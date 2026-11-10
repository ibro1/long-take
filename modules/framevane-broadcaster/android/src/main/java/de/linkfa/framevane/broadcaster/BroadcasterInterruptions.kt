package de.linkfa.framevane.broadcaster

import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Build

/**
 * When something else on the phone takes the microphone.
 *
 * This is the failure that costs the most and shows the least. A call arrives
 * mid-broadcast, Android hands this app digital silence rather than an error -
 * the AudioRecord keeps running, every read succeeds, every sample is zero -
 * and the broadcast carries on looking perfectly healthy. Nothing in the app
 * knew, so nobody was told until a viewer said so.
 *
 * Two detectors, because neither covers the whole problem:
 *
 *  - Android's own recording callback, which from Android 10 carries
 *    `isClientSilenced`: the system saying in as many words that this app is
 *    being given silence. Precise, immediate, and only on Android 10 and up.
 *  - Digital silence in the level meter, which [MicrophoneLevel] is already
 *    measuring on every buffer. It works on every version and catches causes
 *    the first one does not name - a source that failed to restart after a
 *    rotation, a headset unplugged into a dead input - and it is exact rather
 *    than a threshold, because a real microphone in a silent room still
 *    delivers its own noise floor. Every sample being zero is not a quiet
 *    room; it is nothing at all.
 *
 * Deliberately not here: audio focus. Listening for focus changes means
 * holding focus, and an app that takes audio focus pauses whatever the
 * operator was playing. The recording callback already names the call case on
 * any phone from 2019 onwards, and the meter catches the rest, so the cost is
 * not worth paying.
 *
 * Also deliberately not here: `TelephonyManager`. It needs READ_PHONE_STATE -
 * a Play Store declaration and a permission prompt - to learn something the
 * audio APIs already say.
 */

/**
 * Registered against Android's audio service rather than the view, so it is
 * kept beside the file like the Bluetooth route above it: there is one
 * BroadcasterView at a time, and one registration is the whole truth.
 */
private var recordingWatch: AudioManager.AudioRecordingCallback? = null

/**
 * Starts watching. Safe to call repeatedly - a second registration would be a
 * second callback for every change, and every one of them would report.
 */
internal fun BroadcasterView.watchAudioInterruptions() {
  if (recordingWatch != null) return
  val manager = audioManager ?: return

  val watch = object : AudioManager.AudioRecordingCallback() {
    override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>?) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
      /**
       * From Android 10 this list holds only this app's own recordings, so
       * anything in it is ours. An empty list while the microphone is meant to
       * be running is itself the report: the recording did not merely go
       * quiet, it stopped.
       */
      val mine = configs.orEmpty().firstOrNull()
      val running = runCatching { microphone.isRunning() }.getOrDefault(false)
      if (!running) return

      val silenced = mine == null || runCatching { mine.isClientSilenced }.getOrDefault(false)
      noteAudioSilence(silenced, if (mine == null) "taken" else "silenced")

      /**
       * The other half of an interruption, and the half the silence detector
       * cannot see.
       *
       * A call takes the Bluetooth link and does not give it back, so the
       * recorder carries on reading the phone's own microphone: quiet, not
       * silent, and every sample above zero. The level meter dips and nothing
       * else in the app has an opinion. Android tells us which device we are
       * actually recording from, so this asks it rather than inferring
       * anything.
       */
      if (!silenced) checkAudioRoute()
    }
  }

  val onMain = android.os.Handler(android.os.Looper.getMainLooper())
  runCatching { manager.registerAudioRecordingCallback(watch, onMain) }.onFailure {
    log(LOG_WARN, "Could not watch for interruptions: ${it.message}")
    return
  }
  recordingWatch = watch
}

/**
 * The audio mode going back to normal, which is how a call ending sounds from
 * inside an app that never asked about the call.
 *
 * The recording callback fires when this app's own configuration changes, and
 * a link taken away by telephony does not always produce one - the recorder
 * keeps its configuration and simply stops hearing the headset. The mode is
 * the other side of the same event and needs no permission to watch.
 *
 * API 31 and up. Below it the recording callback and the operator are what
 * there is, which is what there was before any of this.
 */
private var modeWatch: AudioManager.OnModeChangedListener? = null

