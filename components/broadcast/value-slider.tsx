import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AccessibilityActionEvent, type LayoutChangeEvent, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";

import { Mono } from "./mono";

/**
 * A manual camera setting as a tick slider, the way Filmic Pro draws its ISO,
 * shutter and white-balance controls.
 *
 * These are settings with a position - ISO 400 lives at one place on the line
 * and stays there - so unlike zoom they are a slider, not a rocker. Where the
 * camera thinks in named stops (1/50, 1/60, ISO 320, ISO 400) the knob jumps
 * from stop to stop and the stops are spaced evenly, which is how a lens ring
 * feels: every click is the same distance and the same amount of light,
 * whatever the number says. Anything else snaps to its step.
 *
 * The drag, the snapping and the knob all run on the UI thread, so the slider
 * keeps up with the thumb while the JS thread is busy with a stream. The
 * value crosses to JS at most every COMMIT_MS while the hand is moving - each
 * crossing ends in a native capture-request rebuild, and sixty of those a
 * second buys nothing the eye can see - and once more on release, so the
 * camera always ends where the knob did.
 */

/** Sixteen commits a second: as fast as a capture request can usefully change. */
const COMMIT_MS = 60;

const KNOB = 18;
const TRACK_HEIGHT = 36;
/** No more ticks than this, or the hairlines merge into a grey bar. */
const MAX_TICKS = 32;

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The stop closest to a value. By ratio when everything is positive, because
 * stops are geometric: 1/60 is "near" 1/50 in a way that nanoseconds alone
 * would not say about 1/4000 and 1/8000.
 */
