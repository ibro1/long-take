package de.linkfa.framevane.broadcaster

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Choosing a microphone, connecting it, and how loud it is.
 *
 * A broadcaster that cannot choose its input is a broadcaster that records the
 * phone's own speaker mesh while a lapel microphone sits plugged in and unused,
 * which is a fault nobody notices until the recording is played back.
 *
 * Choosing is only half of it for Bluetooth, which is why this file grew. A
 * paired headset appears in Android's list of inputs the moment it connects,
 * but its microphone is not carried to an AudioRecord until the SCO link is
 * explicitly asked for - by `setCommunicationDevice` from API 31, by
 * `startBluetoothSco` below that. RootEncoder only calls
 * `AudioRecord.setPreferredDevice`, which names a device without connecting it,
 * so a headset chosen here used to give silence and a dead level meter with
 * nothing anywhere saying why.
 */

/**
 * The Bluetooth link this app asked for, and the receiver waiting on it.
 *
 * Kept beside the file rather than on the view because there is deliberately
 * one BroadcasterView at a time - see the note on the class - so one route is
 * the whole truth. Everything that sets these gives them back through
 * [releaseAudioRoute], which is the only path that touches Android's routing
 * again, and which does nothing unless this app was the one that asked.
 */
private var routedDeviceId = -1
private var scoWatcher: BroadcastReceiver? = null

/**
 * The context [scoWatcher] was registered on, kept with it.
 *
 * The receiver outlives the view that registered it - it is static, and a
 * relaunch from the notification tears the old view down from the new one -
 * and Android only unregisters a receiver through the context it was
 * registered with. Unregistering through whichever view happened to be
 * releasing threw "receiver not registered", which the runCatching swallowed,
 * and the receiver stayed registered on a dead activity for the life of the
 * process. It is registered on the application context, which every view
 * shares, and unregistered on that same object.
 */
private var scoWatcherContext: Context? = null
private var routeReopened = false

/**
 * Set while the microphone is being taken down and started again to pick up a
 * link that has just come up. The stop half of that would otherwise look like
 * the operator finishing with the microphone and hand the headset straight
 * back, one call before it was going to be used.
 */
private var reopeningForRoute = false

/**
 * The main looper, for the audio code's own delays.
 *
 * Not the view's `postDelayed`. A view posts into a queue that only drains
 * while it is attached, and the navigator detaches this one whenever the
 * operator opens another tab - so a call ending while they were on Settings
 * had its "put the headset back" check sitting unrun until they came back to
 * the viewfinder.
 */
internal val audioHandler = Handler(Looper.getMainLooper())

/**
 * The input the operator chose, or -1 for Android's own choice.
 *
 * Here rather than on the view, and that is the whole of the bug this moved
 * for. Choosing a microphone is done on the Audio settings route, and that
 * route has no camera preview mounted - so every call that needed one was
 * rejected before it reached any of this, and the tap did nothing at all. A
 * microphone has nothing to do with a camera; it should never have needed one.
 */
internal var chosenAudioDeviceId = -1

/**
 * The chosen microphone after it dropped, kept so it can be recognised when it
 * reconnects under a new id. Null when nothing chosen has gone.
 */
internal var droppedAudioChoice: DroppedAudioChoice? = null

internal data class DroppedAudioChoice(val type: Int, val name: String, val address: String) {
  fun matches(device: AudioDeviceInfo): Boolean {
    val other = runCatching { device.address }.getOrNull().orEmpty()
    if (address.isNotEmpty() && other.isNotEmpty()) return address == other
    return device.type == type && device.productName?.toString().orEmpty() == name
  }

  companion object {
    fun of(device: AudioDeviceInfo) = DroppedAudioChoice(
      type = device.type,
      name = device.productName?.toString().orEmpty(),
      address = runCatching { device.address }.getOrNull().orEmpty(),
    )
  }
}

/** The phone's audio service, from whatever context is to hand. */
internal fun audioManagerOf(context: Context): AudioManager? =
  context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

/**
 * Every input Android will accept audio from.
 *
 * `current` is what Android says this app is recording from, read back from
 * its own list of active recordings, and only falls back to the stored
 * preference while the microphone is not running - where a preference is the
 * honest answer, because it is a statement about the next start rather than a
 * claim about now. It used to be the preference either way, which is how the
 * viewfinder came to display a Bluetooth headset beside a meter reading
 * nothing: the app had asked for that headset, and was saying so as though
 * asking had settled it.
 */
