package de.linkfa.framevane.broadcaster

import android.content.Context
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.Environment
import com.pedro.library.base.recording.RecordController
import com.pedro.library.view.TakePhotoCallback
import expo.modules.kotlin.Promise
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Recording to the phone, and stills off the live picture.
 *
 * Both write into the app's own external files directory, because that is the
 * only path this app can write to without asking for storage permission and
 * the recorder can only be given a path. A finished take is then moved into
 * the phone's video library - see BroadcasterLibrary.kt for why that move
 * exists and what it costs. Stills stay in the app folder.
 */

/**
 * Starts recording and returns the path being written.
 *
 * The encoder has to be configured before the recorder will take anything, and
 * recording off air is a legitimate thing to do - so this prepares if nothing
 * has, exactly as going live does.
 */
internal fun BroadcasterView.startRecording(): String {
  if (stream.isRecording) return recordingPath
  if (!ensurePrepared()) throw PrepareFailedException()

  /**
   * Same ordering as going live, for the same reason: startRecord starts its
   * sources, and its audio source builds a recorder without releasing the one
   * prepareAudio just built. Handing it a microphone that is already running
   * makes that start a no-op that only swaps the sink.
   */
  monitorAudio(true)
  clearMonitorForAir()

  val dir = recordingsDir() ?: throw RecordingUnavailableException()
  recordingBase = "framevane-${stamp()}"
  recordingSection = 1
  recordingStartedAt = System.currentTimeMillis()
  val file = File(dir, sectionName())
  recordingPath = file.absolutePath

  try {
    stream.startRecord(recordingPath, listener = recordListener())
  } catch (e: Exception) {
    recordingPath = ""
    log(LOG_ERROR, "Recording refused to start: ${e.message}")
    throw RecordingFailedException(e)
  }

  recordingWanted = true
  /**
   * An off-air take starts the encoder with whatever bitrate it was prepared
   * at, and the thermal cap may have moved since - `ensurePrepared` does not
   * prepare again for that. Handed over now that the encoder is running; a
   * running stream already has it from the connection.
   */
  if (!stream.isStreaming) runCatching { stream.setVideoBitrateOnFly(bitrateCeiling()) }
  log(LOG_INFO, "Recording to ${file.name}")
  watchForSplit()
  /**
   * The service is held for a recording as much as for a stream - see
   * [BroadcasterView.syncBackgroundService] - but only stopping a take ever
   * asked for it. A recording started off air never brought the service up, so
   * the first time the phone went in a pocket Android was entitled to take the
   * camera and microphone away from it, and the take ended with the screen.
   */
  syncBackgroundService()
  return recordingPath
}

/**
 * `framevane-20260915-083506.mp4`, or `-001.mp4` when the take is in sections.
 *
 * Unsuffixed when nothing is splitting, so a phone whose operator never turned
 * this on gets the filenames it has always produced.
 */
private fun BroadcasterView.sectionName(): String =
  if (splitMinutes <= 0 && splitBytes <= 0L) "$recordingBase.mp4"
  else "$recordingBase-%03d.mp4".format(recordingSection)

/**
 * Closes one section and opens the next, without the operator seeing anything.
 *
 * Checked on a timer rather than counted in the encoder, because neither limit
 * is a frame count: one is wall-clock and the other is what the muxer has
 * actually written, including its own overhead. Five seconds of slop against a
 * thirty-minute section is nothing, and against 3.5 GB it is about a second's
 * worth of video.
 */
private fun BroadcasterView.watchForSplit() {
  /**
   * On the main looper's own handler, not `View.postDelayed`.
   *
   * A view that is detached queues its posted work into the run queue and runs
   * it when it is next attached - so with the app in the background, which is
   * exactly where a broadcast spends most of its life, the section check
   * simply stopped happening. The recorder kept writing one long file and the
   * limit that was meant to protect it never arrived.
   */
  Handler(Looper.getMainLooper()).postDelayed({
    if (!stream.isRecording) return@postDelayed
    if (splitDue()) rotateRecording()
    watchForSplit()
  }, SPLIT_CHECK_MS)
}

