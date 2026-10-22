import { useMemo, useRef } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Text } from "@/components/ui/text";

import { FocusIcon, ZoomIcon } from "./icons";
import { Mono } from "./mono";

/**
 * Zoom and focus, on the edge the controls are never on.
 *
 * Pinch already sets the zoom and a tap already sets the focus, and neither is
 * enough on a tripod: pinching means two fingers on a phone that is clamped to
 * something, and a tap tells the camera where to look rather than how far away
 * to look. A rail is the control for both - one finger, on the edge, without
 * covering the picture being judged.
 *
 * Drawn in the same language as the control column on the other edge: a solid
 * dark panel rather than chrome floating on the picture, so the two sides read
 * as one app. The track is thick enough to find with a thumb and the value sits
 * on a chip; a hairline and bare white text disappear over a lecture hall,
 * which is the room this is used in.
 *
 * One rail at a time. Two rails on one edge is a column of controls the
 * operator has to aim between, and the second one would be over the picture.
 */

/**
 * The rail's height, as much of the screen as it can have.
 *
 * It was a flat 200, which is most of a phone held sideways once the two end
 * labels, the value chip and the AF button are stacked under it - the focus
 * rail ran off the bottom of the screen and took its own AF button with it.
 * Measured against the window instead, with a floor so it stays draggable on
 * anything and a ceiling so it does not become a ladder on a tablet.
 */
function trackFor(height: number): number {
  // What is left once everything stacked around the track has had its share,
  // and a margin so the panel is not flush against either edge.
  const spare = height - FURNITURE - 48;
  return Math.max(110, Math.min(200, spare));
}

/** What the rail needs around the track: two labels, the chip, the AF button. */
const FURNITURE = 116;

/** Wide enough to catch a thumb aiming at a 4px line. */
const COLUMN = 44;

/** The knob, and therefore how far the value can actually travel. */
const KNOB = 34;

export type Rail = "zoom" | "focus" | null;

export function EdgeRails({
  open,
  onOpen,
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
}: {
  open: Rail;
  onOpen: (rail: Rail) => void;
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
}) {
  const { height } = useWindowDimensions();
  const track = trackFor(height);

  if (!canZoom && !canFocus) return null;

  return (
    <View className="flex-row items-center gap-2">
      {/* The rail first, so it opens towards the picture rather than off the
          edge of the screen. */}
      {open === "zoom" && canZoom ? (
        <RailTrack
          track={track}
          value={zoom}
          min={zoomRange.min}
          max={zoomRange.max}
          onChange={onZoom}
          label={`${zoom.toFixed(1)}x`}
          top={`${zoomRange.max.toFixed(0)}x`}
          bottom={`${zoomRange.min.toFixed(1)}x`}
          tone="plain"
        />
      ) : null}

      {open === "focus" && canFocus ? (
        <RailTrack
          track={track}
          /**
           * Dioptres run the other way from the rail: 0 is infinity and the
           * maximum is as near as the lens goes. Near at the bottom and far at
           * the top is the way every focus ring is marked.
           */
          value={focusNear - focusDistance}
          min={0}
          max={focusNear}
          onChange={(next) => onFocusDistance(focusNear - next)}
          label={manualFocus ? describeFocus(focusDistance) : "AF"}
          top="∞"
          bottom="near"
          tone={manualFocus ? "held" : "plain"}
          /**
           * Parked at infinity while the camera is doing the focusing, and
           * faded to say so. The knob has to sit somewhere, and a solid one at
           * the top of the rail reads as "focused on infinity" when the truth
           * is that this rail is not in charge yet.
           */
          dimmed={!manualFocus}
          footer={
            manualFocus ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to auto focus"
                onPress={onAutoFocus}
                className="mt-2 rounded-full bg-white px-3 py-1"
              >
                <Text className="text-[11px] font-semibold text-black">AF</Text>
              </Pressable>
            ) : null
          }
        />
      ) : null}

      <View className="gap-2 rounded-2xl bg-[#0E1319]/90 p-1.5">
        {canZoom ? (
          <RailButton
            label="Zoom"
            on={open === "zoom"}
            onPress={() => onOpen(open === "zoom" ? null : "zoom")}
          >
            <ZoomIcon className={`h-5 w-5 ${open === "zoom" ? "text-black" : "text-white"}`} />
          </RailButton>
        ) : null}

        {canFocus ? (
          <RailButton
            label="Focus"
            on={open === "focus"}
            held={manualFocus}
            onPress={() => onOpen(open === "focus" ? null : "focus")}
          >
            <FocusIcon
              className={`h-5 w-5 ${
                open === "focus" ? "text-black" : manualFocus ? "text-amber-300" : "text-white"
              }`}
            />
          </RailButton>
        ) : null}
      </View>
    </View>
  );
}

