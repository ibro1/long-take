import { useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path, Rect } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";

/**
 * Filmic's reticle modes, behind the ring at the top of the leading column.
 *
 *   reticle - the two draggable pucks: focus where one sits, meter where the
 *             other sits.
 *   center  - no pucks. The camera's own continuous focus and centre-weighted
 *             metering, with the weighted area drawn so the operator knows
 *             what is being read.
 *   manual  - no pucks. Exposure on a tape down the leading edge (LV moves ISO
 *             and shutter together; ISO or S moves one), focus on a tape down
 *             the trailing edge.
 */
export type MeteringMode = "reticle" | "center" | "manual";

type GlyphProps = { size?: number; color?: string };

/** Filmic's Reticle glyph: a square with gaps at the middle of each side. */
export function ReticleModeIcon({ size = 24, color = "#fff" }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <Path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    </Svg>
  );
}

/** Centre weight: a box with rounded, bowed sides. */
export function CenterWeightIcon({ size = 24, color = "#fff" }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <Path d="M10 6H7.5a6 6 0 0 0 0 12H10M14 6h2.5a6 6 0 0 1 0 12H14" />
    </Svg>
  );
}

/** Manual: two arcs facing apart, a lens ring seen edge on. */
export function ManualModeIcon({ size = 24, color = "#fff" }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <Path d="M6 5a10 10 0 0 1 0 14M18 5a10 10 0 0 0 0 14" />
    </Svg>
  );
}

export const METERING_ICON = {
  reticle: ReticleModeIcon,
  center: CenterWeightIcon,
  manual: ManualModeIcon,
} as const;

const MODES: { mode: MeteringMode; label: string }[] = [
  { mode: "reticle", label: "Reticle" },
  { mode: "center", label: "Center Weight" },
  { mode: "manual", label: "Manual" },
];

/**
 * The three modes as Filmic's segmented bar along the bottom of the picture,
 * in place of the info panel while it is open. The chosen one is lit.
 */