private fun BroadcasterView.splitDue(): Boolean {
  if (rotating) return false
  val byTime = splitMinutes > 0 &&
    System.currentTimeMillis() - recordingStartedAt >= splitMinutes * 60_000L
  val bySize = splitBytes > 0L &&
    (runCatching { File(recordingPath).length() }.getOrNull() ?: 0L) >= splitBytes
  return byTime || bySize
}

/**
 * Stop, then start again on the next name.
 *
 * The frame counters either side go in the log deliberately. RootEncoder has
 * no split of its own, so this is the library's stop and start called back to
 * back, and whether that disturbs the live picture is a question about a
 * particular phone rather than one with an answer in the source. Logging the
 * counters means the first real long broadcast answers it, rather than
 * somebody having to reproduce it later.
 */
private fun BroadcasterView.rotateRecording() {
  val dir = recordingsDir() ?: return
  val before = runCatching { stream.getStreamClient().getDroppedVideoFrames() }.getOrNull() ?: 0L

  rotating = true
  val closed = recordingPath
  val closedMs = sectionMs()
  pendingPublish = recordingPath
  runCatching { stream.stopRecord() }.onFailure {
    log(LOG_WARN, "A section did not close cleanly: ${it.message}")
  }

  recordingSection += 1
  recordingStartedAt = System.currentTimeMillis()
  val next = File(dir, sectionName())
  recordingPath = next.absolutePath

  val started = runCatching {
    stream.startRecord(recordingPath, listener = recordListener())
    true
  }.getOrElse {
    log(LOG_ERROR, "The next section would not start: ${it.message}")
    false
  }
  rotating = false

  if (!started) {
    // The take is over, and saying so is better than a red dot over a recorder
    // that stopped a section ago.
    recordingPath = ""
    val event = recordEvent(false, "", "the next section would not start", closed, closedMs)
    post { runCatching { onRecord(event) } }
    return
  }

  /**
   * The section that just closed, said to the screen without saying the
   * recording stopped: `recording` stays true and the path moves on.
   *
   * The listener cannot say this, because the stop and the start it hears
   * during a split are deliberately kept from the screen - and the next
   * section's first frame then arrived as a plain "recording" event with a new
   * path, which the duration table took as the start of a new take and
   * dropped the one before. Every section but the last lost its duration.
   */
  val section = recordEvent(true, recordingPath, "", closed, closedMs)
  post { runCatching { onRecord(section) } }

  val after = runCatching { stream.getStreamClient().getDroppedVideoFrames() }.getOrNull() ?: 0L
  log(
    LOG_INFO,
    "Section ${recordingSection} started; ${after - before} frames dropped across the join",
  )
}

internal fun BroadcasterView.stopRecording() {
  // Set before the guard: an operator asking for the recording to stop has
  // asked, whether or not the recorder happened to be running at that instant.
  recordingWanted = false
  if (!stream.isRecording) return
  val path = recordingPath
  val ranFor = sectionMs()
  pendingPublish = path
  runCatching { stream.stopRecord() }.onFailure {
    log(LOG_ERROR, "Recording did not close cleanly: ${it.message}")
  }
  // The recorder stops the encoders with it, so they are no longer prepared.
  if (!stream.isStreaming) markUnprepared()
  log(LOG_INFO, "Recording stopped: ${File(path).name}")
  // The background service is held while recording as well as streaming, so
  // a take ending is one of the moments it may no longer be wanted.
  syncBackgroundService()
  /**
   * The one stopped event for a stop that was asked for. The listener hears
   * the same stop - `stopRecord` reports STOPPED before it returns - and used
   * to send its own, so every press of Stop reached the screen twice. It now
   * stays quiet for a stop nobody asked for not to happen; see
   * [recordListener].
   */
  val event = recordEvent(false, path, "", path, ranFor)
  post { runCatching { onRecord(event) } }
  // With nothing streaming, stopping the recorder hands the microphone back to
  // the system - and the operator is still watching the level meter.
  restoreMonitor()
}

