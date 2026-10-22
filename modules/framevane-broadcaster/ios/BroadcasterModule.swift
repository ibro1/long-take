import ExpoModulesCore

/**
 * iOS: not implemented yet, and saying so out loud.
 *
 * The Android side publishes RTMP and SRT through RootEncoder. The iOS
 * counterpart (RootEncoder for iOS, or HaishinKit with its SRT package) is a
 * separate implementation with its own camera and audio session handling, and
 * it needs an Apple Developer account to test on a device at all.
 *
 * Until that is built, this file still implements the whole contract, for one
 * reason: a call to a function the native module does not declare fails with
 * "function not found", which tells an operator nothing. Anything that ACTS
 * throws an error that names the real reason instead. Anything that only READS
 * returns an honest empty answer, so the screens still render and report
 * nothing available rather than crashing on the way to saying it.
 */
internal final class NotImplementedOnIOS: Exception {
  override var reason: String {
    "Broadcasting from iOS is not built yet - use the Android app for now."
  }
}

public class BroadcasterModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FramevaneBroadcaster")

    View(BroadcasterView.self) {
      Events(
        "onStatus",
        "onBitrate",
        "onLevel",
        "onCameras",
        "onAudioDevices",
        "onLog",
        "onRecord",
        "onAudioInterrupted",
        "onThermal"
      )
    }

    // --- The broadcast --------------------------------------------------

    AsyncFunction("configure") { (_: [String: Any]) in throw NotImplementedOnIOS() }
    AsyncFunction("startStream") { (_: String) in throw NotImplementedOnIOS() }
    AsyncFunction("stopStream") { throw NotImplementedOnIOS() }
    Function("isStreaming") { false }
    AsyncFunction("setVideoBitrate") { (_: Int) in throw NotImplementedOnIOS() }

    /**
     * Shaped exactly like the Android reading, zeroed. The stats panel reads
     * this on a timer and formats every field; a missing key there is a crash
     * in a readout, which is a silly way to lose a screen.
     */
    Function("stats") {
      [
        "bitrate": 0,
        "droppedVideoFrames": 0,
        "droppedAudioFrames": 0,
        "sentVideoFrames": 0,
        "sentAudioFrames": 0,
        "queueItems": 0,
        "queueCapacity": 0,
        "bytesSent": 0,
        "congested": false,
        "width": 0,
        "height": 0,
        "fps": 0,
        "codec": "h264",
        "recording": false,
        "videoMuted": false,
      ] as [String: Any]
    }

    AsyncFunction("setSrtOptions") { (_: [String: Any]) in throw NotImplementedOnIOS() }

    // No encoder has been built, which is exactly what null says.
    Function("encoderPicture") { () -> [String: Any]? in nil }

    // --- Cameras --------------------------------------------------------

    Function("cameras") { [] as [[String: Any]] }
    AsyncFunction("openCamera") { (_: String) in throw NotImplementedOnIOS() }
    AsyncFunction("switchCamera") { throw NotImplementedOnIOS() }

    /**
     * Empty rather than a plausible-looking list. The settings screen offers
     * only the codecs this answer contains, so claiming H.264 here would offer
     * a choice that cannot be acted on.
     */
    Function("supportedCodecs") { [] as [[String: Any]] }

    /**
     * `available: false` is the flag the UI already checks before offering any
     * camera control, so every control correctly hides itself here rather than
     * each one needing to know about iOS.
     */
    Function("capabilities") {
      [
        "zoom": ["min": 1.0, "max": 1.0, "current": 1.0],
        "exposure": ["min": 0, "max": 0, "current": 0, "auto": true],
        "autoFocus": true,
        "stabilization": false,
        "whiteBalanceModes": [] as [Int],
        "whiteBalance": 0,
        "autoWhiteBalance": true,
        "torch": false,
        "available": false,
      ] as [String: Any]
    }

    AsyncFunction("setZoom") { (_: Float) in throw NotImplementedOnIOS() }
    Function("zoomRange") { ["min": 1.0, "max": 1.0] }
    AsyncFunction("focusAt") { (_: Double, _: Double) in throw NotImplementedOnIOS() }
    AsyncFunction("setAutoFocus") { (_: Bool) in throw NotImplementedOnIOS() }
    AsyncFunction("setExposure") { (_: Int) in throw NotImplementedOnIOS() }
    AsyncFunction("setExposureLock") { (_: Bool) in throw NotImplementedOnIOS() }
    AsyncFunction("setFocusDistance") { (_: Float) in throw NotImplementedOnIOS() }
    AsyncFunction("resumeAutoFocus") { throw NotImplementedOnIOS() }
    AsyncFunction("setSaveToGallery") { (_: Bool) in throw NotImplementedOnIOS() }
    AsyncFunction("restoreMicrophone") { () -> Bool in throw NotImplementedOnIOS() }
    AsyncFunction("setRecordingSplit") { (_: Int, _: Double) in throw NotImplementedOnIOS() }
    AsyncFunction("setRecordingQuality") { (_: Int, _: Int) in throw NotImplementedOnIOS() }
    Function("recordingQuality") { ["height": 0, "bitrate": 0] }
    AsyncFunction("pickRecordingFolder") { () -> String in throw NotImplementedOnIOS() }
    AsyncFunction("setRecordingFolder") { (_: String) in throw NotImplementedOnIOS() }
    Function("recordingFolder") { "" }
    Function("audioSilenced") { false }
    Function("thermal") { ["status": -1, "name": "unknown"] }
    Function("storage") { ["usableBytes": 0.0, "totalBytes": 0.0] }
    Function("canSaveToGallery") { false }
    AsyncFunction("setWhiteBalance") { (_: Int) in throw NotImplementedOnIOS() }
    AsyncFunction("setStabilization") { (_: Bool) in throw NotImplementedOnIOS() }
    AsyncFunction("setTorch") { (_: Bool) in throw NotImplementedOnIOS() }
    Function("isTorchOn") { false }

    // --- Audio ----------------------------------------------------------

    AsyncFunction("setMuted") { (_: Bool) in throw NotImplementedOnIOS() }
    Function("isMuted") { false }
    AsyncFunction("setMicGain") { (_: Double) in throw NotImplementedOnIOS() }
    Function("micGain") { 1.0 }
    Function("audioDevices") { [] as [[String: Any]] }
    AsyncFunction("selectAudioDevice") { (_: Int) in throw NotImplementedOnIOS() }
    AsyncFunction("monitorAudio") { (_: Bool) in throw NotImplementedOnIOS() }

    // --- Shape ----------------------------------------------------------

    AsyncFunction("setOrientation") { (_: String) in throw NotImplementedOnIOS() }
    Function("orientation") { "auto" }

    // --- Holding the picture --------------------------------------------

    AsyncFunction("setVideoMuted") { (_: Bool) in throw NotImplementedOnIOS() }
    Function("isVideoMuted") { false }

    // --- Recording and stills -------------------------------------------

    AsyncFunction("startRecording") { throw NotImplementedOnIOS() }
    AsyncFunction("stopRecording") { throw NotImplementedOnIOS() }
    Function("isRecording") { false }
    Function("recordings") { [] as [[String: Any]] }
    AsyncFunction("deleteRecording") { (_: String) in throw NotImplementedOnIOS() }
    AsyncFunction("takePhoto") { throw NotImplementedOnIOS() }

    // --- Carrying on in the background ----------------------------------

    AsyncFunction("setBackgroundBroadcast") { (_: Bool) in throw NotImplementedOnIOS() }
    Function("backgroundBroadcast") { false }

    /**
     * UIDevice does report this on iOS, but reading it means enabling
     * monitoring on the main thread and the rest of this file is a stub - so
     * it answers "full and not charging", which renders as nothing on screen
     * rather than as a wrong number.
     */
    Function("power") { ["level": 1.0, "charging": false] as [String: Any] }

    AsyncFunction("setNoiseReduction") { (_: Int) in throw NotImplementedOnIOS() }
    AsyncFunction("setAntiFlicker") { (_: Int) in throw NotImplementedOnIOS() }

    // Android's problem, and Android's solution: a content URI from a
    // FileProvider. iOS has no equivalent here and no encoder behind it yet.
    AsyncFunction("openRecording") { (_: String) in
      throw NotImplementedOnIOS()
    }
  }
}