export function MeteringModeBar({
  mode,
  onChange,
  manualAvailable,
}: {
  readonly mode: MeteringMode;
  readonly onChange: (mode: MeteringMode) => void;
  /** A lens without manual sensor or focus control has nothing for Manual to move. */
  readonly manualAvailable: boolean;
}) {
  return (
    <View style={styles.bar}>
      {MODES.map(({ mode: m, label }) => {
        const on = m === mode;
        const disabled = m === "manual" && !manualAvailable;
        const Icon = METERING_ICON[m];
        const color = on ? filmic.color.base : disabled ? filmic.color.inkMuted : filmic.color.ink;
        return (
          <Pressable
            key={m}
            disabled={disabled}
            onPress={() => onChange(m)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: on, disabled }}
            className="active:opacity-60"
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Icon size={34} color={color} />
            <Text numberOfLines={1} style={[styles.segmentLabel, { color }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * What centre-weighted metering reads: a wide area with bowed sides, and the
 * centre box focus works from. Drawn, not touchable - there is nothing to drag.
 */
export function CenterWeightOverlay({
  insets,
}: {
  readonly insets: { left: number; right: number; top: number; bottom: number };
}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const { w, h } = box;
  const cx = w / 2;
  const cy = h / 2;
  // The weighted area: about half the picture wide, two thirds tall.
  const aw = w * 0.26;
  const ah = h * 0.3;
  const bow = aw * 0.18;
  const area = `M${cx - aw} ${cy - ah} H${cx + aw} Q${cx + aw + bow * 2} ${cy} ${cx + aw} ${cy + ah} H${cx - aw} Q${cx - aw - bow * 2} ${cy} ${cx - aw} ${cy - ah} Z`;
  const s = Math.min(w, h) * 0.2;
  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { left: insets.left, right: insets.right, top: insets.top, bottom: insets.bottom }]}
    >
      {w > 0 ? (
        <Svg width={w} height={h}>
          <Path d={area} stroke={filmic.color.accent} strokeWidth={1.5} fill="none" opacity={0.85} />
          <Rect
            x={cx - s}
            y={cy - s}
            width={s * 2}
            height={s * 2}
            rx={6}
            stroke={filmic.color.accent}
            strokeWidth={2.5}
            fill="none"
          />
        </Svg>
      ) : null}
    </View>
  );
}

// --- Manual ---------------------------------------------------------------

/** Third-stop ISO values, as on every camera's dial. */
const ISO_STOPS = [
  50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000,
  6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200,
];
const SHUTTER_DENOMINATORS = [
  8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 240, 200, 160, 125,
  120, 100, 96, 80, 60, 50, 48, 40, 30, 25, 24, 20, 15,
];

type Range = { min: number; max: number };
type TimeRange = { minNs: number; maxNs: number };

function isoStops(range: Range): number[] {
  const inside = ISO_STOPS.filter((s) => s >= range.min && s <= range.max);
  return Array.from(new Set([range.min, ...inside, range.max])).sort((a, b) => a - b);
}

/** Up to one frame long, never longer: past that the frame rate drops. */
function shutterStops(range: TimeRange, fps: number): number[] {
  const denominators = new Set([...SHUTTER_DENOMINATORS, Math.round(fps), Math.round(fps * 2)]);
  return Array.from(denominators)
    .filter((d) => d >= fps - 1e-6 && d <= 8000)
    .map((d) => 1e9 / d)
    .filter((ns) => ns >= range.minNs && ns <= range.maxNs)
    .sort((a, b) => a - b);
}

function nearest(stops: number[], v: number): number {
  let best = 0;
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(Math.log(stops[i] / v)) < Math.abs(Math.log(stops[best] / v))) best = i;
  }
  return best;
}

function shutterText(ns: number): string {
  if (!(ns > 0)) return "–";
  const d = 1e9 / ns;
  return d >= 1 ? `1/${Math.round(d)}` : `${(ns / 1e9).toFixed(1)}s`;
}

/** `.35` - Filmic's focus readout: how far along the lens's own travel. */
function focusText(t: number): string {
  const r = Math.round(t * 100);
  return r >= 100 ? "1.0" : `.${String(r).padStart(2, "0")}`;
}

export type Axis = "lv" | "iso" | "s" | "z";
export const AXES: { axis: Axis; label: string; a11y: string }[] = [
  { axis: "lv", label: "LV", a11y: "Light value" },
  { axis: "iso", label: "ISO", a11y: "ISO" },
  { axis: "s", label: "S", a11y: "Shutter" },
  { axis: "z", label: "Z", a11y: "Zoom" },
];

/**
 * Filmic's manual controls: a ruler down each edge of the picture that slides
 * under a fixed amber index line at mid-height, with the value read beside the
 * line. The left ruler is exposure or zoom - which one is picked on the wheel
 * of LV / ISO / S / Z in the black column beside it - and the right is focus.
 * Each ruler reports a position 0..1 and this turns positions into camera
 * values and back, so the rulers stay where the camera actually is.
 */
/** The axes this lens can drive: exposure needs a manual sensor, Z needs zoom. */
export function availableAxes(canExpose: boolean, canZoom: boolean): typeof AXES {
  return AXES.filter(({ axis }) => (axis === "z" ? canZoom : canExpose));
}

export function ManualControls({
  insets,
  onDone,
  axis,
  onAxis,
  wheelInline,
  fps,
  isoRange,
  exposureTimeRange,
  iso,
  exposureNs,
  onManualExposure,
  focusNear,
  focusDistance,
  onFocusDistance,
  zoom,
  zoomRange,
  onZoom,
}: {
  readonly insets: { left: number; right: number; top: number; bottom: number };
  /** Which quantity the leading ruler drives; the wheel that picks it lives with the host. */
  readonly axis: Axis;
  readonly onAxis: (axis: Axis) => void;
  /**
   * Draw the wheel here, beside the ruler. Portrait only: in landscape the host
   * puts it in the black column, which is drawn over this layer.
   */
  readonly wheelInline: boolean;
  /** A tap on the picture: done setting, hand back to the reticles. */
  readonly onDone: () => void;
  readonly fps: number;
  readonly isoRange: Range | null;
  readonly exposureTimeRange: TimeRange | null;
  readonly iso: number;
  readonly exposureNs: number;
  readonly onManualExposure: (iso: number, exposureNs: number) => void;
  /** Dioptres at the near end; 0 for a fixed-focus lens. */
  readonly focusNear: number;
  readonly focusDistance: number;
  readonly onFocusDistance: (dioptres: number) => void;
  readonly zoom: number;
  readonly zoomRange: { min: number; max: number };
  readonly onZoom: (zoom: number) => void;
}) {
  const isoList = useMemo(() => (isoRange ? isoStops(isoRange) : []), [isoRange]);
  const shutterList = useMemo(
    () => (exposureTimeRange ? shutterStops(exposureTimeRange, fps > 0 ? fps : 30) : []),
    [exposureTimeRange, fps],
  );
  const canExpose = isoList.length > 1 && shutterList.length > 1;
  const canZoom = zoomRange.max > zoomRange.min;
  const axes = availableAxes(canExpose, canZoom);

  // LV: one light value spread over ISO and shutter, holding the shutter at
  // 180 degrees (1/(2*fps)) for as long as ISO can carry the change.
  const lv = useMemo(() => {
    if (!canExpose) return null;
    const isoMin = isoList[0];
    const isoMax = isoList[isoList.length - 1];
    const sMin = shutterList[0];
    const sMax = shutterList[shutterList.length - 1];
    const eMin = Math.log(isoMin * sMin);
    const eMax = Math.log(isoMax * sMax);
    const preferred = Math.min(sMax, Math.max(sMin, 1e9 / (2 * (fps > 0 ? fps : 30))));
    return {
      toT: (i: number, s: number) => (Math.log(i * s) - eMin) / (eMax - eMin),
      fromT: (t: number): [number, number] => {
        const e = Math.exp(eMin + t * (eMax - eMin));
        let s = preferred;
        let i = e / s;
        if (i > isoMax) {
          i = isoMax;
          s = Math.min(sMax, e / i);
        } else if (i < isoMin) {
          i = isoMin;
          s = Math.max(sMin, e / i);
        }
        return [Math.round(i), Math.round(s)];
      },
    };
  }, [canExpose, isoList, shutterList, fps]);

  const zoomRatio = canZoom ? zoomRange.max / zoomRange.min : 1;
  const leftT =
    axis === "z"
      ? canZoom
        ? Math.log(Math.max(zoomRange.min, zoom) / zoomRange.min) / Math.log(zoomRatio)
        : 0
      : !canExpose
        ? 0.5
        : axis === "lv"
          ? (lv?.toT(iso, exposureNs) ?? 0.5)
          : axis === "iso"
            ? nearest(isoList, iso) / (isoList.length - 1)
            : nearest(shutterList, exposureNs) / (shutterList.length - 1);

  const onLeftT = (t: number) => {
    if (axis === "z") {
      if (canZoom) onZoom(Math.round(zoomRange.min * zoomRatio ** t * 10) / 10);
      return;
    }
    if (!canExpose) return;
    if (axis === "lv" && lv) {
      const [i, s] = lv.fromT(t);
      onManualExposure(i, s);
    } else if (axis === "iso") {
      onManualExposure(isoList[Math.round(t * (isoList.length - 1))], exposureNs);
    } else {
      onManualExposure(iso, shutterList[Math.round(t * (shutterList.length - 1))]);
    }
  };

  const leftLines =
    axis === "z"
      ? [`${zoom.toFixed(1).replace(/\.0$/, "")}x`]
      : axis === "lv"
        ? [`${Math.round(iso)}`, shutterText(exposureNs)]
        : axis === "iso"
          ? [`${Math.round(iso)}`]
          : [shutterText(exposureNs)];

  const focusT = focusNear > 0 ? Math.min(1, Math.max(0, focusDistance / focusNear)) : 0;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Anywhere on the picture but the rulers: finished, as Filmic does it -
          the rulers close and the reticles come back holding these values. */}
      <Pressable accessibilityLabel="Done" onPress={onDone} style={StyleSheet.absoluteFill} />
      {axes.length > 0 ? (
        <>
          {wheelInline ? (
            <AxisWheel axes={axes} axis={axis} onAxis={onAxis} left={insets.left + RULER_WIDTH + 6} width={64} />
          ) : null}
          <View
            pointerEvents="box-none"
            style={[styles.side, { left: insets.left, top: insets.top, bottom: insets.bottom }]}
          >
            {/* Keyed by axis: a new axis is a new ruler, not the old one sliding. */}
            <Ruler key={axis} value={leftT} onChange={onLeftT} side="left" lines={leftLines} label={axis} />
          </View>
        </>
      ) : null}
      {focusNear > 0 ? (
        <View
          pointerEvents="box-none"
          style={[styles.side, { right: insets.right, top: insets.top, bottom: insets.bottom }]}
        >
          <Ruler value={focusT} onChange={(t) => onFocusDistance(t * focusNear)} side="right" lines={[focusText(focusT)]} label="Focus" />
        </View>
      ) : null}
    </View>
  );
}