/**
 * The recorder talking back.
 *
 * Its callbacks arrive on the recorder's own thread, so events are posted onto
 * the view's thread rather than sent from where they happen.
 */
private fun BroadcasterView.recordListener(): RecordController.Listener {
  val view = this
  return object : RecordController.Listener {
    override fun onStatusChange(status: RecordController.Status) {
      /**
       * RECORDING is not a start. The library reports STARTED from inside
       * `startRecord` and RECORDING later, from the encoder's thread, when the
       * first keyframe reaches the muxer - so counting both told the screen
       * about every take twice, and after a split the late RECORDING arrived
       * as a stranger: a start for a new path, with nothing saying the last
       * one had ended.
       */
      val recording = status == RecordController.Status.STARTED ||
        status == RecordController.Status.RESUMED
      view.log(LOG_INFO, "Recorder ${status.name.lowercase()}")

      /**
       * The move into the video library waits for this rather than for
       * `stopRecord` returning. The muxer finishes on its own thread, and a
       * file copied while it is still writing the index is a file that plays
       * nowhere - which is a worse bug than the one being fixed.
       */
      if (status == RecordController.Status.STOPPED) {
        val finished = view.pendingPublish
        view.pendingPublish = ""
        if (finished.isNotEmpty()) view.publishToLibrary(File(finished))
      }

      // A rotation is one recording as far as the operator is concerned. The
      // stop and the start belong to the app, not to them.
      if (view.rotating) return

      /**
       * A stop that was asked for is announced by [stopRecording], which has
       * the path and the running time in hand. `recordingWanted` is cleared
       * before the stop is made, and `stopRecord` reports STOPPED before it
       * returns, so this is that same stop being heard a second time.
       */
      if (status == RecordController.Status.STOPPED && !view.recordingWanted) return
      if (status == RecordController.Status.RECORDING) return

      /**
       * A take that ended without being asked to, while the broadcast is still
       * going out, starts the next one.
       *
       * This is the difference between losing a minute and losing the rest of
       * the lesson. A section that failed to open, or a muxer that gave up
       * under a full disk that has since been cleared, used to end the
       * recording for good and say so only in a log nobody was reading - an
       * hour of broadcast came back as forty minutes of file. The operator
       * asked for a recording; until they ask for it to stop, the answer to
       * the recorder stopping by itself is to start it again.
       *
       * Once, on a delay, and only while streaming: if the next one fails too
       * this stops, rather than turning a broken recorder into a file every
       * five seconds.
       */
      if (status == RecordController.Status.STOPPED &&
        view.recordingWanted &&
        view.stream.isStreaming
      ) {
        view.log(LOG_WARN, "The recording stopped on its own; starting the next section")
        Handler(Looper.getMainLooper()).postDelayed({
          if (view.recordingWanted && view.stream.isStreaming && !view.stream.isRecording) {
            runCatching { view.startRecording() }.onFailure {
              view.log(LOG_ERROR, "Recording could not be restarted: ${it.message}")
            }
          }
        }, RESTART_AFTER_MS)
      }

      // A stop that arrives here was not asked for, so it closes the take
      // just as a pressed Stop would, and says how long it ran.
      val stopped = status == RecordController.Status.STOPPED
      val event = recordEvent(
        recording,
        view.recordingPath,
        "",
        if (stopped) view.recordingPath else "",
        if (stopped) view.sectionMs() else 0L,
      )
      view.post { runCatching { view.onRecord(event) } }
    }

    override fun onError(e: Exception?) {
      val reason = e?.message ?: e?.javaClass?.simpleName ?: "unknown"
      view.log(LOG_ERROR, "Recording failed: $reason")
      view.post {
        runCatching { view.onRecord(recordEvent(false, view.recordingPath, reason)) }
      }
    }
  }
}

/**
 * `closedPath` and `closedMs` name the file this event finished, when it
 * finished one, and how long it runs. Measured here rather than on the screen
 * because these events are posted to the view, and a detached view holds them
 * until it is attached again - so a clock read in JavaScript on arrival would
 * count the time the phone spent in a pocket.
 */
