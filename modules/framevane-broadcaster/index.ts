import { requireNativeModule, requireNativeView } from "expo";
import type * as React from "react";
import { Platform } from "react-native";

import type {
  AudioDevice,
  AudioDeviceKind,
  AudioDevicesEvent,
  AudioInterruptedEvent,
  BitrateEvent,
  BroadcasterViewProps,
  BroadcastState,
  BroadcastStats,
  CameraCapabilities,
  CameraFacing,
  CameraInfo,
  CamerasEvent,
  CodecSupport,
  EncoderSettings,
  LevelEvent,
  LevelMeterViewProps,
  LogEntry,
  LogEvent,
  LogLevel,
  MonitorMode,
  Orientation,
  PowerState,
  RecordEvent,
  RecordingFile,
  StorageState,
  ThermalEvent,
  SrtOptions,
  StatsEvent,
  StatusEvent,
  VideoCodec,
} from "./src/types";

export type {
  AudioDevice,
  AudioDeviceKind,
  AudioDevicesEvent,
  AudioInterruptedEvent,
  BitrateEvent,
  BroadcasterViewProps,
  BroadcastState,
  BroadcastStats,
  CameraCapabilities,
  CameraFacing,
  CameraInfo,
  CamerasEvent,
  CodecSupport,
  EncoderSettings,
  LevelEvent,
  LevelMeterViewProps,
  LogEntry,
  LogEvent,
  LogLevel,
  MonitorMode,
  Orientation,
  PowerState,
  RecordEvent,
  RecordingFile,
  StorageState,
  ThermalEvent,
  SrtOptions,
  StatsEvent,
  StatusEvent,
  VideoCodec,
};

/**
 * The camera preview. Mount exactly one: the phone has one camera stack and one
 * microphone, and the native side keeps a single reference to whichever preview
 * is on screen.
 */
export const BroadcasterView: React.ComponentType<BroadcasterViewProps> =
  requireNativeView("FramevaneBroadcaster");

/**
 * The microphone level meter, drawn natively - or null where there is none.
 *
 * Null on iOS, which has no native meter yet, and on an Android dev client
 * built before the view existed. Both are asked rather than assumed: rendering
 * a native view the installed app does not have fails at render time, deep in
 * the renderer, with nothing naming the cause. So the caller checks for null
 * and keeps the JavaScript meter as the fallback.
 *
 * The config lookup is the same one `requireNativeView` makes on first render
 * (expo-modules-core's `getViewConfig`), done up front so the answer is known
 * before anything is mounted.
 */
const expoGlobal = (globalThis as {
  expo?: { getViewConfig?: (moduleName: string, viewName?: string) => unknown };
}).expo;

export const LevelMeterView: React.ComponentType<LevelMeterViewProps> | null =
  Platform.OS === "android" && expoGlobal?.getViewConfig?.("FramevaneBroadcaster", "LevelMeterView")
    ? requireNativeView<LevelMeterViewProps>("FramevaneBroadcaster", "LevelMeterView")
    : null;

const nativeModule = requireNativeModule("FramevaneBroadcaster");

/**
 * Names the commonest development failure, which otherwise reports itself as
 * `native.x is not a function (it is undefined)` at the moment a screen
 * renders.
 *
 * Metro serves the newest JavaScript to whichever dev client happens to be
 * installed, and nothing checks that the two agree - so calling anything added
 * to the native module after that APK was built fails with a message naming a
 * symbol rather than the problem. The fingerprint runtime version stops this
 * happening over the air; on a dev client there is no such guard.
 *
 * Development only. In a release build the JavaScript and the native code ship
 * together and cannot disagree, and a proxy on the hot path would be a cost for
 * nothing.
 */
const PROBED_BY_JS = new Set([
  "then",
  "toJSON",
  "valueOf",
  "toString",
  "constructor",
  "prototype",
  "$$typeof",
  "inspect",
  "asymmetricMatch",
  "nodeType",
  "@@iterator",
]);