const WHEEL_ITEM = 44;
/** How much of the wheel shows: the chosen axis and a little over one either side. */
const WHEEL_VIEW = WHEEL_ITEM * 3.4;

/**
 * LV / ISO / S / Z as Filmic's scroll wheel down the black column: a fixed
 * amber box at mid-height, in line with the ruler's index, and the labels
 * rolling through it. Drag to scroll and it snaps to the nearest; tap a label
 * to roll to it. On the UI thread, like the rulers.
 */
export function AxisWheel({
  axes,
  axis,
  onAxis,
  left,
  width,
}: {
  readonly axes: typeof AXES;
  readonly axis: Axis;
  readonly onAxis: (axis: Axis) => void;
  readonly left: number;
  readonly width: number;
}) {
  const index = Math.max(0, axes.findIndex((a) => a.axis === axis));
  const max = (axes.length - 1) * WHEEL_ITEM;
  const offset = useSharedValue(index * WHEEL_ITEM);
  const start = useSharedValue(0);

  useEffect(() => {
    offset.value = withTiming(index * WHEEL_ITEM, { duration: 160 });
  }, [index, offset]);

  const pick = (i: number) => {
    const next = axes[Math.max(0, Math.min(axes.length - 1, i))];
    if (next) onAxis(next.axis);
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-4, 4])
    .onBegin(() => {
      start.value = offset.value;
    })
    .onUpdate((e) => {
      offset.value = Math.min(max + WHEEL_ITEM * 0.4, Math.max(-WHEEL_ITEM * 0.4, start.value - e.translationY));
    })
    .onEnd((e) => {
      // A flick carries on, as a picker wheel does, then lands on a label.
      const projected = offset.value - e.velocityY * 0.18;
      const i = Math.round(Math.min(max, Math.max(0, projected)) / WHEEL_ITEM);
      offset.value = withTiming(i * WHEEL_ITEM, { duration: 220 });
      scheduleOnRN(pick, i);
    });
  const tap = Gesture.Tap().onEnd((e) => {
    const i = Math.round((offset.value + (e.y - WHEEL_VIEW / 2)) / WHEEL_ITEM);
    offset.value = withTiming(Math.min(max, Math.max(0, i * WHEEL_ITEM)), { duration: 160 });
    scheduleOnRN(pick, i);
  });

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Manual control"
        accessibilityValue={{ text: axes[index]?.a11y ?? "" }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => pick(index + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
        style={[styles.wheel, { left, width }]}
      >
        <View pointerEvents="none" style={styles.wheelBox} />
        {axes.map(({ axis: a, label }, i) => (
          <WheelLabel key={a} label={label} i={i} offset={offset} on={i === index} />
        ))}
      </View>
    </GestureDetector>
  );
}