private fun recordEvent(
  recording: Boolean,
  path: String,
  error: String,
  closedPath: String = "",
  closedMs: Long = 0L,
): Map<String, Any> = mapOf(
  "recording" to recording,
  "path" to path,
  "error" to error,
  "closedPath" to closedPath,
  "closedMs" to closedMs.toDouble(),
)

/** How long the section being written has been running, or 0 if none is. */
private fun BroadcasterView.sectionMs(): Long =
  if (recordingStartedAt > 0L) (System.currentTimeMillis() - recordingStartedAt).coerceAtLeast(0L) else 0L

/**
 * A still off the live picture.
 *
 * RootEncoder takes the photo out of the GL pipeline rather than the camera, so
 * what is written is exactly what viewers are seeing - filters, orientation and
 * all - which is the point of a still from a broadcast rather than a snapshot
 * from a camera app.
 *
 * The callback it takes is stashed and fired on the next render pass, so there
 * is no photo without a running GL context, and no callback at all if the
 * pipeline has stalled. Hence both the guard and the watchdog: a promise that
 * never settles would leave the shutter button dead for the rest of the
 * broadcast.
 */
internal fun BroadcasterView.takePhoto(promise: Promise) {
  val gl = stream.getGlInterface()
  if (!(runCatching { gl.isRunning() }.getOrNull() ?: false)) {
    promise.reject(NoPictureException())
    return
  }

  val dir = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES)
  if (dir == null) {
    promise.reject(RecordingUnavailableException())
    return
  }
  val file = File(dir, "framevane-${stamp()}.jpg")
  val settled = AtomicBoolean(false)
  val view = this

  runCatching {
    gl.takePhoto(object : TakePhotoCallback {
      override fun onTakePhoto(bitmap: Bitmap) {
        if (!settled.compareAndSet(false, true)) {
          bitmap.recycle()
          return
        }
        // This runs on the executor that also renders the broadcast. Encoding a
        // full frame to JPEG there would stall the picture for as long as it
        // takes, so the file is written somewhere else entirely.
        Thread {
          try {
            FileOutputStream(file).use { out ->
              bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            }
            view.log(LOG_INFO, "Still written to ${file.name}")
            promise.resolve(file.absolutePath)
          } catch (e: Exception) {
            view.log(LOG_ERROR, "Still failed: ${e.message}")
            promise.reject(StillFailedException(e))
          } finally {
            bitmap.recycle()
          }
        }.start()
      }
    })
  }.onFailure {
    if (settled.compareAndSet(false, true)) promise.reject(StillFailedException(it))
    return
  }

  postDelayed(
    {
      if (settled.compareAndSet(false, true)) {
        // Leave nothing stashed in the GL layer, or the next frame after the
        // pipeline recovers writes a photo nobody is waiting for.
        runCatching { gl.takePhoto(null) }
        log(LOG_WARN, "The picture did not render in time for a still")
        promise.reject(NoPictureException())
      }
    },
    PHOTO_TIMEOUT_MS,
  )
}

// --- What is on the phone ------------------------------------------------

/**
 * Where takes are written.
 *
 * Takes a context rather than hanging off the view, because a recording is a
 * file: it outlives the preview that made it, and the screen that lists them
 * is one the preview is not mounted on.
 */
internal fun recordingsDir(context: Context): File? {
  val dir = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: return null
  if (!dir.exists() && !dir.mkdirs()) return null
  return dir
}

/** The same, for the code that does have a view in hand. */
internal fun BroadcasterView.recordingsDir(): File? = recordingsDir(context)

/**
 * The recordings, read off the disk every time.
 *
 * Newest first, because the one an operator wants is almost always the one they
 * just made. A recording still being written is listed like any other: its size
 * grows, which says more than hiding it would.
 */
