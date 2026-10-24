import { useEffect, useRef } from "react";

import { buildHealthReport } from "./health";
import { pushLog } from "./log";
import { postHealth } from "./overlays";
import { readReadouts } from "./readouts";
import type { Connection } from "./types";

/**
 * How often a live phone reports. Fifteen seconds is slow enough to cost
 * nothing worth measuring - a few hundred bytes - and fast enough that a phone
 * which has gone quiet is noticed within the minute.
 */
const EVERY_MS = 15_000;

/** Three misses in a row is a pattern; one is a tunnel. */
const SAY_AFTER_FAILURES = 3;

type Inputs = {
  connection: Connection | null;
  live: boolean;
  state: string;
  thermal: number;
  charge: { level: number; charging: boolean };
  reconnects: number;
  lastDrop: string;
};

/**
 * Tells the studio how the phone is doing, for as long as it is live.
 *
 * It reads the latest values through a ref instead of re-subscribing on every
 * change, and the encoder's stats straight from the readouts store at the
 * moment of sending: they change every second, and neither this timer nor the
 * screen around it should be woken for that.
 *
 * A change in the thermal state is sent at once rather than waiting for the
 * next beat: a phone that has just got hot is exactly the report the studio
 * would otherwise receive up to fifteen seconds late.
 */
export function useHealthHeartbeat(inputs: Inputs): void {
  const latest = useRef(inputs);
  latest.current = inputs;

  const failures = useRef(0);
  const said = useRef(false);
  const sending = useRef(false);

  const send = useRef(async () => {
    const { connection, state, thermal, charge, reconnects, lastDrop } = latest.current;
    const { stats } = readReadouts();
    // One in flight at a time: a slow network must not queue reports behind it.
    if (!connection || sending.current) return;
    sending.current = true;
    try {
      const result = await postHealth(
        connection,
        buildHealthReport({ state, thermal, charge, stats, reconnects, lastDrop }),
      );
      if (result.ok) {
        failures.current = 0;
        said.current = false;
        return;
      }
      failures.current += 1;
      if (failures.current >= SAY_AFTER_FAILURES && !said.current) {
        said.current = true;
        pushLog({
          at: Date.now(),
          level: "warn",
          message: `The studio is not receiving health reports (${result.message})`,
        });
      }
    } finally {
      sending.current = false;
    }
  });

  const { live, thermal } = inputs;
  const connectionId = inputs.connection?.id ?? null;

  useEffect(() => {
    if (!live || !connectionId) return;
    failures.current = 0;
    said.current = false;
    void send.current();
    const timer = setInterval(() => void send.current(), EVERY_MS);
    return () => clearInterval(timer);
  }, [live, connectionId]);

  useEffect(() => {
    if (live && thermal >= 2) void send.current();
  }, [live, thermal]);
}