internal fun listAudioDevices(context: Context): List<Map<String, Any>> {
  val manager = audioManagerOf(context) ?: return emptyList()
  val devices = runCatching {
    manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
  }.getOrNull() ?: return emptyList()

  // What Android says is in use, when there is a preview running one. With no
  // preview there is no recording, and the stored choice is the honest answer.
  val inUse = BroadcasterView.current?.recordingDeviceId() ?: -1

  /**
   * Everything except the two that are certainly not microphones.
   *
   * Android lists the FM tuner and the telephony downlink among this phone's
   * inputs, and both were offered to the operator as things to speak into.
   * Neither can carry a lesson: telephony capture needs a privilege no
   * ordinary app holds, and the tuner is a radio.
   *
   * Removed by name rather than by an allow-list of the types this app knows,
   * which was the first attempt and was wrong. Phones report inputs this
   * module has no constant for - the handset in the report that prompted all
   * this is recording through one, listed as an unhelpful "Microphone" because
   * its type maps to nothing here - and an allow-list would have hidden the
   * very device the phone actually uses. A list that omits the working
   * microphone is a worse fault than one that includes a radio.
   *
   * Whatever Android says is in use is kept regardless, so the screen can
   * always say what is happening - including during a call.
   */
  val usable = devices.filter { canRecordFrom(it.type) || it.id == inUse }

  /**
   * Names that repeat, numbered.
   *
   * Most phones have several built-in microphones - bottom, top, back - and
   * Android reports the phone's model as the product name of every one of
   * them, so [nameOf] returns the same "Built-in microphone" for all of them.
   * Two identical chips is not a choice: the operator cannot tell which is
   * which, cannot see which is selected, and taps one at random. Numbering is
   * the only honest distinction available, since nothing in the platform says
   * which end of the phone a given recorder sits at.
   */
  val counts = usable.groupingBy { nameOf(it) }.eachCount()
  val seen = mutableMapOf<String, Int>()

  return usable.map { device ->
    val base = nameOf(device)
    val name = if ((counts[base] ?: 0) > 1) {
      val n = (seen[base] ?: 0) + 1
      seen[base] = n
      "$base $n"
    } else {
      base
    }

    mapOf(
      "id" to device.id,
      "name" to name,
      "kind" to kindOf(device.type),
      "current" to (device.id == (if (inUse >= 0) inUse else chosenAudioDeviceId)),
    )
  }
}

/**
 * Whether a broadcast could be recorded from this kind of input.
 *
 * A block-list, and a short one on purpose. Only the inputs that are certainly
 * not a microphone are named; everything else is offered, including types this
 * module has no constant for, because a phone knows its own hardware better
 * than a list written here does.
 */
private fun canRecordFrom(type: Int): Boolean = when (type) {
  AudioDeviceInfo.TYPE_FM_TUNER,
  AudioDeviceInfo.TYPE_TELEPHONY,
  AudioDeviceInfo.TYPE_TV_TUNER,
  -> false

  else -> true
}

/**
 * Hands the microphone to one device, or back to Android.
 *
 * Takes a Context rather than a preview, and that is the fix for the fault
 * that was actually reported. Audio settings is its own route; by the time a
 * chip is tapped the viewfinder has detached, so the module's `view()` threw
 * "There is no camera preview mounted to broadcast from" and the screen's bare
 * catch swallowed it. Every tap, on every phone, did nothing. Choosing a
 * microphone does not need a camera and now does not ask for one.
 *
 * The second thing wrong with it only showed up once calls got this far.
 * RootEncoder's `setPreferredDevice` keeps no preference of its own: with no
 * AudioRecord open it logs "audioRecord not created" and returns false, and
 * with one open it points at a recorder that has already chosen its device and
 * does not follow. So the choice is stored here, applied at each moment a
 * recorder comes into existence, and the running recorder is opened again so
 * that it moves.
 */
internal fun chooseAudioDevice(context: Context, id: Int) {
  val manager = audioManagerOf(context)
  val device = if (id < 0) {
    null
  } else {
    runCatching {
      manager?.getDevices(AudioManager.GET_DEVICES_INPUTS)?.firstOrNull { it.id == id }
    }.getOrNull() ?: throw UnknownAudioDeviceException()
  }

  chosenAudioDeviceId = device?.id ?: -1
  // A new choice outranks a headset that dropped earlier: it must not take
  // over again when it reconnects.
  droppedAudioChoice = null

  /**
   * With no preview there is nothing further to do, and nothing further that
   * could be done: no recorder to point, no route to open, no meter to
   * restart. The choice is stored and the next microphone to open uses it,
   * which is what the screen says happens.
   */
  val view = BroadcasterView.current ?: return
  view.applyAudioChoice(device)
}

/**
 * The half of choosing that needs a preview: the route, the recorder, the log.
 */
