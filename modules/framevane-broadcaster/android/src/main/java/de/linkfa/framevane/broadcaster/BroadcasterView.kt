package de.linkfa.framevane.broadcaster

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaCodec
import android.net.Uri
import android.os.BatteryManager
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import com.pedro.common.ConnectChecker
import com.pedro.common.VideoCodec
import com.pedro.encoder.CodecErrorCallback
import com.pedro.encoder.Frame
import com.pedro.encoder.input.audio.GetMicrophoneData
import com.pedro.encoder.input.sources.OrientationConfig
import com.pedro.encoder.input.sources.OrientationForced
import com.pedro.encoder.input.sources.audio.MicrophoneSource
import com.pedro.encoder.input.gl.render.filters.BaseFilterRender
import com.pedro.encoder.input.gl.render.filters.EdgeDetectionFilterRender
import com.pedro.encoder.input.sources.video.Camera2Source
import com.pedro.encoder.input.video.CameraCallbacks
import com.pedro.encoder.input.video.CameraHelper
import com.pedro.encoder.utils.CodecUtil
import com.pedro.encoder.utils.gl.AspectRatioMode
import com.pedro.library.generic.GenericStream
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.atan
import kotlin.math.roundToInt

/** The three levels [LogEntry] carries. Strings, because that is what JS reads. */
internal const val LOG_INFO = "info"
internal const val LOG_WARN = "warn"
internal const val LOG_ERROR = "error"

/**
 * The camera preview, and the encoder behind it.
 *
 * RootEncoder's GenericStream takes the destination as a URL and picks the
 * protocol from its scheme - `rtmp://` and `srt://` are the two this app
 * offers - so one object covers both and the app never has to care which is in
 * use beyond telling the operator.
 *
 * There is deliberately one of these at a time. A phone has one camera stack
 * and one microphone, and a second preview would fight the first for both, so
 * the module keeps a reference to the live one and refuses to hold two.
 */
class BroadcasterView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), ConnectChecker {

  private val onStatus by EventDispatcher()
  private val onBitrate by EventDispatcher()
  private val onLevel by EventDispatcher()
  private val onCameras by EventDispatcher()
  private val onLog by EventDispatcher()
  internal val onAudioDevices by EventDispatcher()
  internal val onRecord by EventDispatcher()
  internal val onAudioInterrupted by EventDispatcher()
  internal val onThermal by EventDispatcher()

  val camera = Camera2Source(context)
  val microphone = MicrophoneSource()
  val stream = GenericStream(context, this, camera, microphone)

  /**
   * React Native does not lay out the children of a view it does not own, so
   * without this the SurfaceView below is measured at zero by zero and the
   * viewfinder is simply black - which is exactly what the first working
   * build did. Expo's own note on the flag says as much: with it, Android's
   * layout pass runs inside the bounds Yoga has already decided.
   */
  override val shouldUseAndroidLayout: Boolean = true

  /**
   * Keep trying, the way every broadcaster does.
   *
   * A phone loses its connection mid-sermon and gets it back twenty seconds
   * later; an operator who has put the phone on a stand is not watching the
   * screen to press a button. RootEncoder does the reconnecting, but only if it
   * is told how many times and when - so a failure is answered here rather than
   * reported and forgotten.
   */
  var autoReconnect = true
  var reconnectDelayMs = 4_000L

  /**
   * How many failures this connection has already answered.
   *
   * The delay doubles with each one. A phone that has just walked out of
   * coverage will not be back in four seconds, and hammering the socket every
   * four seconds for forty seconds wastes the retry budget on the first ten
   * seconds of a two-minute outage - so the ladder starts at the configured
   * delay and climbs to [RECONNECT_CEILING_MS], which is long enough to sit
   * out a lift or a tunnel without giving up the broadcast.
   */
  private var reconnectAttempt = 0

  /**
   * Whether this broadcast has reached the server at least once.
   *
   * It is what separates a reconnect from a slow first connection, and the two
   * have to be reported differently. RootEncoder calls `onConnectionStarted`
   * for every attempt, retries included, and that used to be reported as
   * `connecting` - so each retry of a broadcast that had been on air dropped
   * the screen out of live and turned End broadcast into an unconfirmed
   * Cancel, mid-outage, under the operator's thumb. Before the first success
   * nothing has gone out and Cancel is the honest button; after it, the
   * broadcast is live and dialling back in until somebody ends it.
   */
  private var connectedOnce = false

  /**
   * Why the last attempt failed, said again while the next one dials.
   *
   * The retry's own `onConnectionStarted` only knows the URL, and the URL is
   * the one thing that must not be shown: it carries the stream key, and the
   * notification that repeats this is on the lock screen.
   */
  private var lastFailure = ""

  /**
   * The picture the encoder was last actually built with, or null if the last
   * attempt to build it was refused.
   *
   * Not the same as the fields above. Those are what was last asked for, and a
   * configure under a running recorder stores them and changes nothing, so
   * they can describe a picture the encoder is not producing. Going live while
   * an off-air recording runs needs the real one to decide whether the
   * recording can carry on or has to make way for the destination's picture.
   */
  internal var encoderPicture: Map<String, Any>? = null
    private set

  /**
   * Adaptive bitrate: the difference between a stream that degrades and one
   * that stalls. When the socket's queue backs up the uplink is not carrying
   * what the encoder is producing, and the only useful response is to produce
   * less - immediately, and recover slowly, because coming back up fast just
   * causes the next stall.
   */
  var adaptiveBitrate = true
  private var currentBitrate = 0
  private var healthyTicks = 0

  /** Whether the encoder has been configured since the last settings change. */
  private var prepared = false

  /**
   * Whether the microphone half of that is still good. Kept separately because
   * a rotation only invalidates the picture.
   */
  private var audioPrepared = false

  /** Last values asked for, so the preview can be rebuilt after a rotation. */
  /**
   * The capture-request choices the camera cannot be asked to read back.
   *
   * Camera2 has no getter for either - the builder holds them and RootEncoder
   * does not surface it - so the last value set is the only record, and
   * `capabilities()` reports these rather than guessing. They are re-applied
   * when a lens opens, because a new capture request starts at the camera's
   * own defaults.
   */
  internal var noiseReduction = android.hardware.camera2.CameraCharacteristics.NOISE_REDUCTION_MODE_FAST
  internal var antiFlicker =
    android.hardware.camera2.CameraCharacteristics.CONTROL_AE_ANTIBANDING_MODE_AUTO

  /**
   * Whether either of the two above has been asked for.
   *
   * Both start at what the camera would do anyway, so on a phone whose
   * operator never opens those controls there is nothing to put back and the
   * re-apply is skipped entirely - no extra repeating request on any lens
   * change, which is the common case.
   */
  internal var captureRequestOverridden = false

  var videoWidth = 1280
  var videoHeight = 720

  /**
   * The height the copy on the phone is written at, or 0 to match what is
   * going out.
   *
   * The two are separate jobs. What leaves the phone is limited by the uplink
   * in the hall; what is kept is limited by the disk, and an operator sending
   * 360p over a bad connection has no reason to keep a 360p master. The
   * library will run a second video encoder for this, so it is off by default:
   * two encoders is more heat, and heat is the thing that ends long
   * broadcasts.
   */
  var recordHeight = 0
  var recordBitrate = 0
  var videoFps = 30
  var videoBitrate = 2_500_000
  var audioBitrate = 128_000
  var audioSampleRate = 44_100
  var audioStereo = true

  /**
   * Android's own capture-side effects. Off by default: they are worth having
   * on a phone held at arm's length in a hall, and worth avoiding when a decent
   * external microphone is plugged in, because the processing chews what a good
   * microphone picks up and there is no undoing it after the broadcast.
   */
  var echoCanceler = false
  var noiseSuppressor = false

  /**
   * Encode on the media hardware. On, and it should stay on: software H.264 on
   * a phone heats it until it thermally throttles, which ends a long broadcast
   * by itself. The switch exists only because a few devices ship a broken
   * hardware HEVC encoder, and on those falling back to whatever the phone will
   * give us is the difference between a soft picture and no broadcast.
   */
  var preferHardwareCodec = true

  /**
   * `h264` or `h265`. See [requestVideoCodec] for why `av1` is not among them.
   */
  var videoCodec = "h264"
    private set

  /**
   * SRT's latency floor, in milliseconds, and its passphrase.
   *
   * Both belong to the connection rather than the encoder, so they are applied
   * as the URL is dialled rather than at prepare time. Zero latency means "do
   * not ask for a floor" and an empty passphrase means "unencrypted".
   */
  var srtLatencyMs = 0
  var srtPassphrase = ""

  /** `auto`, `portrait` or `landscape`. See [setOrientation]. */
  var orientation = "auto"
    private set

  /**
   * The rotation the encoder was last configured with, in the library's own
   * terms: 90 and 270 mean a portrait stream, 0 and 180 a landscape one.
   *
   * The shape of the outgoing picture is fixed when the encoder spawns and
   * cannot be changed afterwards, so what it was fixed to is the only thing
   * the way the phone is now being held can be compared against - without it
   * nothing could tell that the phone had been turned since. -1 means nothing
   * has been configured yet.
   */
  private var preparedRotation = -1

  /**
   * The rotation already complained about while live, so the log carries one
   * line per turn of the phone rather than one per surface callback.
   */
  private var warnedRotation = -1

  /**
   * Whether the operator has asked for the broadcast to survive the app going
   * off screen. See [syncBackgroundService], which the setter calls so that
   * turning the preference on mid-broadcast takes effect there and then rather
   * than at the next start.
   */
  var backgroundBroadcast = false
    set(value) {
      field = value
      syncBackgroundService()
    }

  /**
   * Whether this view has asked for the service and not since asked it to
   * stop, as against whether it is running - which only the service knows.
   *
   * The two used to be one flag, set the moment `startForegroundService`
   * returned. That call returns long before the service does anything, and
   * the service can then refuse - Android 12 will not let a background app
   * start one, Android 14 will not let it hold the camera without the
   * permission - and stop itself. The flag stayed true, so every later sync
   * believed the service was up and never asked again: the phone went in a
   * pocket with no foreground service, and Android took the camera. The
   * service now says whether it is running ([BroadcastService.isRunning]) and
   * clears this when it goes ([onServiceGone]), so a refusal is retried at
   * the next chance - the app coming back to the front being the one that
   * matters.
   */
  @Volatile
  private var serviceRequested = false

  /** Where the recorder is writing, or last wrote. */
  internal var recordingPath = ""

  /**
   * Whether a finished take is moved into the phone's own video library.
   *
   * The recorder can only write to a path, and the only path this app may
   * write to without asking for storage permission is its own external files
   * directory - which nothing else on the phone can see. So the take is
   * written there and moved afterwards, and this is the switch for whether
   * that move happens. Off leaves it in the app's folder, which is where every
   * recording made before this lived.
   */
  internal var saveToGallery = true

