import { type JSX, useCallback, useEffect, useMemo, useRef } from "react";
import { type AccessibilityActionEvent, Animated, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

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
 */

/** Long enough to read a number, short enough not to become part of the UI. */
const READOUT_HOLD_MS = 900;

/** About thirty steps a second: smoother than the lens can move, cheap on the bridge. */
const TICK_MS = 33;

/** A thumb resting on the knob is never perfectly still; this is the slack. */
const DEAD_ZONE = 0.06;

/** Keeps the knob's edge off the ends of the track at full deflection. */
const END_INSET = 8;

/** Smaller moves than this are noise the native side would just round away. */
const MIN_STEP = 0.005;

/** One accessibility step: ten percent is a visible but not jarring change. */
const A11Y_STEP = 1.1;

const TRACK_WIDTH = 72;
const KNOB_WIDTH = 64;
const KNOB_HEIGHT = 7;

export function ZoomRocker(props: {
  readonly canZoom: boolean;
  readonly zoom: number; // current zoom factor (updates async from native)
  readonly min: number;
  readonly max: number;
  readonly onZoom: (level: number) => void;
  readonly height: number; // track length in dp
}): JSX.Element | null {
  const { canZoom, zoom, min, max, onZoom, height } = props;

  /**
   * Everything the gesture reads lives in refs so the gesture itself is built
   * once. Rebuilding it mid-drag - which a new zoom prop every tick would do -
   * makes gesture-handler drop the active pan, and the knob freezes off-centre.
   */
  const live = useRef({ min, max, onZoom, height });
  live.current = { min, max, onZoom, height };

  /**
   * Where the lens is, as far as we know. The prop lags behind our own calls
   * because it round-trips through a native promise; integrating from it would
   * keep re-applying the same step and stutter. So the loop integrates from
   * its own value and only resyncs from the prop while the rocker is idle.
   */
  const current = useRef(zoom);
  const dragging = useRef(false);
  if (!dragging.current) current.current = zoom;

  const deflection = useRef(0);
  const loop = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTick = useRef(0);

  const translateY = useRef(new Animated.Value(0)).current;
  const readout = useRef(new Animated.Value(0)).current;
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopLoop = useCallback(() => {
    if (loop.current) clearInterval(loop.current);
    loop.current = null;
  }, []);

  const step = useCallback(() => {
    const d = deflection.current;
    const now = Date.now();
    // Real elapsed time rather than the nominal tick: JS timers slip under
    // load, and a zoom speed that depends on how busy the thread is would
    // feel like the control is sticking.
    const dt = Math.min(0.1, (now - lastTick.current) / 1000);
    lastTick.current = now;
    if (Math.abs(d) <= DEAD_ZONE) return;

    const { min: lo, max: hi, onZoom: emit } = live.current;
    const from = current.current;
    // Multiplicative, because zoom is perceived in ratios: 1x to 2x looks like
    // the same push as 4x to 8x. A linear rate would race through the wide end
    // and crawl at the long end. Full deflection covers the range in ~2 s.
    const next =
      lo > 0
        ? from * Math.exp((Math.log(hi / lo) / 2.0) * d * dt)
        : from + ((hi - lo) / 2.0) * d * dt;
    const clamped = Math.min(hi, Math.max(lo, next));
    if (Math.abs(clamped - from) <= MIN_STEP) return;
    current.current = clamped;
    emit(clamped);
  }, []);

  const showReadout = useCallback(() => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = null;
    readout.stopAnimation();
    readout.setValue(1);
  }, [readout]);

  const hideReadoutSoon = useCallback(() => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    fadeTimer.current = setTimeout(() => {
      Animated.timing(readout, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    }, READOUT_HOLD_MS);
  }, [readout]);

  const release = useCallback(() => {
    dragging.current = false;
    deflection.current = 0;
    stopLoop();
    // The spring is the rocker's whole promise: let go and it is neutral
    // again, so the next touch never starts with the lens already moving.
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      speed: 24,
      bounciness: 6,
    }).start();
    hideReadoutSoon();
  }, [hideReadoutSoon, stopLoop, translateY]);

  const gesture = useMemo(() => {
    /**
     * runOnJS because every tick ends in a native promise and the loop is a JS
     * timer anyway; the knob's own movement is a setValue on a native-driven
     * value, so the thumb still feels direct.
     */
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetY([-4, 4])
      .onStart(() => {
        dragging.current = true;
        deflection.current = 0;
        showReadout();
        stopLoop();
        lastTick.current = Date.now();
        loop.current = setInterval(step, TICK_MS);
      })
      .onUpdate((event) => {
        const reach = Math.max(1, live.current.height / 2 - END_INSET);
        const offset = Math.min(reach, Math.max(-reach, event.translationY));
        translateY.setValue(offset);
        // Up is in: the same direction as "closer" on every zoom rocker on a
        // real camera body.
        deflection.current = -offset / reach;
      })
      .onFinalize(() => {
        if (dragging.current) release();
      });

    // A rocker has no position to return to, so "back to the widest" needs
    // its own way home - and a double tap cannot happen by accident mid-shot.
    const reset = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((_event, success) => {
        if (!success) return;
        const { min: lo, onZoom: emit } = live.current;
        current.current = lo;
        emit(lo);
        showReadout();
        hideReadoutSoon();
      });

    return Gesture.Race(pan, reset);
  }, [hideReadoutSoon, release, showReadout, step, stopLoop, translateY]);

  useEffect(
    () => () => {
      if (loop.current) clearInterval(loop.current);
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    },
    [],
  );

  const onAccessibilityAction = useCallback((event: AccessibilityActionEvent) => {
    const { min: lo, max: hi, onZoom: emit } = live.current;
    const from = current.current;
    let next: number;
    if (event.nativeEvent.actionName === "increment") next = from * A11Y_STEP;
    else if (event.nativeEvent.actionName === "decrement") next = from / A11Y_STEP;
    else return;
    const clamped = Math.min(hi, Math.max(lo, next));
    current.current = clamped;
    emit(clamped);
  }, []);

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
        <Animated.View pointerEvents="none" style={{ transform: [{ translateY }] }}>
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
            style={{
              position: "absolute",
              right: "100%",
              top: KNOB_HEIGHT / 2 - 12,
              height: 24,
              marginRight: 8,
              justifyContent: "center",
              opacity: readout,
            }}
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