internal fun BroadcasterView.applyAudioChoice(device: AudioDeviceInfo?) {
  // Naming a Bluetooth device is not connecting it, and moving away from one
  // is not disconnecting it. Both are this call's business, because the
  // operator has just changed their mind and nothing else will notice. Before
  // the recorder, so a link that is coming up is already asked for.
  acquireAudioRoute()

  val running = runCatching { microphone.isRunning() }.getOrDefault(false)
  val overBluetooth = device != null && needsBluetoothLink(device.type)

  /**
   * A running recorder is not pointed at a headset until the headset can carry
   * anything.
   *
   * `AudioRecord.setPreferredDevice` re-routes a capture that is already open,
   * and routing one to a Bluetooth link that has not come up is silence - the
   * meter goes flat the moment the headset is chosen and stays flat until
   * something reopens it. The link is asked for above; [watchForLink] applies
   * the choice when it answers, by which time there is something on the end of
   * it. Everything else is pointed now.
   */
  val accepted = if (overBluetooth && running) false else applyPreferredDevice()

  when {
    device == null -> log(LOG_INFO, "Microphone choice handed back to Android")
    overBluetooth && running ->
      log(LOG_INFO, "Waiting for ${nameOf(device)} to open its microphone link")
    // Android moved the open recording, which it will do for the phone's own
    // inputs even mid-broadcast. This is the ordinary success.
    accepted -> log(LOG_INFO, "Microphone set to ${nameOf(device)}")
    !running -> log(LOG_INFO, "Microphone set to ${nameOf(device)} for the next start")
    /**
     * Live and refused. Not the same as "cannot be changed while live", which
     * is what this said and was wrong: Android moves a live recording to
     * another built-in or wired input readily enough, and only this branch
     * means it would not. What this app will not do while live is stop and
     * restart the recorder to force it - that is the double-AudioRecord trap
     * the rest of this module is built around, and a hole in the broadcast is
     * worse than the wrong microphone for the rest of it.
     */
    stream.isStreaming || stream.isRecording ->
      log(LOG_WARN, "Android would not move a live recording to ${nameOf(device)}; it will be used from the next broadcast")
    // A refusal from a running microphone IS worth saying out loud: the audio
    // policy can decline a device in use by a call, and the operator would
    // otherwise see their choice ticked while hearing the built-in one.
    else -> log(LOG_WARN, "Android declined ${nameOf(device)}; it is still choosing")
  }

  reopenMicrophoneForChoice()
  reportAudioDevices()
}

/**
 * Points the recorder at the chosen device.
 *
 * Called at every moment an AudioRecord comes into existence, because that is
 * the only moment the call does anything: the library forwards straight to
 * `AudioRecord.setPreferredDevice` and refuses when there is no recorder.
 * Null - the operator handing the choice back to Android - is passed through
 * deliberately, since that is how a preference is cleared.
 */
internal fun BroadcasterView.applyPreferredDevice(): Boolean {
  val device = selectedInputDevice()
  if (device == null && selectedAudioDeviceId >= 0) {
    // Chosen, and then unplugged. Nothing to point at, and the removal watcher
    // has its own say about it.
    return false
  }
  return runCatching { microphone.setPreferredDevice(device) }.getOrDefault(false)
}

/**
 * Takes the microphone down and opens it again on the device just chosen.
 *
 * An AudioRecord does not change device under an operator; the routing is
 * settled when it opens. The Bluetooth path already knew this and reopened for
 * its own reasons - the general case did not, which is why choosing a wired
 * lapel microphone, or moving back to the phone's own, appeared to do nothing
 * at all while the meter was running.
 *
 * Never while live, for the same reason [selectAudioDevice] says so above.
 */
private fun BroadcasterView.reopenMicrophoneForChoice() {
  if (stream.isStreaming || stream.isRecording) return
  if (!runCatching { microphone.isRunning() }.getOrDefault(false)) return

  /**
   * Not for Bluetooth. That case already has an owner and reopening here
   * fights it.
   *
   * A headset carries no audio until its link is up, and the link takes from a
   * moment to several seconds - so [watchForLink] waits for it and reopens the
   * recorder once there is something on the other end. Reopening immediately,
   * as this did when it was written, pointed a fresh AudioRecord at a link
   * that had not answered: the meter went flat the instant the headset was
   * chosen, where before it had at least carried on reading the old microphone
   * until the new one was ready.
   *
   * So the old input keeps the meter alive until the headset answers, and the
   * switch happens when it can actually work.
   */
  val chosen = selectedInputDevice()
  if (chosen != null && needsBluetoothLink(chosen.type)) return

  // The stop half would otherwise look like the operator finishing with the
  // microphone and hand a Bluetooth headset straight back.
  reopeningForRoute = true
  try {
    monitorAudio(false)
    monitorAudio(true)
  } finally {
    reopeningForRoute = false
  }
}

