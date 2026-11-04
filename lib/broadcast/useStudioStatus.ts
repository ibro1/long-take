import { useEffect, useRef } from "react";

import { controlChannelFor, getStudioStatus } from "./overlays";
import { publishStudioStatus } from "./studio-status.ts";
import type { Connection } from "./types";

/**
 * Every thirty seconds, which is what the studio's telemetry budget is sized
 * for and fast enough that an event stuck short of live is noticed inside the
 * first minute of a class.
 */
const EVERY_MS = 30_000;

/**
 * The first ask, ten seconds after going live: long enough for the studio to
 * have opened the run and asked YouTube once, so the first answer is about this
 * broadcast rather than an empty one that clears the chip for half a minute.
 */
const FIRST_AFTER_MS = 10_000;

/**
 * Asks the studio whether each platform is on air, for as long as this phone
 * is live to a destination that goes through Framevane.
 *
 * Shaped like `useHealthHeartbeat`: the connection is read through a ref so a
 * new object with the same id does not restart the timers, one request is in
 * flight at a time, and a failure says nothing - the last answer stands, which
 * on a phone uplink is the right default. The answer goes to the store in
 * `studio-status.ts` and nowhere else, so a poll costs one chip a render and
 * the viewfinder nothing.
 *
 * Off air, or to a destination with no studio behind it, the store is cleared:
 * a chip left saying "YouTube: live" over a stopped broadcast is the kind of
 * screen that reads as a lie.
 */
export function useStudioStatus({ connection, live }: { connection: Connection | null; live: boolean }): void {
  const latest = useRef(connection);
  latest.current = connection;
  const asking = useRef(false);

  const paired = controlChannelFor(connection) !== null;
  const connectionId = connection?.id ?? null;

  useEffect(() => {
    if (!paired || !connectionId) {
      publishStudioStatus(null);
      return;
    }

    let stopped = false;
    const ask = async () => {
      const current = latest.current;
      if (!current || asking.current) return;
      asking.current = true;
      try {
        const result = await getStudioStatus(current);
        if (!stopped && result.ok) publishStudioStatus(result.value);
      } finally {
        asking.current = false;
      }
    };

    if (live) {
      const first = setTimeout(() => void ask(), FIRST_AFTER_MS);
      const timer = setInterval(() => void ask(), EVERY_MS);
      return () => {
        stopped = true;
        clearTimeout(first);
        clearInterval(timer);
      };
    }

    // Off air: ask once so lastBroadcast / watchUrl is known for sharing,
    // and when open is false StudioChip renders nothing.
    void ask();
    return () => {
      stopped = true;
    };
  }, [live, paired, connectionId]);
}