internal fun BroadcasterView.watchAudioMode() {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
  if (modeWatch != null) return
  val manager = audioManager ?: return

  val watch = AudioManager.OnModeChangedListener { mode ->
    if (mode != AudioManager.MODE_NORMAL) return@OnModeChangedListener
    /**
     * A call ending is a fresh start for putting the headset back. Anything
     * tried while the call was still up was bound to fail - the call owns the
     * link - and used to spend the only attempt the settle window allowed, so
     * a short call left the broadcast on the phone's microphone for good.
     */
    lastRouteFix = 0L
    routeRetry = 0
    /**
     * Not immediately. The audio policy is still settling as the call tears
     * down, and a route asked for inside that window is refused. On the main
     * looper, not the view: a view detached for another tab never runs it.
     */
    audioHandler.postDelayed({ checkAudioRoute() }, 1_500L)
  }

  runCatching { manager.addOnModeChangedListener(context.mainExecutor, watch) }.onFailure {
    log(LOG_WARN, "Could not watch for calls: ${it.message}")
    return
  }
  modeWatch = watch
}

internal fun BroadcasterView.stopWatchingAudioInterruptions() {
  val watch = recordingWatch
  if (watch != null) {
    recordingWatch = null
    runCatching { audioManager?.unregisterAudioRecordingCallback(watch) }
  }

  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    val mode = modeWatch
    if (mode != null) {
      modeWatch = null
      runCatching { audioManager?.removeOnModeChangedListener(mode) }
    }
  }
}

/**
 * One place both detectors report to, and the only place that decides whether
 * this is news.
 *
 * Only transitions are reported. The level detector runs on the audio thread
 * several times a second and the recording callback fires on every change
 * Android notices, so without this the operator would get the same banner
 * forty times and the log would be unreadable.
 */
internal fun BroadcasterView.noteAudioSilence(silenced: Boolean, from: String) {
  if (silenced == audioSilenced) return
  audioSilenced = silenced

  /**
   * `getMode` needs no permission and is the difference between "something
   * took the microphone" and the one thing the operator can act on, which is
   * that they are on a call. It is a hint and it is named as one - a ROM that
   * does not set the mode gets the general wording.
   */
  val onCall = runCatching {
    val mode = audioManager?.mode
    mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION
  }.getOrDefault(false)

  val reason = if (!silenced) "back" else if (onCall) "call" else from

  if (silenced) {
    log(
      LOG_WARN,
      when (reason) {
        "call" -> "The microphone has gone silent - this phone is on a call"
        "taken" -> "The microphone stopped; another app may have taken the input"
        else -> "The microphone is running and every sample is silent"
      },
    )
    // The phone is usually in a pocket or on a stand when this happens, so the
    // notification channel that already exists for a broadcast ending carries
    // it too. Only when something is actually going out: a silent meter on a
    // viewfinder nobody is broadcasting from is not worth a notification.
    if (stream.isStreaming || stream.isRecording) {
      runCatching {
        BroadcastService.alertMicrophone(
          context,
          if (reason == "call") "This phone is on a call, so nothing is being heard."
          else "Something else on the phone may have taken the input.",
        )
      }
    }
  } else {
    log(LOG_INFO, "The microphone is delivering sound again")
  }

  post {
    runCatching {
      onAudioInterrupted(mapOf("silenced" to silenced, "reason" to reason))
    }
  }
}

/**
 * When to look again after asking for a lost link back.
 *
 * The link takes a few seconds to come up, and a check inside that window sees
 * the old device and asks again - which is a loop, over a real headset, in the
 * middle of a broadcast.
 */
private const val ROUTE_SETTLE_MS = 8_000L

/** When the route was last re-asked for, so the settle window can be enforced. */
private var lastRouteFix = 0L

/**
 * How long to wait before looking again, after each re-ask that has not yet
 * put the recording back on the chosen headset.
 *
 * It used to be one attempt and nothing after it. A headset that was slow to
 * come back from a call - or a call that ended while the link was still
 * settling - stayed on the phone's microphone for the rest of the broadcast.
 * Three more looks, spaced out, and then the operator is told it is theirs to
 * choose again, rather than this looping over a real headset mid-lesson.
 */
private val ROUTE_RETRY_MS = longArrayOf(8_000L, 15_000L, 30_000L)
private var routeRetry = 0

