import { AppState } from "react-native";

import { scrub } from "@/lib/scrub";
import { getItem, setItem } from "@/lib/storage";
import type { LogEntry } from "@/modules/framevane-broadcaster";

/**
 * What the encoder said, kept where the whole app can read it.
 *
 * This is module-level rather than a hook or a context on purpose. Log lines
 * arrive from the native view, which only exists while the viewfinder is on
 * screen, and the reason anyone opens a log is to find out why a broadcast
 * failed - which they do after leaving the viewfinder. State that unmounts
 * with the screen would throw away the only copy of the answer.
 *
 * It is kept across restarts. It used to be memory only, on the reasoning that
 * yesterday's failures only make the screen harder to read - and then a class
 * was lost, the app was reopened to look at why, and the one record of it had
 * gone with the process. What makes yesterday readable is not deleting it but
 * saying where today starts: every cold start writes an "App started" line,
 * and the screen shows when each line was written.
 */

/**
 * Enough to cover a long broadcast's worth of connection events and a burst of
 * congestion warnings, and small enough that holding it all in memory costs
 * nothing worth measuring.
 */
const CAPACITY = 400;

const STORE_KEY = "broadcast.log.v1";

/** A line is read, not studied; this also bounds what a runaway message can cost. */
const MAX_MESSAGE = 300;

/**
 * Scrubbed on the way in as well as on the way out. The rule above says never
 * to pass a key through here, and a rule that depends on every caller
 * remembering it is the one that eventually fails - now that this outlives the
 * process, a single slip would sit on the phone until somebody cleared it.
 */
function clean(entry: LogEntry): LogEntry {
  return { ...entry, message: scrub(entry.message).slice(0, MAX_MESSAGE) };
}

function restore(): LogEntry[] {
  const saved = getItem<LogEntry[]>(STORE_KEY);
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((e) => e && typeof e.at === "number" && typeof e.message === "string")
    .slice(-CAPACITY)
    .map(clean);
}

let entries: LogEntry[] = restore();
const listeners = new Set<() => void>();

let saving: ReturnType<typeof setTimeout> | undefined;
let lastWrite = 0;

/**
 * Ten seconds between writes. Each one serialises all 400 lines on the JS
 * thread, and during an hour-long class that thread was saturated; a log write
 * every two seconds was a share of it spent on a record nobody reads until
 * afterwards. Going to the background writes at once (below), so the window
 * this leaves is a crash inside ten seconds of the last write.
 */
const SAVE_EVERY_MS = 10_000;

function write(): void {
  if (saving) {
    clearTimeout(saving);
    saving = undefined;
  }
  lastWrite = Date.now();
  try {
    setItem(STORE_KEY, entries);
  } catch {
    // A full disk must not take the broadcast down with the log.
  }
}

/** At most one write per window, however many lines arrive in it. */
function save(): void {
  if (saving) return;
  saving = setTimeout(write, SAVE_EVERY_MS);
}

/**
 * An error line, written now unless a write already happened in the window.
 *
 * An error is the line most likely to be followed by the process dying - the
 * encoder that failed is often what takes the app down a moment later - so it
 * jumps the queue. But a failing encoder can log an error a second, and a write
 * per error was the same per-line cost the window exists to stop; inside the
 * window it waits for the scheduled write like any other line.
 */
function saveSoon(): void {
  if (Date.now() - lastWrite > SAVE_EVERY_MS) write();
  else save();
}

/**
 * Written as the app leaves the foreground: Android may kill a backgrounded
 * process without another JS tick, and a pending write would go with it.
 */
AppState.addEventListener("change", (next) => {
  if ((next === "background" || next === "inactive") && saving) write();
});

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Never pass a stream URL or a stream key through here. The key is the one
 * credential the phone carries, and a log is the thing operators screenshot
 * and send to someone else when a broadcast fails.
 */
export function pushLog(entry: LogEntry): void {
  entries.push(clean(entry));
  if (entries.length > CAPACITY) entries = entries.slice(-CAPACITY);
  if (entry.level === "error") saveSoon();
  else save();
  announce();
}

/** The newest `count` lines, oldest first, for sending to the studio. */
export function recentLog(count: number): LogEntry[] {
  return entries.slice(-count);
}

/** Newest first, which is the order anyone diagnosing a failure reads in. */
export function readLog(): LogEntry[] {
  return [...entries].reverse();
}

export function subscribeLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearLog(): void {
  entries = [];
  save();
  announce();
}

// Where today starts, so lines kept from before it are read as before it.
pushLog({ at: Date.now(), level: "info", message: "App started" });
