package de.linkfa.framevane.broadcaster

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/**
 * Holding the picture, writing to the phone, and carrying on in the
 * background - the three things that make this a broadcaster rather than a
 * camera preview with a socket behind it.
 */
internal fun ModuleDefinitionBuilder.captureFunctions() {
  /**
   * Freeze what viewers see without ending the broadcast - the "be right back"
   * of live streaming. Audio keeps going unless it is muted too, and the
   * connection stays up, so there is nothing to reconnect afterwards.
   */
  AsyncFunction("setVideoMuted") { muted: Boolean -> view().setVideoMuted(muted) }

  /** The words on the pause slate, in the operator's language. Kept for the next pause. */
  Function("setPauseSlate") { title: String, message: String ->
    BroadcasterView.current?.let {
      it.slateTitle = title
      it.slateMessage = message
    }
    Unit
  }

  Function("isVideoMuted") { BroadcasterView.current?.isVideoMuted() ?: false }

  /**
   * Records to the phone as well as sending, and resolves with the path being
   * written. Framevane archives server-side already, so this is the copy that
   * survives the uplink failing entirely.
   */
  AsyncFunction("startRecording") { view().startRecording() }

  AsyncFunction("stopRecording") { view().stopRecording() }

  Function("isRecording") { BroadcasterView.current?.stream?.isRecording ?: false }

  /**
   * Every take on the phone, read off the disk and out of the video library.
   *
   * Through the module's own context rather than the preview's: this is the
   * list on a screen the preview is not mounted on, and answering "none" there
   * because the camera is not running is the app reporting that the operator's
   * recordings are gone.
   */
  Function("recordings") { recordings(fileContext()) }

  /**
   * Video noise reduction and anti-flicker, both Camera2 capture-request keys
   * that RootEncoder has no call of its own for. The modes on offer come from
   * `capabilities()`, so a lens is never asked for one it does not have.
   */
  AsyncFunction("setNoiseReduction") { mode: Int -> view().setNoiseReduction(mode) }

  AsyncFunction("setAntiFlicker") { mode: Int -> view().setAntiFlicker(mode) }

  AsyncFunction("deleteRecording") { path: String -> deleteRecording(fileContext(), path) }

  /**
   * When to close one section of a recording and open the next. Zero for
   * either limit turns that limit off; zero for both records one file, which
   * is what every recording did before this.
   *
   * Applied to the next take rather than the running one: a limit changed
   * mid-recording would be a section boundary nobody asked for.
   */
  /**
   * The height the copy on the phone is written at, and what to spend on it.
   * Zero for either means the recording is the same picture that is going out,
   * which is what it has always been.
   *
   * Applied at the next configure, like every other encoder setting: the
   * library refuses to reconfigure under a running encoder, and a resolution
   * that changed mid-take would be a second file at best.
   */
  AsyncFunction("setRecordingQuality") { height: Int, bitrate: Int ->
    val view = view()
    view.recordHeight = height.coerceAtLeast(0)
    view.recordBitrate = bitrate.coerceAtLeast(0)
    view.markUnprepared()
  }

  Function("recordingQuality") {
    val view = BroadcasterView.current
    mapOf(
      "height" to (view?.recordHeight ?: 0),
      "bitrate" to (view?.recordBitrate ?: 0),
    )
  }

  AsyncFunction("setRecordingSplit") { minutes: Int, bytes: Double ->
    val view = view()
    view.splitMinutes = minutes.coerceAtLeast(0)
    view.splitBytes = bytes.coerceAtLeast(0.0).toLong()
  }

  /**
   * Hands a recording to whatever plays video on this phone.
   *
   * Native rather than done from JavaScript, because the only hard part is
   * Android's - see BroadcasterLibrary.kt, which holds both halves of it: a
   * library entry that any app can already read, and a file in this app's own
   * folder that has to be wrapped by the provider this module declares.
   *
   * The exception carries the reason. It used to be swallowed into "nothing on
   * this phone opened it", which named the wrong culprit and hid the only
   * evidence of what actually went wrong.
   */
  AsyncFunction("openRecording") { path: String -> openRecording(fileContext(), path) }

  /**
   * Whether a finished take is moved into the phone's video library, where the
   * gallery and every video player can see it, or left in the app's own folder
   * where only this app can.
   */
  AsyncFunction("setSaveToGallery") { on: Boolean -> view().saveToGallery = on }

  Function("canSaveToGallery") { CAN_USE_LIBRARY }

  /**
   * A still off the live picture, which is what viewers are seeing rather than
   * what the camera sees. Takes a promise because the still is produced on the
   * next render pass, not on this call.
   */
  AsyncFunction("takePhoto") { promise: Promise -> view().takePhoto(promise) }

  /**
   * Keep broadcasting when the app is not on screen. Android will not let an
   * app hold the camera in the background without a foreground service, and it
   * kills the process soon after besides - so with this on the broadcast runs
   * behind a notification the operator can see and stop from.
   */
  AsyncFunction("setBackgroundBroadcast") { on: Boolean -> view().backgroundBroadcast = on }

  Function("backgroundBroadcast") { BroadcasterView.current?.backgroundBroadcast ?: false }

  /**
   * The phone's own temperature, as Android reports it, and -1 where it
   * cannot. Nothing is inferred from frame timings: a guess dressed as a
   * reading is worse than an honest silence.
   */
  Function("thermal") {
    val status = BroadcasterView.current?.thermalStatus() ?: THERMAL_UNKNOWN
    mapOf("status" to status, "name" to thermalName(status))
  }

  /**
   * Room where recordings are written. Answers zero with no preview mounted,
   * which reads as "nothing can be recorded" - and nothing can.
   */
  Function("storage") { storage(fileContext()) }

  /**
   * Charge remaining, for the readout. Answers a safe "full, not charging"
   * with no preview mounted, because a battery warning on a screen that is not
   * showing a camera is noise.
   */
  Function("power") {
    BroadcasterView.current?.power() ?: mapOf("level" to 1.0, "charging" to false)
  }
}