  /**
   * A document-tree URI the operator picked, or empty for the library.
   *
   * Held as the string it arrives as: nothing here needs it parsed except the
   * one call that copies into it, and a permission that has been revoked
   * parses exactly as well as one that has not.
   */
  internal var recordingFolder = ""

  /** A finished take waiting to be moved, held between stop and STOPPED. */
  internal var pendingPublish = ""

  /**
   * Whether the operator asked for a recording and has not asked for it to
   * stop.
   *
   * The recorder can end a take on its own - a section that failed to open, a
   * muxer that gave up - and until now that was the end of the recording for
   * the rest of the broadcast, silently. An hour of video produced forty
   * minutes of file. This is what lets the next section start itself.
   */
  internal var recordingWanted = false

  /**
   * When to close a section and open the next one. Zero is off.
   *
   * One file for three hours is one chance: a muxer that never finished, a
   * card reader that will not take a file over four gigabytes, a copy that
   * fails at 98% - each of those costs the whole take rather than one section
   * of it.
   */
  internal var splitMinutes = 0
  internal var splitBytes = 0L

  /** The stamp every section of this take shares, and which section this is. */
  internal var recordingBase = ""
  internal var recordingSection = 0
  internal var recordingStartedAt = 0L

  /**
   * Set while one section is being closed and the next opened, so the stop
   * that belongs to a rotation does not reach the screen as a recording
   * ending. The operator asked for one recording; the sections are how it is
   * stored, not something they should have to watch happen.
   */
  internal var rotating = false

  /**
   * Whether the microphone is currently handing back nothing.
   *
   * The one place the answer lives, so that two detectors reporting the same
   * interruption is one banner rather than two - see BroadcasterInterruptions.
   *
   * Volatile because the two detectors are on different threads: the recording
   * callback arrives on the main looper and the level meter runs on the audio
   * thread, several times a second.
   */
  @Volatile
  internal var audioSilenced = false

  /**
   * Where the lens is held, in dioptres, and whether it is being held at all.
   *
   * Camera2 has no getter for either while the request is ours, so the same
   * rule as the settings above applies: the last value set is the only record,
   * and it is put back when a capture session is rebuilt.
   */
  internal var focusDistance = 0f
  internal var manualFocus = false

  /** The last zoom range logged, so the line appears on a change and not on a poll. */
  internal var lastZoomSummary = ""

  /**
   * The input device the operator chose, or -1 for Android's own choice.
   *
   * Backed by a value outside this view, because the screen where the choice
   * is made has no view. Audio settings is its own route: the viewfinder is
   * detached by the time a chip is tapped, and a preference stored on the view
   * would be stored on nothing and then read back as -1 by the next one.
   */
  internal var selectedAudioDeviceId: Int
    get() = chosenAudioDeviceId
    set(value) {
      chosenAudioDeviceId = value
    }

  /**
   * Whether auto-exposure is held where it is.
   *
   * Tracked here because Camera2 has no getter for the lock either, and
   * because a freshly opened camera is metering - so this starts where the
   * camera actually starts, which is unlocked.
   */
  internal var exposureLocked = false

  /**
   * Frames per second measured from what has actually left the phone.
   *
   * Sampled once a second off the bitrate tick, because that is a clock the
   * library already runs and a broadcast does not need a second one.
   */
  private var measuredFps = 0
  private var lastSentFrames = 0L
  private var lastFrameSampleAt = 0L

  private var audioDeviceCallback: AudioDeviceCallback? = null

