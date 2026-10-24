import { type JSX, useCallback, useEffect, useMemo, useRef } from "react";
import { type AccessibilityActionEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type FrameInfo,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { filmic } from "@/lib/theme/filmic";

import { Mono } from "./mono";

/**
 * Zoom as a rocker, the way Filmic Pro does it.
 *
 * A position slider maps finger travel to a zoom factor, which means the
 * operator has to find the right spot on a line and hold it there; any wobble
 * in the thumb is a wobble in the shot. A rocker maps travel to *speed*
 * instead: push a little for a slow creep, push hard for a fast push-in, let
 * go and the lens stops exactly where it is. That is the move a camera
 * operator actually wants mid-broadcast - a smooth zoom that ends on a
 * decision, not on wherever the finger happened to lift.
 *
 * This is the only slider left on the viewfinder, so it has to read at a
 * glance: a hairline track and a flat knob that always comes home to the
 * middle. The knob's position never means a zoom level, so the readout chip
 * says the number while the hand is on it and then gets out of the picture.
 *
 * The gesture, the knob, the spring home and the zoom integration all run on
 * the UI thread, so the rocker answers the thumb even when the JS thread is
 * busy with a long stream. Only the zoom factor itself crosses to JS, because
 * it ends in a native camera call.
 */

/** Long enough to read a number, short enough not to become part of the UI. */
const READOUT_HOLD_MS = 900;

/** Twenty calls a second: smoother than the lens can move, cheap on the bridge. */
const EMIT_MS = 50;

/** A thumb resting on the knob is never perfectly still; this is the slack. */
const DEAD_ZONE = 0.06;

/** Keeps the knob's edge off the ends of the track at full deflection. */
const END_INSET = 8;

/** Smaller moves than this are noise the native side would just round away. */
const MIN_STEP = 0.005;

/** One accessibility step: ten percent is a visible but not jarring change. */
const A11Y_STEP = 1.1;

/** Snappy with a hint of overshoot, so the knob visibly lands on centre. */
const HOME_SPRING = { stiffness: 600, damping: 36, mass: 1 };

const TRACK_WIDTH = 72;
const KNOB_WIDTH = 64;
const KNOB_HEIGHT = 7;

/** Lets the readout linger, then fade, without a JS timer. */
function hideReadoutSoon(readout: SharedValue<number>) {
  "worklet";
  readout.value = withDelay(READOUT_HOLD_MS, withTiming(0, { duration: 260 }));
}

export function ZoomRocker(props: {
  readonly canZoom: boolean;
  readonly zoom: number; // current zoom factor (updates async from native)
  readonly min: number;
  readonly max: number;
  readonly onZoom: (level: number) => void;
  readonly height: number; // track length in dp
}): JSX.Element | null {
  const { canZoom, zoom, min, max, onZoom, height } = props;

  // The worklets read the props from shared values, and reach onZoom through a
  // stable wrapper, so the gesture and the frame callback are built once.
  // Rebuilding the gesture mid-drag - which a new zoom prop every tick would do
  // - makes gesture-handler drop the active pan, and the knob freezes off-centre.
  const minSV = useSharedValue(min);
  const maxSV = useSharedValue(max);
  const heightSV = useSharedValue(height);
  const zoomProp = useSharedValue(zoom);
  useEffect(() => {
    minSV.value = min;
    maxSV.value = max;
    heightSV.value = height;
  }, [minSV, maxSV, heightSV, min, max, height]);
  useEffect(() => {
    zoomProp.value = zoom;
  }, [zoomProp, zoom]);

  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const emitZoom = useCallback((level: number) => onZoomRef.current(level), []);

  /**
   * Where the lens is, as far as we know. The prop lags behind our own calls
   * because it round-trips through a native promise; integrating from it would
   * keep re-applying the same step and stutter. So the loop integrates from
   * its own value and only resyncs from the prop while the rocker is idle.
   */
  const current = useSharedValue(zoom);
  const dragging = useSharedValue(false);
  useAnimatedReaction(
    () => zoomProp.value,
    (z) => {
      if (!dragging.value) current.value = z;
    },
  );

  const deflection = useSharedValue(0);
  /** The last factor handed to onZoom, and when (frame clock). */
  const sent = useSharedValue(zoom);
  const lastEmitAt = useSharedValue(0);

  const translateY = useSharedValue(0);
  const readout = useSharedValue(0);

  const tick = useCallback(
    (frame: FrameInfo) => {
      "worklet";
      if (!dragging.value) return;
      const lo = minSV.value;
      const hi = maxSV.value;
      const d = deflection.value;
      if (Math.abs(d) > DEAD_ZONE) {
        // Real elapsed time rather than a nominal frame: frames drop under
        // load, and a zoom speed that depends on how busy the phone is would
        // feel like the control is sticking.
        const dt = Math.min(0.1, (frame.timeSincePreviousFrame ?? 0) / 1000);
        const from = current.value;
        // Multiplicative, because zoom is perceived in ratios: 1x to 2x looks
        // like the same push as 4x to 8x. A linear rate would race through the
        // wide end and crawl at the long end. Full deflection covers the range
        // in ~2 s.
        const next =
          lo > 0
            ? from * Math.exp((Math.log(hi / lo) / 2.0) * d * dt)
            : from + ((hi - lo) / 2.0) * d * dt;
        current.value = Math.min(hi, Math.max(lo, next));
      }

      // The lens is told at most every EMIT_MS, and only for a move it would
      // not round away - except landing on an end, which must always arrive.
      if (frame.timestamp - lastEmitAt.value < EMIT_MS) return;
      const z = current.value;
      const atEnd = (z === lo || z === hi) && z !== sent.value;
      if (!atEnd && Math.abs(z - sent.value) <= MIN_STEP) return;
      lastEmitAt.value = frame.timestamp;
      sent.value = z;
      scheduleOnRN(emitZoom, z);
    },
    [dragging, minSV, maxSV, deflection, current, lastEmitAt, sent, emitZoom],
  );

  // Idle until a drag starts: a frame callback left running would wake the UI
  // thread every frame for the whole broadcast.
  const loop = useFrameCallback(tick, false);
  const setLoopActive = useCallback((on: boolean) => loop.setActive(on), [loop]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetY([-4, 4])
      .onStart(() => {
        dragging.value = true;
        deflection.value = 0;
        sent.value = current.value;
        lastEmitAt.value = 0;
        readout.value = 1;
        scheduleOnRN(setLoopActive, true);
      })
      .onUpdate((event) => {
        const reach = Math.max(1, heightSV.value / 2 - END_INSET);
        const offset = Math.min(reach, Math.max(-reach, event.translationY));
        translateY.value = offset;
        // Up is in: the same direction as "closer" on every zoom rocker on a
        // real camera body.
        deflection.value = -offset / reach;
      })
      .onFinalize(() => {
        if (!dragging.value) return;
        dragging.value = false;
        deflection.value = 0;
        scheduleOnRN(setLoopActive, false);
        // The throttle may be sitting on the last few frames of travel; the
        // lens has to stop where the rocker did.
        if (current.value !== sent.value) {
          sent.value = current.value;
          scheduleOnRN(emitZoom, current.value);
        }
        // The spring is the rocker's whole promise: let go and it is neutral
        // again, so the next touch never starts with the lens already moving.
        translateY.value = withSpring(0, HOME_SPRING);
        hideReadoutSoon(readout);
      });

    // A rocker has no position to return to, so "back to the widest" needs
    // its own way home - and a double tap cannot happen by accident mid-shot.
    const reset = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((_event, success) => {
        if (!success) return;
        const lo = minSV.value;
        current.value = lo;
        scheduleOnRN(emitZoom, lo);
        readout.value = 1;
        hideReadoutSoon(readout);
      });

    return Gesture.Race(pan, reset);
  }, [current, deflection, dragging, emitZoom, heightSV, lastEmitAt, minSV, readout, sent, setLoopActive, translateY]);

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      // A synchronous read of the UI-side value, which is fine for a rare
      // assistive action and keeps it stepping from where the rocker left off.
      const from = current.value;
      let next: number;
      if (event.nativeEvent.actionName === "increment") next = from * A11Y_STEP;
      else if (event.nativeEvent.actionName === "decrement") next = from / A11Y_STEP;
      else return;
      const clamped = Math.min(max, Math.max(min, next));
      current.value = clamped;
      onZoomRef.current(clamped);
    },
    [current, min, max],
  );

  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const readoutStyle = useAnimatedStyle(() => ({ opacity: readout.value }));

  if (!canZoom || max <= min) return null;

  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Zoom"
        accessibilityValue={{ text: `${zoom.toFixed(1)}×` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={onAccessibilityAction}
        style={{ width: TRACK_WIDTH, height, alignItems: "center", justifyContent: "center" }}
      >
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            width: 1.5,
            backgroundColor: "rgba(255,255,255,0.55)",
          }}
        />

        {/* Styled inline rather than with classes: an Animated.View is not one
            of the components nativewind hands classes to. The chip rides
            inside the knob's wrapper so it stays level with the thumb. */}
        <Animated.View pointerEvents="none" style={knobStyle}>
          <View
            style={{
              width: KNOB_WIDTH,
              height: KNOB_HEIGHT,
              borderRadius: KNOB_HEIGHT / 2,
              backgroundColor: "#F4F5F7",
              shadowColor: "#000",
              shadowOpacity: 0.35,
              shadowRadius: 3,
              shadowOffset: { width: 0, height: 1 },
              elevation: 3,
            }}
          />
          <Animated.View
            style={[
              {
                position: "absolute",
                right: "100%",
                top: KNOB_HEIGHT / 2 - 12,
                height: 24,
                marginRight: 8,
                justifyContent: "center",
              },
              readoutStyle,
            ]}
          >
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: filmic.color.panel }}
            >
              <Mono className="text-xs font-semibold">{zoom.toFixed(1)}×</Mono>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
