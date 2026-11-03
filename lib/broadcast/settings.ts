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
   * Take an external microphone when one is attached and nothing is pinned.
   *
   * Bluetooth is opt-in in Android: the phone will not route an active recorder
   * to a transmitter unless the app asks, so a mic switched on in a pocket is
   * ignored and the lesson goes out on the handset's own microphone. This makes
   * the app ask.
   *
   * It only fills a gap. A microphone the operator picked by hand is never
   * overridden - not on the next report, not on the next cold start - because a
   * control that undoes itself teaches an operator to stop trusting it. What
   * does re-arm it is an accessory arriving that the app has not seen before,
   * which is the moment somebody plugs a lapel in and expects it to take.
   */
  autoExternalMic: boolean;
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
  /**
   * Dim the screen after half a minute without a touch. A phone on a tripod is
   * a lit panel nobody is looking at, and the panel is heat and battery.
   */
  dimWhenIdle: boolean;
  /**
   * Step down as the phone heats: a lower bitrate first, then the viewfinder
   * aids (peaking, zebras) paused, before Android throttles the encoder for us.
   */
  thermalLadder: boolean;
  /** The strip of numbers along the viewfinder - bitrate, time, battery, heat. */
  readoutStrip: boolean;
  /** The colour focus peaking paints edges in, as a #RRGGBB string. */
  peakingColor: string;
  /** Where zebra stripes start, as a fraction of full scale: 0.9, 0.95, 0.98. */
  zebraThreshold: number;
  /**
   * The picture height a NEW destination starts at. A destination keeps its
   * own once it exists; this only saves setting the same thing every time.
   */
  defaultHeight: number;
  /** The frame rate a new destination starts at, as above. */
  defaultFps: number;
  /**
   * A take recorded with no destination - the app's main job. Filmic's
   * Encoding and Frame Rate pages: the picture height (16:9), the frame rate,
   * and how generous the bitrate is.
   */
  takeHeight: number;
  takeFps: number;
  takeQuality: TakeQuality;
  /** Filmic's Standard / Timelapse switch, for takes with no destination. */
  takeMode: "standard" | "timelapse";
  /** Timelapse: frames captured per second; played back at takeFps. */
  timelapseCaptureFps: number;
  /** The colour panel's A and B white-balance slots: a temperature and tint, or empty. */
  wbSlotA: { kelvin: number; tint: number } | null;
  wbSlotB: { kelvin: number; tint: number } | null;
  /** The colour panel's Looks, Gamma and LUT choices; see grade.ts. Null until first set. */
  grade: import("./grade").GradeState | null;
};

export type TakeQuality = "economy" | "standard" | "high";

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
  // On: the microphone in the operator's pocket is the one they meant to use.
  autoExternalMic: true,
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
  // Off: a dark screen mid-broadcast is alarming the first time, so it is
  // something the operator asks for.
  dimWhenIdle: false,
  // On: easing off by a step beats Android throttling the encoder to a crawl.
  thermalLadder: true,
  readoutStrip: true,
  peakingColor: "#FF3B30",
  zebraThreshold: 0.95,
  // The same picture DEFAULT_SETTINGS in pairing.ts gives a destination.
  defaultHeight: 720,
  defaultFps: 30,
  // 1080p30 at a generous bitrate: what a phone records well without heat.
  takeHeight: 1080,
  takeFps: 30,
  takeQuality: "standard",
  takeMode: "standard",
  timelapseCaptureFps: 2,
  wbSlotA: null,
  wbSlotB: null,
  grade: null,
};

/**
 * The picture sizes a new destination can start at, all 16:9 - the width is
 * what the encoder is handed alongside the height.
 */
export const DEFAULT_PICTURES = [
  { label: "360p", width: 640, height: 360 },
  { label: "720p", width: 1280, height: 720 },
  { label: "1080p", width: 1920, height: 1080 },
] as const;

// The rates a destination can be set to (Destinations offers these two), so a
// new destination never starts at a rate its own editor cannot show.
export const DEFAULT_FRAME_RATES = [30, 60] as const;

