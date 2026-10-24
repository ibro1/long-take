import { useEffect } from "react";
import { AppState } from "react-native";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";

import { appendPerfRow, type PerfRow, usePerfLog } from "@/lib/diagnostics/perf-log";
import * as Broadcaster from "@/modules/framevane-broadcaster";

/** Often enough to see a class degrade, rarely enough that writing it is free. */
const SAMPLE_MS = 10_000;

type HermesStats = { js_heapSize?: number };
type HermesGlobal = {
  HermesInternal?: { getInstrumentedStats?: () => HermesStats } | null;
};

/**
 * The performance log's sampler. Mounted once at the root and draws nothing.
 *
 * While the switch is off it is this one component and an MMKV listener: no
 * frame counters, no timer, no native calls. The counters live in a child that
 * only mounts when the switch is on, so turning it off tears them down too.
 */
export function PerfProbe() {
  const on = usePerfLog();
  return on ? <PerfSampler /> : null;
}

function PerfSampler() {
  // Counted on the UI thread, read from JS once a window. The UI thread is
  // where the viewfinder's animations run; it can be fine while JS is not, and
  // telling the two apart is the point of having both numbers.
  const uiFrames = useSharedValue(0);
  useFrameCallback(() => {
    "worklet";
    uiFrames.value += 1;
  });

  useEffect(() => {
    // A requestAnimationFrame that only counts: when the JS thread is busy the
    // callbacks arrive late and the count falls, which is the saturation we
    // are trying to see.
    let jsFrames = 0;
    let frame = requestAnimationFrame(function tick() {
      jsFrames += 1;
      frame = requestAnimationFrame(tick);
    });

    let windowStart = Date.now();
    let uiStart = readShared(() => uiFrames.value);

    const timer = setInterval(() => {
      const now = Date.now();
      const seconds = Math.max(0.001, (now - windowStart) / 1000);
      const ui = readShared(() => uiFrames.value);
      const jsFps = jsFrames / seconds;
      const uiFps = ui === null || uiStart === null ? null : (ui - uiStart) / seconds;
      jsFrames = 0;
      windowStart = now;
      uiStart = ui;
      try {
        appendPerfRow(sample(now, jsFps, uiFps));
      } catch {
        // A full disk or a missing directory loses a row, never the class.
      }
    }, SAMPLE_MS);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, [uiFrames]);

  return null;
}

function readShared(read: () => number): number | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/**
 * Each native call on its own guard, so a build or a moment where one throws
 * still records the rest - and an empty cell says "could not tell" rather than
 * a zero that reads as a measurement.
 */
function sample(now: number, jsFps: number, uiFps: number | null): PerfRow {
  let thermal = "";
  try {
    thermal = String(Broadcaster.thermal().status);
  } catch {
    // No preview, or no such function in this build.
  }

  let batteryLevel = "";
  let charging = "";
  try {
    const power = Broadcaster.power();
    batteryLevel = power.level.toFixed(2);
    charging = power.charging ? "1" : "0";
  } catch {
    // The same.
  }

  let live = false;
  try {
    live = Broadcaster.isStreaming();
  } catch {
    // Nothing is going out.
  }

  let encoderFps = "";
  let dropped = "";
  let bitrateKbps = "";
  if (live) {
    try {
      const stats = Broadcaster.stats();
      encoderFps = stats.measuredFps.toFixed(1);
      dropped = String(stats.droppedVideoFrames);
      bitrateKbps = String(Math.round(stats.bitrate / 1000));
    } catch {
      // Stopped between the two calls.
    }
  }

  let heap = "";
  try {
    const bytes = (globalThis as unknown as HermesGlobal).HermesInternal?.getInstrumentedStats?.()
      .js_heapSize;
    if (typeof bytes === "number") heap = (bytes / 1e6).toFixed(1);
  } catch {
    // Not Hermes, or a Hermes without instrumented stats.
  }

  return {
    iso_time: new Date(now).toISOString(),
    thermal,
    battery_level: batteryLevel,
    charging,
    js_fps: jsFps.toFixed(1),
    ui_fps: uiFps === null ? "" : uiFps.toFixed(1),
    js_heap_mb: heap,
    encoder_fps: encoderFps,
    dropped,
    bitrate_kbps: bitrateKbps,
    live: live ? "1" : "0",
    // Frames stop while the app is in the background, so a zero frame rate
    // there is the app being away, not frozen.
    app_state: AppState.currentState,
  };
}