  private val surfaceView = SurfaceView(context).apply {
    layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    )
  }

  // --- Microphone level -------------------------------------------------

  /**
   * The level meter, which is not a decoration.
   *
   * The one broadcast fault an operator cannot see is silence: the picture
   * looks perfect and nobody hears anything, and they find out from a comment
   * ten minutes in. A moving bar answers "is the microphone working" before
   * going live, which is the only time the answer is cheap.
   *
   * The peak is measured on every PCM buffer, which is dozens of times a
   * second - far more than a bar on a screen can show - so it is held and
   * forwarded ten times a second. The measuring is done in [MicrophoneLevel]
   * rather than with the library's own AmplitudeEffect, for a reason worth
   * reading before anyone swaps it back.
   */
  private var peakSinceEmit = 0f
  @Volatile
  private var lastLevelEmit = 0L

  private val levelMeter = MicrophoneLevel { peak ->
    if (peak > peakSinceEmit) peakSinceEmit = peak
    val now = System.currentTimeMillis()
    if (now - lastLevelEmit >= LEVEL_INTERVAL_MS) {
      lastLevelEmit = now
      val held = peakSinceEmit
      peakSinceEmit = 0f
      // Measured on the audio thread; events go out from the thread the view
      // lives on.
      post { onLevel(mapOf("peak" to held.toDouble(), "muted" to microphone.isMuted())) }
    }
  }

  /**
   * Where the microphone's frames go while nothing is being broadcast.
   *
   * The meter needs the microphone running, and off air nothing else wants the
   * frames. RootEncoder's own `start` is a no-op when the source is already
   * running and only swaps the sink, so going live hands the same running
   * microphone to the encoder without a gap.
   */
  private val discard = object : GetMicrophoneData {
    override fun inputPCMData(frame: Frame) = Unit
  }

  private var monitoring = false

  /**
   * Whether the preview surface has gone - the app backgrounded, the screen
   * off - and whether the meter was closed for it and should come back with
   * the surface. See [parkMonitor].
   */
  @Volatile
  private var previewGone = false
  @Volatile
  private var monitorParked = false

  init {
    addView(surfaceView)
    claim(this)
    microphone.setAudioEffect(levelMeter)

    /**
     * The viewfinder letterboxes rather than crops, in every mode, rather than
     * only when the broadcast and the screen turn out to be different shapes.
     *
     * `Fill` would scale the picture until it covers the screen and throw away
     * whatever hangs over the edge, which looks better and is a lie: a 16:9
     * broadcast on a 20:9 phone would lose a strip off each end of what is
     * actually going out, and the operator would frame a caption or a face
     * against an edge that viewers never see. `Adjust` fits the whole frame in
     * and puts black beside it. The black is not a defect - it is where the
     * broadcast stops, which is the one thing a viewfinder exists to show.
     *
     * This is safe to decide here because it is preview-only: the library reads
     * it in drawScreenPreview, while both encoder draws go through
     * drawScreenEncoder, which takes no aspect ratio at all. Nothing chosen
     * here can reach a viewer.
     */
    runCatching { stream.getGlInterface().setAspectRatioMode(AspectRatioMode.Adjust) }

    surfaceView.holder.addCallback(object : SurfaceHolder.Callback {
      override fun surfaceCreated(holder: SurfaceHolder) {
        /**
         * Preview cannot start before there is a surface to draw on, and the
         * surface arrives after React has mounted the view - so this, not the
         * constructor, is where the camera actually opens.
         *
         * The size comes from the surface rather than from the view, because
         * with Android running the layout inside Yoga's bounds the view can
         * still be measuring at zero when this fires - and a preview started
         * at zero by zero stays that way. The library's own preview callback
         * reads surfaceFrame for the same reason.
         */
        synchronized(this@BroadcasterView) {
        if (!stream.isOnPreview) {
          /**
           * Configure first. Starting the preview before prepareVideo has ever
           * run opens the camera and the GL renderer at zero by zero - the
           * resolution calculator is handed a 0x0 target and returns 0x0 - and
           * it is only put right when something else happens to configure the
           * encoder later. That costs a whole camera open and close at startup,
           * and closing the camera is what drops the capture request the torch
           * lives in, which is the likeliest reason the torch did nothing.
           */
          prepare(videoOnly = true)
          /**
           * A camera Android took while the app was away still reports itself
           * running - see [watchCamera] - and `startPreview` only opens a
           * source that says it is stopped. Stopping it first is what makes
           * the viewfinder come back with a picture instead of black.
           */
          if (cameraLost) runCatching { camera.stop() }
          val frame = holder.surfaceFrame
          runCatching {
            stream.startPreview(holder.surface, frame.width(), frame.height())
          }.onFailure { log(LOG_WARN, "The preview would not start: ${it.message}") }
        }
        }
        reportCameras()
        reportAudioDevices()
        previewGone = false
        if (monitorParked) {
          monitorParked = false
          monitorAudio(true)
        }
      }

      override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        /**
         * The renderer has to be told how big the surface it is drawing into
         * has become, or it keeps fitting the picture into the shape the
         * surface used to be. RootEncoder's own example puts exactly this call
         * here.
         */
        runCatching { stream.getGlInterface().setPreviewResolution(width, height) }
        /**
         * On its own that only moved the black bands about, because it resizes
         * the window the picture is drawn into and never the picture. Turning
         * the phone has to reach the encoder as well, and this is the callback
         * that always fires when it happens - the surface cannot change shape
         * without one. Posted rather than called, because re-shaping takes the
         * preview down and back up and that must not happen with a surface
         * callback still on the stack.
         */
        post { syncAutoOrientation() }
      }

      override fun surfaceDestroyed(holder: SurfaceHolder) {
        /**
         * The preview goes, the broadcast does not. Backgrounding the app or
         * turning the screen off destroys the surface, and an operator who has
         * put their phone in a pocket mid-sermon has not asked to stop
         * broadcasting.
         */
        synchronized(this@BroadcasterView) {
          if (stream.isOnPreview) runCatching { stream.stopPreview() }
        }
        previewGone = true
        // Off air and not recording, the meter has no one to show to.
        if (!stream.isStreaming && !stream.isRecording) parkMonitor()
      }
    })

    /**
     * A camera appearing or disappearing is worth knowing about: plugging in a
     * USB camera mid-setup should offer it, and unplugging one mid-broadcast
     * should not leave the operator looking at a stale list.
     */
    runCatching {
      camera.setAvailabilityCallback(object : CameraManager.AvailabilityCallback() {
        override fun onCameraAvailable(cameraId: String) {
          post { reportCameras() }
        }

        override fun onCameraUnavailable(cameraId: String) {
          post { reportCameras() }
        }
      })
    }

    watchAudioDevices()
    watchCamera()

    /**
     * An encoder that has died is the one failure that looks exactly like a
     * working broadcast from the outside: the socket stays up and nothing
     * arrives. It has to reach the log.
     */
    runCatching {
      stream.setEncoderErrorCallback(object : CodecErrorCallback {
        override fun onCodecError(
          type: CodecUtil.CodecTypeError,
          e: MediaCodec.CodecException,
        ) {
          log(LOG_ERROR, "The ${type.name.lowercase()} encoder failed: ${e.message}")
        }

        override fun onEncodeError(
          type: CodecUtil.CodecTypeError,
          e: IllegalStateException,
        ): Boolean {
          log(LOG_WARN, "The ${type.name.lowercase()} encoder stalled; resetting it")
          // True is the library's own default and the right answer: a reset
          // costs a keyframe, and the alternative is a broadcast that carries
          // on with a dead encoder behind it.
          return true
        }
      })
    }
  }

  // --- Getting the camera back -----------------------------------------

  /**
   * The camera was taken away and has not been given back.
   *
   * Android can take the camera from an app that has gone to the background -
   * a foreground service it refused, or a maker's battery manager that ignores
   * the service - and RootEncoder closes the device when that happens but
   * leaves its own `isRunning` set. Nothing then reopens it: `startPreview`
   * skips a source that claims to be running, so the operator came back to a
   * black viewfinder, and the encoder, given no frames, sent audio alone. Every
   * reconnect after that published a stream with no picture, which the server
   * read as "no picture for 8s" and dialled again, over and over, for as long
   * as the class went on.
   */
  @Volatile
  private var cameraLost = false
  private var cameraRecoveries = 0
  private val cameraHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private val recoverCamera = Runnable { reopenCamera() }

  private fun watchCamera() {
    runCatching {
      camera.setCameraCallback(object : CameraCallbacks {
        override fun onCameraChanged(facing: CameraHelper.Facing) = Unit

        override fun onCameraOpened() {
          post {
            if (cameraLost) log(LOG_INFO, "The camera is back")
            cameraLost = false
            cameraRecoveries = 0
            cameraHandler.removeCallbacks(recoverCamera)
          }
        }

        override fun onCameraDisconnected() {
          post { onCameraGone("another app or the system took it") }
        }

        override fun onCameraError(error: String) {
          post { onCameraGone(error) }
        }
      })
    }.onFailure { log(LOG_WARN, "Could not watch the camera: ${it.message}") }
  }

  private fun onCameraGone(why: String) {
    val live = stream.isStreaming || stream.isRecording
    if (!cameraLost) {
      log(
        if (live) LOG_ERROR else LOG_WARN,
        if (live) "The camera was taken away ($why); the broadcast has no picture until it is back"
        else "The camera was taken away ($why)",
      )
    }
    cameraLost = true
    if (live) scheduleCameraRecovery()
  }

  /**
   * Try to take the camera back, while live, without waiting for the operator.
   *
   * Quickly at first and then every ten seconds: in the background the system
   * may refuse until the app is in front again, and asking every two seconds
   * for an hour would only fill the log. Coming back to the app reopens it
   * regardless, through the surface.
   */
  private fun scheduleCameraRecovery() {
    cameraHandler.removeCallbacks(recoverCamera)
    val delay = if (cameraRecoveries < 3) 1_500L else 10_000L
    cameraHandler.postDelayed(recoverCamera, delay)
  }

  private fun reopenCamera() {
    if (!cameraLost) return
    if (!stream.isStreaming && !stream.isRecording) return
    cameraRecoveries += 1
    synchronized(this) {
      runCatching {
        camera.stop()
        camera.start(stream.getGlInterface().surfaceTexture)
      }.onFailure { log(LOG_WARN, "The camera would not reopen yet: ${it.message}") }
    }
    // Opened is reported by the callback; until then, keep asking.
    if (cameraLost) scheduleCameraRecovery()
  }

  // --- The log ----------------------------------------------------------

  /**
   * One line of what the encoder did, for the screen that has to explain a
   * broadcast that failed three minutes ago.
   *
   * Always posted rather than sometimes called directly: the library's
   * callbacks arrive on several different threads, and posting everything is
   * what keeps the lines in the order they happened.
   */
  internal fun log(level: String, message: String) {
    val entry = mapOf<String, Any>(
      "at" to System.currentTimeMillis().toDouble(),
      "level" to level,
      "message" to message,
    )
    post { runCatching { onLog(entry) } }
  }

  /**
   * Host and port, and nothing else.
   *
   * The stream key lives in the path or in the query string, and a log is the
   * thing an operator screenshots and pastes into a support chat. So the log
   * says which server was dialled and refuses to say with what.
   */
  private fun safeDestination(url: String): String = runCatching {
    val uri = Uri.parse(url)
    val port = if (uri.port > 0) ":${uri.port}" else ""
    "${uri.scheme}://${uri.host}$port"
  }.getOrNull() ?: "the destination"

  // --- Settings ---------------------------------------------------------

  /**
   * Chooses the video codec for the next start.
   *
   * AV1 is in the contract because the shape of the app should not be decided
   * by one library's limits, but RootEncoder's GenericStream throws outright
   * for anything but H.264 and H.265 - none of RTMP, RTSP, SRT or UDP carries
   * AV1 there. Asking for it therefore leaves the codec alone and says so,
   * rather than throwing at the operator or silently pretending.
   */
  internal fun requestVideoCodec(name: String) {
    when (name) {
      "h264", "h265" -> {
        if (name != videoCodec) {
          videoCodec = name
          prepared = false
        }
      }

      "av1" -> log(
        LOG_WARN,
        "AV1 is not carried by RTMP or SRT in this encoder; staying on ${videoCodec.uppercase()}",
      )

      else -> log(LOG_WARN, "Unknown video codec '$name' ignored")
    }
  }

  /**
   * Applies encoder settings. Only takes effect on the next startStream.
   *
   * The preview has to come down first. RootEncoder refuses to configure an
   * encoder while anything holds the camera - `prepareVideo` throws outright if
   * a preview is running - and the preview is running by the time any of this
   * is reachable, because it starts the moment the surface arrives. So the
   * camera is handed back, configured, and handed over again; on screen it is
   * one dropped frame.
   */
  /**
   * Preview state is touched from two threads: the surface callbacks arrive on
   * the view's thread, and everything the module exposes arrives on Expo's own
   * queue. They mutate the same encoder. Without a lock, a rotation landing
   * inside a configure leaves prepareVideo throwing "preview must be stopped"
   * at a preview that was about to be stopped anyway - a race measured in
   * milliseconds that presents as an encoder that silently refused to start.
   */
  @Synchronized
  fun prepare(videoOnly: Boolean = false): Boolean {
    // Settings cannot be applied under a live encoder. The values are already
    // stored on this view, so marking the encoder unconfigured is what makes
    // them take effect at the next start rather than being quietly lost.
    if (stream.isStreaming || stream.isRecording) {
      prepared = false
      audioPrepared = false
      return true
    }

    // Configuring the audio encoder re-creates the microphone underneath, so
    // anything holding it for the meter lets go first.
    val wasMonitoring = monitoring
    // The microphone comes straight back, so the Bluetooth link it may be on
    // stays up across the gap; see [beginHoldingAudioRoute].
    val holdingRoute = wasMonitoring && beginHoldingAudioRoute()
    if (wasMonitoring) monitorAudio(false)

    val hadPreview = stream.isOnPreview
    if (hadPreview) {
      try {
        stream.stopPreview()
      } catch (e: Throwable) {
        // Outside the try below, so its finally will not end the hold.
        if (holdingRoute) endHoldingAudioRoute()
        throw e
      }
    }
    try {
      // Both of these are read when the encoder spawns, so they have to be set
      // before prepareVideo rather than after it.
      applyCodec()
      applyCodecType()

      /**
       * Read once here and kept, because it is the only record of what shape
       * the encoder ended up: after this call the surface the encoder writes
       * into is fixed, and [syncAutoOrientation] has nothing else to compare
       * the phone against. Kept whether or not the encoder accepts the
       * settings, so that a device which refuses them is not asked again on
       * every configuration change.
       */
      val rotation = rotationDegrees()
      preparedRotation = rotation
      warnedRotation = -1

      /**
       * The record size, worked out from the stream's own shape.
       *
       * RootEncoder compares the two aspect ratios as doubles and throws on
       * anything that is not exactly equal, so the width cannot come from a
       * table: 854x480 against a 1280x720 stream is 1.7792 against 1.7778 and
       * is refused outright. Scaling the stream's own width is the only way to
       * land on the ratio every time, and a height that does not divide evenly
       * is skipped rather than rounded - a rounded width is the refusal with
       * extra steps.
       */
      val recordSize = recordSizeFor(videoWidth, videoHeight, recordHeight)
      if (recordHeight > 0 && recordSize == null) {
        log(
          LOG_WARN,
          "Recording at ${recordHeight}p does not fit a ${videoWidth}x${videoHeight} " +
            "picture, so the recording matches the broadcast",
        )
      }

      val video = stream.prepareVideo(
        width = videoWidth,
        height = videoHeight,
        bitrate = videoBitrate,
        fps = videoFps,
        recordWidth = recordSize?.first ?: videoWidth,
        recordHeight = recordSize?.second ?: videoHeight,
        recordBitrate = if (recordSize != null && recordBitrate > 0) recordBitrate else videoBitrate,
        /**
         * The shape of the broadcast is carried here, not by swapping width and
         * height. The library rotates the encoder itself when it is told to -
         * 90 degrees turns a 1280x720 encoder into a 720x1280 stream - and
         * swapping the numbers as well would rotate it twice.
         */
        rotation = rotation,
        // Two seconds, because that is the keyframe interval every platform
        // asks for and the compositor downstream re-encodes against.
        iFrameInterval = 2,
      )
      /**
       * A rotation changes the picture, not the microphone - and re-preparing
       * audio is not free: the library's createMicrophone builds a new
       * AudioRecord and abandons the previous one without releasing it, so
       * every needless pass leaks a recorder and risks the next one being
       * refused. Turning the phone must not cost that.
       */
      val audio = if (videoOnly) true else stream.prepareAudio(
        sampleRate = audioSampleRate,
        isStereo = audioStereo,
        bitrate = audioBitrate,
        echoCanceler = echoCanceler,
        noiseSuppressor = noiseSuppressor,
      )
      if (!videoOnly) audioPrepared = audio
      // prepareAudio is the other place an AudioRecord comes into existence,
      // so it is the other place the operator's choice has to be re-applied.
      if (!videoOnly && audio) applyPreferredDevice()
      prepared = video
      encoderPicture = if (video) {
        mapOf(
          "width" to videoWidth,
          "height" to videoHeight,
          "fps" to videoFps,
          "videoBitrate" to videoBitrate,
          "videoCodec" to videoCodec,
        )
      } else {
        null
      }
      /**
       * prepareVideo ends by resetting the orientation config to NONE, which
       * silently throws away whatever the operator chose. Since going live
       * configures the encoder first, a forced portrait or landscape was being
       * discarded one call before it mattered. Re-applying it here is the only
       * place that is safe from that.
       */
      if (prepared) applyOrientation()

      /**
       * The answer is whether THIS call configured what it set out to, not
       * whether the picture alone worked. Returning the picture's result let a
       * failed audio encoder through, and the failure surfaced later as a
       * broadcast that connected and then threw - by which time the cause
       * looked like something else entirely.
       */
      if (!videoOnly && !audio) {
        log(LOG_ERROR, "The audio encoder would not take these settings")
      }
      /**
       * The picture's refusal used to be the silent one, and a silent refusal
       * here is the whole failure: `monitorAudio` configures the picture before
       * it takes the microphone, so a meter that never moves can be a video
       * problem with nothing anywhere saying video. Name the numbers, because
       * "it refused" is not a fault anyone can act on and these are the only
       * inputs it had.
       */
      if (!video) {
        log(
          LOG_ERROR,
          "The video encoder refused ${videoWidth}x${videoHeight} @${videoFps} " +
            "${videoBitrate / 1000}k rot=${rotation} codec=${videoCodec} " +
            "hardware=${preferHardwareCodec} preview=${stream.isOnPreview} " +
            "record=${recordSize?.let { "${it.first}x${it.second}" } ?: "same"}",
        )
      }
      /**
       * The picture's own refusal used to be the silent one. A rotation
       * configures video only, so the line above could not reach it, and a
       * `prepare` that failed said nothing at all on its way out - which left
       * a viewfinder that had visibly re-shaped itself as the only evidence
       * that anything had been attempted.
       */
      if (!video) {
        log(LOG_ERROR, "The video encoder would not take these settings")
      }
      return video && audio
    } finally {
      // Whether or not the encoder liked the settings, the operator gets their
      // viewfinder back - a failed configure should not leave a black screen.
      //
      // Sized from the surface rather than from the view, because this is
      // reached from a rotation: the surface already has its new size while
      // React may not have laid the view out again yet, and a preview started
      // against the old measurement draws the picture into the shape the
      // screen has just stopped being.
      if (hadPreview && !stream.isOnPreview) {
        val frame = surfaceView.holder.surfaceFrame
        runCatching {
          stream.startPreview(surfaceView.holder.surface, frame.width(), frame.height())
        }.onFailure { log(LOG_WARN, "The viewfinder did not come back: ${it.message}") }
        // A preview restart builds a new capture request, which starts at the
        // camera's own defaults.
        reapplyCaptureRequest()
      }
      /**
       * The meter goes back on whether or not the encoder liked the settings.
       *
       * Gating this on `prepared` is how a refused configure left the
       * microphone stopped for good: monitoring was turned off at the top of
       * this call, and on the way out nothing turned it back on. Nothing else
       * would either - the retry in `useBroadcast` stops the moment a first
       * sample lands, so it has already given up by the time any of this can
       * happen, and every other caller of `monitorAudio(true)` is a screen
       * arriving or a recording ending. The operator was left with a still bar
       * and a log with nothing in it.
       *
       * `monitorAudio` is safe to ask here: it configures the picture itself
       * if this call did not manage to, and it says so when that fails too.
       */
      if (wasMonitoring) {
        if (!prepared) {
          log(LOG_WARN, "The encoder refused that change; putting the level meter back anyway")
        }
        monitorAudio(true)
      }
      if (holdingRoute) endHoldingAudioRoute()
    }
  }

  private fun applyCodec() {
    val codec = if (videoCodec == "h265") VideoCodec.H265 else VideoCodec.H264
    runCatching { stream.setVideoCodec(codec) }.onFailure {
      log(LOG_WARN, "This build refused ${videoCodec.uppercase()}: ${it.message}")
    }
  }

  /**
   * FIRST_COMPATIBLE_FOUND rather than SOFTWARE for the fallback: the point of
   * turning hardware encoding off is to get past one broken hardware encoder,
   * not to insist on the software one when the phone has a second working
   * hardware path.
   */
  /**
   * Video on the media hardware; audio wherever it can be found.
   *
   * Forcing hardware for audio as well is what stopped every broadcast: phones
   * ship a hardware H.264 encoder and almost none ship a hardware AAC one -
   * AAC is cheap enough that nobody builds silicon for it - so the encoder
   * search came back empty and prepareAudio quietly returned false. The
   * picture is where the heat is and where forcing hardware earns anything.
   */
  private fun applyCodecType() {
    val video =
      if (preferHardwareCodec) CodecUtil.CodecType.HARDWARE
      else CodecUtil.CodecType.FIRST_COMPATIBLE_FOUND
    runCatching {
      stream.forceCodecType(video, CodecUtil.CodecType.FIRST_COMPATIBLE_FOUND)
    }.onFailure {
      log(LOG_WARN, "Could not choose the ${video.name.lowercase()} encoder: ${it.message}")
    }
  }

  /**
   * Configure only if nothing has yet. Going live calls this rather than
   * `prepare` so the camera is not taken down a second time for settings that
   * were applied moments ago.
   */
  /**
   * Configured for a broadcast, which means the audio encoder too. The meter
   * needs only the picture path, and asks for that directly - preparing audio
   * it does not need is what left two recorders fighting over one microphone.
   */
  /**
   * Forget that the encoder was configured.
   *
   * Stopping a stream or a recording stops the encoders underneath, and the
   * library gives no way to ask whether they are still prepared - so the only
   * honest position afterwards is that they are not. Getting this wrong is
   * quiet and confusing: the next thing to use them fails with "AudioEncoder
   * not prepared yet", which points at the wrong place entirely.
   */
  internal fun markUnprepared() {
    prepared = false
    audioPrepared = false
  }

  fun ensurePrepared(): Boolean = if (prepared && audioPrepared) true else prepare()

  /**
   * Runs the microphone off air so the level meter reads before going live.
   *
   * Written to be asked twice with no harm, because it is: ending a broadcast
   * stops the microphone underneath us, and the screen asks for monitoring
   * back without knowing whether it was ever off.
   */
  @Synchronized
  fun monitorAudio(on: Boolean) {
    if (!on) {
      monitoring = false
      // Never take the microphone away from a live encoder.
      if (!stream.isStreaming) {
        runCatching { microphone.stop() }
        // Give the audio route back only where the microphone actually
        // stopped. Holding the phone's communication device after we are done
        // with it would break the operator's next call.
        syncAudioRoute(false)
      }
      return
    }

    // While live the encoder owns the microphone and the meter already reads
    // from it; there is nothing to take and nothing to start.
    if (stream.isStreaming) return

    /**
     * Every exit from here used to be silent, which is why a meter that never
     * moved could not be explained from the app itself. `prepare` has no catch
     * of its own, so a throw from prepareVideo or prepareAudio escaped all the
     * way out to JavaScript and died in a `.catch(() => {})` - the operator saw
     * a grey bar and the log said nothing at all.
     */
    // Only the picture has to be configured for the meter to run; asking for
    // the audio encoder as well is what created the second recorder.
    val ready = runCatching { if (prepared) true else prepare(videoOnly = true) }.getOrElse {
      log(LOG_WARN, "The encoder would not configure, so the meter has nothing to read: ${it.message}")
      false
    }
    if (!ready) {
      log(LOG_WARN, "The encoder refused these settings, so the meter has nothing to read")
      return
    }

    runCatching {
      /**
       * Before the recorder, not after: a Bluetooth microphone will not carry
       * audio until Android has been asked to open the link to it, and an
       * AudioRecord opened first reads the nothing it was pointed at.
       */
      syncAudioRoute(true)
      if (!microphone.isRunning()) {
        /**
         * Deliberately NOT through prepareAudio.
         *
         * prepareAudio builds an AudioRecord, and MicrophoneSource.start then
         * builds a second one without releasing the first. On this phone the
         * second is refused, and the failure is invisible: createMicrophone
         * catches the exception and still returns the `created` flag left true
         * by the first call, so start() reports success and every read comes
         * back as an error code. The library skips the audio effect on a read
         * error and returns null, so the meter is never called, nothing
         * throws, and the promise resolves. Silent success with no audio.
         *
         * The source's parameters are public, so they can be set without the
         * create that init() does - which leaves exactly one AudioRecord, made
         * by start() itself.
         */
        microphone.sampleRate = audioSampleRate
        microphone.isStereo = audioStereo
        microphone.echoCanceler = echoCanceler
        microphone.noiseSuppressor = noiseSuppressor
        microphone.start(discard)
        /**
         * After the start, because before it there is nothing to point.
         *
         * The library's setPreferredDevice forwards straight to the
         * AudioRecord and refuses when there is not one yet - it keeps no
         * preference of its own. This is the only moment in the microphone's
         * life when the operator's choice can be applied, and without it every
         * choice made off air was quietly discarded at the next start.
         */
        applyPreferredDevice()
      }
      monitoring = true
      watchForSilence()
    }.onFailure {
      log(LOG_WARN, "The phone would not lend the microphone to the meter: ${it.message}")
    }
  }

  /**
   * Says so when the microphone was handed over and then delivered nothing.
   *
   * A read error inside the library is reported to Android's log and to nobody
   * else - the source still calls itself running. Without this the only
   * symptom is a meter that never moves, which looks exactly like a quiet room.
   */
  /**
   * Measured from this start, not from the life of the process.
   *
   * It used to ask whether the meter had ever sent anything, and the first
   * level of the session answered that for good: a microphone that opened
   * fine at launch and then came back dead after a call, a headset or a
   * broadcast was never reported, which is the case this exists for. Each
   * start now carries its own mark, and only the latest one's check speaks,
   * so a burst of starts is one line rather than several.
   */
  private fun watchForSilence() {
    val from = System.currentTimeMillis()
    silenceWatchFrom = from
    postDelayed({
      // Muted is the one silence that is meant: the library skips the meter
      // entirely while muted, and that is already said when it starts.
      val muted = runCatching { microphone.isMuted() }.getOrDefault(false)
      if (silenceWatchFrom == from && monitoring && !muted && lastLevelEmit < from) {
        log(
          LOG_WARN,
          "The microphone started and sent nothing. Its own read errors are in the device log.",
        )
      }
    }, SILENCE_CHECK_MS)
  }

  /** When the current silence check started; see [watchForSilence]. */
  @Volatile
  private var silenceWatchFrom = 0L

  /**
   * Puts the meter back after the library has pulled the microphone out from
   * under it. Stopping a recording with nothing streaming stops the audio
   * source, and the operator is still looking at the bar.
   */
  internal fun restoreMonitor() {
    if (!monitoring || stream.isStreaming) return
    // A broadcast that ended while the app was out of sight does not get the
    // microphone back for a meter nobody can see. See [monitorParked].
    if (previewGone && !stream.isRecording) {
      parkMonitor()
      return
    }
    monitorAudio(true)
  }

  /**
   * The screen asking for the meter, as against the encoder needing the
   * microphone.
   *
   * Separate from [monitorAudio] because the screen keeps asking - a retry
   * until the first level, and a watchdog when levels stop - and it goes on
   * asking from the background, where its timers still run. With the preview
   * gone and nothing live that would reopen a microphone [parkMonitor] had
   * just closed. Going live and recording call [monitorAudio] directly and are
   * never parked: they are the reason the microphone is wanted.
   */
  fun requestMonitor(on: Boolean) {
    if (!on) {
      monitorParked = false
      monitorAudio(false)
      return
    }
    if (previewGone && !stream.isStreaming && !stream.isRecording) {
      monitorParked = true
      return
    }
    monitorAudio(true)
  }

  /**
   * Lets go of the microphone while nobody can see the meter, and remembers to
   * take it back.
   *
   * The preview surface goes when the app is backgrounded or the screen turns
   * off, and until now only the preview went with it: off air, the meter kept
   * the microphone open - and with it any Bluetooth link - for as long as the
   * app sat in the background. Android shows that as the microphone-in-use
   * dot, over another app, for a meter on a screen nobody is looking at. A
   * phone that is live or recording keeps everything; this is only for the
   * phone that is doing neither.
   */
  private fun parkMonitor() {
    if (!monitoring) return
    monitorAudio(false)
    monitorParked = true
    log(LOG_INFO, "Out of sight; the microphone is closed until the viewfinder is back")
  }

  // --- The shape of the broadcast ---------------------------------------

  /**
   * Portrait, landscape, or whichever way the phone is held.
   *
   * The mistake worth not making twice is treating the shape of the outgoing
   * stream and the way the operator is holding the phone as one fact. They are
   * two, and this control is about the first:
   *
   * `portrait` and `landscape` fix the shape and leave it fixed. Turning the
   * phone changes neither what viewers get nor what the viewfinder shows, so
   * an operator who locked the shape and then tilted the phone can see in the
   * preview that they are holding it wrong, which is the only way they would
   * ever find out.
   *
   * `auto` gives the decision to the phone, but only while nobody is watching.
   * Off air, turning the phone re-shapes the stream and the viewfinder fills
   * the screen the way a camera app does. Live it is refused: a stream's
   * resolution is agreed once, at the handshake, and a broadcaster that
   * changes it halfway through is letterboxed by every platform that keeps
   * taking it and dropped by the ones that do not.
   */
  /**
   * Holds the screen to the shape the operator chose.
   *
   * Without this the app's shape control and the phone's own rotation argue:
   * forcing a portrait broadcast while Android keeps turning the interface
   * landscape leaves a tall video in a wide window, and the operator is left
   * to reconcile two things that disagree. Every camera app that offers a
   * locked orientation locks the screen with it.
   *
   * `auto` hands the decision back to the phone, which is the case where
   * letting Android turn the interface is exactly right.
   */
  private fun lockScreen(mode: String) {
    val activity = runCatching { appContext.currentActivity }.getOrNull() ?: return
    val wanted = when (mode) {
      "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
      "landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
      else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }
    runCatching { activity.requestedOrientation = wanted }
      .onFailure { log(LOG_WARN, "The screen would not hold that orientation: ${it.message}") }
  }

  fun setOrientation(mode: String) {
    val next = if (mode == "portrait" || mode == "landscape") mode else "auto"
    val changed = next != orientation
    orientation = next

    // The screen follows the choice, whether or not the encoder has to.
    if (changed) lockScreen(next)

    /**
     * Live, the choice is recorded and the picture is left exactly as it is.
     * The renderer would take a new shape the moment it was handed one, and
     * viewers would watch the frame change under them - which is the thing
     * this control exists to prevent, whether the change comes from the phone
     * being turned or from the operator pressing the button. `prepare` refuses
     * under a live stream and marks the encoder unconfigured, and that is what
     * carries the choice to the next broadcast instead of losing it.
     */
    if (stream.isStreaming || stream.isRecording) {
      if (changed) prepare()
      return
    }

    applyOrientation()
    /**
     * The shape lives in the size of the surface the encoder writes into, and
     * that size is settled when the encoder spawns - so changing the shape
     * means configuring again.
     *
     * The PICTURE, and only the picture. Nothing about a rotation concerns the
     * audio encoder, and configuring it anyway is what stopped the level meter:
     * prepareAudio builds an AudioRecord, and the meter restarting afterwards
     * asks MicrophoneSource.start for one, which builds a second without
     * releasing the first. The second is refused, silently - createMicrophone
     * swallows the failure and returns the `created` flag the first call left
     * true, so start() reports success while every read comes back an error
     * code, which the library answers by skipping the audio effect. The meter
     * is then never called and reads flat zero, which looks exactly like a
     * quiet room. Reopening the app was the only way back, because that built
     * the view again from nothing.
     *
     * MicrophoneSource.stop() cannot undo it either: it is guarded by
     * isRunning(), and a recorder prepareAudio made but never started is not
     * running, so stop() returns having released nothing. Not creating the
     * second one is the only fix available from this side.
     */
    if (changed && rotationDegrees() != preparedRotation) prepare(videoOnly = true)
  }

  /**
   * The rotation to hand the encoder for the shape the operator chose, in the
   * library's own terms: 90 turns a 1280x720 encoder into a 720x1280 stream,
   * 0 leaves it as it is.
   *
   * `auto` reads the display every time it is asked rather than remembering an
   * answer, because an answer that is remembered is exactly what `auto` must
   * not have. CameraHelper already speaks this convention - 90 for an upright
   * phone, 0 for one on its side.
   */
  private fun rotationDegrees(): Int = when (orientation) {
    "portrait" -> 90
    "landscape" -> 0
    else -> runCatching { CameraHelper.getCameraOrientation(context) }.getOrDefault(0)
  }

  /**
   * Puts the chosen shape into the renderer.
   *
   * Separate from [setOrientation] because `prepare` has to call it too, and
   * because calling `setOrientation` from inside `prepare` would have them
   * calling each other.
   *
   * `auto` hands the job to the library's own sensor listener, which is all
   * `autoHandleOrientation` is: a listener that re-derives the rotation from
   * the display and pushes it into the renderer as the phone turns. It keeps
   * the picture upright. It cannot change the size of the encoder's surface,
   * which is why it was never enough on its own.
   *
   * The two fixed shapes switch that listener off and set the renderer's two
   * numbers directly, rather than calling forceOrientation(PORTRAIT) or
   * forceOrientation(LANDSCAPE) as this used to. Those two pass CameraHelper's
   * display-rotation labels straight into setCameraOrientation, which wants a
   * render rotation; everywhere else in the library that crosses between the
   * two - prepareVideo, the sensor listener, forceOrientation(NONE) -
   * subtracts 90 first. Three against one, and the odd one out leaves the
   * picture a quarter turn over. What is written below is prepareVideo's own
   * line, given the same rotation prepareVideo was given, so a fixed shape
   * lands exactly where the library itself would have put it.
   */
  private fun applyOrientation() {
    val gl = stream.getGlInterface()
    runCatching {
      if (orientation == "auto") {
        gl.autoHandleOrientation = true
        gl.forceOrientation(OrientationForced.NONE)
        return@runCatching
      }
      val rotation = rotationDegrees()
      gl.autoHandleOrientation = false
      gl.setOrientationConfig(
        OrientationConfig(
          cameraOrientation = if (rotation == 0) 270 else rotation - 90,
          isPortrait = rotation == 90 || rotation == 270,
          forced = OrientationForced.NONE,
        ),
      )
    }.onFailure {
      log(LOG_WARN, "Could not shape the broadcast: ${it.message}")
    }
  }

  /**
   * Makes `auto` mean what it says: the broadcast follows the phone.
   *
   * Nothing in the library can re-shape a running encoder, so following the
   * phone means configuring a new one - stopping the preview, calling
   * prepareVideo with the new rotation, and starting the preview again. Off
   * air that costs a dropped frame and nobody sees it.
   *
   * Live it is refused, and the operator is told once per turn rather than
   * left to wonder. The preview tells them the rest: with the listener still
   * running, the picture stays upright inside the frame the broadcast started
   * with, so a phone turned mid-broadcast shows the operator the same
   * letterboxed band their viewers are getting. Upright and letterboxed is the
   * better of the two failures - the alternative, a full frame lying on its
   * side, is unwatchable, and this one rights itself the moment they turn the
   * phone back.
   */
  @Synchronized
  private fun syncAutoOrientation() {
    if (orientation != "auto") return
    // Nothing has been configured yet, so nothing can have fallen behind: the
    // first prepare reads the display for itself.
    if (preparedRotation < 0) return

    val rotation = runCatching { CameraHelper.getCameraOrientation(context) }.getOrNull() ?: return
    /**
     * Only a quarter turn changes the shape. Portrait to upside-down portrait
     * is the same rectangle, and the renderer keeps the picture the right way
     * up through it by itself - taking the camera down for that would be a
     * visible glitch bought for nothing.
     */
    val portrait = rotation == 90 || rotation == 270
    if (portrait == (preparedRotation == 90 || preparedRotation == 270)) return

    if (stream.isStreaming || stream.isRecording) {
      if (warnedRotation != rotation) {
        warnedRotation = rotation
        log(LOG_WARN, "The phone was turned. The broadcast keeps the shape it started in.")
      }
      return
    }
    prepare(videoOnly = true)
  }

  /**
   * A rotation the activity handles itself.
   *
   * The generated manifest declares `orientation|screenSize` in the
   * MainActivity's configChanges, so turning the phone resizes this view
   * instead of destroying and rebuilding it - which means nothing runs prepare
   * again on its own, and without this the encoder would keep the shape it was
   * born with for the life of the app. That was the bug.
   *
   * Checked here as well as from the surface callback because the two arrive
   * in either order depending on how quickly React lays the view out again,
   * and because the fix has to hold even if the activity is ever built without
   * those configChanges: then the view is rebuilt, prepare runs fresh, and
   * neither of these fires. Re-shaping is idempotent, so arriving twice costs
   * nothing.
   */
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    syncAutoOrientation()
  }

  // --- Holding the picture ----------------------------------------------

  /**
   * Freeze what viewers see without ending the broadcast.
   *
   * The GL layer stops drawing the camera into the encoder surface, so the
   * socket stays up and the audio keeps going - which is the whole point.
   * Nothing to reconnect afterwards.
   */
  fun setVideoMuted(muted: Boolean) {
    val gl = stream.getGlInterface()
    runCatching {
      if (muted) gl.muteVideo() else gl.unMuteVideo()
    }.onFailure {
      log(LOG_WARN, "Could not ${if (muted) "hold" else "resume"} the picture: ${it.message}")
      return
    }
    log(LOG_INFO, if (muted) "Picture held" else "Picture resumed")
  }

  fun isVideoMuted(): Boolean =
    runCatching { stream.getGlInterface().isVideoMuted() }.getOrNull() ?: false

  // --- Display-only monitoring (focus peaking) -------------------------
  //
  // A monitoring aid is a RootEncoder GL filter over the preview. RootEncoder
  // applies filters to the encoder surface too, so one left on would burn into
  // the recording and the stream; it is therefore cleared the moment the
  // operator goes on air (clearMonitorForAir, from the go-live and record
  // paths). Peaking reuses the library's own edge detector - red edges drawn
  // over the live picture, a negative background meaning "keep the original".

  private var monitorFilter: BaseFilterRender? = null

  /** The monitoring mode actually applied: "off" or "peaking". */
  var monitorMode: String = "off"
    private set

  /** Apply a monitoring aid over the preview, or "off" to clear it. */
  fun setMonitor(mode: String) {
    val gl = runCatching { stream.getGlInterface() }.getOrNull() ?: return
    runCatching {
      gl.clearFilters()
      monitorFilter = null
      when (mode) {
        "peaking" -> {
          // performanceMode=false is the Sobel path, the only one whose colour
          // setters work; a negative background keeps the live picture.
          val f = EdgeDetectionFilterRender(false)
          f.setEdgeRGBColor(255, 48, 48)
          f.setBackgroundRGBColor(-1, -1, -1)
          gl.setFilter(f)
          monitorFilter = f
        }
      }
      monitorMode = if (monitorFilter != null) mode else "off"
      log(LOG_INFO, "monitor: $monitorMode")
    }.onFailure { log(LOG_WARN, "monitor $mode failed: ${it.message}") }
  }

  /**
   * Clear any monitoring aid before going on air, so it is never encoded into
   * the stream or the recording. Called from the go-live and record paths.
   */
  fun clearMonitorForAir() {
    if (monitorFilter != null) setMonitor("off")
  }

  // --- Carrying on in the background ------------------------------------

  /**
   * Starts or stops the foreground service so that it is running exactly when
   * there is a broadcast to carry.
   *
   * Android revokes camera and microphone access to a backgrounded app and then
   * kills the process, so without the service the operator's phone stops
   * broadcasting the moment it goes in a pocket. With it, the broadcast runs
   * behind a notification they can see and stop from - which is also the only
   * honest way to do it.
   *
   * Called from every path that changes either half of the condition, because a
   * service left running with no stream behind it is a phone holding the camera
   * for nothing, and a notification that lies about what the app is doing.
   */
  internal fun syncBackgroundService() {
    /**
     * Recording counts as much as streaming. A stream that gave up on a bad
     * network leaves the phone's own recording running - and taking the
     * service down then left a backgrounded app recording with no foreground
     * service, which Android is entitled to cut off, camera and microphone
     * both. That was the recording that stopped along with the stream.
     */
    val wanted = backgroundBroadcast && (stream.isStreaming || stream.isRecording)
    /**
     * Up means running, or asked for and not yet answered. Asked-for counts
     * because the service takes a moment to start, and a second sync in that
     * moment must not stop it or start it twice; a service that refused has
     * already cleared the request on its way out, so it does not count.
     */
    val up = serviceRequested || BroadcastService.isRunning
    if (wanted == up) return
    runCatching {
      if (wanted) BroadcastService.start(context) else BroadcastService.stop(context)
      serviceRequested = wanted
      log(
        LOG_INFO,
        if (wanted) "Broadcasting in the background" else "Background broadcasting off",
      )
    }.onFailure {
      serviceRequested = false
      log(LOG_WARN, "Could not change background broadcasting: ${it.message}")
    }
  }

  /**
   * The service has gone, whether it was asked to or refused to start.
   *
   * Called by the service itself on its way out. Clearing the request is what
   * lets the next sync try again, rather than trusting a start that Android
   * turned down.
   */
  internal fun onServiceGone() {
    serviceRequested = false
  }

  /**
   * Ends everything, for the Stop action on the notification. That action is
   * the operator's only control when the app is not on screen, so it has to do
   * what the button on screen does rather than only close the notification.
   */
  fun stopBroadcast() {
    if (stream.isRecording) runCatching { stopRecording() }
    if (stream.isStreaming) runCatching { stream.stopStream() }
    /**
     * What follows is the module's own `stopStream`, step for step and in its
     * order, because this is the same operation and stopping from the
     * notification is not a lesser way to perform it.
     *
     * Stopping the stream tears the encoders down, so leaving them marked
     * prepared is a lie that costs the operator their next broadcast:
     * `ensurePrepared` returns true without preparing anything and the start
     * throws "AudioEncoder not prepared yet". `stopRecording`'s own
     * markUnprepared cannot cover for it - it is gated on nothing streaming,
     * which is still false when it runs from here.
     */
    markUnprepared()
    log(LOG_INFO, "Broadcast stopped from the notification")
    status("idle", "stopped from the notification")
    syncBackgroundService()
    // And the meter comes back: the stream took the microphone down with it,
    // and the operator is still looking at the bar.
    restoreMonitor()
  }

  // --- Cameras ----------------------------------------------------------

  internal val cameraManager: CameraManager?
    get() = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager

  internal val audioManager: AudioManager?
    get() = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  /**
   * Every camera the phone will open, named the way an operator can choose
   * between them.
   *
   * An id on its own is useless - "0" and "2" say nothing about which lens is
   * which. Facing and field of view come from Android's own characteristics,
   * so a wide lens reads as wide and a plugged-in USB camera reads as
   * external rather than as another number.
   */
  fun cameras(): List<Map<String, Any>> {
    val manager = cameraManager
    val currentId = runCatching { camera.getCurrentCameraId() }.getOrNull()
    val ids = runCatching { camera.camerasAvailable() }.getOrNull() ?: emptyArray<String>()

    return ids.map { id ->
      val characteristics = manager?.let { runCatching { it.getCameraCharacteristics(id) }.getOrNull() }
      mapOf(
        "id" to id,
        "facing" to facingOf(characteristics),
        "fieldOfView" to fieldOfView(characteristics),
        "current" to (id == currentId),
      )
    }
  }

  fun openCamera(id: String) {
    camera.openCameraId(id)
    log(LOG_INFO, "Camera $id opened")
    reapplyCaptureRequest()
    reportCameras()
  }

  fun switchCamera() {
    camera.switchCamera()
    log(LOG_INFO, "Camera switched to ${runCatching { camera.getCurrentCameraId() }.getOrNull() ?: "another lens"}")
    reapplyCaptureRequest()
    reportCameras()
  }

  /**
   * Last list sent, so an unchanged one is not sent again.
   *
   * Android's availability callback fires whenever any camera changes state -
   * including this app opening and closing its own - and every report re-runs
   * the screen's capability read. That churn was resetting control state the
   * operator had set.
   */
  private var lastCameras: List<Map<String, Any>>? = null

  internal fun reportCameras() {
    runCatching {
      val list = cameras()
      if (list == lastCameras) return@runCatching
      lastCameras = list
      onCameras(mapOf("cameras" to list))
    }
  }

  internal fun reportAudioDevices() {
    runCatching { onAudioDevices(mapOf("devices" to listAudioDevices(context))) }
  }

  /** The characteristics of whichever camera is open, or null if none is. */
  internal fun currentCharacteristics(): CameraCharacteristics? {
    val id = runCatching { camera.getCurrentCameraId() }.getOrNull() ?: return null
    return runCatching { cameraManager?.getCameraCharacteristics(id) }.getOrNull()
  }

  private fun facingOf(characteristics: CameraCharacteristics?): String =
    when (characteristics?.get(CameraCharacteristics.LENS_FACING)) {
      CameraCharacteristics.LENS_FACING_FRONT -> "front"
      CameraCharacteristics.LENS_FACING_BACK -> "back"
      CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
      else -> "unknown"
    }

  /**
   * Horizontal field of view in whole degrees, or 0 when the phone does not
   * say. It is the number that actually distinguishes one rear lens from
   * another: 68 degrees is the main camera, 110 is the ultra-wide.
   */
  private fun fieldOfView(characteristics: CameraCharacteristics?): Int {
    val size = characteristics?.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: return 0
    val focal = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)
      ?.firstOrNull() ?: return 0
    if (focal <= 0f) return 0
    return Math.toDegrees(2.0 * atan((size.width / (2.0 * focal)))).roundToInt()
  }

  // --- Readouts ---------------------------------------------------------

  /**
   * What the socket is doing, for the readouts an operator watches.
   *
   * The queue is reported as frames waiting against the cache that holds them,
   * rather than as a byte count: a fraction is something a person can read -
   * half full is fine, nearly full is about to drop - where bytes mean nothing
   * without knowing the capacity. It is also the measure the library's own
   * congestion check uses.
   */
  fun stats(): Map<String, Any> {
    val client = stream.getStreamClient()
    /**
     * The shape that is going out, rather than the pair of numbers that was
     * asked for. A portrait broadcast is configured as 1280x720 and leaves the
     * phone as 720x1280, and a readout that quotes the request instead of the
     * result is the same confusion between the stream's shape and the phone's
     * that everything above exists to undo.
     */
    val portrait = preparedRotation == 90 || preparedRotation == 270
    return mapOf(
      "bitrate" to currentBitrate,
      "droppedVideoFrames" to client.getDroppedVideoFrames(),
      "droppedAudioFrames" to client.getDroppedAudioFrames(),
      "queueItems" to client.getItemsInCache(),
      "queueCapacity" to client.getCacheSize(),
      "sentVideoFrames" to client.getSentVideoFrames(),
      "sentAudioFrames" to client.getSentAudioFrames(),
      "bytesSent" to client.getBytesSend(),
      "congested" to client.hasCongestion(),
      "width" to if (portrait) videoHeight else videoWidth,
      "height" to if (portrait) videoWidth else videoHeight,
      "fps" to videoFps,
      "measuredFps" to measuredFps,
      "codec" to videoCodec,
      "recording" to stream.isRecording,
      "videoMuted" to isVideoMuted(),
    )
  }

  /**
   * What the phone has left, read from the sticky battery broadcast.
   *
   * Registering a null receiver for ACTION_BATTERY_CHANGED returns the last
   * one Android sent without subscribing to anything, which is the cheap way
   * to ask a question whose answer changes every few minutes. Polling it
   * beats an event: a broadcaster has enough of those already, and a battery
   * that moved one per cent is not news.
   */
  internal fun power(): Map<String, Any> {
    val intent = runCatching {
      context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    }.getOrNull()

    val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1

    return mapOf(
      // Unknown reads as full rather than empty: a readout that cries wolf on
      // a phone that is fine is worse than no readout.
      "level" to if (level >= 0 && scale > 0) level.toDouble() / scale else 1.0,
      "charging" to (
        status == BatteryManager.BATTERY_STATUS_CHARGING ||
          status == BatteryManager.BATTERY_STATUS_FULL
        ),
    )
  }

  fun release() {
    /**
     * The full stop, not the library's.
     *
     * This used to call `stream.stopRecord()` straight through, which ends the
     * file and tells nobody: the take is never handed to the video library, the
     * screen never hears that recording finished, and the operator is left with
     * a file in the app's own folder that they have no reason to go looking
     * for. `stopRecording` is the same operation with those three things
     * attached.
     */
    if (stream.isRecording) runCatching { stopRecording() }
    if (stream.isStreaming) runCatching { stream.stopStream() }
    markUnprepared()
    /**
     * After the stream, not before it, and the route unconditionally.
     *
     * This used to begin with `monitorAudio(false)`, which leaves the
     * microphone alone while live - correctly, everywhere else - and so, on a
     * view released mid-broadcast, gave back neither the microphone nor the
     * Bluetooth link. The view went and the headset stayed held for the life
     * of the process, with its link receiver still registered: the operator's
     * next call went through a headset they had put away. Everything is
     * stopped first, so the microphone stop below is a real one, and the route
     * is released whether or not anything thinks it is still wanted, because
     * nothing that wanted it survives this.
     */
    monitorAudio(false)
    monitorParked = false
    releaseAudioRoute()
    if (stream.isOnPreview) runCatching { stream.stopPreview() }
    // Whatever happens to the view, the service must not outlive the stream.
    // Assigning the preference is what stops it; the setter does the rest.
    backgroundBroadcast = false
    audioDeviceCallback?.let { callback ->
      runCatching { audioManager?.unregisterAudioDeviceCallback(callback) }
    }
    audioDeviceCallback = null
    stopWatchingAudioInterruptions()
    stopWatchingThermal()
    cameraHandler.removeCallbacks(recoverCamera)
    if (current === this) current = null
  }

  /**
   * Watches for microphones appearing and disappearing.
   *
   * A lapel mic gets unplugged by someone walking past the stand, and the
   * operator needs to see the list change rather than wonder why the meter
   * went quiet. Separate from the constructor because it has to be able to
   * happen twice: a tab change detaches this view and takes the registration
   * with it, and the operator coming back should not silently lose this.
   */
  private fun watchAudioDevices() {
    if (audioDeviceCallback != null) return
    runCatching {
      val callback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
          /**
           * The chosen microphone coming back.
           *
           * Android gives a Bluetooth headset a new id when it reconnects, so
           * the id the operator chose stops naming anything the moment it
           * drops - and the choice used to be thrown away with it, leaving the
           * broadcast on the phone's microphone after a headset that was only
           * gone for a second. It is recognised by address where Android
           * gives one, by kind and name where it does not, and taken back.
           */
          val wanted = droppedAudioChoice
          if (wanted != null) {
            val back = addedDevices.orEmpty().firstOrNull { device ->
              device.isSource && wanted.matches(device)
            }
            if (back != null) {
              droppedAudioChoice = null
              selectedAudioDeviceId = back.id
              log(LOG_INFO, "${back.productName} is back; using it again")
              applyAudioChoice(back)
              return
            }
          }
          reportAudioDevices()
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
          // A device that has been unplugged cannot still be the chosen one,
          // and leaving the id set would mark a stale row as current. What it
          // was is kept, so it can be taken back when it reconnects.
          val gone = removedDevices?.firstOrNull { it.id == selectedAudioDeviceId }
          if (gone != null) {
            droppedAudioChoice = DroppedAudioChoice.of(gone)
            selectedAudioDeviceId = -1
            log(LOG_WARN, "The chosen microphone was disconnected; Android is choosing until it comes back")
          }
          reportAudioDevices()
        }
      }
      audioManager?.registerAudioDeviceCallback(callback, null)
      audioDeviceCallback = callback
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    /**
     * The navigator detaches this view when the operator opens another tab and
     * attaches it again when they come back, and the module reaches the
     * encoder through the static reference claimed here. Without re-claiming
     * it, one visit to Destinations left every control - going live, the
     * torch, flipping the camera - failing with "there is no camera preview
     * mounted" for the rest of the session, with a preview plainly on screen.
     */
    claim(this)
    watchAudioDevices()
    watchAudioInterruptions()
    watchAudioMode()
    watchThermal()
    /**
     * Coming back to the front is the moment a refused service can start.
     * Android refuses a foreground service to an app in the background, so a
     * broadcast whose service was turned down while the phone was locked was
     * left without one until something else happened to change state - and
     * the next lock took the camera. The app is in the foreground now, which
     * is the one condition the refusal was about.
     */
    syncBackgroundService()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    /**
     * Being detached is not being asked to stop.
     *
     * A tab change detaches this view, and tearing the broadcast down here
     * would end a live stream because someone looked at their destinations -
     * which is the one thing a broadcaster must never do. So while a stream is
     * live only the preview surface goes; the camera, the encoder and the
     * notification carry on, which is exactly what the foreground service is
     * for. The static reference is kept too, because the Stop action on that
     * notification reaches the encoder through it.
     */
    // A recording that outlived its stream - the network gave up, the phone
    // carried on writing the lesson - is kept the same way. Checking only the
    // stream meant looking at another tab after a failure ended the take.
    if (stream.isStreaming || stream.isRecording) {
      if (stream.isOnPreview) runCatching { stream.stopPreview() }
      return
    }
    release()
  }

  // --- ConnectChecker: the encoder talking back --------------------------

  /**
   * Posted and caught, for the same reason [log] is.
   *
   * Every one of these arrives on one of RootEncoder's own threads, where an
   * exception has no handler above it and takes the process with it - the
   * shape of the AmplitudeEffect crash that already killed this app once.
   * Posting also puts a status and the log line explaining it back in the
   * order they happened, which they were not.
   */
  private fun status(state: String, detail: String? = null) {
    /**
     * The retry this is, on every status, so the screen can count the attempts
     * a broadcast has needed. Two events arrive per attempt - the failure and
     * the redial - and only the number tells them apart; counting events would
     * report every outage twice over.
     */
    val event = mapOf("state" to state, "detail" to (detail ?: ""), "attempt" to reconnectAttempt)
    post { runCatching { onStatus(event) } }
    /**
     * The same state, said again where the operator can actually see it.
     *
     * The event above reaches the screen, and the screen is face down in a
     * pocket for most of a background broadcast. The ongoing notification said
     * one fixed sentence for the whole life of the service - including the
     * minutes a dropped connection spends retrying - so a glance at a locked
     * phone reported a healthy stream that was in fact down.
     */
    runCatching { BroadcastService.setState(context, state, detail ?: "") }
  }

  /**
   * Called once per new broadcast, before the socket is first opened.
   *
   * Two things a previous broadcast must not hand on. The retry budget: the
   * library's starts at zero and was only ever set once a connection had
   * succeeded, so a first connection that failed - a busy cell, a server still
   * waking up - failed outright instead of being tried again. And the ladder:
   * a broadcast that gave up mid-outage left its attempt count behind, so the
   * next one would have opened as though it were already reconnecting.
   */
  internal fun beginConnection() {
    reconnectAttempt = 0
    connectedOnce = false
    lastFailure = ""
    connectedAt = 0L
    shortLivedConnections = 0
    runCatching { stream.getStreamClient().setReTries(RETRIES) }.onFailure {
      log(LOG_WARN, "Could not set the reconnect budget: ${it.message}")
    }
  }

  override fun onConnectionStarted(url: String) {
    failedJustNow = false
    dialledSecrets = secretsIn(url)
    /**
     * A retry of a broadcast that was on air is a reconnect, whatever the
     * library calls it. See [connectedOnce].
     *
     * The detail is never the URL itself. It used to be, which put the full
     * endpoint - stream key and all - into the screen's state.
     */
    if (connectedOnce && reconnectAttempt > 0) {
      log(LOG_INFO, "Reconnecting to ${safeDestination(url)}")
      status("reconnecting", lastFailure)
      return
    }
    log(LOG_INFO, "Connecting to ${safeDestination(url)}")
    status("connecting", safeDestination(url))
  }

  override fun onConnectionSuccess() {
    /**
     * The full bitrate on a first connection only. A reconnect is a phone
     * coming back over the same struggling network that just dropped it, and
     * jumping straight back to full quality was the next drop, ready-made. The
     * adapted rate carries over and climbs back on its own once the queue
     * stays clear.
     */
    // `connectedOnce` rather than the attempt count: a first connection that
    // needed a retry has no adapted rate of its own, only whatever the last
    // broadcast happened to end on.
    if (!connectedOnce || currentBitrate <= 0) currentBitrate = videoBitrate
    connectedOnce = true
    lastFailure = ""
    healthyTicks = 0
    // A connection that worked earns a fresh ladder: the next outage is a new
    // outage and should not inherit a thirty-second delay from the last one.
    reconnectAttempt = 0
    connectedAt = System.currentTimeMillis()
    lastSentFrames = 0L
    lastFrameSampleAt = 0L
    measuredFps = 0
    // Retries are per-connection, so the budget is restored once one succeeds.
    stream.getStreamClient().setReTries(RETRIES)
    log(LOG_INFO, "Connected at ${videoBitrate / 1000} kbps, ${videoCodec.uppercase()}")
    status("connected")
  }

  /**
   * The parameter keeps the supertype's name. Renaming it `raw` drew a warning
   * that a caller using named arguments would hit the interface's name and not
   * this one; the unscrubbed text is shadowed at once instead, so nothing below
   * this line can reach it by accident.
   */
  override fun onConnectionFailed(reason: String) {
    // Whatever the server or the socket said, before it goes anywhere: the
    // screen, the log and the lock screen all repeat it.
    @Suppress("NAME_SHADOWING")
    val reason = scrubbed(reason)
    val flapping = noteDrop()
    if (autoReconnect && stream.isStreaming && !flapping) {
      val delay = backoffDelayMs()
      val retrying = stream.getStreamClient().reTry(delay, reason)
      if (retrying) {
        reconnectAttempt += 1
        lastFailure = reason
        /**
         * Before the first success nothing has gone out, so this is still the
         * broadcast connecting - with a reason now - and Cancel stays the
         * honest button. After it, the broadcast is live and dropped.
         */
        if (connectedOnce) {
          log(LOG_WARN, "Connection lost ($reason); retrying in ${delay / 1000}s")
          status("reconnecting", reason)
        } else {
          log(LOG_WARN, "Could not connect ($reason); trying again in ${delay / 1000}s")
          status("connecting", reason)
        }
        return
      }
    }
    /**
     * A server that keeps accepting the connection and dropping it is given up
     * on, and said to be the reason - the last socket error on its own would
     * read as one more network blip, and the operator needs to know that
     * waiting will not help.
     */
    val why = if (flapping) {
      log(
        LOG_ERROR,
        "The server dropped the broadcast $shortLivedConnections times in a row within " +
          "${SHORT_LIVED_MS / 1000}s of accepting it (last: $reason); no longer retrying",
      )
      FLAPPING_REASON
    } else {
      reason
    }
    log(LOG_ERROR, "Broadcast failed: $why")
    /**
     * A failure nobody is going to retry has to be closed out here.
     * RootEncoder marks itself as streaming the moment `startStream` is called
     * and only clears the flag in `stopStream`, so a connection that gave up
     * would otherwise leave the object convinced it is live - `isStreaming`
     * would lie to the screen and the next attempt would throw.
     */
    failedJustNow = true
    runCatching { stream.stopStream() }
    status("failed", why)
    /**
     * Read before the service is torn down, because that is the question being
     * asked: was this broadcast running with the app off screen?
     *
     * If it was, the ongoing notification is about to disappear and that is all
     * the operator would get - a notification quietly leaving the shade while
     * the stream they thought was live has been dead for however long it took
     * ten retries to give up. If the app is on screen the banner already says
     * so, and a second copy in the shade is noise.
     */
    val wasUnwatched = BroadcastService.isRunning
    syncBackgroundService()
    if (wasUnwatched) {
      runCatching { BroadcastService.alertEnded(context, why) }
    }
    restoreMonitor()
  }

  /**
   * Double the delay per failure, up to a ceiling.
   *
   * Both ends are defended against the configured delay rather than trusting
   * it. A zero delay would have the library reconnecting inside the same
   * millisecond it failed, ten times over, and call that a retry budget; a
   * configured delay longer than the ceiling is a deliberate choice and raises
   * the ceiling rather than being clamped under it. The number of doublings is
   * capped as well, because shifting a Long past sixty-three places is
   * undefined and a long outage would get there.
   */
  /** Set while a failed connection is being closed out; see [onDisconnect]. */
  private var failedJustNow = false

  /**
   * When the current connection succeeded, and how many in a row have died
   * young.
   *
   * Every success restores the full retry budget, which is right for a phone
   * on a bad network - each outage is a new one - and wrong for a server that
   * accepts the connection and then drops it: a publish slot held by a ghost
   * session, a key that authenticates and is then refused, a proxy with a
   * short idle timeout. That loops for ever, a few seconds on air and a few
   * off, and the operator sees a broadcast that is nearly working for as long
   * as they are willing to watch it. A connection that lasted
   * [SHORT_LIVED_MS] was a real one and clears the count; [MAX_SHORT_LIVED]
   * short ones in a row is a pattern, and the broadcast is ended with a reason
   * that says so.
   */
  private var connectedAt = 0L
  private var shortLivedConnections = 0

  /** Counts a drop, and says whether it is the one that ends the broadcast. */
  private fun noteDrop(): Boolean {
    val since = connectedAt
    // Only the first failure after a success is a drop. The rest are retries
    // that could not get back in, which the budget already handles.
    if (since <= 0L) return false
    connectedAt = 0L
    if (System.currentTimeMillis() - since >= SHORT_LIVED_MS) {
      shortLivedConnections = 0
      return false
    }
    shortLivedConnections += 1
    return shortLivedConnections >= MAX_SHORT_LIVED
  }

  /**
   * The credentials in the URL being dialled, so that a reason which repeats
   * one can be cleaned before it is shown.
   *
   * An RTMP server's refusal often quotes the stream name it refused, and the
   * stream name is the key; an exception from the socket layer can carry the
   * whole URL. Neither is a shape a pattern can be trusted to recognise, but
   * the values themselves are known - they are what this phone just sent.
   */
  @Volatile
  private var dialledSecrets: List<String> = emptyList()

  private fun secretsIn(url: String): List<String> = runCatching {
    val uri = Uri.parse(url)
    val found = mutableListOf<String>()
    uri.lastPathSegment?.let { found += it }
    for (name in listOf("streamid", "passphrase", "key")) {
      uri.getQueryParameter(name)?.let { value ->
        found += value
        // MediaMTX's `publish:path/key` - the key is the last part.
        found += value.substringAfterLast('/').substringAfterLast(':')
      }
    }
    if (srtPassphrase.isNotEmpty()) found += srtPassphrase
    // Short values are too likely to be ordinary words to replace safely, and
    // no real key is this short.
    found.filter { it.length >= MIN_SECRET_LENGTH }.distinct().sortedByDescending { it.length }
  }.getOrDefault(emptyList())

  /** A reason with every known credential, and anything shaped like a URL, taken out. */
  private fun scrubbed(reason: String): String {
    var out = reason
    for (secret in dialledSecrets) out = out.replace(secret, "<key>")
    return STREAM_URL.replace(out) { match -> safeDestination(match.value) }
  }

  private fun backoffDelayMs(): Long {
    val base = reconnectDelayMs.coerceAtLeast(MIN_RECONNECT_DELAY_MS)
    val steps = reconnectAttempt.coerceIn(0, BACKOFF_MAX_DOUBLINGS)
    val ceiling = maxOf(base, RECONNECT_CEILING_MS)
    return (base shl steps).coerceIn(base, ceiling)
  }

  override fun onDisconnect() {
    log(LOG_INFO, "Disconnected")
    /**
     * Not after a failure. Closing out a failed connection ends in this
     * callback too, a moment later - and "disconnected" with no detail
     * replaced "failed" and its reason, so the banner saying why the broadcast
     * stopped vanished and the operator was left looking at a plain Off air.
     */
    if (failedJustNow) {
      failedJustNow = false
      return
    }
    status("disconnected")
  }

  override fun onAuthError() {
    log(LOG_ERROR, "The server rejected the stream key")
    status("authError")
  }

  override fun onAuthSuccess() {
    log(LOG_INFO, "Stream key accepted")
    status("authSuccess")
  }

  /**
   * Reported roughly once a second while streaming. It is the only honest
   * measure of what the uplink is actually carrying, as opposed to what the
   * encoder was asked for.
   */
  override fun onNewBitrate(bitrate: Long) {
    sampleFrameRate()
    if (adaptiveBitrate && stream.isStreaming) adapt()
    // Read here, on the thread that knows, and sent from the view's own -
    // this is a library thread with nothing above it to catch a throw.
    val event = mapOf(
      "bitrate" to bitrate.toDouble(),
      "target" to currentBitrate.toDouble(),
      "congested" to stream.getStreamClient().hasCongestion(),
    )
    post { runCatching { onBitrate(event) } }
  }

  /**
   * Frames actually sent, divided by the wall clock between samples.
   *
   * The configured frame rate is what the encoder was asked for and it keeps
   * reporting that number long after a thermally throttled phone has stopped
   * delivering it. This is the number that moves when the picture starts
   * stuttering, which is the moment the operator needs the truth.
   */
  private fun sampleFrameRate() {
    if (!stream.isStreaming) {
      measuredFps = 0
      lastFrameSampleAt = 0L
      return
    }
    val sent = runCatching { stream.getStreamClient().getSentVideoFrames() }.getOrNull() ?: return
    val now = System.currentTimeMillis()
    val elapsed = now - lastFrameSampleAt
    if (lastFrameSampleAt > 0L && elapsed > 0L) {
      val frames = sent - lastSentFrames
      // A counter that went backwards means it was reset under us, which is
      // not a frame rate; skip the sample rather than report a negative one.
      if (frames >= 0L) measuredFps = ((frames * 1000.0) / elapsed).roundToInt()
    }
    lastSentFrames = sent
    lastFrameSampleAt = now
  }

  /**
   * Down fast, up slow.
   *
   * Congestion means the queue is filling because the uplink cannot carry what
   * is being produced; every second spent deciding is a second of video the
   * viewer loses. Recovery is the opposite: climbing back the moment the queue
   * drains just fills it again, so it takes a run of healthy seconds and then
   * moves a fifth of the way back.
   */
  private fun adapt() {
    val client = stream.getStreamClient()
    if (currentBitrate <= 0) currentBitrate = videoBitrate

    if (client.hasCongestion()) {
      healthyTicks = 0
      val reduced = (currentBitrate * 0.8).toInt().coerceAtLeast(MIN_BITRATE)
      if (reduced < currentBitrate) {
        currentBitrate = reduced
        stream.setVideoBitrateOnFly(reduced)
        log(LOG_WARN, "Uplink congested; bitrate down to ${reduced / 1000} kbps")
      }
      return
    }

    healthyTicks += 1
    if (healthyTicks < HEALTHY_TICKS_BEFORE_RECOVERY || currentBitrate >= videoBitrate) return

    healthyTicks = 0
    val raised = (currentBitrate + (videoBitrate - currentBitrate) * 0.2).toInt()
    currentBitrate = raised.coerceAtMost(videoBitrate)
    stream.setVideoBitrateOnFly(currentBitrate)
    log(LOG_INFO, "Uplink clear; bitrate back up to ${currentBitrate / 1000} kbps")
  }

  companion object {
    /** Below this the picture is worthless, so stalling is the better failure. */
    private const val MIN_BITRATE = 300_000

    /** Seconds of clear queue before any of the bitrate is given back. */
    private const val HEALTHY_TICKS_BEFORE_RECOVERY = 10

    /**
     * Reconnect attempts per connection: enough, at the ceiling below, to keep
     * trying for about five minutes - the studio holds the broadcast open for
     * five, so a phone that comes back inside that continues the same YouTube
     * event instead of walking into a new one. It was ten tries over about four
     * minutes against a studio that only waited two.
     */
    private const val RETRIES = 32

    /**
     * The longest the ladder waits between attempts.
     *
     * Ten seconds, down from thirty. Thirty was a lift or a tunnel's worth of
     * patience, but it was also how long a phone sat after the network came
     * back before it tried again - half a minute of dead air on the channel
     * with a perfectly good connection in hand. The cost of trying more often
     * is a connection attempt every ten seconds during an outage, which is
     * nothing next to that.
     */
    private const val RECONNECT_CEILING_MS = 10_000L

    /**
     * A connection that stays up this long was a real one. Thirty seconds:
     * longer than any handshake-then-refuse a server does, shorter than the
     * shortest outage worth riding out.
     */
    private const val SHORT_LIVED_MS = 30_000L

    /** Short-lived connections in a row before the broadcast is ended. */
    private const val MAX_SHORT_LIVED = 5

    /** Said on the banner and the lock screen when the above gives up. */
    private const val FLAPPING_REASON =
      "The server keeps dropping the broadcast seconds after accepting it, so the phone has stopped retrying"

    private const val MIN_SECRET_LENGTH = 6

    /** Anything that looks like a destination, for [scrubbed]. */
    private val STREAM_URL = Regex("""\b(?:rtmps?|srts?|rtsp)://\S+""", RegexOption.IGNORE_CASE)

    /** The shortest first attempt. Anything faster is not a retry, it is a spin. */
    private const val MIN_RECONNECT_DELAY_MS = 250L

    /** Enough doublings to reach the ceiling from any sane starting delay. */
    private const val BACKOFF_MAX_DOUBLINGS = 10

    /** Long enough for a working microphone to have produced many buffers. */
    private const val SILENCE_CHECK_MS = 2_500L

    /** A level meter that moves faster than this is not readable anyway. */
    private const val LEVEL_INTERVAL_MS = 100L

    /** The preview currently mounted, if any. See the note on the class. */
    var current: BroadcasterView? = null
      private set

    /**
     * Become the preview the module and the notification talk to.
     *
     * Two of these exist at once in exactly one situation, and it is the
     * dangerous one: a background broadcast whose activity was swiped away,
     * then relaunched from its notification into the same process. The old
     * view is detached but - deliberately, see [onDetachedFromWindow] - still
     * holding the camera, the encoder and the socket. A new one assigning over
     * it would point Stop at an idle view, which stops nothing, while the
     * orphan carried on broadcasting behind a notification that had gone; the
     * new view's own camera would then fail to open and show black.
     *
     * So the incumbent is torn down rather than dropped. A phone has one
     * camera stack and one microphone, and the view being mounted now is the
     * one the operator is looking at. Synchronously, because the alternative
     * is a release racing this view's camera open, and this only ever runs on
     * the path back into an app that was swiped away.
     */
    private fun claim(view: BroadcasterView) {
      val incumbent = current
      // The ordinary case by far: the same view re-claiming after a tab change.
      if (incumbent === view) return
      incumbent?.let { runCatching { it.release() } }
      current = view
    }
  }
}
