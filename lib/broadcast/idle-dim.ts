import { useCallback, useEffect, useRef } from "react";

/**
 * Dim the screen while nobody is touching it.
 *
 * The panel is one of the two biggest heaters in a phone that is broadcasting,
 * and for most of a long class nobody is looking at it closely - the phone is
 * on a tripod and the operator is watching the room. So once the ladder says
 * the phone is hot, the screen drops after a quiet spell and comes back the
 * moment a finger lands. The hook only keeps time; the brightness call is the
 * caller's, through onDim and onWake.
 */

/**
 * The timing, apart from timers, so it can be checked without waiting.
 * `touch` and `tick` return what the caller should do, or null.
 */
export class IdleClock {
  private readonly dimAfterMs: number;
  private lastTouchAt: number;
  private dimmed = false;

  // No parameter properties: Node's type stripping cannot run them.
  constructor(dimAfterMs: number, now: number) {
    this.dimAfterMs = dimAfterMs;
    this.lastTouchAt = now;
  }

  get isDimmed(): boolean {
    return this.dimmed;
  }

  touch(now: number): "wake" | null {
    this.lastTouchAt = now;
    if (!this.dimmed) return null;
    this.dimmed = false;
    return "wake";
  }

  tick(now: number): "dim" | null {
    if (this.dimmed || now - this.lastTouchAt < this.dimAfterMs) return null;
    this.dimmed = true;
    return "dim";
  }

  /** Time until the next tick could dim, for scheduling one timer rather than polling. */
  msUntilDim(now: number): number {
    return Math.max(0, this.lastTouchAt + this.dimAfterMs - now);
  }
}

export function useIdleDim({
  enabled,
  dimAfterMs = 30_000,
  onDim,
  onWake,
}: {
  enabled: boolean;
  dimAfterMs?: number;
  onDim: () => void;
  onWake: () => void;
}): { touched: () => void } {
  const clockRef = useRef<IdleClock | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDimRef = useRef(onDim);
  onDimRef.current = onDim;
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const clock = clockRef.current;
    if (!clock || clock.isDimmed) {
      timerRef.current = null;
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (clockRef.current?.tick(Date.now()) === "dim") onDimRef.current();
      else schedule();
    }, clock.msUntilDim(Date.now()));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    clockRef.current = new IdleClock(dimAfterMs, Date.now());
    schedule();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      // Leaving the screen dim after the ladder stands down would read as a
      // broken phone, so switching off always gives the brightness back.
      if (clockRef.current?.isDimmed) onWakeRef.current();
      clockRef.current = null;
    };
  }, [enabled, dimAfterMs, schedule]);

  const touched = useCallback(() => {
    const clock = clockRef.current;
    if (!clock) return;
    if (clock.touch(Date.now()) === "wake") onWakeRef.current();
    schedule();
  }, [schedule]);

  return { touched };
}