function nearestIndex(v: number, stops: readonly number[]): number {
  "worklet";
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const d = v > 0 && s > 0 ? Math.abs(Math.log(s / v)) : Math.abs(s - v);
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

/** Where a value sits along the track, 0 at the left end and 1 at the right. */
function positionOf(v: number, min: number, max: number, stops: readonly number[]): number {
  "worklet";
  if (stops.length > 1) return nearestIndex(v, stops) / (stops.length - 1);
  if (stops.length === 1) return 0.5;
  return max > min ? clamp((v - min) / (max - min), 0, 1) : 0;
}

/** The value a point on the track lands on, already snapped. */
function valueAt(t: number, min: number, max: number, step: number, stops: readonly number[]): number {
  "worklet";
  const p = clamp(t, 0, 1);
  if (stops.length > 0) return stops[Math.round(p * (stops.length - 1))];
  const raw = min + p * (max - min);
  if (!(step > 0)) return raw;
  // Rounded off the float noise, or 0.1 steps read back as 0.30000000000000004.
  const snapped = Math.round(((min + Math.round((raw - min) / step) * step) * 1e6)) / 1e6;
  return clamp(snapped, min, max);
}

export function ValueSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Snap interval when there are no stops. Omitted = continuous. */
  step?: number;
  /** Ascending. When given the knob lands only on these and min/max are not used for snapping. */
  stops?: number[];
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}): JSX.Element {
  const { label, value, min, max, step = 0, stops, format, onChange, disabled = false } = props;
  const stopList = useMemo(() => stops ?? [], [stops]);

  // The worklets read every prop through a shared value, so the gesture is
  // built once and survives a re-render mid-drag - rebuilding it drops the
  // active pan, as the zoom rocker learned.
  const valueSV = useSharedValue(value);
  const minSV = useSharedValue(min);
  const maxSV = useSharedValue(max);
  const stepSV = useSharedValue(step);
  const stopsSV = useSharedValue<number[]>(stopList);
  const width = useSharedValue(0);
  useEffect(() => {
    minSV.value = min;
    maxSV.value = max;
    stepSV.value = step;
    stopsSV.value = stopList;
  }, [minSV, maxSV, stepSV, stopsSV, min, max, step, stopList]);
  useEffect(() => {
    valueSV.value = value;
  }, [valueSV, value]);

  /** Knob position, 0-1. Follows the prop while idle, the finger while held. */
  const position = useSharedValue(positionOf(value, min, max, stopList));
  const dragging = useSharedValue(false);
  /** The last value handed to JS, and when. */
  const sent = useSharedValue(value);
  const lastCommitAt = useSharedValue(0);

  useAnimatedReaction(
    () => positionOf(valueSV.value, minSV.value, maxSV.value, stopsSV.value),
    (t) => {
      if (!dragging.value) position.value = t;
    },
  );

  // What the readout says. Moves with each commit during a drag rather than
  // waiting for the parent to round-trip the value through native.
  const [shown, setShown] = useState(value);
  const draggingJS = useRef(false);
  useEffect(() => {
    if (!draggingJS.current) setShown(value);
  }, [value]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const commit = useCallback((v: number) => {
    setShown(v);
    onChangeRef.current(v);
  }, []);
  const setHeld = useCallback((on: boolean) => {
    draggingJS.current = on;
  }, []);

  const gesture = useMemo(() => {
    /** Finger x to a snapped value; moves the knob onto it. */
    const land = (x: number) => {
      "worklet";
      const w = width.value;
      const travel = Math.max(1, w - KNOB);
      const v = valueAt((x - KNOB / 2) / travel, minSV.value, maxSV.value, stepSV.value, stopsSV.value);
      position.value = positionOf(v, minSV.value, maxSV.value, stopsSV.value);
      return v;
    };

    // Horizontal only: a vertical move belongs to the panel's scroll, and a
    // thumb scrolling past the slider must not drag ISO on the way.
    const pan = Gesture.Pan()
      .enabled(!disabled)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart((event) => {
        dragging.value = true;
        sent.value = valueSV.value;
        lastCommitAt.value = 0;
        scheduleOnRN(setHeld, true);
        const v = land(event.x);
        if (v !== sent.value) {
          sent.value = v;
          lastCommitAt.value = Date.now();
          scheduleOnRN(commit, v);
        }
      })
      .onUpdate((event) => {
        const v = land(event.x);
        if (v === sent.value) return;
        const now = Date.now();
        if (now - lastCommitAt.value < COMMIT_MS) return;
        lastCommitAt.value = now;
        sent.value = v;
        scheduleOnRN(commit, v);
      })
      .onFinalize(() => {
        if (!dragging.value) return;
        dragging.value = false;
        scheduleOnRN(setHeld, false);
        // The throttle may be holding the last stop the knob landed on; the
        // camera has to end where the slider did.
        const v = valueAt(position.value, minSV.value, maxSV.value, stepSV.value, stopsSV.value);
        if (v !== sent.value) {
          sent.value = v;
          scheduleOnRN(commit, v);
        }
      });

    // A tap jumps straight to a point, the quickest way across a long range.
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .onEnd((event, success) => {
        if (!success) return;
        const v = land(event.x);
        if (v === sent.value && v === valueSV.value) return;
        sent.value = v;
        scheduleOnRN(commit, v);
      });

    return Gesture.Race(pan, tap);
  }, [commit, disabled, dragging, lastCommitAt, maxSV, minSV, position, sent, setHeld, stepSV, stopsSV, valueSV, width]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      width.value = event.nativeEvent.layout.width;
    },
    [width],
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const direction =
        event.nativeEvent.actionName === "increment" ? 1 : event.nativeEvent.actionName === "decrement" ? -1 : 0;
      if (direction === 0 || disabled) return;
      let next: number;
      if (stopList.length > 0) {
        next = stopList[clamp(nearestIndex(shown, stopList) + direction, 0, stopList.length - 1)];
      } else {
        // Continuous sliders move a twentieth of the range per action.
        const by = step > 0 ? step : (max - min) / 20;
        const moved = clamp(shown + direction * by, min, max);
        next = max > min ? valueAt((moved - min) / (max - min), min, max, step, stopList) : moved;
      }
      if (next !== shown) commit(next);
    },
    [commit, disabled, max, min, shown, step, stopList],
  );

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.value * Math.max(0, width.value - KNOB) }],
  }));

  const ticks = useMemo(() => tickMarks(min, max, step, stopList), [min, max, step, stopList]);

  return (
    <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <View className="flex-row items-baseline justify-between gap-3">
        <Text
          numberOfLines={1}
          className="shrink text-[10px] font-semibold uppercase tracking-wide text-filmic-inkmuted"
        >
          {label}
        </Text>
        <Mono className="text-sm font-bold">{format(shown)}</Mono>
      </View>

      <GestureDetector gesture={gesture}>
        <View
          collapsable={false}
          onLayout={onLayout}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: format(shown) }}
          accessibilityState={{ disabled }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={onAccessibilityAction}
          style={styles.track}
        >
          {/* The ticks span the knob's travel, not the full width, so the end
              ticks sit exactly under the knob's centre at either end. */}
          <View pointerEvents="none" style={styles.rail}>
            <View style={styles.hairline} />
            {ticks.map((tick) => (
              <View
                key={tick.at}
                style={[
                  styles.tick,
                  {
                    left: `${tick.at * 100}%`,
                    height: tick.major ? 10 : 6,
                    // Centred on the hairline whatever its height.
                    transform: [{ translateY: tick.major ? -5 : -3 }],
                    backgroundColor: tick.major ? filmic.color.lineStrong : filmic.color.line,
                  },
                ]}
              />
            ))}
          </View>

          {/* Inline style: an Animated.View is not one nativewind hands
              classes to. */}
          <Animated.View pointerEvents="none" style={[styles.knob, knobStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

/**
 * One tick per stop, or evenly spaced across a stepped range, thinned to
 * MAX_TICKS. The ends are long, and so is zero when the range straddles it -
 * tint's neutral is the one point on that line worth finding by eye.
 */
function tickMarks(
  min: number,
  max: number,
  step: number,
  stops: readonly number[],
): { at: number; major: boolean }[] {
  const count =
    stops.length > 1 ? stops.length - 1 : step > 0 && max > min ? Math.round((max - min) / step) : 20;
  if (count <= 0) return [{ at: 0.5, major: true }];
  const every = Math.ceil(count / MAX_TICKS);
  const marks: { at: number; major: boolean }[] = [];
  for (let i = 0; i <= count; i += every) {
    marks.push({ at: i / count, major: i === 0 || i === count });
  }
  if (marks[marks.length - 1].at !== 1) marks.push({ at: 1, major: true });
  if (stops.length <= 1 && min < 0 && max > 0) {
    const zero = -min / (max - min);
    const existing = marks.find((m) => Math.abs(m.at - zero) < 1e-6);
    if (existing) existing.major = true;
    else marks.push({ at: zero, major: true });
  }
  return marks;
}

const styles = StyleSheet.create({
  track: { height: TRACK_HEIGHT, justifyContent: "center" },
  rail: {
    position: "absolute",
    left: KNOB / 2,
    right: KNOB / 2,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: filmic.color.lineStrong },
  tick: {
    position: "absolute",
    width: StyleSheet.hairlineWidth,
    top: "50%",
  },
  knob: {
    position: "absolute",
    left: 0,
    top: (TRACK_HEIGHT - KNOB) / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});