/**
 * Opens or gives back the Bluetooth link, around the microphone's life.
 *
 * Called with `true` immediately before the microphone is started and `false`
 * immediately after it is stopped. Tied to the microphone rather than to the
 * app or the broadcast on purpose: holding the phone's communication device
 * while not recording is antisocial - Android's own note on
 * `setCommunicationDevice` says the selection lasts as long as the process
 * unless it is cleared - and an operator whose next phone call goes through a
 * headset they had forgotten about will blame the last app they opened, which
 * would be this one, correctly.
 */
internal fun BroadcasterView.syncAudioRoute(microphoneWanted: Boolean) {
  if (!microphoneWanted) {
    if (!reopeningForRoute) releaseAudioRoute()
    return
  }
  // Asked for far more often than it does anything: the screen re-arms
  // monitoring after a recording, after a broadcast, and on a timer while it
  // waits to hear a level. Only the call that actually starts the microphone
  // is worth a line in the log.
  val alreadyRunning = runCatching { microphone.isRunning() }.getOrDefault(false)
  acquireAudioRoute()
  if (!alreadyRunning) postDelayed({ reportAudioInput() }, ANNOUNCE_DELAY_MS)
}

/**
 * One line saying what the microphone turned out to be recording from, and a
 * warning for every way it can be running and still deliver nothing.
 *
 * This exists because of how a dead level meter reads from the outside: a
 * column of grey segments, and a log in which every link of the chain is
 * silent. The meter itself now says whether PCM is arriving at all - see
 * [MicrophoneLevel] - and this says whether the phone thinks it is recording,
 * from what, and whether what it is handing over has been emptied first. The
 * two lines together are meant to be enough to place a fault without a device
 * in hand.
 */
private fun BroadcasterView.reportAudioInput() {
  // Still waiting on a headset to answer. The line would be true for the
  // second it took to write it, and the reopen that follows will say this
  // properly.
  if (scoWatcher != null) return

  if (!runCatching { microphone.isRunning() }.getOrDefault(false)) {
    log(LOG_WARN, "The microphone was started and is not running, so the level meter has no input")
    return
  }

  // A muted microphone does not hand the level meter quiet samples - it does
  // not hand it any. RootEncoder swaps in a buffer of zeros and skips the
  // audio effect entirely on the way past, so muting is indistinguishable from
  // a microphone that never opened unless something says so here.
  if (runCatching { microphone.isMuted() }.getOrDefault(false)) {
    log(LOG_WARN, "The microphone is muted, so the level meter is not being called at all")
  }

  val recording = activeRecording()
  if (recording == null) {
    log(LOG_WARN, "The microphone says it is running, but Android has no recording open for this app")
    return
  }

  /**
   * Android empties an app's microphone buffers rather than refusing it when
   * another app has priority on the input, which is the one fault that looks
   * exactly like a broken meter: a recording that is open, running, reading
   * full buffers, and every sample zero. It has only been reportable since
   * Android 10.
   */
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
    runCatching { recording.isClientSilenced }.getOrDefault(false)
  ) {
    log(LOG_WARN, "Android is handing this app silence; something else on the phone holds the microphone")
  }

  val device = runCatching { recording.audioDevice }.getOrNull()
  log(LOG_INFO, "Recording from ${device?.let { nameOf(it) } ?: "an input Android will not name"}")

  // The picker and the viewfinder chip both follow `current`, and `current` has
  // just become knowable.
  reportAudioDevices()
}

/**
 * Connects the chosen Bluetooth headset, if the choice is a Bluetooth headset.
 *
 * The judgement this encodes, which is worth having an opinion about before
 * changing it: the app does not force the built-in microphone as a default. It
 * would fix one hazard by creating a worse one - the whole reason this picker
 * exists is the lapel microphone plugged in and ignored, and Android picks up a
 * wired or USB input by itself, so overriding that would silently undo the
 * operator's accessory every time.
 *
 * The forgotten-headset hazard is narrower than it looks, because it is a
 * Bluetooth hazard specifically: Android will not record from a headset's
 * microphone on its own, only from one that has been asked for. So the line is
 * drawn there instead. Bluetooth is used when, and only when, the operator has
 * picked it in the list - never inherited from whatever happens to be paired,
 * and never promoted by this app. Someone deliberately running a lapel
 * microphone through a Bluetooth adapter chooses it once and gets it; someone
 * who left a headset in a coat pocket is not broadcast through it.
 */
