/**
 * Every word the operator reads on the viewfinder while working, in English.
 *
 * This table is the contract: its keys are the only keys, and the Hausa and
 * Arabic tables are typed against it, so a string added here without a
 * translation is a compile error there rather than a blank chip on a phone.
 *
 * Scope is the screens an operator reads mid-class - the head-up display, the
 * banners, the check before going live, the end dialog and the full-frame
 * connection states. The settings pages stay English for now: they are read
 * once, at a desk, often by whoever set the phone up rather than whoever is
 * teaching with it.
 *
 * `{name}` is filled in by `t`. Words a chip has to fit are kept short here,
 * because the translations are asked to stay within the same length.
 */
export const en = {
  // The state chip, top left.
  "hud.reconnecting": "Reconnecting",
  "hud.paused": "Paused",
  "hud.connecting": "Connecting",
  "hud.offAir": "Off air",
  "hud.rec": "REC",
  "hud.ready": "Ready",
  "hud.goingLive": "Going live",
  "hud.fpsOut": "{fps} fps out",
  "hud.dropped": "· {count} dropped",

  // The studio's answer about each platform, beside the uptime.
  "studio.live": "live",
  "studio.waiting": "waiting",
  "studio.starting": "starting",
  "studio.ended": "ended",
  "studio.unpublished": "private",
  "studio.liveA11y": "{platform} is live.",
  "studio.waitingA11y": "{platform} is not on air yet, although this phone is sending.",
  "studio.startingA11y": "{platform} is still starting.",
  "studio.endedA11y": "{platform} has ended its event, although this phone is still sending.",
  "studio.unpublishedA11y": "{platform} is receiving the video, unpublished.",

  // The shutter.
  "primary.setUp": "Set up",
  "primary.cancel": "Cancel",
  "primary.end": "End broadcast",
  "primary.goLive": "Go live",

  // The discs, and their rows behind More.
  "control.camera": "Camera",
  "control.cameraHint": "Lens, zoom, exposure and focus.",
  "control.shape": "Shape",
  "control.shapeHint": "Portrait, landscape, or follow the phone.",
  "control.overlays": "Overlays",
  "control.overlaysHint": "Name cards and captions burned into the picture.",
  "control.stats": "Stats",
  "control.statsHint": "What is actually leaving the phone.",
  "control.log": "Log",
  "control.logHint": "What the encoder said, in order.",
  "control.record": "Record",
  "control.recordHint": "A copy on this handset, as well as whatever the server keeps.",
  "control.noRoom": "No room",
  "control.noRoomHint": "Free up some space and this starts working again.",
  "control.stopRecording": "Stop recording",
  "control.stopRecordingHint": "Ends the take and saves the file to the phone.",
  "control.photo": "Photo",
  "control.photoHint": "A still from the live picture, saved to the phone.",
  "control.pause": "Pause",
  "control.paused": "Paused",
  "control.pauseHint": "Hold the picture without dropping the connection.",
  "slate.title": "We'll be right back",
  "slate.message": "The broadcast will continue shortly",
  "control.flip": "Flip",
  "control.flipHint": "Switch between the front and back cameras.",
  "control.settings": "Settings",
  "control.analytics": "Analytics",
  "control.more": "More",
  "control.destinations": "Destinations",
  "control.nowhere": "Nowhere to send this yet.",
  "control.mute": "Mute",
  "control.muted": "Muted",
  "control.torch": "Torch",
  "control.torchOn": "Torch on",
  "control.torchOff": "Torch off",
  "control.recordingA11y": "Stop recording, {time} so far",
  "control.rec": "Rec",
  "control.longTake": "long take",

  // The microphone chip, bottom left.
  "mic.chip": "Input: {name}",
  "mic.chipA11y": "Input: {name}. Change it.",
  "mic.androidChoice": "Android's choice",
  "mic.auto": "Auto",
  "mic.builtin": "Mic",
  "mic.builtinNumbered": "Mic {n}",
  "mic.wired": "Wired",
  "mic.bluetooth": "Bluetooth",
  "mic.usb": "USB",
  "mic.other": "Other",
  "mic.wiredFull": "Wired microphone",
  "mic.bluetoothFull": "Bluetooth microphone",
  "mic.usbFull": "USB microphone",
  "mic.externalFull": "External microphone",

  // Where it is going.
  "destination.none": "No destination",
  "destination.choose": "Choose a destination",
  "destination.recordOnly": "Record only",
  "destination.a11y": "Destination: {name}. Change it.",

  // Shared furniture.
  "common.close": "Close",
  "common.dismiss": "Dismiss",
  "common.openLog": "Open log",

  // Banners.
  "banner.offAir":
    "The broadcast is off air. The connection dropped and could not be restored, so viewers are no longer receiving anything.",
  "banner.goLiveAgain": "Go live again",
  "banner.tryAgain": "Try again",
  "banner.stall":
    "Nothing has left the phone for several seconds. The connection is still open, so this is the network or the encoder, not the server.",
  "banner.restart": "Restart the connection",
  "banner.micCall": "Nothing is being heard - this phone is on a call. The picture is still going out.",
  "banner.micHeadset":
    "The Bluetooth headset never opened its microphone. Choose it again, or pick the phone's own microphone.",
  "banner.micTaken": "The microphone stopped. Something else on the phone may have taken it.",
  "banner.micSilent":
    "The microphone is open and every sample is silent. Something else on the phone may have taken it.",
  "banner.reopenMic": "Reopen the microphone",
  "banner.congestion":
    "The connection is not carrying everything. Framevane is sending less to keep the picture moving.",

  // Why a broadcast failed (lib/broadcast/failure.ts).
  "failure.flapping":
    "The server kept accepting the broadcast and dropping it seconds later, so the phone stopped retrying. Check that nothing else is sending to this stream, then go live again.",
  "failure.refused": "The server turned the connection away. Check the server address, and that the server is running.",
  "failure.dns": "The server's name could not be found. Check the server address, and that this phone is online.",
  "failure.unreachable": "This phone has no route to the server. Check Wi-Fi or mobile data.",
  "failure.timeout": "The server did not answer in time. The network may be too slow, or the address may be wrong.",
  "failure.auth": "The server refused this stream key. Copy it again from the stream's page in Framevane.",
  "failure.malformed": "The server address is not one this app can use. Check it on the destination.",
  "failure.handshake":
    "The server answered but would not finish connecting. Check the address and the protocol - RTMP, RTMPS or SRT.",
  "failure.reset": "The server closed the connection.",
  "failure.configure": "The camera or encoder would not start at these settings. Try a smaller picture size.",
  "failure.unknown": "The broadcast could not start. The log has the phone's own words for why.",

  // The phone's own state (lib/broadcast/guards.ts).
  "guard.batteryClosing": "The battery is nearly gone. Closing the recording now so the file is playable.",
  "guard.batteryGone": "The battery is nearly gone.",
  "guard.storageClosing": "The phone is out of room. Closing the recording now so the file is playable.",
  "guard.tooHot": "Too hot: controls paused until it cools. Still on air.",
  "guard.minutesLeft": "About {left} of recording left on this phone.",
  "guard.nearlyFull": "This phone is nearly full.",
  "guard.gettingHot": "Getting hot: picture quality reduced to cool down.",
  "guard.battery": "Battery at {percent}%.",
  "guard.minutesOfBattery": "About {minutes} min of battery left",
  "guard.preBatteryGone": "The battery is nearly gone. Plug the phone in before going live.",
  "guard.preStorage": "{room} The broadcast still goes out; the copy on this phone will not.",
  "guard.preTooHot":
    "This phone is already too hot. The encoder will be throttled - let it cool, or drop the picture size a step.",
  "guard.preWarm": "This phone is already warm. Expect dropped frames on a long broadcast.",
  "guard.preBattery": "Battery at {percent}%. Plug in for anything long.",
  "guard.noMore": "no more",
  "guard.underAMinute": "under a minute",
  "guard.aMinute": "a minute",
  "guard.minutes": "{n} minutes",
  "guard.tooLittleRoom": "There is {free} free on this phone, and a recording needs {needed} to start.",

  // The check before going live.
  "preflight.title": "Before you go live",
  "preflight.goLive": "Go live",
  "preflight.goLiveAnyway": "Go live anyway",
  "preflight.microphone": "Microphone",
  "preflight.androidMic": "The phone's own, chosen by Android",
  "preflight.muted": "The microphone is muted.",
  "preflight.unmute": "Unmute",
  "preflight.usual": "Your usual microphone.",
  "preflight.usualConnected": "Your usual is {name}, and it is connected.",
  "preflight.switchTo": "Switch to {name}",
  "preflight.usualMissing": "{name} is not connected. Connect it and it appears here - or go live on this one.",
  "preflight.tellUsual":
    "Tell Framevane which microphone you teach with and this will say so whenever a different one is in use.",
  "preflight.makeUsualInstead": "Make this one my usual instead",
  "preflight.makeUsual": "This is my usual microphone",
  "preflight.heard": "Heard you.",
  "preflight.notHeard": "Not hearing anything yet. Say something and the bar on the left moves.",
  "preflight.thisPhone": "This phone",
  "preflight.goingOut": "Going out",
  "preflight.picture": "{height}p · {fps} fps · {rate} to {name}",
  "preflight.changePicture": "Change the picture",
  "preflight.copy": "Copy on this phone",
  "preflight.recordToo": "Record on this phone too",
  "preflight.sameAsBroadcast": "Same as the broadcast, {height}p",
  "preflight.recordOn": "{quality} - starts and stops with the broadcast",
  "preflight.recordOff": "Off - only what goes out, and the server's copy if it keeps one",
  "preflight.secondEncoder":
    "Recording at {quality} while sending {height}p runs a second video encoder. The phone works harder and heats up faster - Same as the broadcast is lighter.",
  "preflight.changeRecording": "Change the recording size",

  // Ending.
  "end.title": "End the broadcast?",
  "end.body": "Viewers will see it stop. Starting again opens a new broadcast rather than resuming this one.",
  "end.keep": "Keep broadcasting",
  "end.confirm": "End broadcast",

  // The full-frame states.
  "overlay.reconnecting": "Reconnecting",
  "overlay.reconnectingBody": "Viewers see the stream stall. The phone is dialling back in - leave it where it is.",
  "overlay.reconnectingA11y": "Reconnecting. Viewers see the stream stall while the phone dials back in.",
  "overlay.onAirFor": "on air for {time}",
  "overlay.offAir": "Off air",
  "overlay.offAirBody": "The connection could not be restored. Nothing is going out.",
  "overlay.offAirA11y": "Off air. The connection could not be restored.",
  "overlay.paused": "Paused",
  "overlay.pausedLive": "Viewers see a still and hear nothing. The connection is still up.",
  "overlay.pausedIdle": "The picture is held and the microphone is off.",
  "overlay.pausedAt": "paused at {time}",
} as const;

export type StringKey = keyof typeof en;
