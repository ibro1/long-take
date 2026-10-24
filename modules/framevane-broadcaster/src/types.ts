import type { ViewProps } from "react-native";

/** What the encoder is doing, as reported by the native connection callbacks. */
export type BroadcastState =
  | "idle"
  | "connecting"
  | "connected"
  /** A dropped connection being retried, rather than given up on. */
  | "reconnecting"
  | "failed"
  | "disconnected"
  | "authError"
  | "authSuccess";

export type StatusEvent = {
  state: BroadcastState;
  detail: string;
  /**
   * Which retry of the current outage this is, 0 when none. Optional because a
   * native build older than 55 does not send it, and the screen has to keep
   * counting - more roughly - against one.
   */
  attempt?: number;
};

export type BitrateEvent = {
  /** What actually went out in the last second. */
  bitrate: number;
  /** What the encoder is currently aiming at, after any adaptation. */
  target: number;
  congested: boolean;
};

/** Peak microphone amplitude, 0-100, ten times a second. */
export type LevelEvent = { peak: number; muted: boolean };

export type CameraFacing = "front" | "back" | "external" | "unknown";

export type CameraInfo = {
  id: string;
  facing: CameraFacing;
  /** Horizontal degrees, or 0 when the phone does not say. */
  fieldOfView: number;
  current: boolean;
};

export type CamerasEvent = { cameras: CameraInfo[] };

/**
 * What this camera will actually let the operator change.
 *
 * Phones differ wildly - an ultra-wide often has no optical zoom range and
 * some cameras refuse manual white balance - so a control is offered only
 * when the camera says it exists, rather than offered and then silently
 * ignored.
 */
export type CameraCapabilities = {
  zoom: { min: number; max: number; current: number };
  /**
   * Exposure compensation. The camera counts in its own steps, not in EV, so
   * `evStep` is how many EV one step is worth - typically 1/3 or 1/6. Multiply
   * to show the operator EV, which is the unit they know from every other
   * camera they have used. 0 is neutral.
   */
  exposure: {
    min: number;
    max: number;
    current: number;
    /** Whether the metering is held where it is, by CONTROL_AE_LOCK. */
    locked: boolean;
    /**
     * Whether this camera offers the lock at all. A phone that does not answer
     * the question counts as yes - see the note on the Kotlin side.
     */
    lockAvailable: boolean;
    evStep: number;
  };
  /** Whether auto-focus is on RIGHT NOW. `focusAt` turns it off. */
  autoFocus: boolean;
  /**
   * How near this lens focuses, in dioptres (1/metres): 10 is ten centimetres.
   * Zero means the lens is fixed and there is no manual focus to offer.
   */
  focusNear: number;
  /** Where the lens is being held, in dioptres. 0 is infinity. */
  focusDistance: number;
  /** Whether this camera offers video stabilisation at all. */
  stabilization: boolean;
  /** Whether stabilisation is on right now. Meaningless unless supported. */
  stabilizationOn: boolean;
  /**
   * Android CONTROL_AWB_MODE values this camera supports. 1 is
   * CONTROL_AWB_MODE_AUTO and 0 is CONTROL_AWB_MODE_OFF; the rest are the
   * named presets (incandescent, daylight, and so on).
   */
  whiteBalanceModes: number[];
  whiteBalance: number;
  autoWhiteBalance: boolean;
  torch: boolean;
  /**
   * Video noise reduction modes this lens offers, as Camera2
   * NOISE_REDUCTION_MODE values, and the one in use. A lens that reports fewer
   * than two has no choice to offer and the control is not shown.
   */
  noiseReductionModes: number[];
  noiseReduction: number;
  /**
   * Anti-flicker modes, as CONTROL_AE_ANTIBANDING_MODE values, and the one in
   * use. Mains lighting flickers at twice the supply frequency and a sensor
   * exposing out of step with it bands the picture - 50Hz or 60Hz by country,
   * AUTO where the phone will work it out.
   */
  antiFlickerModes: number[];
  antiFlicker: number;
  /** False when no camera is open yet, in which case nothing else is meaningful. */
  available: boolean;
};