@Suppress("DEPRECATION")
private fun BroadcasterView.acquireAudioRoute() {
  val manager = audioManager ?: return
  val chosen = selectedInputDevice()
  if (chosen == null || !needsBluetoothLink(chosen.type)) {
    releaseAudioRoute()
    return
  }
  /**
   * Already ours only if Android still says so.
   *
   * This used to trust `routedDeviceId` alone. A phone call takes the link
   * while that id still names the headset, so after the call choosing the
   * headset again returned right here having done nothing - and while live the
   * recorder was never pointed back at it either. Choosing it looked like a
   * tap the screen ignored, which is how it was reported.
   */
  if (routedDeviceId == chosen.id && linkStillHeld(manager, chosen)) return
  releaseAudioRoute()

  val name = nameOf(chosen)
  val asked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    /**
     * `setCommunicationDevice` takes an output device and picks the matching
     * input itself, so the headset has to be found a second time among the
     * communication sinks rather than handed over as the input the operator
     * chose - passing the input throws. The address is what ties the two
     * halves together on a phone with two headsets paired; where it is not
     * readable, any Bluetooth sink is a better answer than none, because a
     * second paired headset is rarer than a phone that hides the address.
     */
    val sinks = runCatching { manager.availableCommunicationDevices }.getOrNull().orEmpty()
    val address = runCatching { chosen.address }.getOrNull().orEmpty()
    val match = sinks.firstOrNull {
      address.isNotEmpty() && runCatching { it.address }.getOrNull() == address
    } ?: sinks.firstOrNull { needsBluetoothLink(it.type) }
    match != null && runCatching { manager.setCommunicationDevice(match) }.getOrDefault(false)
  } else {
    /**
     * The deprecated pair is the only option below API 31, and the headset
     * types that do not exist down here - LE audio - are the only ones it
     * cannot carry, so nothing is lost by the older branch being cruder.
     */
    runCatching { manager.startBluetoothSco() }.isSuccess
  }

  if (!asked) {
    log(LOG_WARN, "Android refused to open the audio link to $name; the phone's own microphone will be used")
    return
  }

  routedDeviceId = chosen.id
  routeReopened = false
  watchForLink(manager, name)
}

/**
 * Waits for the headset to actually answer.
 *
 * The link takes anything from a moment to several seconds, and Android's own
 * instruction is to wait for the broadcast rather than to assume it is up when
 * the call returns. An AudioRecord opened in that gap is aimed at a device with
 * nothing on the other end, which is the silence this whole file is about - so
 * nothing is decided here, it is only noticed, and the microphone is reopened
 * afterwards.
 */
@Suppress("DEPRECATION")
private fun BroadcasterView.watchForLink(manager: AudioManager, name: String) {
  val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (scoWatcher !== this) return
      val state = intent?.getIntExtra(
        AudioManager.EXTRA_SCO_AUDIO_STATE,
        AudioManager.SCO_AUDIO_STATE_ERROR,
      )
      // Only the arrival is acted on. The first thing this receiver hears is
      // the current state, which is "disconnected" every time, and treating
      // that as a failure would give up before anything had been tried.
      if (state != AudioManager.SCO_AUDIO_STATE_CONNECTED) return
      stopWatchingForLink()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        /**
         * A live link is not the same as recording through it below API 31:
         * the audio policy only prefers the headset's microphone once record
         * routing has been forced to SCO, and this is the call that forces it.
         * From 31 the communication device covers both halves.
         */
        runCatching { manager.setBluetoothScoOn(true) }
      }
      log(LOG_INFO, "$name answered; reopening the microphone on it")
      reopenMicrophoneOnRoute()
    }
  }

  val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
  val owner = context.applicationContext ?: context
  val sticky = runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      owner.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      owner.registerReceiver(receiver, filter)
    }
  }.getOrElse {
    log(LOG_WARN, "Could not wait for $name to answer: ${it.message}")
    return
  }
  scoWatcher = receiver
  scoWatcherContext = owner

  // A headset that was already carrying audio never changes state, so the
  // broadcast never comes. Registering returns the state it is in, which is
  // the only way that case is ever heard about.
  if (sticky != null) receiver.onReceive(context, sticky)

  postDelayed({
    // Still the receiver that was registered here means nothing has answered;
    // a link that came up took it down on the way past.
    if (scoWatcher === receiver) {
      stopWatchingForLink()
      /**
       * From API 31 the link is opened on this app's behalf rather than by it,
       * and whether that still comes with the SCO broadcast is the platform's
       * business and not documented either way. So the selection itself is
       * asked before anyone is accused: a headset Android says it is using is
       * a headset that answered, however quietly.
       */
      val holding = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        runCatching { manager.communicationDevice?.type }.getOrNull()
          ?.let { needsBluetoothLink(it) } == true
      if (holding) {
        log(LOG_INFO, "$name answered; reopening the microphone on it")
        reopenMicrophoneOnRoute()
      } else {
        log(LOG_WARN, "$name never opened its microphone link; its audio will be silent until it is chosen again")
        /**
         * On screen, not only in the log. A headset that never answers is a
         * flat meter and nothing else - the operator has no way to tell it
         * from a quiet room, and the banner carries the way out of it.
         */
        noteAudioSilence(true, "headset")
      }
    }
  }, LINK_TIMEOUT_MS)
}

