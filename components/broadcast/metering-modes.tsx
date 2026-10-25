import { useEffect, useMemo, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
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

type ExposureAxis = "lv" | "iso" | "s";

/**
 * The exposure tape and the focus tape. Each tape reports a position 0..1
 * (1 at the top: brighter, or nearer) and this turns positions into camera
 * values and back, so the tapes stay where the camera actually is.
 */
export function ManualControls({
  insets,
  fps,
  isoRange,
  exposureTimeRange,
  iso,
  exposureNs,
  onManualExposure,
  focusNear,
  focusDistance,
  onFocusDistance,
}: {
  readonly insets: { left: number; right: number; top: number; bottom: number };
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
}) {
  const [axis, setAxis] = useState<ExposureAxis>("lv");
  const isoList = useMemo(() => (isoRange ? isoStops(isoRange) : []), [isoRange]);
  const shutterList = useMemo(
    () => (exposureTimeRange ? shutterStops(exposureTimeRange, fps > 0 ? fps : 30) : []),
    [exposureTimeRange, fps],
  );
  const canExpose = isoList.length > 1 && shutterList.length > 1;

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

  const exposureT = !canExpose
    ? 0.5
    : axis === "lv"
      ? (lv?.toT(iso, exposureNs) ?? 0.5)
      : axis === "iso"
        ? nearest(isoList, iso) / (isoList.length - 1)
        : nearest(shutterList, exposureNs) / (shutterList.length - 1);

  const onExposureT = (t: number) => {
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

  const focusT = focusNear > 0 ? Math.min(1, Math.max(0, focusDistance / focusNear)) : 0;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {canExpose ? (
        <View
          pointerEvents="box-none"
          style={[styles.side, { left: insets.left, top: insets.top, bottom: insets.bottom }]}
        >
          <Tape
            value={exposureT}
            onChange={onExposureT}
            side="left"
            lines={[`${Math.round(iso)}`, shutterText(exposureNs)]}
            accessibilityLabel="Exposure"
          />
          <View style={styles.axes}>
            {(["lv", "iso", "s"] as const).map((a) => (
              <Pressable
                key={a}
                onPress={() => setAxis(a)}
                accessibilityRole="button"
                accessibilityLabel={a === "lv" ? "Light value" : a === "iso" ? "ISO" : "Shutter"}
                accessibilityState={{ selected: axis === a }}
                className="active:opacity-60"
                style={[styles.axis, axis === a && styles.axisOn]}
              >
                <Text style={[styles.axisText, axis === a && styles.axisTextOn]}>{a.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {focusNear > 0 ? (
        <View
          pointerEvents="box-none"
          style={[styles.side, { right: insets.right, top: insets.top, bottom: insets.bottom }]}
        >
          <Tape
            value={focusT}
            onChange={(t) => onFocusDistance(t * focusNear)}
            side="right"
            lines={[focusText(focusT)]}
            accessibilityLabel="Focus"
          />
        </View>
      ) : null}
    </View>
  );
}

/** How often a moving tape tells the camera: sixteen times a second. */
const COMMIT_MS = 60;
const TAPE_WIDTH = 56;
const TICKS = 40;

/**
 * A vertical tick tape with an amber index line, dragged up and down. The
 * drag runs on the UI thread and is relative - the line moves by the finger's
 * travel, wherever the finger lands - so a small adjustment is a small
 * movement, not a jump to the touch point.
 */
function Tape({
  value,
  onChange,
  side,
  lines,
  accessibilityLabel,
}: {
  readonly value: number;
  readonly onChange: (t: number) => void;
  readonly side: "left" | "right";
  readonly lines: string[];
  readonly accessibilityLabel: string;
}) {
  const height = useSharedValue(0);
  const pos = useSharedValue(value);
  const start = useSharedValue(value);
  const dragging = useSharedValue(false);
  const lastCommit = useSharedValue(0);
  const [h, setH] = useState(0);

  useEffect(() => {
    if (!dragging.value) pos.value = value;
  }, [value, pos, dragging]);

  const pan = Gesture.Pan()
    .minDistance(2)
    .onBegin(() => {
      dragging.value = true;
      start.value = pos.value;
    })
    .onUpdate((e) => {
      if (height.value <= 0) return;
      pos.value = Math.min(1, Math.max(0, start.value - e.translationY / height.value));
      const now = Date.now();
      if (now - lastCommit.value >= COMMIT_MS) {
        lastCommit.value = now;
        scheduleOnRN(onChange, pos.value);
      }
    })
    .onFinalize(() => {
      dragging.value = false;
      scheduleOnRN(onChange, pos.value);
    });

  const indexStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - pos.value) * height.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: lines.join(" ") }}
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
          setH(e.nativeEvent.layout.height);
        }}
        style={styles.tape}
      >
        {h > 0
          ? Array.from({ length: TICKS + 1 }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.tick,
                  { top: (i / TICKS) * h, width: i % 5 === 0 ? 26 : 14 },
                  side === "left" ? { left: 6 } : { right: 6 },
                ]}
              />
            ))
          : null}
        <Animated.View pointerEvents="none" style={[styles.index, indexStyle]}>
          <View style={styles.indexLine} />
          <View style={[styles.indexLabel, side === "left" ? { left: TAPE_WIDTH + 6 } : { right: TAPE_WIDTH + 6 }]}>
            {lines.map((line) => (
              <Text key={line} style={styles.indexText}>
                {line}
              </Text>
            ))}
          </View>
        </Animated.View>
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
  side: { position: "absolute", flexDirection: "row", alignItems: "center", paddingVertical: 12 },
  tape: {
    width: TAPE_WIDTH,
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  tick: {
    position: "absolute",
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  index: { position: "absolute", left: 0, right: 0, top: 0 },
  indexLine: { height: 3, marginTop: -1.5, backgroundColor: filmic.color.accent },
  indexLabel: { position: "absolute", top: -20 },
  indexText: { color: filmic.color.accent, fontSize: 17, fontWeight: "700" },
  axes: { marginLeft: 8, gap: 6, alignSelf: "flex-end" },
  axis: {
    minWidth: 44,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  axisOn: { backgroundColor: filmic.color.accent },
  axisText: { color: filmic.color.ink, fontSize: 13, fontWeight: "700" },
  axisTextOn: { color: filmic.color.base },
});
