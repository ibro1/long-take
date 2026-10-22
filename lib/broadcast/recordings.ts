import { getItem, setItem } from "@/lib/storage";
import type { RecordEvent } from "@/modules/framevane-broadcaster";

/**
 * How long each recording runs for.
 *
 * The list of recordings themselves comes from `Broadcaster.recordings()`,
 * which reads the disk - the file is the truth, and a list this app kept went
 * stale the moment anything else deleted one. But a file on disk does not say
 * how long it plays for without parsing the container, and the native side
 * does not, so the one thing left here is the duration: measured from the
 * recorder's own start and stop events and remembered against the path.
 *
 * A recording with no entry - made before this existed, or made while the app
 * was killed mid-recording - simply has no duration shown. That is better
 * than a guess, and it is why nothing else depends on this table.
 */

const KEY = "framevane.recordingDurations";
/**
 * The start time has to outlive the screen. A recording begins on the
 * viewfinder and the `onRecord` event that closes it can arrive after the
 * operator has walked through two other tabs, so the open recording is
 * written down rather than held in a component.
 */
const IN_FLIGHT_KEY = "framevane.recordingInFlight";

/** A long broadcast day. Older entries only pin memory for files long gone. */
const CAPACITY = 100;

type Durations = { path: string; durationMs: number }[];

function durations(): Durations {
  return getItem<Durations>(KEY) ?? [];
}

type InFlight = { path: string; startedAt: number };

function remember(path: string, durationMs: number): void {
  const rest = durations().filter((entry) => entry.path !== path);
  setItem(KEY, [{ path, durationMs }, ...rest].slice(0, CAPACITY));
}

/**
 * Feed this every `onRecord` event.
 *
 * The native side says which file an event closed and how long it ran, by
 * its own clock, so a split take gets a duration for every section rather
 * than only the last: a split used to be invisible here - its stop was kept
 * from the screen, and the next section's start overwrote the open entry - so
 * every section but the final one came back with no duration at all. The
 * start-to-stop clock below remains for events that do not carry a duration,
 * which is a recorder failing and anything from a build before this.
 */
export function noteRecordEvent(event: RecordEvent): void {
  const open = getItem<InFlight>(IN_FLIGHT_KEY);
  const closed = event.closedPath ?? "";

  if (closed) {
    const measured =
      event.closedMs && event.closedMs > 0
        ? event.closedMs
        : open?.path === closed
          ? Date.now() - open.startedAt
          : 0;
    if (measured > 0) remember(closed, measured);
    if (open?.path === closed) setItem(IN_FLIGHT_KEY, null);
  }

  if (!event.path) return;

  if (event.recording) {
    // The recorder reports a start more than once - started, then resumed -
    // and restarting the clock on the second would shorten the file by the
    // gap between them.
    if (open?.path === event.path) return;
    setItem(IN_FLIGHT_KEY, { path: event.path, startedAt: Date.now() });
    return;
  }

  // Already measured above.
  if (closed === event.path) return;

  setItem(IN_FLIGHT_KEY, null);
  // Nothing sensible to record when the start was never seen - the app was
  // not running for it - and a duration of "however long this screen has been
  // open" would be a lie rather than a gap.
  if (open?.path !== event.path) return;
  remember(event.path, Date.now() - open.startedAt);
}

/** Milliseconds, or null when this recording was not made under our clock. */
export function durationOf(path: string): number | null {
  return durations().find((entry) => entry.path === path)?.durationMs ?? null;
}

/** Called after the file itself is deleted, so the table does not outlive it. */
export function forgetDuration(path: string): void {
  setItem(
    KEY,
    durations().filter((entry) => entry.path !== path),
  );
}

/** `4:07` / `1:12:40`. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Sizes as an operator reads them when deciding what to delete: whole
 * megabytes, because a tenth of a megabyte has never changed anyone's mind.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
