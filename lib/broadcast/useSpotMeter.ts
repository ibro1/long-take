import { useEffect, useRef } from "react";

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
 */

/** Display-referred mid-grey: roughly what an 18% card reads on a phone screen. */
const TARGET = 0.46;
/** Close enough. Inside this the meter leaves exposure alone. */
const DEADBAND = 0.06;
/** How often a correction is judged. */
const INTERVAL_MS = 320;

export function useSpotMeter({
  point,
  enabled,
  exposure,
  min,
  max,
  onExposure,
}: {
  /** Where the exposure reticle is, in fractions of the camera view. */
  point: { x: number; y: number } | null;
  /** Off while locked, while a monitoring aid recolours the picture, or with no camera. */
  enabled: boolean;
  /** Current compensation, in the camera's own steps. */
  exposure: number;
  min: number;
  max: number;
  onExposure: (next: number) => void;
}) {
  const pointRef = useRef(point);
  pointRef.current = point;
  const exposureRef = useRef(exposure);
  exposureRef.current = exposure;
  const onExposureRef = useRef(onExposure);
  onExposureRef.current = onExposure;

  useEffect(() => {
    if (!enabled || max <= min) return;
    let cancelled = false;
    let busy = false;
    const id = setInterval(() => {
      const p = pointRef.current;
      if (!p || busy) return;
      busy = true;
      sampleLuma(p.x, p.y)
        .then((luma) => {
          if (cancelled || luma < 0) return;
          const error = TARGET - luma;
          if (Math.abs(error) < DEADBAND) return;
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
    }, INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, min, max]);
}
