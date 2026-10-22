package de.linkfa.framevane.broadcaster

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NoPreviewException :
  CodedException("There is no camera preview mounted to broadcast from.")

class PrepareFailedException :
  CodedException("The encoder refused these settings. Try a lower resolution or frame rate.")

class UnsupportedDestinationException :
  CodedException("That destination is not a URL this app can broadcast to. Use rtmp://, rtmps:// or srt://.")

class BadPassphraseException :
  CodedException("An SRT passphrase must be between 10 and 79 characters, or empty.")

class RecordingUnavailableException :
  CodedException("The phone did not give this app anywhere to write to.")

class NoContextException :
  CodedException("The app has no context yet, so it cannot reach the recordings.")

class NoActivityException :
  CodedException("The app is not on screen, so it cannot ask for a folder.")

class FolderPickInProgressException :
  CodedException("The folder picker is already open.")

class NoFolderPickerException :
  CodedException("This phone has no file picker to choose a folder with.")

class RecordingFailedException(cause: Throwable) :
  CodedException("The recorder would not start.", cause)

class RecordingInUseException :
  CodedException("That recording is still being written. Stop it before deleting it.")

class OutsideRecordingsException :
  CodedException("That path is not one of this app's recordings.")

class NoPictureException :
  CodedException("There is no live picture to take a still from.")

class StillFailedException(cause: Throwable) :
  CodedException("The still could not be written.", cause)

class UnknownAudioDeviceException :
  CodedException("That microphone is no longer attached.")

/**
 * The schemes GenericStream will actually dial.
 *
 * Checked here rather than left to the library, because the library answers an
 * unknown scheme by marking itself as streaming and then reporting a failure
 * asynchronously - which leaves the object convinced it is live, so the next
 * attempt throws. A scheme is something that can be judged before any of that
 * happens.
 */
private val SUPPORTED_SCHEMES = listOf("rtmp", "rtmps", "rtmpt", "rtmpts", "rtsp", "rtsps", "srt", "udp")

/**
 * The JS-facing surface of the broadcaster.
 *
 * Every function acts on the one mounted preview rather than taking a view
 * handle: there is only ever one camera in play, and threading a ref through
 * React for something the phone can only do once buys nothing.
 *
 * The definition is split across files by concern - the camera controls, the
 * audio ones, and recording - because one list of forty functions is a list
 * nobody reads. They are extensions on the same builder, so the shape of the
 * module is unchanged.
 */
/**
 * The folder picker's request code and the promise waiting on it. One at a
 * time: two pickers would be two dialogs over each other.
 */
private const val FOLDER_REQUEST = 8_431
private var pendingFolderPick: Promise? = null

/**
 * The application context, kept from the moment the module is created.
 *
 * Everything to do with files used to reach the disk through the camera
 * preview, which is wrong twice over: a recording is a file and has nothing to
 * do with the camera, and the preview is not mounted on the screen where the
 * recordings are listed. Opening one there failed with "there is no camera
 * preview mounted to broadcast from", deleting one failed the same way with
 * the error swallowed, and the list came back empty afterwards - which read
 * exactly like every recording having just been deleted.
 *
 * Application context, so it outlives every Activity and leaks nothing.
 */
internal var moduleContext: Context? = null

/**
 * The context for anything that touches storage: the preview's if there is
 * one, the module's otherwise. There is always one of the two by the time
 * JavaScript can call anything.
 */
internal fun fileContext(): Context =
  BroadcasterView.current?.context?.applicationContext
    ?: moduleContext
    ?: throw NoContextException()

class BroadcasterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FramevaneBroadcaster")

    OnCreate { moduleContext = appContext.reactContext?.applicationContext }

    View(BroadcasterView::class) {
      Events(
        "onStatus",
        "onBitrate",
        "onLevel",
        "onCameras",
        "onAudioDevices",
        "onLog",
        "onRecord",
        "onAudioInterrupted",
        "onThermal",
      )
    }

    /**
     * Asks Android for a folder to keep recordings in.
     *
     * Here rather than in one of the split-out files because it needs the
     * module's own `appContext` to reach the Activity, which the extension
     * functions elsewhere have no way to.
     *
     * The permission is taken persistably, so the choice survives a reboot.
     * Everything else about the folder - writing into it, falling back when it
     * is gone - lives with the rest of the recording code.
     */
    AsyncFunction("pickRecordingFolder") { promise: Promise ->
      val activity = appContext.activityProvider?.currentActivity
      if (activity == null) {
        promise.reject(NoActivityException())
        return@AsyncFunction
      }
      if (pendingFolderPick != null) {
        promise.reject(FolderPickInProgressException())
        return@AsyncFunction
      }
      pendingFolderPick = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        .addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
        )
      runCatching { activity.startActivityForResult(intent, FOLDER_REQUEST) }.onFailure {
        pendingFolderPick = null
        promise.reject(NoFolderPickerException())
      }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != FOLDER_REQUEST) return@OnActivityResult
      val promise = pendingFolderPick ?: return@OnActivityResult
      pendingFolderPick = null

      val uri = payload.data?.data
      if (uri == null) {
        // Cancelled. Not a failure - an operator who changed their mind gets
        // the folder they already had, which is what an empty string means to
        // everything downstream.
        promise.resolve("")
        return@OnActivityResult
      }

      /**
       * Without taking the permission persistably, the grant dies with this
       * process and the first recording after a restart fails to a folder the
       * settings screen still claims is chosen.
       */
      runCatching {
        appContext.reactContext?.contentResolver?.takePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
      }
      BroadcasterView.current?.recordingFolder = uri.toString()
      promise.resolve(uri.toString())
    }

    /**
     * Where finished takes go: a document-tree URI, or empty for the phone's
     * video library. Set on every start, because the view outlives neither the
     * screen nor the preference.
     */
    AsyncFunction("setRecordingFolder") { uri: String -> view().recordingFolder = uri }

    Function("recordingFolder") { BroadcasterView.current?.recordingFolder ?: "" }

    /**
     * Encoder settings. Applied on the next start, never mid-broadcast: the
     * resolution and frame rate are baked into the encoder when it spawns, and
     * changing them under a running stream is how you get half a second of
     * garbage on every platform at once.
     */
    AsyncFunction("configure") { settings: Map<String, Any?> ->
      val v = view()
      (settings["width"] as? Number)?.let { v.videoWidth = it.toInt() }
      (settings["height"] as? Number)?.let { v.videoHeight = it.toInt() }
      (settings["fps"] as? Number)?.let { v.videoFps = it.toInt() }
      (settings["videoBitrate"] as? Number)?.let { v.videoBitrate = it.toInt() }
      (settings["videoCodec"] as? String)?.let { v.requestVideoCodec(it) }
      (settings["audioBitrate"] as? Number)?.let { v.audioBitrate = it.toInt() }
      (settings["sampleRate"] as? Number)?.let { v.audioSampleRate = it.toInt() }
      (settings["stereo"] as? Boolean)?.let { v.audioStereo = it }
      (settings["micGain"] as? Number)?.let { v.setMicGain(it.toFloat()) }
      (settings["echoCanceler"] as? Boolean)?.let { v.echoCanceler = it }
      (settings["noiseSuppressor"] as? Boolean)?.let { v.noiseSuppressor = it }
      (settings["preferHardwareCodec"] as? Boolean)?.let { v.preferHardwareCodec = it }
      (settings["adaptiveBitrate"] as? Boolean)?.let { v.adaptiveBitrate = it }
      (settings["autoReconnect"] as? Boolean)?.let { v.autoReconnect = it }
      (settings["reconnectDelayMs"] as? Number)?.let { v.reconnectDelayMs = it.toLong() }
      if (!v.prepare()) throw PrepareFailedException()
    }

    /**
     * `rtmp://host/app/key`, `rtmps://` for the same over TLS, or
     * `srt://host:8890?streamid=...`. RootEncoder picks the protocol from the
     * scheme, so the app never chooses a client.
     */
    AsyncFunction("startStream") { url: String ->
      val v = view()
      if (!v.stream.isStreaming) {
        if (SUPPORTED_SCHEMES.none { url.startsWith("$it://", ignoreCase = true) }) {
          throw UnsupportedDestinationException()
        }
        if (!v.ensurePrepared()) throw PrepareFailedException()
        // Both of these have to happen before the socket opens: the library
        // ignores a passphrase set on a running stream, and the latency only
        // exists as part of the URL.
        v.applySrtPassphrase()
        // The retry budget too: the library's starts at zero, and a first
        // connection with nothing to fall back on fails outright.
        v.beginConnection()

        /**
         * Hand the encoder a microphone that is already running.
         *
         * `startStream` opens the socket and only then starts its sources, and
         * its audio source builds an AudioRecord without releasing the one
         * `prepareAudio` just built. When the second is refused it throws -
         * after the connection is up - so the operator saw a connected stream,
         * an error, and nothing arriving at the server. RootEncoder's own start
         * is a no-op on a running source and only swaps the sink, so starting
         * it here means there is no second recorder to refuse.
         */
        v.monitorAudio(true)

        runCatching { v.stream.startStream(v.srtDestination(url)) }.onFailure {
          /**
           * The library sets isStreaming before it opens anything and does not
           * unset it when a later step throws, so a failed start leaves the
           * encoder convinced it is live: the next prepare returns early
           * without preparing, and whatever is asked for after that fails for
           * a reason that has nothing to do with itself. Putting it back is
           * the difference between one failure and every subsequent one.
           */
          runCatching { v.stream.stopStream() }
          v.markUnprepared()
          v.log(LOG_WARN, "The broadcast would not start: ${it.message}")
          throw it
        }
        v.syncBackgroundService()
      }
    }

    AsyncFunction("stopStream") {
      val v = view()
      /**
       * The recording ends with the broadcast that was carrying it, and it has
       * to end through `stopRecording` rather than as a side effect of the
       * encoders stopping - that is the only path that finalises the file and
       * tells JavaScript the recorder has stopped.
       *
       * Without this the file was written and closed, so it appeared in the
       * recordings list, but no `onRecord` ever said so: the REC badge went on
       * counting a recording that had already finished, until the screen was
       * left and came back. A screen that keeps timing something that is over
       * is a screen claiming a state the app is not in.
       *
       * Before the stream, so the muxer closes while its encoders are still
       * running rather than after they have been torn down.
       */
      if (v.stream.isRecording) runCatching { v.stopRecording() }
      if (v.stream.isStreaming) v.stream.stopStream()
      // Stopping the stream stops the encoders with it, so they have to be
      // prepared again before anything else can use them.
      v.markUnprepared()
      // The service must never outlive the stream, and the level meter should
      // come back now that the encoder has let go of the microphone.
      v.syncBackgroundService()
      v.restoreMonitor()
    }

    Function("isStreaming") { BroadcasterView.current?.stream?.isStreaming ?: false }

    /**
     * Dropped frames, queue depth and the frame rate actually leaving the
     * phone, which is what says whether the uplink is keeping up. The bitrate
     * alone does not: a stream can report its target right up until the moment
     * it stalls.
     */
    Function("stats") { BroadcasterView.current?.stats() ?: idleStats() }

    /**
     * Changing the bitrate of a running encoder IS safe, unlike resolution -
     * it is the one knob an operator can turn when the uplink is struggling
     * without interrupting what viewers are watching.
     */
    AsyncFunction("setVideoBitrate") { bitrate: Int ->
      val v = view()
      v.videoBitrate = bitrate
      if (v.stream.isStreaming) v.stream.setVideoBitrateOnFly(bitrate)
    }

    /**
     * SRT's latency floor and passphrase. Both apply to the next connection:
     * the passphrase is part of the handshake and the latency is negotiated
     * with it, so neither can change under a live stream.
     */
    AsyncFunction("setSrtOptions") { options: Map<String, Any?> ->
      val v = view()
      (options["latencyMs"] as? Number)?.let { v.srtLatencyMs = it.toInt().coerceAtLeast(0) }
      /**
       * Absent counts as empty. A destination without a passphrase used to
       * send nothing here, which left the previous destination's passphrase on
       * the view - so the next SRT broadcast tried to encrypt for a server that
       * had never been given the key, and was refused for no visible reason.
       */
      val passphrase = options["passphrase"] as? String ?: ""
      // Rejected here rather than at connect time: SRT's own handshake has
      // this limit, and finding out on the way to air is too late.
      if (passphrase.isNotEmpty() &&
        passphrase.length !in SRT_PASSPHRASE_MIN..SRT_PASSPHRASE_MAX
      ) {
        // Cleared on the way out, so a refused passphrase cannot leave the
        // last destination's in its place.
        v.srtPassphrase = ""
        throw BadPassphraseException()
      }
      v.srtPassphrase = passphrase
    }

    /**
     * The picture the encoder is actually producing, or null if it has not
     * been built. Read before going live while an off-air recording runs: a
     * configure under a running recorder changes nothing, so this is how the
     * screen finds out whether the destination's picture would be ignored.
     */
    Function("encoderPicture") { BroadcasterView.current?.encoderPicture }

    /**
     * Which codecs this handset will actually encode. Read before offering
     * H.265: on a phone that cannot do it, the choice is a trap.
     */
    Function("supportedCodecs") { supportedCodecs() }

    /**
     * Which way the broadcast is shaped. Decided before going live, because a
     * stream that changes shape halfway through is worse than one in the wrong
     * shape: every platform re-encodes it and viewers get letterboxing on top
     * of letterboxing.
     */
    AsyncFunction("setOrientation") { mode: String -> view().setOrientation(mode) }

    Function("orientation") { BroadcasterView.current?.orientation ?: "auto" }

    cameraFunctions()
    audioFunctions()
    captureFunctions()
  }
}

/** The one mounted preview, or a refusal that says why. */
internal fun view(): BroadcasterView = BroadcasterView.current ?: throw NoPreviewException()

/**
 * The shape of [stats] with nothing mounted. Every field, because a screen
 * reading `stats().codec` should not have to know whether a preview exists.
 */
private fun idleStats(): Map<String, Any> = mapOf(
  "bitrate" to 0,
  "droppedVideoFrames" to 0,
  "droppedAudioFrames" to 0,
  "sentVideoFrames" to 0,
  "sentAudioFrames" to 0,
  "queueItems" to 0,
  "queueCapacity" to 0,
  "bytesSent" to 0,
  "congested" to false,
  "width" to 0,
  "height" to 0,
  "fps" to 0,
  "measuredFps" to 0,
  "codec" to "h264",
  "recording" to false,
  "videoMuted" to false,
)
