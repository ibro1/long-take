package de.linkfa.framevane.broadcaster

import expo.modules.kotlin.modules.ModuleDefinitionBuilder

/** The audio half of the module definition. */
internal fun ModuleDefinitionBuilder.audioFunctions() {
  AsyncFunction("setMuted") { muted: Boolean ->
    val microphone = view().microphone
    if (muted) microphone.mute() else microphone.unMute()
  }

  Function("isMuted") { BroadcasterView.current?.microphone?.isMuted() ?: false }

  /**
   * 0 to 2, where 1 is the microphone as it comes. Above 1 is gain applied
   * after capture, so it clips rather than getting louder.
   */
  AsyncFunction("setMicGain") { level: Float ->
    /**
     * Applied to the preview when there is one, and otherwise not an error.
     *
     * Same trap as the input picker, in the same screen: Audio settings has no
     * camera preview mounted, so `view()` rejected the call and the screen's
     * catch swallowed it. Gain at least survived that - the phone stores it and
     * it is re-applied with the rest of the settings when the viewfinder next
     * configures - but a throw for an ordinary case is a throw that trains a
     * screen to ignore its own failures.
     */
    BroadcasterView.current?.setMicGain(level)
  }

  Function("micGain") { BroadcasterView.current?.micGain() ?: 1f }

  /**
   * Only the inputs attached right now, read from Android every time. A list
   * this app remembered would keep showing a lapel microphone after it fell
   * out, and the disappearance of that entry is exactly how the viewfinder
   * knows to warn the operator that the phone's own microphone has taken over.
   */
  Function("audioDevices") { listAudioDevices(fileContext()) }

  /**
   * -1 hands the choice back to Android.
   *
   * Deliberately not through `view()`. This is called from the Audio settings
   * route, which has no camera preview mounted - so requiring one rejected
   * every call with "There is no camera preview mounted to broadcast from",
   * and the screen swallowed it. A microphone is not a camera.
   */
  AsyncFunction("selectAudioDevice") { id: Int -> chooseAudioDevice(fileContext(), id) }

  /**
   * Run the microphone while off air so the level meter means something
   * before the broadcast starts. Silence is the one fault the picture cannot
   * show, and the cheap moment to catch it is before anyone is watching.
   *
   * Through `requestMonitor`, which holds the request while the viewfinder is
   * out of sight rather than opening the microphone for a meter nobody can
   * see; the request is honoured when the preview comes back.
   */
  AsyncFunction("monitorAudio") { on: Boolean -> view().requestMonitor(on) }

  /**
   * Opens the microphone again after something else on the phone took it.
   *
   * Refused while live and says so, because the encoder owns the audio source
   * by then and the only call that swaps it is the one that builds two
   * AudioRecords - see BroadcasterInterruptions for why that is not worth the
   * risk. The screen offers the connection restart instead.
   */
  AsyncFunction("restoreMicrophone") { view().restoreMicrophone() }

  /** Whether the microphone is handing back digital silence right now. */
  Function("audioSilenced") { BroadcasterView.current?.audioSilenced ?: false }
}