internal fun recordings(context: Context): List<Map<String, Any>> {
  val dir = recordingsDir(context)
  val files = dir?.let { runCatching { it.listFiles() }.getOrNull() } ?: emptyArray()

  /**
   * Both places, in one list.
   *
   * The app folder is not empty just because new takes go to the library:
   * every recording made before this is still in it, so is anything made on a
   * phone too old for the library, and so is anything whose move failed. An
   * operator should not have to know which of those happened to find their
   * file.
   */
  val onPhone = files
    .filter { it.isFile }
    .map {
      mapOf(
        "path" to it.absolutePath,
        "name" to it.name,
        "bytes" to it.length().toDouble(),
        "modifiedAt" to it.lastModified().toDouble(),
        "durationMs" to 0.0,
        "inLibrary" to false,
      )
    }

  return (libraryRecordings(context) + onPhone)
    .sortedByDescending { it["modifiedAt"] as? Double ?: 0.0 }
}

/**
 * Deletes one recording, and only a recording.
 *
 * The path arrives from JavaScript, so it is treated as untrusted: both it and
 * the recordings directory are resolved to canonical paths and the parent has
 * to match exactly. A string prefix check would not do - `.../movies/../../foo`
 * starts with the right characters and points somewhere else entirely - and
 * "delete whatever path you are given" is not a thing an app should be willing
 * to do on request.
 */
internal fun deleteRecording(context: Context, path: String): Boolean {
  // A library entry is addressed by URI and has no file path an app may use,
  // so the canonical-path check below has nothing to check. It is our own
  // entry, which is the whole of the permission question.
  if (path.startsWith("content://")) {
    val uri = runCatching { android.net.Uri.parse(path) }.getOrNull()
      ?: throw OutsideRecordingsException()
    val deleted = deleteFromLibrary(context, uri)
    BroadcasterView.current?.log(
      if (deleted) LOG_INFO else LOG_WARN,
      if (deleted) "Deleted a recording from the library" else "Could not delete $path",
    )
    return deleted
  }

  val dir = recordingsDir(context) ?: throw RecordingUnavailableException()
  val root = runCatching { dir.canonicalFile }.getOrNull() ?: throw RecordingUnavailableException()
  val target = runCatching { File(path).canonicalFile }.getOrNull()
    ?: throw OutsideRecordingsException()

  if (target.parentFile != root) throw OutsideRecordingsException()

  /**
   * The take being written is the one case where the preview matters, and it
   * is asked for rather than required: with no preview mounted nothing is
   * recording, so there is nothing to protect.
   */
  val view = BroadcasterView.current
  if (view != null && view.stream.isRecording &&
    target.absolutePath == File(view.recordingPath).absolutePath
  ) {
    throw RecordingInUseException()
  }
  if (!target.exists()) return false

  val deleted = runCatching { target.delete() }.getOrNull() ?: false
  view?.log(
    if (deleted) LOG_INFO else LOG_WARN,
    if (deleted) "Deleted ${target.name}" else "Could not delete ${target.name}",
  )
  return deleted
}

/**
 * `framevane-20260912-143755`. Seconds are enough - nobody starts two
 * recordings in the same second - and the order the characters sort in is the
 * order the files were made, which is what matters when a phone is holding
 * forty of them.
 */
private fun stamp(): String =
  SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())

/**
 * High enough that the still is worth keeping as a thumbnail or a poster frame,
 * low enough that a 1080p frame is a few hundred kilobytes rather than three
 * megabytes.
 */
private const val JPEG_QUALITY = 92

/**
 * Three seconds. A running pipeline renders within a frame or two; anything
 * that has not produced a frame in three seconds is not about to.
 */
private const val PHOTO_TIMEOUT_MS = 3_000L

/**
 * How often to ask whether a section is due. Cheap - a clock reading and a
 * stat - and five seconds of slop against a half-hour section is nothing.
 */
private const val SPLIT_CHECK_MS = 5_000L

/**
 * Long enough for whatever ended the take to have finished doing so - a muxer
 * closing, a disk catching up - and short enough that the gap in the recording
 * is a sentence rather than a paragraph.
 */
private const val RESTART_AFTER_MS = 2_000L
