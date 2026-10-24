import { useEffect, useRef, useState } from "react";

/**
 * What the app gives up, in order, as the phone heats.
 *
 * The guards only *say* the phone is hot; by then the encoder is already being
 * throttled and the picture is what pays. The ladder acts first, shedding the
 * work the operator will miss least: the analytics aids and meter rates
 * (pure GPU and CPU load), then bitrate and screen brightness (the encoder and
 * the panel are the two biggest heaters), and last the viewfinder's chrome.
 * The broadcast itself is never touched.
 *
 * Up at once, down slowly. Heat is a lagging signal: a phone that has just
 * dropped from severe to moderate is still hot inside, and stepping straight
 * back to full load sends it up again a minute later - a ladder that flaps is
 * worse than one that stays put, because every flap is a visible change in the
 * picture. So it climbs straight to the step the status calls for, and comes
 * down one step at a time, a minute apart.
 */

/**
 * 0 full; 1 aids off and slow meters; 2 plus bitrate cap, quiet HUD and an
 * idle dim; 3 plus the viewfinder cut to picture, reticles and shutter.
 */
export type LadderStep = 0 | 1 | 2 | 3;

/** How long a step holds before the ladder may come down one. */
export const STEP_DOWN_AFTER_MS = 60_000;

/** How often the hook looks again while the thermal status stays put. */
export const REEVALUATE_MS = 15_000;

/** The step a thermal status calls for: moderate 1, severe 2, critical 3. */
export function stepFor(thermal: number): LadderStep {
  if (thermal >= 4) return 3;
  if (thermal >= 3) return 2;
  if (thermal >= 2) return 1;
  return 0;
}

export function nextStep(
  current: LadderStep,
  thermal: number,
  now: number,
  lastChangeAt: number,
): LadderStep {
  // A phone that cannot say is not a phone that has cooled.
  if (thermal < 0) return current;
  const wanted = stepFor(thermal);
  if (wanted > current) return wanted;
  // Down needs both the wait and a status low enough for the step below:
  // 3->2 at <=3, 2->1 at <=2, 1->0 at <=1, which is wanted < current.
  if (wanted < current && now - lastChangeAt >= STEP_DOWN_AFTER_MS) {
    return (current - 1) as LadderStep;
  }
  return current;
}

export type LadderEffects = {
  /** Zebras, peaking, false colour and the rest: off. */
  aidsOff: boolean;
  spotMeterIntervalMs: number;
  levelMeterFps: number;
  /** Fraction of the chosen video bitrate the encoder may use. */
  bitrateCap: number;
  /** Zoom readout and notices suppressed. */
  quietHud: boolean;
  /** Screen to 60% while the finger is off the glass. */
  dimIdle: boolean;
  /** Viewfinder reduced to picture, reticles and shutter. */
  minimal: boolean;
};

export function ladderEffects(step: LadderStep): LadderEffects {
  return {
    aidsOff: step >= 1,
    spotMeterIntervalMs: step >= 1 ? 1000 : 320,
    levelMeterFps: step >= 1 ? 5 : 30,
    bitrateCap: step >= 2 ? 0.7 : 1,
    quietHud: step >= 2,
    dimIdle: step >= 2,
    minimal: step >= 3,
  };
}

/**
 * The ladder as React state. The timer is what lets it come down: Android
 * only reports a thermal *change*, so a phone that settles at light and stays
 * there would otherwise sit on step 3 for the rest of the broadcast.
 */
export function useThermalLadder(thermal: number, enabled: boolean): LadderStep {
  const [step, setStep] = useState<LadderStep>(0);
  const stepRef = useRef<LadderStep>(0);
  const changedAtRef = useRef(0);
  const thermalRef = useRef(thermal);
  thermalRef.current = thermal;

  useEffect(() => {
    if (!enabled) {
      // Off air the ladder starts again from full; re-enabling at heat climbs
      // straight back, so nothing is lost by forgetting.
      stepRef.current = 0;
      changedAtRef.current = 0;
      setStep(0);
      return;
    }
    const evaluate = () => {
      const now = Date.now();
      const next = nextStep(stepRef.current, thermalRef.current, now, changedAtRef.current);
      if (next !== stepRef.current) {
        stepRef.current = next;
        changedAtRef.current = now;
        setStep(next);
      }
    };
    evaluate();
    const timer = setInterval(evaluate, REEVALUATE_MS);
    return () => clearInterval(timer);
    // thermal in the deps so a rise acts at once, not up to 15 s later.
  }, [enabled, thermal]);

  return enabled ? step : 0;
}
