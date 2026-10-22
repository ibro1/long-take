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

function write(): void {
  try {
    setItem(STORE_KEY, entries);
  } catch {
    // A full disk must not take the broadcast down with the log.
  }
}

/**
 * Written at most every two seconds. A congested broadcast logs several lines a
 * second, and a write per line is work the phone does for nothing while it is
 * already the thing getting hot.
 */
function save(): void {
  if (saving) return;
  saving = setTimeout(() => {
    saving = undefined;
    write();
  }, 2000);
}

/**
 * Written now, and the pending write with it.
 *
 * An error is the line most likely to be followed by the process dying - the
 * encoder that failed is often what takes the app down a moment later - and
 * the two-second wait meant the crash took the line with it. The log kept
 * across restarts exists to answer "why did that broadcast end", and it was
 * losing exactly the lines that answer it. Errors are rare enough that a write
 * each costs nothing worth measuring.
 */
function saveNow(): void {
  if (saving) {
    clearTimeout(saving);
    saving = undefined;
  }
  write();
}

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
  if (entry.level === "error") saveNow();
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