/**
 * Takes the microphone down and starts it again now that there is something on
 * the other end of the link.
 *
 * An AudioRecord does not follow a device that appears after it was opened; it
 * goes on reading the nothing it was pointed at. Once per link, because a
 * headset that keeps dropping would otherwise have this app restarting the
 * microphone in a loop, and a broadcast is better served by one bad input than
 * by an input that keeps disappearing.
 */
private fun BroadcasterView.reopenMicrophoneOnRoute() {
  // The link answered, so whatever this file said about it being silent is no
  // longer true. Cleared before the reopen rather than after, because the
  // reopen is what the banner was offering to do.
  noteAudioSilence(false, "headset")

  /**
   * Live: point the running recorder at the headset, now - and only now.
   *
   * The microphone is never taken down and rebuilt while live; a hole in the
   * broadcast is worse than the wrong input, and the encoder's sink would not
   * survive it. But that was taken to mean nothing at all happened while
   * live, and so a headset chosen mid-broadcast, or one coming back after a
   * call, was never used: the link came up and the recorder went on reading
   * the phone's own microphone. `setPreferredDevice` re-routes an open capture
   * without a restart. What made it dangerous before was calling it while the
   * link was still coming up, which routes to silence; this is the moment the
   * link has said it is up, so there is something on the end of it.
   */
  if (stream.isStreaming || stream.isRecording) {
    val moved = applyPreferredDevice()
    log(
      if (moved) LOG_INFO else LOG_WARN,
      if (moved) "Moving the live recording onto the headset" else "Android would not move the live recording onto the headset",
    )
    audioHandler.postDelayed({ confirmLiveRoute() }, ROUTE_CONFIRM_MS)
    return
  }

  if (routeReopened) return
  routeReopened = true
  if (!runCatching { microphone.isRunning() }.getOrDefault(false)) return

  reopeningForRoute = true
  try {
    monitorAudio(false)
    monitorAudio(true)
  } finally {
    reopeningForRoute = false
  }
}

/**
 * Keeps the Bluetooth link up across a microphone stop and start that the app
 * makes for its own reasons.
 *
 * Reconfiguring the encoder takes the meter's microphone down and puts it back
 * - see [BroadcasterView.prepare] - and the stop half handed the headset back
 * to the phone, so every settings change, every rotation and every go-live
 * dropped the SCO link and asked for it again. A headset takes seconds to
 * answer, says so in the operator's ear, and is silent while it does. If the
 * choice is still the same headset there is nothing to give back; if it has
 * changed, [acquireAudioRoute] notices on the way back up and swaps it.
 *
 * Returns false when something further out already holds the route, so only
 * the outermost caller ends the hold.
 */
internal fun beginHoldingAudioRoute(): Boolean {
  if (reopeningForRoute) return false
  reopeningForRoute = true
  return true
}

/**
 * Ends [beginHoldingAudioRoute]. If the microphone did not come back - the
 * encoder refused the new settings, the phone would not lend it - the link is
 * given back after all, because a headset held open for a microphone that is
 * not running is the stuck-on-Bluetooth phone call this file promises not to
 * cause.
 */
internal fun BroadcasterView.endHoldingAudioRoute() {
  reopeningForRoute = false
  val running = runCatching { microphone.isRunning() }.getOrDefault(false)
  if (!running && !stream.isStreaming && !stream.isRecording) releaseAudioRoute()
}

/**
 * Gives the headset back to the phone.
 *
 * Only ever undoes what this app asked for: a phone call or another app may
 * hold the communication device, and clearing a selection this app did not make
 * would cut off whoever did.
 */
@Suppress("DEPRECATION")
internal fun BroadcasterView.releaseAudioRoute() {
  stopWatchingForLink()
  if (routedDeviceId < 0) return
  routedDeviceId = -1
  routeReopened = false

  val manager = audioManager ?: return
  runCatching {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      manager.clearCommunicationDevice()
    } else {
      manager.setBluetoothScoOn(false)
      manager.stopBluetoothSco()
    }
  }.onFailure {
    log(LOG_WARN, "Could not release the Bluetooth microphone: ${it.message}")
    return
  }
  log(LOG_INFO, "Bluetooth microphone released")
}

/**
 * Asks for the headset again after something else took it.
 *
 * A call is the case this exists for. Telephony takes the communication device
 * while it rings, and when it ends Android does not give it back - but nothing
 * in this app noticed, because `routedDeviceId` still said the link was ours
 * and [acquireAudioRoute] returns early when it thinks that. The AudioRecord
 * carried on reading the phone's own microphone from inside a pocket: not
 * silent, which is why the silence detector never fired, just far too quiet to
 * hear. An operator found it by watching the level meter and fixed it by
 * choosing the built-in microphone and then the headset again, which is
 * precisely the sequence below.
 *
 * Deliberately no restart of the recorder. That is the part which is unsafe
 * while live, and it is not what was needed: the route is what was lost, and
 * re-asking for it is what the operator's own fix did.
 */
