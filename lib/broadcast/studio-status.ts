/**
 * Whether each platform is actually on air, as the studio last said.
 *
 * The phone can see its own connection and nothing past it. A class could go
 * out for an hour to a healthy ingest while the YouTube event never went live -
 * video flowing, nobody watching, and the operator holding a phone that said
 * everything was fine. The studio can ask YouTube; this is where its answer is
 * kept and judged.
 *
 * Kept outside React state, like the level meter. The answer arrives every
 * thirty seconds and exactly one chip draws it, so it is published here and
 * read there, and the rest of the viewfinder does not re-render to find out
 * nothing changed.
 *
 * Pure apart from the store, so the judgement is tested without a phone.
 */

export type PlatformStatus = {
  platform: string;
  status: string;
  watchUrl?: string | null;
};

export type StudioStatus = {
  /** A run is open in the studio for this stream. */
  open: boolean;
  /** The studio is holding the run open for a phone that went quiet. */
  waiting: boolean;
  platforms: PlatformStatus[];
  /** Latest completed broadcast info, if any. */
  lastBroadcast?: {
    startedAt: string | Date;
    endedAt: string | Date | null;
    platforms: PlatformStatus[];
  } | null;
};

/** Trusted only as far as it parses; an entry missing either field is dropped. */
export function studioStatusFrom(value: unknown): StudioStatus | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    open?: unknown;
    waiting?: unknown;
    platforms?: unknown;
    lastBroadcast?: unknown;
  };
  if (typeof raw.open !== "boolean") return null;

  const parsePlatforms = (input: unknown): PlatformStatus[] =>
    Array.isArray(input)
      ? input.flatMap((entry) => {
          const row = entry as Partial<PlatformStatus> | null;
          return row && typeof row.platform === "string" && typeof row.status === "string"
            ? [
                {
                  platform: row.platform,
                  status: row.status,
                  watchUrl: typeof row.watchUrl === "string" ? row.watchUrl : null,
                },
              ]
            : [];
        })
      : [];

  const platforms = parsePlatforms(raw.platforms);

  let lastBroadcast: StudioStatus["lastBroadcast"] = null;
  if (raw.lastBroadcast && typeof raw.lastBroadcast === "object") {
    const lb = raw.lastBroadcast as Record<string, unknown>;
    lastBroadcast = {
      startedAt: (lb.startedAt as string | Date) ?? "",
      endedAt: (lb.endedAt as string | Date | null) ?? null,
      platforms: parsePlatforms(lb.platforms),
    };
  }

  return { open: raw.open, waiting: raw.waiting === true, platforms, lastBroadcast };
}

/**
 * Returns the best public viewer URL (e.g. YouTube Live link) available from
 * the studio status, checking the active live platforms first and falling back
 * to the most recent broadcast.
 */
export function activeWatchUrl(status: StudioStatus | null): string | null {
  if (!status) return null;
  const liveUrl = status.platforms.find((p) => p.watchUrl)?.watchUrl;
  if (liveUrl) return liveUrl;
  return status.lastBroadcast?.platforms.find((p) => p.watchUrl)?.watchUrl ?? null;
}

export type ChipWord = "live" | "waiting" | "starting" | "ended" | "unpublished";

export type PlatformChip = {
  /** The platform as a person names it: "YouTube", not "youtube". */
  name: string;
  word: ChipWord;
  tone: "good" | "warn" | "plain";
};

/**
 * How long a phone can be connected before an event that is still not live
 * stops being "starting" and becomes the fault this exists to catch. YouTube
 * takes a few seconds to see the stream and the studio polls it on its own
 * clock; forty-five seconds covers both with room, and is still well inside
 * the first minute of a class.
 */
export const SETTLE_SECONDS = 45;

/**
 * A yes or no rather than the seconds themselves, so the chip that asks is
 * re-rendered once when the answer flips and not on every tick of the clock.
 */
export function isSettled(connectedSeconds: number): boolean {
  return connectedSeconds > SETTLE_SECONDS;
}

const NAMES: Record<string, string> = { youtube: "YouTube", facebook: "Facebook" };

/** YouTube's lifeCycleStatus values that mean the event is over. */
const ENDED = new Set(["complete", "revoked"]);

/**
 * One chip entry per platform the studio can actually vouch for. `settled` is
 * whether the phone has been connected longer than SETTLE_SECONDS.
 *
 * Only YouTube is judged on every status. Its status is what the studio last
 * heard from YouTube, so a value short of `live` while the phone has been up
 * for a while is the failure worth turning amber for.
 *
 * Facebook is not polled: its stored status is what was written when the
 * event was made - `created` or `unpublished` - and never changes. Turning
 * that amber after forty-five seconds would cry wolf on every Facebook
 * broadcast, so it is shown only when it says something true: live, or
 * deliberately unpublished. Anything else from any other platform is left
 * off, because a status nobody is checking is not a status.
 */
export function platformChips(status: StudioStatus | null, settled: boolean): PlatformChip[] {
  if (!status?.open) return [];
  return status.platforms.flatMap((entry): PlatformChip[] => {
    const platform = entry.platform.toLowerCase();
    const value = entry.status.toLowerCase();
    const name = NAMES[platform] ?? entry.platform;
    if (value === "live" || value === "live_now") return [{ name, word: "live", tone: "good" }];
    if (platform === "youtube") {
      if (ENDED.has(value)) return [{ name, word: "ended", tone: settled ? "warn" : "plain" }];
      return settled
        ? [{ name, word: "waiting", tone: "warn" }]
        : [{ name, word: "starting", tone: "plain" }];
    }
    if (value === "unpublished") return [{ name, word: "unpublished", tone: "plain" }];
    return [];
  });
}

let snapshot: StudioStatus | null = null;
const listeners = new Set<() => void>();

export function publishStudioStatus(next: StudioStatus | null): void {
  // A poll that changed nothing is not worth waking the chip for.
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeStudioStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function studioStatusSnapshot(): StudioStatus | null {
  return snapshot;
}
