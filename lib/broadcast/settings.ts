import { getItem, setItem } from "@/lib/storage";
import type { EncoderSettings, Orientation } from "@/modules/framevane-broadcaster";

/**
 * Settings that belong to the phone, not to a destination.
 *
 * Picture size and bitrate are per-destination - a YouTube stream and a test
 * server are not the same job - but these are about this phone, this
 * microphone and this network, and an operator should not have to set them
 * again for every place they send video.
 *
 * There are two kinds here and they are kept in two stores, because
 * `useBroadcast` spreads the encoder half straight into
 * `Broadcaster.configure(...)`. Anything that is not a real `EncoderSettings`
 * key would be handed to the native encoder as a setting it has never heard
 * of. Rather than trust a filter that someone will forget to update, the app
 * preferences live under a different key and simply cannot arrive in that
 * spread: `loadSettings()` and `loadEncoderSettings()` read one store,
 * `loadPreferences()` reads the other.
 */

/**
 * Derived from `EncoderSettings` on purpose: a key that is not in the native
 * contract will not compile here, which is the guarantee that the spread into
 * `configure` stays valid.
 */
export type PhoneEncoderSettings = Pick<
  EncoderSettings,
  | "videoCodec"
  | "preferHardwareCodec"
  | "audioBitrate"
  | "sampleRate"
  | "stereo"
  | "micGain"
  | "echoCanceler"
  | "noiseSuppressor"
  | "adaptiveBitrate"
  | "autoReconnect"
  | "reconnectDelayMs"
>;

/** The name this type had before video codec and mic gain joined it. */
export type AudioAndNetworkSettings = PhoneEncoderSettings;

export const DEFAULTS: PhoneEncoderSettings = {
  // H.264 by default because every phone encodes it. H.265 is worth choosing
  // deliberately and not worth defaulting to: on a handset whose encoder does
  // not do it, the broadcast fails rather than degrades.
  videoCodec: "h264",
  // The media hardware, because software H.264 heats a phone until it
  // throttles and that ends a long broadcast on its own.
  preferHardwareCodec: true,
  // 128k stereo at 44.1k is what every platform expects and what a phone
  // microphone can actually justify; higher is bits spent on nothing.
  audioBitrate: 128_000,
  sampleRate: 44_100,
  stereo: true,
  micGain: 1,
  // Off by default: Android's capture effects are tuned for a phone call and
  // audibly chew music and crowd noise. They earn their place on speech in a
  // hall, which is a choice the operator makes knowing the room.
  echoCanceler: false,
  noiseSuppressor: false,
  adaptiveBitrate: true,
  autoReconnect: true,
  reconnectDelayMs: 4_000,
};

/**
 * A viewfinder control the operator can move off the glass.
 *
 * The five panels and the four things done to a running broadcast, and not the
 * microphone, the torch or the button that goes live: those three are what a
 * hand reaches for without looking away from the picture, so they are not up
 * for rearranging. The rest is where operators differ - one takes a still
 * every broadcast and never opens Stats, the next never touches either.
 */
export type QuickControl =
  | "camera"
  | "shape"
  | "overlays"
  | "stats"
  | "log"
  | "record"
  | "photo"
  | "pause"
  | "flip";

/**
 * The order they are shown in, wherever they are shown. What is stored is a
 * set and not an arrangement: choosing which controls are on the glass is a
 * different job from choosing where they sit, and keeping the order fixed
 * leaves every remaining control where the hand already expects it.
 */
export const QUICK_CONTROLS: QuickControl[] = [
  "camera",
  "shape",
  "overlays",
  "stats",
  "log",
  "record",
  "photo",
  "pause",
  "flip",
];

/**
 * How the app behaves around the broadcast, which the encoder knows nothing
 * about. Each of these is applied by a call of its own - `setBackgroundBroadcast`,
 * `selectAudioDevice`, `startRecording` - so they must not travel with the
 * encoder settings.
 */
export type Preferences = {
  /** Keep sending when the app is not on screen, behind a notification. */
  backgroundBroadcast: boolean;
  /** Record to the phone as well as sending, every time a broadcast starts. */
  recordWhileStreaming: boolean;
  /**
   * Move a finished recording into the phone's video library, where the
   * gallery, a file manager, a video player and a USB cable can all reach it.
   * Off keeps it in the app's own folder, where only this app can.
   */
  saveToGallery: boolean;
  /**
   * Minutes per section of a recording, or 0 for one file however long the
   * take runs. The size limit that goes with it is not a preference: 3.5 GB is
   * the FAT32 ceiling, which is a fact about card readers rather than a taste.
   */
  splitMinutes: number;
  /**
   * The height the copy on the phone is written at, or 0 to match what is
   * going out. See RECORD_QUALITIES for why the rungs are the ones they are.
   */
  recordHeight: number;
  /**
   * A document-tree URI the operator picked, or empty for the video library.
   * Stored as the string Android gave us; it is only ever handed back.
   */
  recordingFolder: string;
  /** An Android audio device id, or -1 to leave the choice to Android. */
  audioDeviceId: number;
  /**
   * The microphone the operator normally teaches with, by what it is rather
   * than by Android's number for it.
   *
   * `audioDeviceId` above is the right thing to hand the encoder and the wrong
   * thing to recognise a headset by: Android can give a Bluetooth microphone a
   * new id when it reconnects, so a stored id can stop matching the very
   * headset it was saved for, and the phone quietly goes back to its own
   * microphone. The check before going live compares against this instead -
   * kind and name survive the reconnect - and says so when the usual
   * microphone is connected but not the one in use.
   */
  usualMic: { kind: string; name: string } | null;
  /**
   * The shape of the broadcast: portrait, landscape, or follow the phone.
   *
   * Kept here because the native side holds it on the view, which lives only
   * as long as the screen does - so an operator who set landscape came back to
   * a portrait app and had to set it again every launch.
   */
  orientation: Orientation;
  /**
   * The controls kept on the glass. The rest move into the viewfinder's
   * overflow menu - one tap further in rather than gone.
   *
   * The default is all of them, which is the viewfinder as it was before this
   * setting existed. An operator who has never opened it has nothing stored
   * and so keeps getting the full default list, a control added later
   * included; one who has pruned the glass gets the new control in the menu,
   * which is the half of the guess that does not move a button under a thumb
   * mid-broadcast.
   */
  quickAccess: QuickControl[];
  /**
   * A short buzz when a control on the viewfinder takes: going live, ending,
   * recording, muting. The operator is looking at the room, not at the glass,
   * and a press that lands with no feedback gets pressed again - which for
   * mute or record undoes it.
   *
   * The buzzes for a dropped or abandoned connection are not governed by this.
   * Those are alarms, and an alarm that can be switched off from a convenience
   * setting is one somebody will switch off by accident.
   */
  haptics: boolean;
  /**
   * The language of the viewfinder, or `auto` for the phone's own when it is
   * Hausa or Arabic and English otherwise. See lib/i18n.
   */
  language: LanguageChoice;
};