internal fun BroadcasterView.reacquireAudioRoute() {
  val chosen = selectedInputDevice() ?: return
  if (!needsBluetoothLink(chosen.type)) return

  log(LOG_WARN, "The link to ${nameOf(chosen)} was lost; asking for it again")
  // Forget first, or acquire believes it still holds the device and does
  // nothing - the exact early return that let this run for a whole broadcast.
  releaseAudioRoute()
  runCatching { microphone.setPreferredDevice(chosen) }
  acquireAudioRoute()
}

/**
 * Whether this app is recording from the device its operator chose.
 *
 * Android answers this itself through the active recording configuration, so
 * it is a fact rather than an inference: -1 means nothing is recording, and any
 * other id that is not the chosen one means the audio is coming from somewhere
 * the operator did not ask for.
 */
internal fun BroadcasterView.recordingFromChosenDevice(): Boolean {
  if (selectedAudioDeviceId < 0) return true
  val actual = recordingDeviceId()
  // Not running, or Android declining to say, is not evidence of a fault.
  if (actual < 0) return true
  return actual == selectedAudioDeviceId
}

/** How long a live re-route is given before Android is asked whether it took. */
private const val ROUTE_CONFIRM_MS = 1_500L

/**
 * Whether Android actually moved the live recording onto the chosen device.
 *
 * Said either way. "Putting it back" was the last word on screen whether or
 * not it worked, and an operator watching a meter cannot tell a headset from a
 * phone microphone in a pocket - so the answer comes from the active recording
 * configuration, which is Android's own account of where the sound is from.
 */
private fun BroadcasterView.confirmLiveRoute() {
  val chosen = selectedInputDevice() ?: return
  if (recordingFromChosenDevice()) {
    log(LOG_INFO, "Recording from ${nameOf(chosen)} again")
    post { runCatching { onAudioInterrupted(mapOf("silenced" to false, "reason" to "restored")) } }
  } else {
    log(LOG_WARN, "${nameOf(chosen)} is connected but the live recording is still on another microphone")
    checkAudioRoute()
  }
}

/**
 * Whether the Bluetooth link this app asked for is still its link.
 *
 * A call, or another app, can take it without this app being told. From API
 * 31 Android names the communication device outright; below that, whether SCO
 * is on is the closest thing there is.
 */
@Suppress("DEPRECATION")
private fun linkStillHeld(manager: AudioManager, chosen: AudioDeviceInfo): Boolean {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
    val current = runCatching { manager.communicationDevice }.getOrNull() ?: return false
    if (!needsBluetoothLink(current.type)) return false
    val want = runCatching { chosen.address }.getOrNull().orEmpty()
    val have = runCatching { current.address }.getOrNull().orEmpty()
    return want.isEmpty() || have.isEmpty() || want == have
  }
  return runCatching { manager.isBluetoothScoOn }.getOrDefault(false)
}

private fun BroadcasterView.stopWatchingForLink() {
  val receiver = scoWatcher ?: return
  val owner = scoWatcherContext ?: context.applicationContext ?: context
  scoWatcher = null
  scoWatcherContext = null
  runCatching { owner.unregisterReceiver(receiver) }.onFailure {
    log(LOG_WARN, "Could not stop waiting on the headset: ${it.message}")
  }
}

/** The device the operator chose, looked up fresh, or null for Android's choice. */
private fun BroadcasterView.selectedInputDevice(): AudioDeviceInfo? {
  if (selectedAudioDeviceId < 0) return null
  val manager = audioManager ?: return null
  return runCatching {
    manager.getDevices(AudioManager.GET_DEVICES_INPUTS).firstOrNull { it.id == selectedAudioDeviceId }
  }.getOrNull()
}

/**
 * The one input device Android reports this app is recording from, or -1.
 *
 * -1 while the microphone is not running rather than a stale last answer,
 * because "nothing is being recorded" is a fact the screen can use and a
 * remembered device is not.
 */
internal fun BroadcasterView.recordingDeviceId(): Int {
  if (!runCatching { microphone.isRunning() }.getOrDefault(false)) return -1
  return runCatching { activeRecording()?.audioDevice?.id }.getOrNull() ?: -1
}

/**
 * This app's own recording, out of everything Android has open.
 *
 * From Android 10 the list holds nothing but this app's recordings, so the
 * single entry is the answer. Before that it held every app's, and the format
 * this app asked for is the only thing distinguishing them - so a unique match
 * on that is taken and an ambiguous one is not, because the readout exists to
 * stop the app guessing at what it is recording from.
 */
