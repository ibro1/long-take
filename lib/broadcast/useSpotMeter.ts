import { type MutableRefObject, useEffect, useRef } from "react";

import { sampleLuma } from "@/modules/framevane-broadcaster";

/**
 * The exposure reticle's spot meter: keep the patch of picture under the
 * reticle near a mid-grey by steering exposure compensation, the way Filmic's
 * exposure reticle does.
 *
 * Camera2 has a hardware way to say "meter here" (AE regions), but it is
 * optional, and on the phone this app is used with it changed nothing - and
 * moved focus. So the loop measures what is actually on the screen and nudges
 * compensation a step at a time. Compensation is the one exposure control every
 * camera honours, and it goes through the same setter as the Camera panel's
 * stepper, so the number shown there stays true.
 *
 * Slow on purpose: a step every few hundred milliseconds gives auto-exposure
 * time to land each change before the next is judged, so it settles instead of
 * hunting, and the dead band keeps it from fidgeting once it is close.
 *
 * And slower still once settled. Each reading is a GPU read-back, and for a
 * whole class the picture under a still reticle mostly does not change: fast
 * reads while the reticle has just moved or the picture is off target, one a
 * second otherwise. An hour-long class at the fast rate was 11,000 reads for
 * nothing.
 */

/** Display-referred mid-grey: roughly what an 18% card reads on a phone screen. */
const TARGET = 0.46;
/** Close enough. Inside this the meter leaves exposure alone. */
const DEADBAND = 0.06;
/** How often a correction is judged while it matters. */
const FAST_MS = 320;
/** How often a settled picture is looked at again. */
const SETTLED_MS = 1000;
/** How long after the reticle last moved the meter keeps reading fast. */
const MOVING_MS = 2000;

/** Where the exposure reticle is, in fractions of the camera view, and when it last moved. */
export type SpotPoint = { x: number; y: number; movedAt: number };

export function useSpotMeter({
  pointRef,
  enabled,
  exposure,
  min,
  max,
  onExposure,
}: {
  /** Written by the reticle as it moves; read here, never rendered from. */
  pointRef: MutableRefObject<SpotPoint | null>;
  /** Off while locked, while a monitoring aid recolours the picture, under a panel, or with no camera. */
  enabled: boolean;
  /** Current compensation, in the camera's own steps. */
  exposure: number;
  min: number;
  max: number;
  onExposure: (next: number) => void;
}) {
  const exposureRef = useRef(exposure);
  exposureRef.current = exposure;
  const onExposureRef = useRef(onExposure);
  onExposureRef.current = onExposure;

  useEffect(() => {
    if (!enabled || max <= min) return;
    let cancelled = false;
    let busy = false;
    let lastReadAt = 0;
    let settled = false;
    const id = setInterval(() => {
      const p = pointRef.current;
      if (!p || busy) return;
      const now = Date.now();
      const moving = now - p.movedAt < MOVING_MS;
      if (settled && !moving && now - lastReadAt < SETTLED_MS) return;
      busy = true;
      lastReadAt = now;
      sampleLuma(p.x, p.y)
        .then((luma) => {
          if (cancelled || luma < 0) return;
          const error = TARGET - luma;
          settled = Math.abs(error) < DEADBAND;
          if (settled) return;
          // Two steps when far off, so a reticle dropped on a window gets
          // there in a second or two rather than ten.
          const step = Math.abs(error) > 0.2 ? 2 : 1;
          const next = Math.min(max, Math.max(min, exposureRef.current + Math.sign(error) * step));
          if (next !== exposureRef.current) onExposureRef.current(next);
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }, FAST_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, min, max, pointRef]);
}