function WheelLabel({
  label,
  i,
  offset,
  on,
}: {
  readonly label: string;
  readonly i: number;
  readonly offset: SharedValue<number>;
  readonly on: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const d = i * WHEEL_ITEM - offset.value;
    return {
      transform: [{ translateY: d }],
      opacity: Math.max(0, 1 - Math.abs(d) / (WHEEL_ITEM * 2.2)),
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.wheelItem, style]}>
      <Text style={[styles.wheelText, on ? styles.wheelTextOn : styles.wheelTextOff]}>{label}</Text>
    </Animated.View>
  );
}

/** How often a moving ruler tells the camera: sixteen times a second. */
const COMMIT_MS = 60;
const RULER_WIDTH = 34;
/** One minor tick per this many points of ruler. */
const TICK_EVERY = 11;
/** The ruler's full travel, as a share of the strip's height. */
const RULER_SPAN = 0.9;

/**
 * A ruler that slides under a fixed index line at mid-height. The line and
 * the value never move; the ticks do, the way a lens ring turns under its
 * mark. The drag runs on the UI thread and follows the finger: ruler up,
 * value up.
 */
function Ruler({
  value,
  onChange,
  side,
  lines,
  label,
}: {
  readonly value: number;
  readonly onChange: (t: number) => void;
  readonly side: "left" | "right";
  readonly lines: string[];
  readonly label: string;
}) {
  const span = useSharedValue(0);
  const pos = useSharedValue(value);
  const start = useSharedValue(value);
  const dragging = useSharedValue(false);
  const lastCommit = useSharedValue(0);
  const [h, setH] = useState(0);

  useEffect(() => {
    if (!dragging.value) pos.value = value;
  }, [value, pos, dragging]);

  // Commits while the ruler coasts after a flick, at the same rate as a drag.
  useAnimatedReaction(
    () => pos.value,
    (v, prev) => {
      if (!dragging.value || prev === null || v === prev) return;
      const now = Date.now();
      if (now - lastCommit.value >= COMMIT_MS) {
        lastCommit.value = now;
        scheduleOnRN(onChange, v);
      }
    },
  );

  // Drag follows the finger; let go mid-swipe and it coasts to a stop, as
  // every scroller does. Caught again by a touch. The strip takes touches a
  // finger's width either side of what is drawn, so it is easy to land on.
  const pan = Gesture.Pan()
    .minDistance(1)
    .hitSlop({ horizontal: 22 })
    .onBegin(() => {
      dragging.value = true;
      start.value = pos.value;
      pos.value = pos.value; // cancels any coasting
    })
    .onUpdate((e) => {
      if (span.value <= 0) return;
      pos.value = Math.min(1, Math.max(0, start.value - e.translationY / span.value));
    })
    .onEnd((e) => {
      if (span.value <= 0) return;
      pos.value = withDecay(
        { velocity: -e.velocityY / span.value, clamp: [0, 1], deceleration: 0.994 },
        (finished) => {
          dragging.value = false;
          if (finished) scheduleOnRN(onChange, pos.value);
        },
      );
    })
    .onFinalize((_e, success) => {
      if (!success) {
        dragging.value = false;
        scheduleOnRN(onChange, pos.value);
      }
    });

  const rulerLength = h * RULER_SPAN;
  // The ruler's top end sits on the line at the bottom of the range and its
  // bottom end at the top of it: what is under the line is the value.
  const rulerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: span.value * (1 - pos.value) - span.value }],
  }));
  const ticks = rulerLength > 0 ? Math.floor(rulerLength / TICK_EVERY) : 0;
  const outer = side === "left" ? { left: 3 } : { right: 3 };

  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: lines.join(" ") }}
        onLayout={(e) => {
          const height = e.nativeEvent.layout.height;
          span.value = height * RULER_SPAN;
          setH(height);
        }}
        style={styles.strip}
      >
        {h > 0 ? (
          <Animated.View pointerEvents="none" style={[styles.ruler, { top: h / 2, height: rulerLength }, rulerStyle]}>
            {Array.from({ length: ticks + 1 }, (_, i) => (
              <View
                key={i}
                style={[styles.tick, outer, { top: (i / ticks) * rulerLength, width: i % 5 === 0 ? 20 : 9 }]}
              />
            ))}
          </Animated.View>
        ) : null}
        {/* The index: fixed at mid-height, the value beside it. */}
        <View pointerEvents="none" style={[styles.indexLine, side === "left" ? { left: 0, right: -28 } : { right: 0, left: -28 }]} />
        <View
          pointerEvents="none"
          style={[styles.indexLabel, side === "left" ? { left: RULER_WIDTH + 34 } : { right: RULER_WIDTH + 34 }]}
        >
          {lines.map((line) => (
            <Text
              key={line}
              numberOfLines={1}
              style={[styles.indexText, side === "right" && { textAlign: "right" }]}
            >
              {line}
            </Text>
          ))}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: "rgba(28,28,30,0.96)",
    borderRadius: 14,
    padding: 6,
    gap: 4,
  },
  segment: {
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  segmentOn: { backgroundColor: "rgba(235,235,235,0.92)" },
  segmentLabel: { fontSize: 13 },
  side: { position: "absolute" },
  strip: {
    width: RULER_WIDTH,
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.14)",
  },
  ruler: { position: "absolute", left: 0, right: 0 },
  tick: {
    position: "absolute",
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  indexLine: { position: "absolute", top: "50%", height: 3, marginTop: -1.5, backgroundColor: filmic.color.accent },
  // A fixed width: shrink-to-fit wrapped "1594" into "159" over "4".
  indexLabel: { position: "absolute", top: "50%", marginTop: -12, width: 120 },
  indexText: { color: filmic.color.accent, fontSize: 19, fontWeight: "700", lineHeight: 24 },
  wheel: {
    position: "absolute",
    top: "50%",
    marginTop: -WHEEL_VIEW / 2,
    height: WHEEL_VIEW,
    overflow: "hidden",
    alignItems: "flex-end",
    paddingRight: 4,
  },
  // Fixed, like Filmic's: the labels roll through it.
  wheelBox: {
    position: "absolute",
    right: 4,
    top: (WHEEL_VIEW - WHEEL_ITEM) / 2,
    width: 50,
    height: WHEEL_ITEM,
    borderRadius: 3,
    backgroundColor: filmic.color.accent,
  },
  wheelItem: {
    position: "absolute",
    right: 4,
    top: (WHEEL_VIEW - WHEEL_ITEM) / 2,
    width: 50,
    height: WHEEL_ITEM,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelText: { fontSize: 21, fontWeight: "200", letterSpacing: 0.5 },
  wheelTextOn: { color: filmic.color.accentInk, fontWeight: "300" },
  wheelTextOff: { color: "rgba(244,245,247,0.7)" },
});
