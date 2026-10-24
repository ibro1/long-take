import { View } from "react-native";

import { filmic } from "@/lib/theme/filmic";

import { ControlSlider } from "./control-slider";
import { ExposureIcon, FocusIcon, ZoomIcon } from "./icons";
import { formatEv } from "./stepper";

/**
 * The always-on Filmic control cluster: zoom, focus and exposure down one edge.
 *
 * Only the continuous controls belong here. The native camera module exposes
 * zoom, focus distance and exposure compensation as smooth ranges, so each is a
 * slider the thumb can walk without lifting. ISO and shutter are *not* offered
 * by the module as settable ranges, so there is nothing to drive - a slider
 * there would be a lie. White balance is a short list of named presets, not a
 * range, so it lives as discrete chips elsewhere, not as a slider that would
 * pretend to a precision the camera does not have.
 *
 * Every slider is gated on its own `can*` flag: a fixed-focus lens reports no
 * near distance, a camera with no exposure control reports no range, and a
 * slider for a thing the lens cannot do is drawn only to be dead. Gone is
 * clearer than disabled.
 *
 * The cluster hugs whichever edge it is parked on. On the left edge the knobs
 * and readings sit to the left so the operator's thumb comes in from outside
 * the picture rather than across it; on the right, the mirror.
 */

/** A dark glyph reads on both the white and the amber knob. */
const KNOB_GLYPH = "h-4 w-4";

export function ManualSliders({
  edge,
  canZoom,
  zoom,
  zoomRange,
  onZoom,
  canFocus,
  focusNear,
  focusDistance,
  manualFocus,
  onFocusDistance,
  onAutoFocus,
  canExpose,
  exposure,
  exposureRange,
  onExposure,
  exposureLocked,
}: {
  /** Which edge the cluster is parked on; only shifts its alignment. */
  edge: "left" | "right";
  canZoom: boolean;
  zoom: number;
  zoomRange: { min: number; max: number };
  onZoom: (level: number) => void;
  /** False on a lens with fixed focus, which reports no near distance at all. */
  canFocus: boolean;
  /** How near the lens goes, in dioptres. The far end is always infinity. */
  focusNear: number;
  focusDistance: number;
  manualFocus: boolean;
  onFocusDistance: (dioptres: number) => void;
  onAutoFocus: () => void;
  /** False on a camera that offers no exposure control at all. */
  canExpose: boolean;
  /** In the camera's own steps, which is what goes back out of onExposure. */
  exposure: number;
  exposureRange: { min: number; max: number; evStep: number };
  onExposure: (next: number) => void;
  exposureLocked: boolean;
}) {
  // onAutoFocus is part of the contract so the screen can wire a return-to-auto
  // affordance; referenced here so it is not flagged as unused while the label
  // tap that will call it lives on the screen.
  void onAutoFocus;

  if (!canZoom && !canFocus && !canExpose) return null;

  return (
    <View
      className="gap-3"
      style={{ alignItems: edge === "left" ? "flex-start" : "flex-end" }}
    >
      {canZoom ? (
        <ControlSlider
          label="Zoom"
          icon={<ZoomIcon className={KNOB_GLYPH} color={filmic.color.accentInk} />}
          value={zoom}
          min={zoomRange.min}
          max={zoomRange.max}
          onChange={onZoom}
          format={(n) => `${n.toFixed(1)}x`}
        />
      ) : null}

      {canFocus ? (
        <ControlSlider
          label="Focus"
          icon={<FocusIcon className={KNOB_GLYPH} color={filmic.color.accentInk} />}
          // Dioptres straight through: 0 is infinity and the maximum is as near
          // as the lens goes. The slider reads near at the top, far at the
          // bottom, which is the one quirk against a focus ring - but it keeps
          // the value the screen hands us untouched.
          value={focusDistance}
          min={0}
          max={focusNear}
          onChange={onFocusDistance}
          // A percentage of the lens's reach while focusing by hand; the word
          // AUTO while the camera has it, because there is no distance to read.
          format={(d) =>
            manualFocus ? `${Math.round(focusNear > 0 ? (d / focusNear) * 100 : 0)}%` : "AUTO"
          }
          // Amber only when the operator has taken focus; otherwise it is the
          // camera's, and the slider is just showing where that landed.
          locked={manualFocus}
        />
      ) : null}

      {canExpose ? (
        <ControlSlider
          label="EV"
          icon={<ExposureIcon className={KNOB_GLYPH} color={filmic.color.accentInk} />}
          value={exposure}
          min={exposureRange.min}
          max={exposureRange.max}
          onChange={onExposure}
          // The camera counts in its own steps; the operator thinks in EV, so
          // the reading is the step scaled into stops.
          format={(n) => formatEv(n * exposureRange.evStep)}
          locked={exposureLocked}
        />
      ) : null}
    </View>
  );
}