private fun BroadcasterView.scheduleRouteRecheck() {
  val attempt = routeRetry
  if (attempt >= ROUTE_RETRY_MS.size) {
    routeRetry = 0
    log(LOG_WARN, "Could not get the chosen microphone back; choose it again from the microphone list")
    return
  }
  routeRetry = attempt + 1
  audioHandler.postDelayed({
    // Another call has started: the mode watch will begin again when it ends.
    val mode = runCatching { audioManager?.mode }.getOrNull()
    if (mode != null && mode != AudioManager.MODE_NORMAL) {
      routeRetry = 0
      return@postDelayed
    }
    if (recordingFromChosenDevice()) {
      routeRetry = 0
      return@postDelayed
    }
    lastRouteFix = 0L
    checkAudioRoute()
  }, ROUTE_RETRY_MS[attempt])
}

/**
 * Puts the operator back on the microphone they chose, if they are not on it.
 *
 * A call or another app can take the microphone away from any input - not only
 * Bluetooth. For Bluetooth the SCO link must be re-asked for; for wired, USB
 * and built-in mics the AudioRecord simply needs to be reopened (off-air) or
 * re-pointed (live) so Android routes it back to the chosen device.
 */
internal fun BroadcasterView.checkAudioRoute() {
  if (recordingFromChosenDevice()) {
    routeRetry = 0
    return
  }

  val now = System.currentTimeMillis()
  if (now - lastRouteFix < ROUTE_SETTLE_MS) return
  lastRouteFix = now

  val chosen = selectedInputDevice()
  val isBluetooth = chosen != null && needsBluetoothLink(chosen.type)

  if (isBluetooth) {
    reacquireAudioRoute()
  } else if (stream.isStreaming || stream.isRecording) {
    // Live: we cannot restart the microphone, but we can re-apply the preferred
    // device so Android routes the existing AudioRecord back to it.
    runCatching { microphone.setPreferredDevice(chosen) }
    log(LOG_INFO, "Re-applying preferred device for live recovery: ${chosen?.let { nameOf(it) } ?: "Android default"}")
  } else {
    // Off-air: restart the microphone so a fresh AudioRecord picks up the chosen device.
    log(LOG_INFO, "Restoring microphone after interruption for ${chosen?.let { nameOf(it) } ?: "Android default"}")
    restoreMicrophone()
  }

  scheduleRouteRecheck()

  /**
   * Said on screen as well as in the log. The operator's evidence for this was
   * a level meter that looked low - which is indistinguishable from a quiet
   * room until somebody plays the broadcast back on another phone, by which
   * time it is an hour of inaudible video.
   */
  post {
    runCatching {
      onAudioInterrupted(mapOf("silenced" to false, "reason" to "route"))
    }
  }
}

/**
 * Opens the microphone again.
 *
 * Off air this is the path the meter already uses, and it is proven: down and
 * up, which builds a fresh AudioRecord.
 *
 * While live it is refused, and that refusal is the honest answer rather than
 * a missing feature. The encoder owns the audio source once a broadcast
 * starts, and the only way to swap it is RootEncoder's `changeAudioSource`,
 * which calls `init` and then `start` on the new source - the exact pair that
 * builds two AudioRecords and leaves the second one failing every read with
 * nothing thrown. This app has already been bitten by that once. An operator
 * whose microphone does not come back on its own is offered the connection
 * restart instead, which rebuilds everything through a path that is used every
 * day.
 *
 * Returns whether the microphone is running again, which is all this call can
 * honestly claim. Whether it is delivering sound is a different question, and
 * the level detector answers it a buffer or two later by clearing the warning
 * on its own - so the screen does not have to take this return value as proof.
 */
internal fun BroadcasterView.restoreMicrophone(): Boolean {
  if (stream.isStreaming) {
    log(LOG_WARN, "The microphone cannot be reopened while live; restart the connection instead")
    return false
  }

  log(LOG_INFO, "Reopening the microphone")
  monitorAudio(false)
  monitorAudio(true)

  /**
   * The silenced flag is deliberately left alone.
   *
   * Clearing it here would be the app declaring the problem solved on the
   * strength of having tried something, and it would also break the report
   * that says so for real: the level detector only speaks on a change, so a
   * flag cleared behind its back means the recovery it sees is not a change
   * and the warning on screen never clears. Sound arriving is what ends this,
   * and nothing else is entitled to.
   */
  return runCatching { microphone.isRunning() }.getOrDefault(false)
}