function RailButton({
  label,
  on,
  held,
  onPress,
  children,
}: {
  label: string;
  on: boolean;
  held?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: on }}
      onPress={onPress}
      className={`h-11 w-11 items-center justify-center rounded-full ${
        on ? "bg-white" : held ? "bg-amber-300/20" : "bg-white/10"
      }`}
    >
      {children}
    </Pressable>
  );
}

/**
 * The rail itself: a thick track, a knob, and the value on a chip.
 *
 * Relative dragging rather than absolute. A thumb landing on the track should
 * not jump the lens to wherever it landed - on a zoom that is a shot thrown
 * away, and this is used mid-broadcast.
 */
function RailTrack({
  track,
  value,
  min,
  max,
  onChange,
  label,
  top,
  bottom,
  tone,
  dimmed,
  footer,
}: {
  /** How tall this rail may be, decided from the window. */
  track: number;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  label: string;
  top: string;
  bottom: string;
  tone: "plain" | "held";
  /** Drawn faint, for a rail showing where something is rather than setting it. */
  dimmed?: boolean;
  footer?: React.ReactNode;
}) {
  const span = max - min;
  const base = useRef(value);
  const latest = useRef(value);
  latest.current = value;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onStart(() => {
          base.current = latest.current;
        })
        .onUpdate((event) => {
          if (span <= 0) return;
          // Up is more - more zoom, further away - because screen y grows
          // downwards and neither of those does.
          const moved = (-event.translationY / (track - KNOB)) * span;
          const next = Math.min(max, Math.max(min, base.current + moved));
          onChange(next);
        }),
    [span, min, max, onChange, track],
  );

  const travel = track - KNOB;
  const knobTop = span > 0 ? travel - ((value - min) / span) * travel : travel;

  return (
    <View className="items-center rounded-2xl bg-[#0E1319]/90 px-2 py-2">
      <Text className="pb-1 text-[10px] text-white/70">{top}</Text>

      <GestureDetector gesture={pan}>
        <View style={{ height: track, width: COLUMN }} collapsable={false}>
          {/* Thick, and dark-edged, so it holds over a bright sky and a dark
              hall alike. A hairline holds over neither. */}
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: COLUMN / 2 - 3, top: 8, bottom: 8, width: 6 }}
            className="rounded-full bg-black/60"
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: COLUMN / 2 - 2,
              top: knobTop + KNOB / 2,
              bottom: 8,
              width: 4,
            }}
            className={`rounded-full ${tone === "held" ? "bg-amber-300" : "bg-white"} ${
              dimmed ? "opacity-40" : ""
            }`}
          />
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: COLUMN / 2 - KNOB / 2,
              top: knobTop,
              height: KNOB,
              width: KNOB,
            }}
            className={`rounded-full border-2 border-black/40 ${
              tone === "held" ? "bg-amber-300" : "bg-white"
            } ${dimmed ? "opacity-40" : ""}`}
          />
        </View>
      </GestureDetector>

      <Text className="pt-1 text-[10px] text-white/70">{bottom}</Text>

      <View className="mt-1 rounded-full bg-black/70 px-2 py-0.5">
        <Mono className="text-[11px] font-semibold">{label}</Mono>
      </View>
      {footer}
    </View>
  );
}

/**
 * Dioptres in the units a person thinks in. 0 is infinity; everything else is
 * how far away the lens is holding, which is 1/dioptres in metres.
 */
function describeFocus(dioptres: number): string {
  if (dioptres <= 0.01) return "∞";
  const metres = 1 / dioptres;
  if (metres < 1) return `${Math.round(metres * 100)}cm`;
  return `${metres.toFixed(1)}m`;
}