export type Orientation = "auto" | "portrait" | "landscape";

/** A display-only viewfinder aid. Grows as zebras and false colour land. */
export type MonitorMode = "off" | "peaking";

/**
 * H.265 is half the bitrate for the same picture and every platform Framevane
 * fans out to accepts it - but not every phone encodes it, and the compositor
 * has to transcode it either way, so it is offered rather than assumed.
 */
export type VideoCodec = "h264" | "h265" | "av1";

export type AudioDeviceKind = "builtin" | "wired" | "bluetooth" | "usb" | "other";

export type AudioDevice = {
  /** Android's own device id. */
  id: number;
  name: string;
  kind: AudioDeviceKind;
  current: boolean;
};

/**
 * Only devices attached right now. A microphone that has been unplugged is
 * ABSENT from the list, never present with `current: false` - the UI reads a
 * missing id as "the accessory you were using is gone", which is the moment
 * worth telling an operator about, and a lingering entry would silence that.
 */

export type AudioDevicesEvent = { devices: AudioDevice[] };

/**
 * SRT's two options that are not in the URL.
 *
 * Latency is the buffer SRT is allowed to use to recover lost packets - the
 * whole reason to prefer it over RTMP on a mobile uplink. It must be at least
 * as large as the round trip, and the server has its own value; the larger of
 * the two wins, so setting it here is a floor rather than a decision.
 *
 * A passphrase encrypts the stream on the wire. It is a credential: it belongs
 * with the stream key, not in a log line.
 */
export type SrtOptions = { latencyMs?: number; passphrase?: string };

/**
 * What the phone has left, and whether it is filling or emptying.
 *
 * An encoder, a radio and a lit screen together are the fastest way to flatten
 * a phone, and the operator finds out at the worst possible moment unless it is
 * on the glass in front of them.
 */
export type PowerState = { level: number; charging: boolean };

export type LogLevel = "info" | "warn" | "error";

/**
 * One line of what the encoder did. A broadcast that failed three minutes ago
 * cannot be diagnosed from a screen that only shows the present.
 */
export type LogEntry = { at: number; level: LogLevel; message: string };

export type LogEvent = LogEntry;

/**
 * The microphone going silent, and coming back.
 *
 * `reason` says which detector fired and what it could tell: `call` when the
 * phone is in a call, `taken` when the recording stopped outright, `silenced`
 * when Android reported this app is being given silence, `silent` when every
 * sample is zero and nothing said why, `back` when sound returned, and `route`
 * when the microphone was still working but was no longer the one the operator
 * chose - a Bluetooth headset a call took away and did not give back, which
 * sounds like a quiet room rather than a silent one. `headset` is a Bluetooth
 * microphone that was asked for and never answered: the link is what carries
 * its audio, and until the link is up the recorder is pointed at nothing.
 */
export type AudioInterruptedEvent = {
  silenced: boolean;
  /**
   * `restored`: Android confirmed the recording is back on the chosen
   * headset after `route` had to ask for it again.
   */
  reason: "call" | "taken" | "silenced" | "silent" | "back" | "route" | "restored" | "headset";
};

/**
 * Android's thermal status: 0 none, 1 light, 2 moderate, 3 severe, 4 critical,
 * 5 emergency, 6 shutdown - and -1 on a phone too old to be asked, which is
 * not the same fact as "not hot" and is never reported as one.
 */
export type ThermalEvent = {
  status: number;
  name: string;
};

/** Room where recordings are written. */
export type StorageState = {
  usableBytes: number;
  totalBytes: number;
};

export type RecordEvent = {
  recording: boolean;
  /** Where the file is being written, or was written. */
  path: string;
  /** Empty unless the recorder failed. */
  error: string;
  /**
   * The file this event closed, when it closed one: the take on a stop, the
   * finished section on a split - where `recording` stays true and `path` is
   * the next section. Empty or absent otherwise.
   */
  closedPath?: string;
  /**
   * How long that file runs, by the native recorder's clock. The event can
   * reach the screen long after it happened - the view queues its events while
   * detached - so a clock started in JavaScript would measure the wait too.
   * Zero or absent when the native side could not say.
   */
  closedMs?: number;
};