private fun BroadcasterView.activeRecording(): AudioRecordingConfiguration? {
  val manager = audioManager ?: return null
  val open = runCatching { manager.activeRecordingConfigurations }.getOrNull().orEmpty()
  if (open.size <= 1) return open.firstOrNull()
  val rate = runCatching { microphone.sampleRate }.getOrNull() ?: return null
  return open.singleOrNull { runCatching { it.clientFormat.sampleRate }.getOrNull() == rate }
}

/**
 * Whether this device needs a link opened before it will carry a microphone.
 *
 * Only the headset profiles, which are the ones with a microphone on the far
 * end. A2DP is a loudspeaker protocol and appears here as an input on a handful
 * of phones that can act as a sink; asking for SCO on account of one would
 * connect a different device than the one named.
 */
internal fun needsBluetoothLink(type: Int): Boolean =
  type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type == AudioDeviceInfo.TYPE_BLE_HEADSET

/**
 * 0 to 2, where 1 is the microphone untouched.
 *
 * Above 1 is gain applied to the samples after capture, so it clips rather than
 * getting quietly louder - which is why the ceiling is here and not left to the
 * caller. Below 1 is the only sane way to deal with a microphone that is too
 * hot for the room.
 */
internal fun BroadcasterView.setMicGain(level: Float) {
  val clamped = level.coerceIn(0f, MAX_MIC_GAIN)
  runCatching { microphone.microphoneVolume = clamped }.onFailure {
    log(LOG_WARN, "Could not set microphone gain: ${it.message}")
    return
  }
  if (clamped != level) {
    log(LOG_WARN, "Microphone gain $level is out of range; using $clamped")
  }
}

internal fun BroadcasterView.micGain(): Float =
  runCatching { microphone.microphoneVolume }.getOrNull() ?: 1f

/**
 * Android reports the phone's model as the product name of every built-in
 * device, so a list built from product names alone reads "Pixel 7, Pixel 7,
 * Pixel 7". The kind is what tells the operator which one to pick, so it leads,
 * and the product name only follows when it says something the kind does not.
 */
private fun nameOf(device: AudioDeviceInfo): String {
  val kind = labelOf(device.type)
  val product = runCatching { device.productName?.toString() }.getOrNull()?.trim().orEmpty()
  return if (product.isEmpty() || device.type == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
    kind
  } else {
    "$kind - $product"
  }
}

/** The contract's five kinds. Everything Android knows about maps onto one. */
private fun kindOf(type: Int): String = when (type) {
  AudioDeviceInfo.TYPE_BUILTIN_MIC -> "builtin"
  AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
  AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "bluetooth"
  // Added in API 31 and 26 respectively. Both are compile-time constants, so
  // the value is inlined and nothing looks them up on an older phone - where
  // no device will ever report those types anyway.
  AudioDeviceInfo.TYPE_BLE_HEADSET -> "bluetooth"
  AudioDeviceInfo.TYPE_USB_DEVICE,
  AudioDeviceInfo.TYPE_USB_ACCESSORY,
  AudioDeviceInfo.TYPE_USB_HEADSET,
  -> "usb"

  else -> "other"
}

private fun labelOf(type: Int): String = when (type) {
  AudioDeviceInfo.TYPE_BUILTIN_MIC -> "Built-in microphone"
  AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headset"
  AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth headset"
  AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth audio"
  AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth LE headset"
  AudioDeviceInfo.TYPE_USB_DEVICE -> "USB audio"
  AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB accessory"
  AudioDeviceInfo.TYPE_USB_HEADSET -> "USB headset"
  AudioDeviceInfo.TYPE_TELEPHONY -> "Telephony"
  AudioDeviceInfo.TYPE_DOCK -> "Dock"
  AudioDeviceInfo.TYPE_FM_TUNER -> "FM tuner"
  AudioDeviceInfo.TYPE_LINE_ANALOG -> "Line in"
  AudioDeviceInfo.TYPE_LINE_DIGITAL -> "Digital line in"
  else -> "Microphone"
}

/** Two is already well past clipping on every phone; more is not a feature. */
private const val MAX_MIC_GAIN = 2f

/**
 * Long enough that the recording Android opens on this app's behalf is on its
 * books before it is asked about, short enough that the answer is in the log
 * while the operator is still looking at the screen that prompted it.
 */
private const val ANNOUNCE_DELAY_MS = 700L

/**
 * Android's own note says the link can take several seconds. This is past the
 * point where a headset that was going to answer has, and short of the point
 * where an operator has decided the app is broken and left.
 */
private const val LINK_TIMEOUT_MS = 6_000L
