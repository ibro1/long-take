import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { scrub } from "@/lib/scrub";
import * as Broadcaster from "@/modules/framevane-broadcaster";
import type {
  AudioDevice,
  AudioDevicesEvent,
  AudioInterruptedEvent,
  BitrateEvent,
  StatsEvent,
  BroadcastState,
  CameraCapabilities,
  CameraInfo,
  CamerasEvent,
  EncoderSettings,
  LevelEvent,
  LogEvent,
  Orientation,
  ThermalEvent,
  PowerState,
  RecordEvent,
  StatusEvent,
} from "@/modules/framevane-broadcaster";
import { type Connection, endpointFor, srtOptionsFor } from "./connections";
import { canStartRecording, tooLittleRoom } from "./guards";
import { offerableInputs, stillOfferable } from "./inputs";
import { pushLog, readLog, subscribeLog } from "./log";
import { noteRecordEvent } from "./recordings";
import { publishLevel, takePainted, takeRenders } from "./level-store";
import { readReadouts, setReadouts } from "./readouts";
import {
  loadPreferences,
  loadSettings,
  recordQualityFor,
  savePreferences,
  SPLIT_BYTES,
} from "./settings";

/**
 * Bitrate events arrive about once a second. Eight of them missing is a stall,
 * not a stutter - long enough that a slow phone is not accused of one, short
 * enough that the operator hears it from us before they hear it from a viewer.
 */
const STALL_AFTER_MS = 8_000;

/**
 * Why a start failed, with nothing in it that could put someone else on air.
 *
 * The encoder is handed a full endpoint and quotes it back in its own
 * exceptions, and this message goes on the banner and into the log - which is
 * the thing an operator screenshots into a support chat. So anything
 * URL-shaped is cut back to its scheme and host, the same line the native log
 * draws with `safeDestination`.
 */
function reasonFor(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/[^\s/?#]+)(\S*)/gi,
    (_match, origin: string, rest: string) => (rest ? `${origin}/...` : origin),
  );
  return cleaned.trim() || "The phone would not start the broadcast.";
}

/** Android's CONTROL_AWB_MODE for automatic white balance. */
export const AWB_AUTO = 1;

/** NOISE_REDUCTION_MODE_FAST - what nearly every phone does by default. */
export const NOISE_REDUCTION_FAST = 1;

/** CONTROL_AE_ANTIBANDING_MODE_AUTO - the phone works the mains out itself. */
export const ANTI_FLICKER_AUTO = 3;

/**
 * One broadcast, as the screen needs to see it.
 *
 * The native side reports connection events and a bitrate once a second; this
 * turns that into the three things an operator actually reads under pressure:
 * am I on air, for how long, and is the uplink carrying it.
 *
 * It also holds everything about the camera that has a current value - zoom,
 * exposure, focus, white balance, the recorder - so that the screen is left
 * being about layout. Every one of those calls can arrive before a camera is
 * open, and all of them are allowed to fail quietly: a control that throws
 * takes the viewfinder down with it, and losing the viewfinder is worse than
 * losing a tap.
 */