/**
 * Whether this handset can actually encode a codec, and whether it does it on
 * the media hardware.
 *
 * H.265 halves the bitrate for the same picture, which on a phone uplink is
 * the single biggest win available - but plenty of handsets either cannot
 * encode it or ship an implementation that fails at runtime. Asking the phone
 * is the difference between offering a choice and offering a trap.
 */
export type CodecSupport = { codec: VideoCodec; hardware: boolean };

/**
 * A file the phone recorded. Reported by the native side rather than kept in
 * app storage, because the file is the truth: a list of paths goes stale the
 * moment anything else deletes one.
 */
export type RecordingFile = {
  /**
   * How to address this recording: a file path in the app's own folder, or a
   * `content://` URI for one in the phone's video library. It is what
   * `openRecording` and `deleteRecording` take, and it is the identity of the
   * row - a recording moved into the library gets a new one.
   */
  path: string;
  name: string;
  bytes: number;
  modifiedAt: number;
  /** From the library's own index. 0 when nothing has measured it. */
  durationMs: number;
  /** Whether the phone's gallery and video players can see it. */
  inLibrary: boolean;
};

export type EncoderSettings = {
  width: number;
  height: number;
  fps: number;
  /** Bits per second, not kbps - the native side speaks bps throughout. */
  videoBitrate: number;
  videoCodec: VideoCodec;
  audioBitrate: number;
  sampleRate: number;
  stereo: boolean;
  /** 0-2. 1 is the microphone as it comes; above that is gain, not volume. */
  micGain: number;
  /**
   * Android's own audio effects, applied by the capture hardware where it has
   * them. Worth having on a phone held at arm's length in a hall; worth off
   * when a decent external microphone is plugged in and the processing is
   * chewing what it picks up.
   */
  echoCanceler: boolean;
  noiseSuppressor: boolean;
  /**
   * Encode on the media hardware rather than in software. On by default and it
   * should stay on - software H.264 on a phone heats it until it throttles,
   * which ends a long broadcast by itself. The switch exists because a few
   * devices ship a broken hardware HEVC encoder and falling back is the only
   * way to stream at all.
   */
  preferHardwareCodec: boolean;
  /** Give bitrate up when the uplink cannot carry it, and take it back slowly. */
  adaptiveBitrate: boolean;
  /** Reconnect on a dropped connection rather than ending the broadcast. */
  autoReconnect: boolean;
  reconnectDelayMs: number;
};

export type BroadcastStats = {
  bitrate: number;
  droppedVideoFrames: number;
  droppedAudioFrames: number;
  sentVideoFrames: number;
  sentAudioFrames: number;
  /** Frames waiting to go out, against the cache that holds them. */
  queueItems: number;
  queueCapacity: number;
  bytesSent: number;
  congested: boolean;
  width: number;
  height: number;
  /** What the encoder was asked for. */
  fps: number;
  /**
   * What is actually leaving the phone, counted from frames sent. It is the
   * number that matters: a thermally throttled phone reports the frame rate it
   * was configured with right up until the picture starts stuttering.
   */
  measuredFps: number;
  codec: VideoCodec;
  recording: boolean;
  videoMuted: boolean;
};

export type BroadcasterViewProps = ViewProps & {
  onStatus?: (event: { nativeEvent: StatusEvent }) => void;
  onBitrate?: (event: { nativeEvent: BitrateEvent }) => void;
  onLevel?: (event: { nativeEvent: LevelEvent }) => void;
  onCameras?: (event: { nativeEvent: CamerasEvent }) => void;
  onAudioDevices?: (event: { nativeEvent: AudioDevicesEvent }) => void;
  onLog?: (event: { nativeEvent: LogEvent }) => void;
  onRecord?: (event: { nativeEvent: RecordEvent }) => void;
  onAudioInterrupted?: (event: { nativeEvent: AudioInterruptedEvent }) => void;
  onThermal?: (event: { nativeEvent: ThermalEvent }) => void;
};
