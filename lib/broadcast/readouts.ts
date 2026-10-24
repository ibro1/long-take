import { useSyncExternalStore } from "react";

import type { BroadcastStats, LogEntry } from "@/modules/framevane-broadcaster";

/**
 * The broadcast's running numbers, kept outside React state on purpose - the
 * same reasoning as level-store.ts, one size up.
 *
 * Bitrate, the clocks, the encoder's stats and the log all change about once a
 * second while live. Held in useBroadcast's state, each change re-rendered the
 * whole viewfinder - two to three full renders a second with nobody touching
 * anything - on the one JavaScript thread that the meter and every drag also
 * need. Over an hour-long class on a warm phone that thread fell behind, and
 * the meter froze and the reticles stopped following the finger.
 *
 * So the numbers live here and the few pieces that draw them subscribe to
 * exactly the value they show. A selector that turns a number into something
 * coarser - "has the studio settled", "which minute of the take" - re-renders
 * its reader only when that coarser answer changes.
 */

export type Readouts = {
  /** What the encoder reports leaving, bits per second. */
  bitrate: number;
  /** Seconds since the broadcast started, 0 off air. */
  uptime: number;
  /** Seconds since the recording started, 0 when not recording. */
  recordSeconds: number;
  /** The encoder's own numbers, while live or while the stats panel is open. */
  stats: BroadcastStats | null;
  /** Newest first, as the log panel shows it. */
  log: LogEntry[];
  /** The sensor's actual ISO, from capture results; null until reported. */
  iso: number | null;
  /** The sensor's actual exposure time in nanoseconds; null until reported. */
  exposureNs: number | null;
};

let current: Readouts = {
  bitrate: 0,
  uptime: 0,
  recordSeconds: 0,
  stats: null,
  log: [],
  iso: null,
  exposureNs: null,
};
const listeners = new Set<() => void>();

/** Merge in what changed; listeners hear about it only if something did. */
export function setReadouts(patch: Partial<Readouts>): void {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof Readouts)[]) {
    if (!Object.is(current[key], patch[key])) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  current = { ...current, ...patch };
  for (const listener of listeners) listener();
}

/** The latest values, for code that needs them at one moment rather than over time. */
export function readReadouts(): Readouts {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One value, re-rendering only when it changes. The selector must return a
 * primitive or a reference already held in the store - never a new object or
 * array, which would differ on every read and loop.
 */
export function useReadout<T>(select: (readouts: Readouts) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(current),
    () => select(current),
  );
}