export function useBroadcast() {
  const [state, setState] = useState<BroadcastState>("idle");
  const [detail, setDetail] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [charge, setCharge] = useState<PowerState>({ level: 1, charging: false });
  /**
   * The two readings the phone takes about itself. Judged in `guards.ts`, not
   * here: what they mean is a product decision and what they are is not.
   */
  const [thermal, setThermal] = useState(() => {
    try {
      return Broadcaster.thermal().status;
    } catch {
      return -1;
    }
  });
  const [usableBytes, setUsableBytes] = useState(0);
  const [orientation, setOrientationState] = useState<Orientation>("auto");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);


  useEffect(() => () => {
    if (retry.current) clearTimeout(retry.current);
  }, []);

  // Reconnecting is still on air as far as the operator is concerned: the
  // broadcast has not been ended, and the button must still say so.
  const live = state === "connected" || state === "reconnecting";

  /**
   * Whether a broadcast is under way as far as the operator is concerned -
   * from the moment going live is asked for until it is ended - and whether
   * that broadcast has reached the server yet.
   *
   * Refs, because they are read inside the status callback and must be right
   * on the event that arrives in the same tick as the change.
   */
  const inBroadcast = useRef(false);
  const reachedAir = useRef(false);

  /**
   * A broadcast that was on air and stopped without anyone ending it.
   *
   * The state alone cannot say this: `disconnected` is also what the encoder
   * reports a moment after the operator presses End, and `failed` is also a
   * first connection that never got anywhere. The difference is whether it had
   * been live and whether anybody asked - which only this hook knows. Kept
   * until the operator acts on it, because a phone that went off air while
   * nobody was looking has to still be saying so when they look.
   */
  const [lostAir, setLostAir] = useState(false);
  const dismissLostAir = useCallback(() => setLostAir(false), []);

  /**
   * How many times this broadcast has had to dial back in, and what dropped it
   * last. For the studio's Phone card, which saw a stream that looked healthy
   * from the ingest while the phone was on its fifth retry.
   *
   * Attempts, not outages: an outage that took four tries says more about the
   * network than one that took one. The native side numbers each retry within
   * an outage; the count here adds up the new numbers it hears, because every
   * attempt arrives twice - once as the failure, once as the redial - and the
   * number is the only thing telling the two apart. A native build too old to
   * send it is counted per outage instead, which under-counts but never
   * doubles.
   *
   * Both start over with each broadcast, in `start` or on a connection this
   * screen did not start.
   */
  const [reconnects, setReconnects] = useState(0);
  const [lastDrop, setLastDrop] = useState("");
  const reconnectCount = useRef(0);
  const outageAttempt = useRef(0);
  const lastReported = useRef<BroadcastState>("idle");

  const resetDrops = useCallback(() => {
    reconnectCount.current = 0;
    outageAttempt.current = 0;
    setReconnects(0);
    setLastDrop("");
  }, []);

  const onStatus = useCallback((event: { nativeEvent: StatusEvent }) => {
    const { state: reported, detail: reason, attempt } = event.nativeEvent;
    /**
     * A broadcast that has been on air stays on air while it dials back in.
     *
     * The native side reports retries as `reconnecting` now, but this is the
     * second line of defence against the bug that made that necessary: every
     * retry used to arrive as `connecting`, which is not `live`, so mid-outage
     * the shutter turned from a confirmed End into an unconfirmed Cancel. Within
     * one broadcast, once it has connected, nothing short of an end leaves live.
     */
    const next: BroadcastState =
      reachedAir.current && (reported === "connecting" || reported === "authSuccess")
        ? "reconnecting"
        : reported;
    // The encoder saying it is connected is a broadcast under way whoever
    // started it - including one this screen was not mounted for.
    if (next === "connected") {
      // A connection nobody here asked for is a new broadcast - the
      // notification's, or one left running when this screen was rebuilt.
      if (!inBroadcast.current) resetDrops();
      inBroadcast.current = true;
      reachedAir.current = true;
      outageAttempt.current = 0;
    }
    if (next === "reconnecting") {
      if (typeof attempt === "number") {
        if (attempt > outageAttempt.current) {
          reconnectCount.current += attempt - outageAttempt.current;
          outageAttempt.current = attempt;
        }
      } else if (lastReported.current !== "reconnecting") {
        reconnectCount.current += 1;
      }
      setReconnects(reconnectCount.current);
      // Scrubbed natively since build 54; this is the line behind it, as for
      // `detail` below. Clamped to what the studio keeps.
      if (reason) setLastDrop(scrub(reason).slice(0, 120));
    }
    lastReported.current = next;
    if (
      next === "idle" ||
      next === "failed" ||
      next === "disconnected" ||
      next === "authError"
    ) {
      // `idle` is the Stop on the notification, which is somebody asking.
      if (inBroadcast.current && reachedAir.current && next !== "idle") setLostAir(true);
      inBroadcast.current = false;
      reachedAir.current = false;
    }
    setState(next);
    /**
     * Scrubbed on the way into state, whatever the native side promises. The
     * detail is drawn in the failure banner, and the encoder's reasons are
     * whatever the server and the socket said - an RTMP server is free to
     * echo the stream name it refused, and the stream name is the key. The
     * native side strips what it can recognise; this is the line behind it.
     */
    setDetail(scrub(reason ?? ""));
    if (next === "connected") setStartedAt((current) => current ?? Date.now());
    /**
     * A reconnect keeps the clock running. The broadcast did not end - the
     * encoder is dialling back in, and an uptime that restarts at zero every
     * time a phone changes cell tower tells the operator nothing useful.
     */
    /**
     * `idle` belongs here too. It is what the Stop action on the notification
     * reports, and without it the clock kept running against a broadcast that
     * had ended - so the next one opened with the last one's uptime already on
     * it, counting from a moment hours ago.
     */
    if (
      next === "idle" ||
      next === "failed" ||
      next === "disconnected" ||
      next === "authError"
    ) {
      setStartedAt(null);
      setReadouts({ bitrate: 0 });
    }
  }, [resetDrops]);

  const [congested, setCongested] = useState(false);

  const lastBitrateAt = useRef(0);
  const [stalled, setStalled] = useState(false);

  /**
   * The encoder's stats, pushed by the native side once a second while live.
   * They used to be pulled with a synchronous call on the JS thread every
   * second; the poll below now only covers what the push does not - the stats
   * panel off air, and a dev client that predates the event.
   */
  /**
   * Frames the encoder dropped. State, unlike the rest of the stats, because a
   * drop changes what the screen says - and it changes rarely, so this re-renders
   * the screen on a new drop, not on every second's fresh stats object.
   */
  const [dropped, setDropped] = useState(0);
  const lastStatsEventAt = useRef(0);
  const onStats = useCallback((event: { nativeEvent: StatsEvent }) => {
    lastStatsEventAt.current = Date.now();
    setReadouts({ stats: event.nativeEvent });
    setDropped(event.nativeEvent.droppedVideoFrames);
  }, []);

  const onBitrate = useCallback((event: { nativeEvent: BitrateEvent }) => {
    setReadouts({ bitrate: event.nativeEvent.bitrate });
    setCongested(event.nativeEvent.congested);
    lastBitrateAt.current = Date.now();
    setStalled(false);
  }, []);

  const onLevel = useCallback((event: { nativeEvent: LevelEvent }) => {
    if (__DEV__ && !heardLevel.current) {
      console.log(`[meter] first sample: peak ${event.nativeEvent.peak}`);
    }
    heardLevel.current = true;
    samplesSinceTick.current += 1;
    lastSampleAt.current = Date.now();
    lastPeak.current = event.nativeEvent.peak;
    publishLevel(event.nativeEvent.peak);
    // Ten level events a second, and the mute almost never changes. Setting it
    // anyway is a render request for the whole screen each time, which React
    // may still pay for before it notices the value is the same.
    if (event.nativeEvent.muted !== mutedRef.current) {
      mutedRef.current = event.nativeEvent.muted;
      setMuted(event.nativeEvent.muted);
    }
  }, []);

  /**
   * The camera list arrives from the native side rather than being asked for,
   * because it changes without anyone pressing anything: a USB camera plugged
   * in should offer itself, and one unplugged mid-setup should stop being
   * offered.
   */
  const onCameras = useCallback((event: { nativeEvent: CamerasEvent }) => {
    setCameras(event.nativeEvent.cameras);
    // A different camera means different controls, so ask again.
    setCameraGeneration((current) => current + 1);
  }, []);

  /**
   * The first camera report is also the signal that the native view exists and
   * its surface is up. Nothing can be asked of the encoder before that, so the
   * microphone monitor waits for it rather than guessing at a delay.
   */
  const ready = cameras.length > 0;

  /**
   * Whether the meter has ever seen a sample. Used to tell "the microphone is
   * quiet" apart from "the microphone never started", which look identical on
   * screen and have completely different causes.
   */
  const heardLevel = useRef(false);

  /**
   * How many level events arrived since the last check, when the last one
   * arrived, and what it said.
   *
   * A meter that has stopped moving has two completely different causes that
   * look identical on screen: the native side has stopped emitting, or it is
   * still emitting and every peak is zero. `heardLevel` cannot tell them
   * apart - it only records that a first sample once arrived - and the first
   * sample is always zero, because it is measured before anyone has spoken.
   */
  const samplesSinceTick = useRef(0);
  const lastSampleAt = useRef(0);
  const lastPeak = useRef(0);

  /**
   * How many of those samples reached the screen.
   *
   * The third cause of a still bar, and the one the other two counters cannot
   * see: the events arrive, the peak changes, and the screen never paints it.
   * Counted by the meter itself now that the level lives outside React state -
   * see lib/broadcast/level-store.ts for why it had to move.
   */

  /**
   * The mute state as the watchdog sees it. A ref rather than the state,
   * because the interval below closes over its first render and would
   * otherwise go on asking for a microphone the operator has muted.
   *
   * Followed from the state rather than from the level event, because muting
   * is the one change a level event cannot carry: the native side stops
   * calling the audio effect altogether, so the last event ever received says
   * the microphone was unmuted. Mute arrives here from the button, from
   * pausing and from unpausing, and all three land in the state.
   */
  const mutedRef = useRef(false);

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const tryMonitor = () => {
      if (__DEV__) console.log(`[meter] asking for the microphone (attempt ${attempts + 1})`);
      Broadcaster.monitorAudio(true)
        .then(() => {
          if (__DEV__) console.log("[meter] the native side accepted the request");
        })
        .catch((error) => {
          // A phone that will not lend us the microphone off air still
          // broadcasts; the meter is the only thing lost.
          if (__DEV__) console.log(`[meter] refused: ${String(error)}`);
        });
    };

    /**
     * Asking once is not enough, and asking a fixed number of times was not
     * either.
     *
     * Starting the meter configures the encoder, and that competes with the
     * surface being set up on another thread - and with the screen rotating, if
     * the stored shape is not the one the phone booted in. Five attempts two
     * seconds apart is a twelve-second window, and a cold start that spends it
     * all rotating used its last attempt before the surface was ready. Then
     * nothing tried again: the watchdog below only rescues a meter that was
     * alive, so a meter that never started stayed dead until the app was.
     *
     * So it keeps asking until a sample arrives, backing off rather than
     * hammering, and gives up only after a minute - by which point the answer
     * is not "try again", it is that something is wrong and the log says so.
     */
    const GIVE_UP_AFTER_MS = 60_000;
    let waited = 0;
    const schedule = () => {
      if (cancelled) return;
      const delay = Math.min(8000, 1000 * 2 ** Math.min(attempts, 3));
      retry = setTimeout(() => {
        if (cancelled || heardLevel.current) return;
        waited += delay;
        attempts += 1;
        if (waited >= GIVE_UP_AFTER_MS) {
          if (__DEV__) console.log("[meter] gave up asking; the encoder never configured");
          return;
        }
        tryMonitor();
        schedule();
      }, delay);
    };

    const preferences = loadPreferences();
    setOrientationState(preferences.orientation);
    Broadcaster.setBackgroundBroadcast(preferences.backgroundBroadcast).catch(() => {});
    /**
     * Ask for the inputs rather than wait to be told about them.
     *
     * The native side reports the list when the preview comes up, and that is
     * a race this screen was losing: the event is emitted before React has
     * attached the listener, so the list stayed empty until something was
     * plugged in or unplugged. It never mattered while the chip was only a
     * readout for an external microphone - the act of plugging one in was
     * itself the event that filled the list. It matters now that the chip is
     * the control: no list, no chip, nothing to tap.
     *
     * Reading it directly costs one call and does not depend on having been
     * listening at the right moment.
     */
    let inputs: AudioDevice[] = [];
    try {
      inputs = Broadcaster.audioDevices();
      setAudioDevices(inputs);
    } catch {
      // Answered by the event when the preview comes up, as before.
    }

    /**
     * The remembered microphone, only if it is still one worth using.
     *
     * A stored id outlives the thing it names, and re-applying it blindly is
     * how one bad tap becomes a phone with no sound: an input that starts and
     * sends nothing was chosen once, remembered, and re-applied on every cold
     * start after that. If it is gone, or is an input this app will not
     * recommend, the choice goes back to Android and the preference with it.
     */
    const wanted = preferences.audioDeviceId;
    const keep = stillOfferable(inputs, wanted);
    if (!keep) savePreferences({ audioDeviceId: -1 });
    Broadcaster.selectAudioDevice(keep ? wanted : -1).catch(() => {});
    // Read at the moment a take finishes rather than when one starts, so it
    // has to be on the view before any recording ends - which means now.
    Broadcaster.setSaveToGallery(preferences.saveToGallery).catch(() => {});
    Broadcaster.setRecordingSplit(preferences.splitMinutes, SPLIT_BYTES).catch(() => {});
    Broadcaster.setRecordingFolder(preferences.recordingFolder).catch(() => {});
    const quality = recordQualityFor(preferences.recordHeight);
    Broadcaster.setRecordingQuality(quality.height, quality.bitrate).catch(() => {});

    if (__DEV__) {
      console.log(
          `[meter] cold start applies orientation ${preferences.orientation}, ` +
          `audio device ${preferences.audioDeviceId}` +
          `, inputs ${inputs.length} [${inputs
            .map((d) => `${d.id}:${d.kind}${d.current ? "*" : ""}`)
            .join(" ")}]`,
      );
    }

    /**
     * The shape is applied before the microphone is asked for, and the asking
     * waits for it.
     *
     * Restoring a stored landscape on a phone held in portrait rotates the
     * Activity, which destroys the surface and builds a new one. A meter
     * started before that is configuring an encoder that is about to be thrown
     * away, and every attempt in the window fails with "the encoder refused
     * these settings" - which is what this whole sequence used to do on any
     * launch where the stored shape was not the one the phone woke up in.
     */
    Broadcaster.setOrientation(preferences.orientation)
      .catch(() => {})
      .then(() => {
        if (cancelled) return;
        tryMonitor();
        schedule();
      });

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      Broadcaster.monitorAudio(false).catch(() => {});
    };
  }, [ready]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  /**
   * Puts the meter back when it stops being fed, and says so.
   *
   * The bar going still has three causes that look identical on screen: the
   * native side stopped calling, it is still calling and every sample is
   * zero, or the samples arrive and the screen never paints them. Counting
   * arrivals and commits separately is what tells them apart - `heardLevel`
   * cannot, because it only records that a first sample once arrived, and the
   * first sample is always zero: it is measured before anyone has spoken.
   *
   * The re-ask is the repair, not the diagnosis. Every native path that takes
   * the microphone down puts it back in a `finally`, and any one of them that
   * fails leaves it down for good - the retry above has already given up by
   * then, because it stops the moment a first sample lands. So the meter is
   * asked for again whenever it falls silent, which costs a no-op in the case
   * where the microphone is simply quiet.
   *
   * Not while muted: a muted microphone legitimately delivers nothing at all.
   * RootEncoder swaps in a buffer of zeros and skips the audio effect on the
   * way past, so silence from a mute is indistinguishable here from silence
   * from a dead recorder, and asking would fight the operator's own choice.
   */
  useEffect(() => {
    if (!ready) return;
    let flowing = false;
    let quiet = 0;
    /**
     * Measured against the clock, not against the interval.
     *
     * A one-second interval does not fire once a second when the JavaScript
     * thread is busy - it fires when the thread is free again, and everything
     * counted in between is then reported as though it happened in one second.
     * That is how a microphone emitting ten samples a second came to be logged
     * as "239/s": the tick was twenty-four seconds late. The lateness was the
     * finding and the rate was the artefact, so measure the gap and say it.
     */
    let lastTickAt = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.max(1, now - lastTickAt);
      lastTickAt = now;
      const perSecond = (count: number) => Math.round((count * 1000) / elapsed);

      const arrived = samplesSinceTick.current;
      const painted = takePainted();
      const renders = takeRenders();
      samplesSinceTick.current = 0;

      if (arrived > 0) {
        flowing = true;
        quiet = 0;
        if (__DEV__) {
          console.log(
            `[meter] ${perSecond(arrived)}/s arrived, ${perSecond(painted)}/s painted, ` +
              `${perSecond(renders)}/s renders, last peak ${lastPeak.current.toFixed(1)}` +
              // Only when the thread was actually blocked, so the ordinary line
              // stays readable and this one means something when it appears.
              (elapsed > 1500 ? `  [JS THREAD BLOCKED ${(elapsed / 1000).toFixed(1)}s]` : ""),
          );
        }
        return;
      }

      // Never having heard anything is the retry above's problem, and it is
      // still working on it. This is only about a meter that was alive.
      if (!flowing || mutedRef.current) return;

      quiet += 1;
      if (quiet === 1) {
        flowing = false;
        pushLog({
          at: Date.now(),
          level: "warn",
          message: "The level meter stopped being fed. Asking for the microphone again.",
        });
        if (__DEV__) console.log("[meter] samples STOPPED; asking for the microphone again");
      }

      /**
       * Backed off rather than every second. A microphone another app is
       * holding will refuse for as long as that app holds it, and a request
       * per second for the length of a phone call is a log nobody can read
       * the real failure out of.
       */
      if (quiet === 1 || quiet === 3 || quiet % 10 === 0) {
        Broadcaster.monitorAudio(true).catch(() => {});
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [ready]);

  // --- What this camera can do ------------------------------------------

  const [capabilities, setCapabilities] = useState<CameraCapabilities | null>(null);
  const [cameraGeneration, setCameraGeneration] = useState(0);
  const [zoom, setZoomState] = useState(1);
  const [exposure, setExposureState] = useState(0);
  const [exposureLocked, setExposureLockedState] = useState(false);
  const [focusDistance, setFocusDistanceState] = useState(0);
  const [manualFocus, setManualFocusState] = useState(false);
  const [autoFocus, setAutoFocusState] = useState(true);
  const [whiteBalance, setWhiteBalanceState] = useState(AWB_AUTO);
  /**
   * The two the camera cannot be asked to read back.
   *
   * Camera2 has no getter for either, so the native side keeps the last value
   * set and reports it through `capabilities`. Both start at what the camera
   * would do anyway.
   */
  const [noiseReduction, setNoiseReductionState] = useState(NOISE_REDUCTION_FAST);
  const [antiFlicker, setAntiFlickerState] = useState(ANTI_FLICKER_AUTO);
  const [stabilization, setStabilizationState] = useState(false);
  const [torch, setTorchState] = useState(false);

  /**
   * `available` is false until the preview's surface exists, and there is no
   * event that says when that happens - so this asks, and keeps asking for a
   * few seconds after a camera change. Giving up quietly is correct: a phone
   * that never reports capabilities still broadcasts, it just offers no
   * exposure control, which is what the absence of capabilities means.
   */
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = () => {
      if (cancelled) return;
      let next: CameraCapabilities | null = null;
      try {
        next = Broadcaster.capabilities();
      } catch {
        next = null;
      }
      if (next?.available) {
        setCapabilities(next);
        setZoomState(next.zoom.current);
        setExposureState(next.exposure.current);
        setExposureLockedState(next.exposure.locked);
        setAutoFocusState(next.autoFocus);
        setFocusDistanceState(next.focusDistance);
        /**
         * `stabilization` says the camera has it, `stabilizationOn` says it is
         * running. The toggle needs the second and its existence needs the
         * first, so only the second is mirrored here.
         */
        setStabilizationState(next.stabilizationOn);
        setWhiteBalanceState(next.autoWhiteBalance ? AWB_AUTO : next.whiteBalance);
        setNoiseReductionState(next.noiseReduction);
        setAntiFlickerState(next.antiFlicker);
        try {
          setTorchState(Broadcaster.isTorchOn());
        } catch {
          setTorchState(false);
        }
        return;
      }
      attempts += 1;
      if (attempts < 15) timer = setTimeout(attempt, 400);
    };

    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ready, cameraGeneration]);

  const zoomRange = useMemo(
    () => ({ min: capabilities?.zoom.min ?? 1, max: capabilities?.zoom.max ?? 1 }),
    [capabilities],
  );
  /**
   * The camera counts exposure in its own steps; `evStep` is what one of them
   * is worth in EV, which is the unit the operator reads. Both travel together
   * so nothing downstream has to guess which one it is holding.
   */
  const exposureRange = useMemo(
    () => ({
      min: capabilities?.exposure.min ?? 0,
      max: capabilities?.exposure.max ?? 0,
      evStep: capabilities?.exposure.evStep ?? 0,
      lockAvailable: capabilities?.exposure.lockAvailable ?? false,
    }),
    [capabilities],
  );

  /**
   * A pinch produces sixty values a second and the lens cannot follow that, so
   * the native call is rate limited while the readout is not. The last value
   * always goes out, which is the one that matters: a zoom left one frame short
   * of where the fingers stopped is a bug the operator can see.
   */
  const zoomPending = useRef<number | null>(null);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rangeRef = useRef(zoomRange);
  rangeRef.current = zoomRange;

  /**
   * The readout at ten a second, not sixty.
   *
   * Every pinch frame set state, and state on this hook re-renders the whole
   * broadcast screen - sixty full renders a second for the length of a pinch,
   * on the same thread the pinch itself is handled on, which is why zooming
   * while live felt like pushing through mud. The lens is driven from the ref
   * as before; only the number on screen waits, and the last value always
   * lands.
   */
  const zoomShown = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomLatest = useRef(0);

  const setZoom = useCallback((level: number) => {
    const { min, max } = rangeRef.current;
    const clamped = Math.min(max, Math.max(min, level));
    zoomLatest.current = clamped;
    if (!zoomShown.current) {
      zoomShown.current = setTimeout(() => {
        zoomShown.current = null;
        setZoomState(zoomLatest.current);
      }, 100);
    }
    zoomPending.current = clamped;
    if (zoomTimer.current) return;
    const flush = () => {
      const value = zoomPending.current;
      zoomPending.current = null;
      if (value === null) {
        zoomTimer.current = null;
        return;
      }
      Broadcaster.setZoom(value).catch(() => {});
      zoomTimer.current = setTimeout(flush, 60);
    };
    flush();
  }, []);

  useEffect(
    () => () => {
      if (zoomTimer.current) clearTimeout(zoomTimer.current);
      if (zoomShown.current) clearTimeout(zoomShown.current);
    },
    [],
  );

  const focusAt = useCallback(async (x: number, y: number) => {
    setAutoFocusState(false);
    await Broadcaster.focusAt(x, y).catch(() => {});
  }, []);

  const setAutoFocus = useCallback(async (on: boolean) => {
    setAutoFocusState(on);
    await Broadcaster.setAutoFocus(on).catch(() => {});
  }, []);

  /**
   * Compensation is a correction on top of whatever the camera is doing, and
   * it applies whether or not the metering is locked - so this no longer
   * switches anything off on the operator's behalf. It used to turn auto
   * exposure off first, which on Camera2 means manual sensor control, which is
   * the one state where compensation does nothing at all.
   */
  const setExposure = useCallback(async (value: number) => {
    setExposureState(value);
    await Broadcaster.setExposure(value).catch(() => {});
  }, []);

  const setExposureLock = useCallback(async (on: boolean) => {
    setExposureLockedState(on);
    await Broadcaster.setExposureLock(on).catch(() => {});
  }, []);

  /**
   * Manual focus, in dioptres. Held here rather than read back, because
   * Camera2 has no getter for a distance this app set through the capture
   * request - the same rule as the exposure lock beside it.
   */
  const setFocusDistance = useCallback(async (dioptres: number) => {
    setFocusDistanceState(dioptres);
    setManualFocusState(true);
    await Broadcaster.setFocusDistance(dioptres).catch(() => {});
  }, []);

  const resumeAutoFocus = useCallback(async () => {
    setManualFocusState(false);
    await Broadcaster.resumeAutoFocus().catch(() => {});
  }, []);

  const setWhiteBalance = useCallback(async (mode: number) => {
    setWhiteBalanceState(mode);
    await Broadcaster.setWhiteBalance(mode).catch(() => {});
  }, []);

  /**
   * Both of these are written straight into the live capture request, so they
   * take effect on the next frame and there is nothing to confirm - the state
   * moves first and the camera is told after, as every other control here
   * does.
   */
  const setNoiseReduction = useCallback(async (mode: number) => {
    setNoiseReductionState(mode);
    await Broadcaster.setNoiseReduction(mode).catch(() => {});
  }, []);

  const setAntiFlicker = useCallback(async (mode: number) => {
    setAntiFlickerState(mode);
    await Broadcaster.setAntiFlicker(mode).catch(() => {});
  }, []);

  const setStabilization = useCallback(async (on: boolean) => {
    setStabilizationState(on);
    await Broadcaster.setStabilization(on).catch(() => {});
  }, []);

  const toggleTorch = useCallback(async () => {
    const next = !torch;
    setTorchState(next);
    await Broadcaster.setTorch(next).catch(() => setTorchState(!next));
  }, [torch]);

  const selectCamera = useCallback(async (id: string) => {
    await Broadcaster.openCamera(id).catch(() => {});
    setCameraGeneration((current) => current + 1);
  }, []);

  const flipCamera = useCallback(async () => {
    await Broadcaster.switchCamera().catch(() => {});
    setCameraGeneration((current) => current + 1);
  }, []);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    await Broadcaster.setMuted(next).catch(() => {});
    setMuted(next);
  }, [muted]);

  // --- Holding the picture, recording it, taking one frame of it ---------

  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ text: string; at: number; tone: "plain" | "bad" }>({
    text: "",
    at: 0,
    tone: "plain",
  });

  const notify = useCallback((text: string, tone: "plain" | "bad" = "plain") => {
    setNotice({ text, at: Date.now(), tone });
  }, []);

  /**
   * The shape of the broadcast, which is a different question from the way the
   * phone is being held - `auto` is only one of the three answers to it.
   *
   * The native side will not re-shape a live encoder: a stream that changes
   * resolution halfway through is letterboxed by every platform that keeps
   * taking it. So a change made on air is kept for the next broadcast rather
   * than applied to this one, and the operator hears that from us - otherwise
   * they are looking at a control that has visibly done nothing.
   */
  const setOrientation = useCallback(
    async (mode: Orientation) => {
      await Broadcaster.setOrientation(mode).catch(() => {});
      savePreferences({ orientation: mode });
      setOrientationState(mode);
      if (live) notify("The broadcast keeps its shape until the next one starts.");
    },
    [live, notify],
  );

  /**
   * Change the input without leaving the picture.
   *
   * The settings screen can do this too, and that is the wrong place for it: a
   * lapel microphone comes loose, or a headset is not being heard, in the
   * minute before a lesson or during one - and the fix was four taps away
   * behind a screen that hides the viewfinder. The operator is looking at the
   * meter when they discover the problem, so the control belongs beside the
   * meter.
   *
   * Saved as well as applied. The two places that choose a microphone must not
   * be able to disagree about which one was chosen, and the stored preference
   * is what a cold start re-applies.
   */
  const selectAudioInput = useCallback(
    async (id: number) => {
      savePreferences({ audioDeviceId: id });
      try {
        await Broadcaster.selectAudioDevice(id);
      } catch (error) {
        notify(
          error instanceof Error && error.message
            ? `That microphone was refused: ${error.message}`
            : "That microphone was refused",
          "bad",
        );
      }
    },
    [notify],
  );

  /**
   * Which microphone is actually being used.
   *
   * Picking one is also possible from here now - see `selectAudioInput` - but
   * this is the readout, and it exists because of the failure it prevents:
   * someone plugs a lapel mic in seconds before going live, nothing on screen
   * changes, and they broadcast on the phone's own microphone and find out
   * afterwards. Same class of mistake as silence, which is why the level meter
   * exists.
   */
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const chosenInput = useRef<AudioDevice | null>(null);

  /**
   * And again once the preview is actually up.
   *
   * The read on mount can land before the module has a context to answer
   * from, and the report the native side sends when the preview comes up can
   * land before this screen is listening. Neither is worth engineering a
   * handshake for; reading the list once more when the cameras arrive - which
   * is what `ready` means - costs one call and closes both gaps.
   */
  useEffect(() => {
    if (!ready) return;
    try {
      setAudioDevices(Broadcaster.audioDevices());
    } catch {
      // Then the event is the only source, which is where this started.
    }
  }, [ready]);

  const onAudioDevices = useCallback(
    (event: { nativeEvent: AudioDevicesEvent }) => {
      const { devices } = event.nativeEvent;
      setAudioDevices(devices);

      /**
       * Android does not announce that it has fallen back; it simply starts
       * using the built-in mic. An operator who chose something else has just
       * lost it and is owed the sentence.
       */
      const chosen = chosenInput.current;
      if (chosen && !devices.some((device) => device.id === chosen.id)) {
        // Some accessories report no name at all, and a sentence that starts
        // with nothing reads as a bug rather than as news.
        const lost = chosen.name || "The microphone you chose";
        notify(`${lost} is gone. The phone's own microphone is live.`, "bad");
      }

      const current = devices.find((device) => device.current) ?? null;
      chosenInput.current = current && current.kind !== "builtin" ? current : null;
    },
    [notify],
  );

  /**
   * Whatever is in use, including the phone's own.
   *
   * It used to be null for the built-in microphone, on the reasoning that a
   * chip which is always there says nothing. That held while it was only a
   * readout. It is the control now - tapping it changes the input - and a
   * control that appears only once something is already plugged in is a
   * control nobody finds, so it is always there and always says which
   * microphone the sound is coming from.
   */
  const audioInput = useMemo(
    () => audioDevices.find((device) => device.current) ?? null,
    [audioDevices],
  );


  /**
   * The microphone going quiet, and coming back.
   *
   * Held as one piece of state rather than a notice, because it persists: a
   * notice is read once and gone, and an operator who looked away during the
   * call needs the screen to still be saying it when they look back. The
   * native side only reports changes, so this is never set twice to the same
   * thing.
   */
  const [micSilence, setMicSilence] = useState<AudioInterruptedEvent | null>(null);

  const onAudioInterrupted = useCallback(
    (event: { nativeEvent: AudioInterruptedEvent }) => {
      const { silenced, reason } = event.nativeEvent;

      /**
       * A route that was put back is not an interruption to sit on the screen:
       * it is already fixed by the time this arrives, and what the operator
       * needs is to know it happened - so that an hour later they are not
       * wondering why the first minute sounds different.
       */
      if (reason === "route") {
        notify("The headset was taken by something else; putting it back", "bad");
        return;
      }
      // Sent only once Android confirms the recording is back on the chosen
      // headset - so "putting it back" is no longer the last word whether or
      // not it worked.
      if (reason === "restored") {
        notify("Back on the headset");
        return;
      }

      setMicSilence(silenced ? { silenced, reason } : null);
      if (silenced) {
        notify(
          reason === "call"
            ? "The microphone went silent - this phone is on a call"
            : reason === "headset"
              ? "The headset never opened its microphone"
              : "The microphone went silent",
          "bad",
        );
        return;
      }
      notify("The microphone is back");
    },
    [notify],
  );

  /**
   * Refused while live, and the refusal is the answer rather than a failure -
   * the screen offers the connection restart in that case, so this resolving
   * false is not an error to report twice.
   */
  const restoreMicrophone = useCallback(async () => {
    const running = await Broadcaster.restoreMicrophone().catch(() => false);
    if (!running) notify("The microphone could not be reopened", "bad");
    return running;
  }, [notify]);

  /**
   * The recorder is the authority on its own state - it can stop on its own
   * when the storage fills - so the event sets the state and the buttons only
   * ask.
   */
  const onThermal = useCallback((event: { nativeEvent: ThermalEvent }) => {
    setThermal(event.nativeEvent.status);
  }, []);

  /**
   * And read, not only heard.
   *
   * The listener speaks only on a change, and the read at mount lands before
   * the native view exists to answer it - so a phone that was already severe
   * when the app opened stayed at "cannot say" until it changed, which on a
   * phone that is simply hot it may never do. The native side logs that first
   * reading and never sends it. So it is asked for again once the view is up,
   * and again whenever the app comes back to the front, which is when a phone
   * left in the sun is picked up to go live.
   */
  useEffect(() => {
    const read = () => {
      try {
        setThermal(Broadcaster.thermal().status);
      } catch {
        // No view yet; the event or the next foreground has it.
      }
    };
    if (ready) read();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") read();
    });
    return () => subscription.remove();
  }, [ready]);

  const onRecord = useCallback(
    (event: { nativeEvent: RecordEvent }) => {
      const { recording: on, path, error } = event.nativeEvent;
      /**
       * The file list is kept outside this hook, because a recording outlives
       * the screen that made it: the start and the finish of the same path are
       * what give it a duration, and only these events see both.
       */
      noteRecordEvent(event.nativeEvent);
      setRecording(on);
      // A section closing under a take that carries on. The operator asked for
      // one recording, and the split is how it is stored, not news.
      if (on && event.nativeEvent.closedPath) return;
      if (error) {
        setRecordingSince(null);
        notify(`Recording stopped: ${error}`, "bad");
        return;
      }
      if (on) {
        setRecordingSince((current) => current ?? Date.now());
        notify("Recording to the phone");
        return;
      }
      setRecordingSince(null);
      notify(path ? `Recording saved · ${fileNameOf(path)}` : "Recording stopped");
    },
    [notify],
  );

  /**
   * Whether there is room to start a take, said out loud when there is not.
   *
   * Read now rather than trusting the poll: the disk may have filled since
   * the last one, and refusing here is cheap while a take that dies at 95%
   * is not. One function for every way a recording starts - the button, and
   * going live with "record while streaming" on - because only the button
   * used to ask, so the take that started itself with the broadcast was the
   * one that filled the phone mid-lesson.
   *
   * An unreadable disk is not a refusal: zero means the native side could not
   * say, and refusing on that would stop every recording on a phone whose
   * storage call failed once.
   */
  const roomToRecord = useCallback((): boolean => {
    const free = (() => {
      try {
        return Broadcaster.storage().usableBytes;
      } catch {
        return 0;
      }
    })();
    setUsableBytes(free);
    if (free > 0 && !canStartRecording(free)) {
      notify(tooLittleRoom(free), "bad");
      return false;
    }
    return true;
  }, [notify]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      setRecording(false);
      setRecordingSince(null);
      await Broadcaster.stopRecording().catch(() => {});
      return;
    }
    if (!roomToRecord()) return;

    try {
      const path = await Broadcaster.startRecording();
      // The event confirms this; setting it here means the red dot appears on
      // the press rather than on the round trip.
      setRecording(true);
      setRecordingSince(Date.now());
      if (path) notify("Recording to the phone");
    } catch {
      notify("The phone would not start recording", "bad");
    }
  }, [recording, notify, roomToRecord]);

  /**
   * Pause is one action because it is one intention: hold the picture and stop
   * the sound, without touching the connection - a broadcast that has to be
   * reconnected is not a pause. Nothing here calls `configure`, so there is no
   * encoder restart and nothing for the far end to notice beyond a still
   * frame.
   *
   * The microphone it releases is only the one it took. An operator who was
   * already muted before pausing stays muted afterwards, because unpausing is
   * not a request to be heard.
   */
  const mutedBeforePause = useRef(false);

  const togglePause = useCallback(async () => {
    const next = !paused;
    if (next) {
      mutedBeforePause.current = muted;
      setPaused(true);
      setPausedAt(readReadouts().uptime);
      setMuted(true);
      await Broadcaster.setVideoMuted(true).catch(() => {});
      await Broadcaster.setMuted(true).catch(() => {});
      return;
    }
    setPaused(false);
    await Broadcaster.setVideoMuted(false).catch(() => {});
    if (!mutedBeforePause.current) {
      setMuted(false);
      await Broadcaster.setMuted(false).catch(() => {});
    }
  }, [paused, muted]);

  /**
   * A pause does not outlive the broadcast it was holding.
   *
   * End, the notification's Stop, and a connection that gave up all left
   * `paused` set, with the picture held and the microphone muted on the
   * encoder - so the next broadcast opened on a frozen frame and silence,
   * under an overlay saying PAUSED for a broadcast that had not started. Any
   * way out of a broadcast lets go of the hold, and puts the microphone back
   * the way it was before the pause took it.
   *
   * Only on the way out of one: a pause taken off air, over the preview or a
   * recording, is the operator's and an idle state is not news to it.
   */
  const wasBroadcasting = useRef(false);
  useEffect(() => {
    const before = wasBroadcasting.current;
    wasBroadcasting.current =
      state === "connecting" ||
      state === "authSuccess" ||
      state === "connected" ||
      state === "reconnecting";
    const ended =
      state === "idle" || state === "failed" || state === "disconnected" || state === "authError";
    if (!before || !ended || !paused) return;
    setPaused(false);
    void Broadcaster.setVideoMuted(false).catch(() => {});
    if (!mutedBeforePause.current) {
      setMuted(false);
      void Broadcaster.setMuted(false).catch(() => {});
    }
  }, [state, paused]);

  const takePhoto = useCallback(async () => {
    try {
      const path = await Broadcaster.takePhoto();
      notify(path ? `Photo saved · ${fileNameOf(path)}` : "Photo saved");
    } catch {
      notify("The camera did not write a photo", "bad");
    }
  }, [notify]);

  // --- The log -----------------------------------------------------------

  // The log lives in the readouts store; seeded once so a reopened screen shows it.
  useState(() => setReadouts({ log: readLog() }));

  /**
   * At most once a second. Every native line used to re-render the whole
   * screen - with the Log panel shut - and a congested uplink logs a line a
   * second on its own. The panel reads the same lines, a moment later.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      setReadouts({ log: readLog() });
    };
    const unsubscribe = subscribeLog(() => {
      if (!timer) timer = setTimeout(flush, 1000);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  /**
   * The native line goes into the shared buffer rather than into this hook's
   * state, so a log written while the viewfinder is not mounted survives to be
   * read afterwards - which is exactly the log anyone wants.
   */
  const onLog = useCallback((event: { nativeEvent: LogEvent }) => {
    pushLog(event.nativeEvent);
    /**
     * Also to the console, but only on a development build. The encoder's own
     * account of what it did is the fastest way to diagnose a fault on someone
     * else's phone, and against a development server it arrives on the
     * developer's machine as it happens - rather than waiting for a screenshot
     * of a panel nobody thought to open.
     */
    if (__DEV__) {
      const { level, message } = event.nativeEvent;
      console.log(`[encoder/${level}] ${message}`);
    }
  }, []);

  /**
   * The encoder is read on a timer while live, and also while a panel is
   * showing the numbers - polling it for a readout nobody is looking at is
   * work for nothing, but the head-up display counts as looking.
   *
   * Dropped frames and the measured frame rate are the two numbers that matter
   * when a broadcast looks wrong: the bitrate can read healthy while the socket
   * quietly throws frames away, and a throttled phone reports the frame rate it
   * was configured with right up until the picture stutters.
   */
  const [statsWatched, setStatsWatched] = useState(false);

  /**
   * One clock for everything that changes once a second.
   *
   * The uptime, the recording clock and the stats each had an interval of
   * their own, started at different moments - so a live broadcast that was
   * also recording re-rendered this whole screen three times a second, out of
   * step, before anything had happened. The phone's JS thread is also the one
   * that handles pinch, focus and the rails, and an operator trying to zoom
   * while live was queueing behind those renders. One interval sets all three
   * inside the same callback, which React commits as one render.
   */
  useEffect(() => {
    const ticking = startedAt !== null || recordingSince !== null || live || statsWatched;
    if (!ticking) {
      setReadouts({ uptime: 0, recordSeconds: 0 });
      return;
    }
    const tick = () => {
      const now = Date.now();
      setReadouts({
        uptime: startedAt === null ? 0 : Math.floor((now - startedAt) / 1000),
        recordSeconds: recordingSince === null ? 0 : Math.floor((now - recordingSince) / 1000),
      });
      if (!live && !statsWatched) return;
      // Pushed while live (onStats); poll only when that has gone quiet.
      if (live && now - lastStatsEventAt.current < 2500) return;
      try {
        const next = Broadcaster.stats();
        setReadouts({ stats: next });
        setDropped(next.droppedVideoFrames);
      } catch {
        // Reading stats between a stop and a start is not an error worth
        // showing anyone.
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt, recordingSince, live, statsWatched]);

  /**
   * Going live, and the one thing it must never do is fail in silence.
   *
   * Both halves throw, and each strands the screen in its own way: a camera
   * that will not configure throws before the state has moved, so the
   * countdown runs down and nothing at all happens; a server that will not
   * take the connection throws after it, leaving a "Connecting" chip up for
   * ever. Neither has a caller that could catch it - going live is started
   * from a timer and from a banner button - so the failure is closed out here,
   * in the same state the native side reports its own failures in, which is
   * the state the banner already draws.
   */
  const start = useCallback(async (connection: Connection) => {
    setLostAir(false);
    resetDrops();
    inBroadcast.current = true;
    reachedAir.current = false;
    let resumeRecording = false;
    try {
      /**
       * The destination decides the picture; the phone decides the audio and
       * how it behaves on a bad network. Both are applied in one call, because
       * configuring the encoder takes the camera down briefly and doing it
       * twice would be two flickers for no reason.
       */
      const settings = { ...loadSettings(), ...pictureFor(connection) };

      /**
       * Unless an off-air recording already owns the encoder.
       *
       * A configure under a running recorder is stored and applied to nothing -
       * the encoder cannot be rebuilt under a file being written - so going
       * live mid-recording sent the recording's picture to the destination, at
       * whatever size and rate the recording happened to start with, and the
       * destination's own settings were quietly ignored. If the two agree the
       * recording carries on and nothing is lost; if they do not, the
       * destination wins, because the broadcast is the job: the take is closed,
       * and a new one starts once the stream is up.
       */
      if (isRecordingNow() && !isStreamingNow()) {
        const running = (() => {
          try {
            return Broadcaster.encoderPicture();
          } catch {
            return null;
          }
        })();
        if (!running || !samePicture(running, settings)) {
          pushLog({
            at: Date.now(),
            level: "info",
            message:
              "The off-air recording was running at a different picture from this destination's, so " +
              "it was closed to go live at the destination's settings. A new recording starts with the broadcast.",
          });
          await Broadcaster.stopRecording().catch(() => {});
          resumeRecording = true;
        }
      }

      await Broadcaster.configure(settings);
      /**
       * SRT's latency and passphrase belong to the socket, not the encoder, and
       * have to be in place before it is opened - a passphrase applied after the
       * handshake encrypts nothing, which is worse than not offering one. RTMP
       * and RTMPS carry neither.
       *
       * Not swallowed. A refusal here used to be caught and ignored, which left
       * whatever passphrase the native side already held - another
       * destination's - to be used for this one.
       */
      if (connection.protocol === "srt") {
        await Broadcaster.setSrtOptions(srtOptionsFor(connection));
      }
      setState("connecting");
      await Broadcaster.startStream(endpointFor(connection));
      /**
       * The phone's copy, for an operator who has asked for one every time - or
       * the take that was closed above to make way for this picture. It is
       * started after the stream rather than before, because the broadcast is
       * the job: a recorder that refuses must not be the reason nobody went on
       * air. The record event puts the indicator up.
       */
      if ((resumeRecording || loadPreferences().recordWhileStreaming) && roomToRecord()) {
        await Broadcaster.startRecording().catch(() => {});
      }
    } catch (error) {
      inBroadcast.current = false;
      /**
       * The take closed to make way for a broadcast that then would not start
       * comes back, as a new section. The operator asked for a recording and
       * nothing they did since asked for it to end.
       */
      if (resumeRecording && roomToRecord()) await Broadcaster.startRecording().catch(() => {});
      const reason = reasonFor(error);
      setState("failed");
      setDetail(reason);
      setReadouts({ bitrate: 0 });
      setStartedAt(null);
      // The log is where this is read back afterwards; the banner is where it
      // is read now.
      pushLog({
        at: Date.now(),
        level: "error",
        message: `The broadcast would not start: ${reason}`,
      });
    }
  }, [roomToRecord, resetDrops]);

  const stop = useCallback(async () => {
    if (retry.current) clearTimeout(retry.current);
    /**
     * Before the native call, not after it. The encoder reports `disconnected`
     * while it is stopping, and that event has to find the broadcast already
     * ended on purpose - otherwise every End would be announced as the phone
     * having dropped off air.
     */
    inBroadcast.current = false;
    reachedAir.current = false;
    setLostAir(false);
    await Broadcaster.stopStream();
    setState("idle");
    setStartedAt(null);
    setReadouts({ bitrate: 0 });
    /**
     * Ending the broadcast stops the microphone with it, which would leave the
     * meter dead for the next one. Take it back for monitoring.
     */
    await Broadcaster.monitorAudio(true).catch(() => {});
  }, []);

  /**
   * Read every half minute, and every five seconds while live. A battery does
   * not move fast enough to watch, but an encoder, a radio and a lit screen
   * together empty one quickly enough that an operator wants to see it going.
   */
  useEffect(() => {
    const read = () => {
      try {
        const next = Broadcaster.power();
        setCharge((current) =>
          current.level === next.level && current.charging === next.charging ? current : next,
        );
      } catch {
        // No preview mounted yet; the next tick has it.
      }
    };
    read();
    const timer = setInterval(read, live ? 5000 : 30000);
    return () => clearInterval(timer);
    /**
     * `ready` as well as `live`, so the first real reading lands the moment the
     * native view exists rather than up to half a minute later.
     *
     * With no preview mounted the native side answers a safe "full, not
     * charging" - which is the right answer for a screen that is not showing a
     * camera, and the wrong one to leave on screen for thirty seconds after the
     * camera arrives.
     */
  }, [live, ready]);

  /**
   * Room on the phone, read every fifteen seconds while a take is running and
   * once otherwise.
   *
   * It is a statvfs call, which costs nothing, but there is no point asking
   * repeatedly while nothing is being written - the number cannot move on this
   * app's account, and anything else filling the disk is a slower problem than
   * the one this guard exists for.
   */
  useEffect(() => {
    const read = () => {
      try {
        setUsableBytes(Broadcaster.storage().usableBytes);
      } catch {
        // No preview mounted yet. Zero would read as "no room at all" and put
        // a warning on a screen that has not started, so the last known
        // reading stands.
      }
    };
    read();
    if (!recording) return;
    const timer = setInterval(read, 15000);
    return () => clearInterval(timer);
  }, [recording]);


  /**
   * A socket that fails is the native side's problem and it reconnects. A
   * socket that stays open while nothing goes through it is nobody's problem
   * yet, and it is what a phone on a dead cell looks like: the state is still
   * `connected`, the bitrate events simply stop. Eight seconds of silence on
   * an event that arrives every second is not a hiccup.
   *
   * Detected, not acted on. Tearing a broadcast down and rebuilding it from a
   * timer the operator cannot see is a worse failure than the one it fixes -
   * and if the silence is the platform's end pausing, restarting makes it
   * worse. So the operator is told, and given the button.
   */
  /**
   * Connected only, not reconnecting.
   *
   * No bitrate events arrive while the phone is dialling back in, so a stall
   * timer running through a reconnect went off after eight seconds and told
   * the operator "the connection is still open" - while it was plainly not -
   * with a Restart button whose stop ended the phone's recording. A reconnect
   * already says what it is doing; the stall warning is for a connection that
   * claims to be up and is carrying nothing.
   */
  const connected = state === "connected";
  useEffect(() => {
    if (!connected) {
      setStalled(false);
      return;
    }
    lastBitrateAt.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - lastBitrateAt.current > STALL_AFTER_MS) setStalled(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [connected]);

  /**
   * End the connection and dial it again, which is the only cure for a stall
   * that is the phone's own fault. Kept here rather than left to the screen so
   * the order is not up for debate: a start on top of a live stream is a
   * configure on a camera that is already busy.
   */
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  /**
   * And the phone's recording comes back too.
   *
   * Stopping ends the recording, and the start only begins a new one when
   * "record while streaming" is on - so a take the operator had started by
   * hand was ended for good by a restart, which is the recording that
   * "stopped too" on a bad network. It starts again here as a new section;
   * the minutes before the restart are already safe in the last file.
   */
  const restart = useCallback(
    async (connection: Connection) => {
      const wasRecording = recordingRef.current;
      await stop().catch(() => {});
      await start(connection);
      if (wasRecording && !loadPreferences().recordWhileStreaming && roomToRecord()) {
        await Broadcaster.startRecording().catch(() => {});
      }
    },
    [start, stop, roomToRecord],
  );

  return {
    state,
    detail,
    reconnects,
    lastDrop,
    lostAir,
    dismissLostAir,
    congested,
    stalled,
    dropped,
    setStatsWatched,
    live,
    muted,
    cameras,
    charge,
    orientation,
    ready,
    audioDevices,
    audioInput,
    selectAudioInput,
    start,
    stop,
    restart,
    selectCamera,
    setOrientation,
    toggleMute,
    onStatus,
    onBitrate,
    onStats,
    onLevel,
    onCameras,
    onAudioDevices,

    capabilities,
    zoom,
    zoomRange,
    setZoom,
    autoFocus,
    focusAt,
    setAutoFocus,
    exposure,
    exposureLocked,
    exposureRange,
    setExposure,
    setExposureLock,
    focusDistance,
    manualFocus,
    setFocusDistance,
    resumeAutoFocus,
    whiteBalance,
    setWhiteBalance,
    noiseReduction,
    setNoiseReduction,
    antiFlicker,
    setAntiFlicker,
    stabilization,
    setStabilization,
    torch,
    toggleTorch,
    flipCamera,

    paused,
    pausedAt,
    togglePause,
    recording,
    toggleRecording,
    onRecord,
    onThermal,
    thermal,
    usableBytes,
    micSilence,
    onAudioInterrupted,
    restoreMicrophone,
    takePhoto,
    notice,

    onLog,
  };
}

function pictureFor(connection: Connection) {
  return {
    width: connection.width,
    height: connection.height,
    fps: connection.fps,
    videoBitrate: connection.videoBitrate,
  };
}

/**
 * Asked of the encoder rather than of this hook's state, because the decision
 * they feed has to be about what the encoder is doing at this instant - the
 * record event that sets `recording` arrives a round trip later.
 */
function isRecordingNow(): boolean {
  try {
    return Broadcaster.isRecording();
  } catch {
    return false;
  }
}

function isStreamingNow(): boolean {
  try {
    return Broadcaster.isStreaming();
  } catch {
    return false;
  }
}

/**
 * Whether the encoder already produces what this destination asks for: the
 * size, the frame rate, the codec and the bitrate, which are the four things
 * a configure would have changed. Audio is the phone's, not the
 * destination's, so the recording already has the right audio.
 */
function samePicture(
  running: Broadcaster.EncoderPicture,
  wanted: Pick<EncoderSettings, "width" | "height" | "fps" | "videoBitrate" | "videoCodec">,
): boolean {
  return (
    running.width === wanted.width &&
    running.height === wanted.height &&
    running.fps === wanted.fps &&
    running.videoBitrate === wanted.videoBitrate &&
    running.videoCodec === wanted.videoCodec
  );
}

/** A full path is unreadable on a chip and the name is the part that helps. */
function fileNameOf(path: string): string {
  return path.split("/").pop() ?? path;
}

/** `00:07` / `1:04:22`, the way a stopwatch reads. */
export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
