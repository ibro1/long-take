import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { Mono } from "./mono";

/**
 * The picture, as something you can touch.
 *
 * Pinch and tap are the two gestures a phone camera has earned the right to
 * assume, and both belong on the image rather than in a panel: an operator
 * framing a shot is already holding the phone with both hands and has no
 * spare attention for a control. This layer sits directly over the preview and
 * under the chrome, so buttons drawn afterwards still take their own taps.
 *
 * Neither gesture does anything until the camera is open. The native side
 * would reject the call harmlessly, but a reticle drawn where nothing focused
 * is a lie, and a zoom factor that does not match the picture is worse than
 * none.
 */

/** Long enough to read a number, short enough not to become part of the UI. */
const ZOOM_HOLD_MS = 900;

/** About how long a camera takes to rack focus, so the reticle outlives the act. */
const RETICLE_HOLD_MS = 1100;

/** Twenty zoom calls a second: smoother than the lens can move, cheap on the bridge. */
const EMIT_MS = 50;

type Props = {
  /** False when the lens has no range to give, which many ultra-wides do not. */
  canZoom: boolean;
  /** False until a camera is open; there is nothing to focus before that. */
  canFocus: boolean;
  zoom: number;
  range: { min: number; max: number };
  onZoom: (level: number) => void;
  onFocus: (x: number, y: number) => void;
  /**
   * Where the tap landed, in pixels, with the size of the picture it landed
   * on. The exposure rail is drawn from this - above this layer rather than
   * inside it, so that dragging its knob is not also a tap on the picture
   * behind it.
   */
  onTapPoint?: (point: { x: number; y: number; at: number }, frame: { width: number; height: number }) => void;
};

/**
 * Visible now, gone shortly after. Called again before it fades, it simply
 * restarts the hold. A worklet, but plain JS can call it too.
 */
function flash(opacity: SharedValue<number>, holdMs: number) {
  "worklet";
  opacity.value = 1;
  opacity.value = withDelay(holdMs, withTiming(0, { duration: 260 }));
}

export function TouchLayer({
  canZoom,
  canFocus,
  zoom,
  range,
  onZoom,
  onFocus,
  onTapPoint,
}: Props) {
  const size = useRef({ width: 0, height: 0 });

  // The pinch runs on the UI thread, so it reads the lens's zoom from a shared
  // value rather than the prop.
  const zoomSV = useSharedValue(zoom);
  useEffect(() => {
    zoomSV.value = zoom;
  }, [zoomSV, zoom]);
  const pinchBase = useSharedValue(zoom);
  /** The latest pinched factor, the last one handed to onZoom, and when. */
  const pending = useSharedValue(zoom);
  const sent = useSharedValue(zoom);
  const lastEmitAt = useSharedValue(0);

  const [reticle, setReticle] = useState<{ x: number; y: number } | null>(null);
  const zoomOpacity = useSharedValue(0);
  const reticleOpacity = useSharedValue(0);

  // Reached through refs so the gesture is built once, not on every parent
  // render that hands down fresh closures.
  const handlers = useRef({ onZoom, onFocus, onTapPoint });
  handlers.current = { onZoom, onFocus, onTapPoint };
  const emitZoom = useCallback((level: number) => handlers.current.onZoom(level), []);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    size.current = event.nativeEvent.layout;
  }, []);

  // A tap is one-off and ends in React state and native calls, so it is
  // handled on the JS side in full.
  const onTap = useCallback(
    (x: number, y: number) => {
      const { width, height } = size.current;
      if (width === 0 || height === 0) return;
      setReticle({ x, y });
      flash(reticleOpacity, RETICLE_HOLD_MS);
      handlers.current.onFocus(clamp01(x / width), clamp01(y / height));
      handlers.current.onTapPoint?.({ x, y, at: Date.now() }, { width, height });
    },
    [reticleOpacity],
  );

  const { min: rangeMin, max: rangeMax } = range;

  const gesture = useMemo(() => {
    /**
     * On the UI thread, so a pinch keeps tracking the fingers while the JS
     * thread is busy. Only the factor crosses to JS, at most every EMIT_MS
     * and once more at the end so the lens lands where the fingers stopped.
     */
    const pinch = Gesture.Pinch()
      .enabled(canZoom)
      .onStart(() => {
        pinchBase.value = zoomSV.value;
        pending.value = zoomSV.value;
        sent.value = zoomSV.value;
        lastEmitAt.value = 0;
      })
      .onUpdate((event) => {
        const next = Math.min(rangeMax, Math.max(rangeMin, pinchBase.value * event.scale));
        pending.value = next;
        flash(zoomOpacity, ZOOM_HOLD_MS);
        const now = Date.now();
        if (now - lastEmitAt.value < EMIT_MS) return;
        lastEmitAt.value = now;
        sent.value = next;
        scheduleOnRN(emitZoom, next);
      })
      .onEnd(() => {
        if (pending.value === sent.value) return;
        sent.value = pending.value;
        scheduleOnRN(emitZoom, pending.value);
      });

    const tap = Gesture.Tap()
      .enabled(canFocus)
      .maxDuration(300)
      .onEnd((event, success) => {
        if (success) scheduleOnRN(onTap, event.x, event.y);
      });

    return Gesture.Simultaneous(pinch, tap);
  }, [
    canZoom,
    canFocus,
    rangeMin,
    rangeMax,
    emitZoom,
    onTap,
    pinchBase,
    zoomSV,
    pending,
    sent,
    lastEmitAt,
    zoomOpacity,
  ]);

  const reticleStyle = useAnimatedStyle(() => ({ opacity: reticleOpacity.value }));
  const zoomStyle = useAnimatedStyle(() => ({ opacity: zoomOpacity.value }));

  return (
    <GestureDetector gesture={gesture}>
      <View className="absolute inset-0" onLayout={onLayout} collapsable={false}>
        {reticle ? (
          <Animated.View
            pointerEvents="none"
            style={[{ position: "absolute", left: reticle.x - 36, top: reticle.y - 36 }, reticleStyle]}
          >
            <View className="h-[72px] w-[72px] rounded-lg border-2 border-amber-300">
              <View className="m-auto h-2 w-2 rounded-full bg-amber-300" />
            </View>
          </Animated.View>
        ) : null}

        {/* The factor sits over the middle of the picture and leaves, because
            a zoom readout that never goes away is just clutter on the shot.
            Styled inline rather than with classes: an Animated.View is not one
            of the components nativewind hands classes to. */}
        <Animated.View
          pointerEvents="none"
          style={[{ position: "absolute", left: 0, right: 0, top: "50%", alignItems: "center" }, zoomStyle]}
        >
          <View className="rounded-full bg-black/70 px-3 py-1">
            <Mono className="text-base font-semibold">{zoom.toFixed(1)}x</Mono>
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