export type LanguageChoice = "auto" | "en" | "ha" | "ar";

export const PREFERENCE_DEFAULTS: Preferences = {
  /**
   * On. Off meant that the first time a new operator's screen locked, or they
   * glanced at a message, Android took the camera and the broadcast ended -
   * and the setting that prevents it was one nobody knew to look for until
   * after it had cost them a class. A default only reaches a phone that has
   * never saved its preferences, so anyone who turned it off keeps it off.
   */
  backgroundBroadcast: true,
  recordWhileStreaming: false,
  /**
   * On. A recording nobody can open is not a recording, and the app folder is
   * invisible to everything that plays video.
   */
  saveToGallery: true,
  /**
   * On, at half an hour. One file for a three-hour broadcast is one chance -
   * a muxer that never finished, or a copy that fails at 98%, costs the whole
   * take rather than one section of it - and a folder of sections is the
   * lesser inconvenience by a wide margin.
   */
  splitMinutes: 30,
  /**
   * Match the broadcast, which is what every recording has done until now.
   * Anything else runs a second video encoder, and heat is the thing that ends
   * long broadcasts - so the operator asks for that, it is not assumed.
   */
  recordHeight: 0,
  recordingFolder: "",
  audioDeviceId: -1,
  usualMic: null,
  orientation: "auto",
  /**
   * The shutter, the pause and the camera switch, and nothing else.
   *
   * Not all of them. A viewfinder with nine discs down the side is the layout
   * this preference exists to undo - the default has to be the restrained one,
   * or an operator who never opens this screen gets the cluttered glass and has
   * to tidy it by hand. These three are what a camera app puts on the picture;
   * the panels are set up before a broadcast and live in the overflow until
   * somebody says otherwise.
   */
  quickAccess: ["photo", "pause", "flip"],
  haptics: true,
  language: "auto",
};

/**
 * The size limit, in bytes. Not a preference: it is the largest file FAT32
 * holds, which is what a card reader or an older USB stick will accept.
 */
export const SPLIT_BYTES = 3.5 * 1024 * 1024 * 1024;

/**
 * What the copy on the phone can be written at.
 *
 * Heights only, and no 480p. The library compares the record and stream aspect
 * ratios as doubles and refuses anything that is not exactly equal, and the
 * width is scaled from the broadcast's own - so against a 1280x720 picture,
 * 480p would have to be 853.33 wide. 540p is the rung that fits there, and it
 * is the same picture 480p was reached for.
 *
 * The bitrates are more generous than the ones offered for a destination,
 * because nothing here has to cross a network: the limit is the disk, and a
 * master worth keeping is worth the megabytes.
 */
export const RECORD_QUALITIES = [
  { label: "Same as the broadcast", height: 0, bitrate: 0 },
  { label: "360p", height: 360, bitrate: 1_500_000 },
  { label: "540p", height: 540, bitrate: 3_000_000 },
  { label: "720p", height: 720, bitrate: 6_000_000 },
  { label: "1080p", height: 1080, bitrate: 12_000_000 },
] as const;

/** The rung the operator chose, or the one that means "follow the broadcast". */
export function recordQualityFor(height: number) {
  return RECORD_QUALITIES.find((q) => q.height === height) ?? RECORD_QUALITIES[0];
}

const KEY = "framevane.encoderSettings";
const PREFERENCES_KEY = "framevane.preferences";

/**
 * What `useBroadcast` hands to `configure`. Kept under this name because that
 * is where it is spread, and every key in it is a native encoder setting.
 */
export function loadSettings(): PhoneEncoderSettings {
  return { ...DEFAULTS, ...(getItem<Partial<PhoneEncoderSettings>>(KEY) ?? {}) };
}

/** The same thing, under the name that says what it is safe to do with. */
export function loadEncoderSettings(): PhoneEncoderSettings {
  return loadSettings();
}

export function saveSettings(patch: Partial<PhoneEncoderSettings>): PhoneEncoderSettings {
  const next = { ...loadSettings(), ...patch };
  setItem(KEY, next);
  return next;
}

export function loadPreferences(): Preferences {
  return { ...PREFERENCE_DEFAULTS, ...(getItem<Partial<Preferences>>(PREFERENCES_KEY) ?? {}) };
}

export function savePreferences(patch: Partial<Preferences>): Preferences {
  const next = { ...loadPreferences(), ...patch };
  setItem(PREFERENCES_KEY, next);
  return next;
}