const native: typeof nativeModule = __DEV__
  ? new Proxy(nativeModule, {
      get(target, prop) {
        // Read off the target, not the proxy: a native function called through
        // a proxy would otherwise receive the proxy as `this`, and Expo's
        // module methods use it. Functions are bound for the same reason.
        const value = Reflect.get(target, prop);
        if (
          value === undefined &&
          typeof prop === "string" &&
          !prop.startsWith("__") &&
          !PROBED_BY_JS.has(prop)
        ) {
          throw new Error(
            `FramevaneBroadcaster.${prop} is missing from the app installed on this device.\n\n` +
              "The dev client is older than the JavaScript being served to it. Install the " +
              "latest framevane-android-devclient.apk from the GitHub release, or run the " +
              "standalone preview build, which carries its own JavaScript.",
          );
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    })
  : nativeModule;

// --- The broadcast ------------------------------------------------------

/**
 * Applies encoder settings. Takes effect on the next start, never mid-stream:
 * resolution, frame rate and codec are baked in when the encoder spawns.
 */
export function configure(settings: Partial<EncoderSettings>): Promise<void> {
  return native.configure(settings);
}

/**
 * The destination, as a URL whose scheme picks the protocol: `rtmp://`,
 * `rtmps://` for RTMP over TLS, or `srt://host:8890?streamid=...`.
 */
export function startStream(url: string): Promise<void> {
  return native.startStream(url);
}

export function stopStream(): Promise<void> {
  return native.stopStream();
}

export function isStreaming(): boolean {
  return native.isStreaming();
}

/**
 * What the socket is doing: a stream reports its target bitrate right up until
 * the moment it stalls, and the queue is what says the uplink is losing.
 *
 * While live, prefer the view's `onStats` event, which pushes this same map
 * once a second. This call is synchronous and blocks the JavaScript thread for
 * the round trip; it is kept for a one-off read and for when nothing is live.
 */
export function stats(): BroadcastStats {
  return native.stats();
}

/**
 * How often the view's `onLevel` event fires, in milliseconds. 250 by default;
 * 0 stops it; anything else is held between 50 and 10000. Raise it to 100 only
 * while JavaScript is actually drawing the level - `LevelMeterView` does not
 * need the event.
 *
 * Feature-detected like `sampleLuma`, so a dev client that predates it keeps
 * its old fixed rate rather than throwing through the dev proxy.
 */
export function setLevelEventInterval(ms: number): void {
  const fn = (nativeModule as Record<string, unknown>).setLevelEventInterval;
  if (typeof fn !== "function") return;
  native.setLevelEventInterval(Math.round(ms));
}

/**
 * The one encoder setting that is safe to change while live, and the one worth
 * changing: when the uplink is struggling, less data is better than a stall.
 */
export function setVideoBitrate(bitsPerSecond: number): Promise<void> {
  return native.setVideoBitrate(bitsPerSecond);
}

/**
 * SRT's latency floor and passphrase, applied to the next connection. Both are
 * ignored for RTMP, which has neither.
 */
export function setSrtOptions(options: SrtOptions): Promise<void> {
  return native.setSrtOptions(options);
}

/**
 * The picture the encoder was actually built with, or null if it has not been.
 *
 * Not what was last asked for: a configure under a running recorder is stored
 * and applied to nothing, so this is the only way to tell whether going live
 * now would send the destination's picture or the recording's.
 */
export type EncoderPicture = Pick<
  EncoderSettings,
  "width" | "height" | "fps" | "videoBitrate" | "videoCodec"
>;

export function encoderPicture(): EncoderPicture | null {
  return native.encoderPicture() ?? null;
}

// --- Cameras ------------------------------------------------------------

/**
 * Every camera the phone will open, including one plugged in over USB. An id
 * on its own is useless - "0" and "2" say nothing - so each carries which way
 * it faces and how wide it sees.
 */
export function cameras(): CameraInfo[] {
  return native.cameras();
}

export function openCamera(id: string): Promise<void> {
  return native.openCamera(id);
}

export function switchCamera(): Promise<void> {
  return native.switchCamera();
}

/**
 * Which codecs this handset will actually encode. Ask before offering H.265:
 * on a phone that cannot do it, the choice is a trap rather than an option.
 */
export function supportedCodecs(): CodecSupport[] {
  return native.supportedCodecs();
}

/**
 * What the camera now open will actually let you change. Read it after every
 * camera change: an ultra-wide and a main lens do not offer the same controls.
 */
export function capabilities(): CameraCapabilities {
  return native.capabilities();
}

export function setZoom(level: number): Promise<void> {
  return native.setZoom(level);
}

export function zoomRange(): { min: number; max: number } {
  return native.zoomRange();
}

/**
 * Focus where the operator touched, in fractions of the preview: 0,0 is the
 * top left and 1,1 the bottom right. Takes the camera off auto-focus, which is
 * the point - tapping means "this, not whatever you chose".
 */
export function focusAt(x: number, y: number): Promise<void> {
  return native.focusAt(x, y);
}

export function setAutoFocus(on: boolean): Promise<void> {
  return native.setAutoFocus(on);
}

/** In the camera's own exposure-compensation steps. See [CameraCapabilities]. */
export function setExposure(value: number): Promise<void> {
  return native.setExposure(value);
}

/**
 * Brightness (0..1 luma) of the picture under a point, in fractions of the
 * preview (0,0 top-left .. 1,1 bottom-right) - the exposure reticle's spot
 * meter. -1 when the preview cannot be read.
 *
 * Feature-detected against the raw module so a dev client that predates the
 * native function answers -1 (meter idle) rather than throwing through the dev
 * proxy.
 */
export function sampleLuma(x: number, y: number): Promise<number> {
  const fn = (nativeModule as Record<string, unknown>).sampleLuma;
  if (typeof fn !== "function") return Promise.resolve(-1);
  return native.sampleLuma(x, y);
}

/**
 * Holds the lens at a distance, in dioptres - 1/metres, so 0 is infinity and
 * `capabilities().focusNear` is as near as this lens goes.
 *
 * Turns auto-focus off in the same capture request. Doing it in two would let
 * the lens take the distance and immediately overrule it, which looks exactly
 * like the control not working.
 */
export function setFocusDistance(dioptres: number): Promise<void> {
  return native.setFocusDistance(dioptres);
}

/**
 * A display-only viewfinder aid over the preview: "peaking" highlights the
 * in-focus edges in red, "off" clears it. It is never encoded - going live or
 * recording clears it on the native side.
 */
export function setMonitor(mode: MonitorMode): Promise<void> {
  return native.setMonitor(mode);
}

/** The monitoring aid currently applied. */
export function monitorMode(): MonitorMode {
  return native.monitorMode();
}

/** Gives focus back to the camera. */
export function resumeAutoFocus(): Promise<void> {
  return native.resumeAutoFocus();
}

/**
 * Holds the metering where it is, through CONTROL_AE_LOCK.
 *
 * Not the same as turning auto exposure off: the camera keeps the exposure it
 * has converged to rather than falling back to the sensor's defaults, and
 * [setExposure] still moves it while the lock is on.
 */
/**
 * Whether a finished take is moved into the phone's video library.
 *
 * The recorder can only be given a path, and the only path this app may write
 * to without a storage permission is its own folder - which nothing else on
 * the phone can see. So a take is written there and moved afterwards. Off
 * leaves it where it was written, reachable only from this app.
 */
export function setSaveToGallery(on: boolean): Promise<void> {
  return native.setSaveToGallery(on);
}

/**
 * Opens the microphone again after something else on the phone took it.
 *
 * Refused while live: the encoder owns the audio source by then, and swapping
 * it goes through a RootEncoder call that builds a second AudioRecord and
 * leaves it failing every read in silence. Restart the connection instead,
 * which is the path the stall banner already offers.
 *
 * Resolves with whether the microphone is running, which is all it can claim.
 * Whether sound is arriving is answered a moment later by the level detector,
 * which clears the warning itself.
 */
export function restoreMicrophone(): Promise<boolean> {
  return native.restoreMicrophone();
}

/**
 * What the phone says about its own temperature, and -1 where it cannot say.
 * Nothing is inferred from frame timings: a guess dressed as a reading is
 * worse than an honest silence.
 */
export function thermal(): ThermalEvent {
  return native.thermal();
}

/** Room where recordings are written. */
export function storage(): StorageState {
  return native.storage();
}

/** Whether the microphone is handing back digital silence right now. */
export function audioSilenced(): boolean {
  return native.audioSilenced();
}

/**
 * The height the copy on the phone is written at, and what to spend on it.
 *
 * Zero for either means the recording is the same picture that is going out.
 * Anything else runs a second video encoder, so it costs heat - which is why
 * it is a choice rather than a default.
 *
 * The height has to divide the broadcast's shape exactly: RootEncoder compares
 * the two aspect ratios and refuses anything that is not equal, so 480p
 * against a 720p picture is not on offer and 540p is. A height that does not
 * fit is ignored with a line in the log rather than failing the configure.
 */
export function setRecordingQuality(height: number, bitrate: number): Promise<void> {
  return native.setRecordingQuality(height, bitrate);
}

export function recordingQuality(): { height: number; bitrate: number } {
  return native.recordingQuality();
}

/**
 * When to close one section of a recording and open the next.
 *
 * Zero for either limit turns that limit off. Applied to the next take, not
 * the running one - a limit changed mid-recording would be a section boundary
 * nobody asked for.
 */
export function setRecordingSplit(minutes: number, bytes: number): Promise<void> {
  return native.setRecordingSplit(minutes, bytes);
}

/**
 * Asks Android for a folder to keep recordings in, and returns it.
 *
 * Resolves with the empty string when the operator backs out, which means the
 * same thing everywhere downstream: no folder of their choosing, use the
 * library. The permission is taken persistably, so the folder survives a
 * reboot - but it can still be revoked from Android's settings, and a take
 * that cannot be written there falls back to the library rather than being
 * lost.
 */
export function pickRecordingFolder(): Promise<string> {
  return native.pickRecordingFolder();
}

export function setRecordingFolder(uri: string): Promise<void> {
  return native.setRecordingFolder(uri);
}

export function recordingFolder(): string {
  return native.recordingFolder();
}

/** False on Android 9 and older, where an app cannot add to the library. */
export function canSaveToGallery(): boolean {
  return native.canSaveToGallery();
}

export function setExposureLock(on: boolean): Promise<void> {
  return native.setExposureLock(on);
}

/**
 * An Android CONTROL_AWB_MODE value from `capabilities().whiteBalanceModes`.
 * Pass 1 - CONTROL_AWB_MODE_AUTO - to hand white balance back to the camera.
 */
export function setWhiteBalance(mode: number): Promise<void> {
  return native.setWhiteBalance(mode);
}

export function setStabilization(on: boolean): Promise<void> {
  return native.setStabilization(on);
}

export function setTorch(on: boolean): Promise<void> {
  return native.setTorch(on);
}

export function isTorchOn(): boolean {
  return native.isTorchOn();
}

// --- Audio --------------------------------------------------------------

export function setMuted(muted: boolean): Promise<void> {
  return native.setMuted(muted);
}

export function isMuted(): boolean {
  return native.isMuted();
}

/** 0-2, where 1 is the microphone untouched. Above 1 is gain, and it clips. */
export function setMicGain(level: number): Promise<void> {
  return native.setMicGain(level);
}

export function micGain(): number {
  return native.micGain();
}

/**
 * Microphones the phone will accept input from - built in, wired, Bluetooth, a
 * USB interface. A broadcaster that cannot choose is a broadcaster that
 * records the phone's own speaker mesh instead of the lapel mic someone
 * plugged in.
 */
export function audioDevices(): AudioDevice[] {
  return native.audioDevices();
}

/** Pass -1 to hand the choice back to Android. */
export function selectAudioDevice(id: number): Promise<void> {
  return native.selectAudioDevice(id);
}

/**
 * Run the microphone while off air, so the level meter reads before the
 * broadcast starts rather than after someone complains they cannot hear it.
 *
 * While the viewfinder is out of sight and nothing is live or recording, a
 * request to turn it on is held rather than honoured, and the microphone opens
 * when the preview comes back - the phone does not keep a microphone open for
 * a meter nobody can see.
 */
export function monitorAudio(on: boolean): Promise<void> {
  return native.monitorAudio(on);
}

// --- Shape --------------------------------------------------------------

/**
 * The shape of the broadcast. Set it before going live: a stream that changes
 * shape halfway through gets letterboxed on top of letterboxed by every
 * platform downstream.
 */
export function setOrientation(mode: Orientation): Promise<void> {
  return native.setOrientation(mode);
}

export function orientation(): Orientation {
  return native.orientation();
}

// --- Holding the picture ------------------------------------------------

/**
 * Freeze what viewers see without ending the broadcast - the "be right back"
 * of live streaming. Audio keeps going unless it is muted too, and the
 * connection stays up, so there is nothing to reconnect afterwards.
 */
export function setVideoMuted(muted: boolean): Promise<void> {
  return native.setVideoMuted(muted);
}

export function isVideoMuted(): boolean {
  return native.isVideoMuted();
}

// --- Recording and stills -----------------------------------------------

/**
 * Records to the phone as well as sending. Framevane archives server-side
 * already, so this is the belt to that braces: the copy that survives the
 * uplink failing entirely.
 *
 * Resolves with the path being written.
 */
export function startRecording(): Promise<string> {
  return native.startRecording();
}

export function stopRecording(): Promise<void> {
  return native.stopRecording();
}

export function isRecording(): boolean {
  return native.isRecording();
}

/**
 * What is on the phone, read from disk rather than from a list this app keeps.
 * A remembered list goes stale the moment anything else removes a file, and
 * then offers the operator a recording that is not there.
 */
export function recordings(): RecordingFile[] {
  return native.recordings();
}

/** Resolves false when the file was already gone. */
export function deleteRecording(path: string): Promise<boolean> {
  return native.deleteRecording(path);
}

/** A still from the live picture. Resolves with the path written. */
export function takePhoto(): Promise<string> {
  return native.takePhoto();
}

// --- Carrying on in the background --------------------------------------

/**
 * Keep broadcasting when the app is not on screen.
 *
 * Android will not let an app hold the camera in the background without a
 * foreground service, and it kills the process soon after besides. With this
 * on, the broadcast runs behind a notification the operator can see and stop
 * from - which is also the only honest way to do it: a phone that is secretly
 * filming is a phone nobody should trust.
 */
export function setBackgroundBroadcast(on: boolean): Promise<void> {
  return native.setBackgroundBroadcast(on);
}

export function backgroundBroadcast(): boolean {
  return native.backgroundBroadcast();
}

/**
 * Charge remaining as a fraction, and whether it is going up. Read on a timer
 * rather than pushed: a battery does not change fast enough to be worth an
 * event, and a broadcaster already has enough of those.
 */
/**
 * Opens a recording in whatever plays video on this phone.
 *
 * There is no player in this app and there should not be - the phone has
 * several, and one of them is already the operator's choice. Android only.
 */
export function openRecording(path: string): Promise<void> {
  return native.openRecording(path);
}

/**
 * Video noise reduction, as one of `capabilities().noiseReductionModes`.
 *
 * Nothing here invents a mode: the list comes from the lens, so a phone that
 * offers no choice is never asked to make one.
 */
export function setNoiseReduction(mode: number): Promise<void> {
  return native.setNoiseReduction(mode);
}

/** Anti-flicker, as one of `capabilities().antiFlickerModes`. */
export function setAntiFlicker(mode: number): Promise<void> {
  return native.setAntiFlicker(mode);
}

export function power(): PowerState {
  return native.power();
}