/**
 * What a new destination is created with. A stored height that is not one of
 * the rungs (hand-edited, or from a later build) falls back to 720p rather
 * than handing the encoder a width nobody chose.
 */
export function defaultPicture(preferences: Preferences = loadPreferences()): {
  width: number;
  height: number;
  fps: number;
} {
  const picture =
    DEFAULT_PICTURES.find((p) => p.height === preferences.defaultHeight) ?? DEFAULT_PICTURES[1];
  const fps = (DEFAULT_FRAME_RATES as readonly number[]).includes(preferences.defaultFps)
    ? preferences.defaultFps
    : 30;
  return { width: picture.width, height: picture.height, fps };
}

/** Take sizes, 16:9. 4K is offered; a lens that cannot do it falls back with a notice. */
export const TAKE_PICTURES = [
  { label: "360p", width: 640, height: 360 },
  { label: "480p SD", width: 854, height: 480 },
  { label: "720p HD", width: 1280, height: 720 },
  { label: "1080p Full HD", width: 1920, height: 1080 },
  { label: "1440p QHD", width: 2560, height: 1440 },
  { label: "4K UHD 2160p", width: 3840, height: 2160 },
] as const;

/**
 * Filmic's row of rates. Which of them a phone can record is the lens's to
 * say (capabilities().frameRates); 120 and 240 need Android's high-speed
 * capture, which the recorder does not use yet, so they are shown and never
 * offered - as Filmic greys out what a phone cannot do.
 */
export const TAKE_FRAME_RATES = [24, 25, 30, 48, 50, 60, 120, 240] as const;
const HIGH_SPEED = [120, 240];
/** Offered when the lens has not said what it can do: what nearly every phone holds. */
const SAFE_RATES = [24, 25, 30, 60];

/** Timelapse capture rates, frames a second - 1 is a 30x speed-up at 30 fps playback. */
export const TIMELAPSE_CAPTURE_RATES = [1, 2, 3, 5, 10, 15] as const;

/** Whether a rate can be picked for a take, given the lens's steady rates. */
export function takeRateOffered(fps: number, lensRates: number[]): boolean {
  if (HIGH_SPEED.includes(fps)) return false;
  return lensRates.length > 0 ? lensRates.includes(fps) : SAFE_RATES.includes(fps);
}

export const TAKE_QUALITIES: { value: TakeQuality; label: string; detail: string }[] = [
  { value: "economy", label: "Economy", detail: "Smaller files, fine for talking heads" },
  { value: "standard", label: "Standard", detail: "Clean detail for most shooting" },
  { value: "high", label: "High", detail: "Most detail for editing; large files" },
];

/** Bits per second at 30 fps, per height and quality. */
const TAKE_BITRATES: Record<number, Record<TakeQuality, number>> = {
  360: { economy: 1_000_000, standard: 1_500_000, high: 2_500_000 },
  480: { economy: 2_000_000, standard: 3_000_000, high: 5_000_000 },
  720: { economy: 5_000_000, standard: 8_000_000, high: 12_000_000 },
  1080: { economy: 10_000_000, standard: 16_000_000, high: 24_000_000 },
  1440: { economy: 16_000_000, standard: 24_000_000, high: 36_000_000 },
  2160: { economy: 30_000_000, standard: 45_000_000, high: 60_000_000 },
};

/**
 * The encoder picture for a take with no destination. 60 fps gets half as
 * much again: twice the frames, but each changes less from the last.
 */
export function takePicture(preferences: Preferences = loadPreferences()): {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
} {
  const picture = TAKE_PICTURES.find((p) => p.height === preferences.takeHeight) ?? TAKE_PICTURES[1];
  const fps =
    (TAKE_FRAME_RATES as readonly number[]).includes(preferences.takeFps) && !HIGH_SPEED.includes(preferences.takeFps)
      ? preferences.takeFps
      : 30;
  const quality = TAKE_BITRATES[picture.height][preferences.takeQuality] ?? TAKE_BITRATES[picture.height].standard;
  return { width: picture.width, height: picture.height, fps, videoBitrate: Math.round(quality * (fps > 30 ? 1.5 : 1)) };
}

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
