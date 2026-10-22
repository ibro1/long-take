import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

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
  const pinchBase = useRef(zoom);
  const latestZoom = useRef(zoom);
  latestZoom.current = zoom;

  const [reticle, setReticle] = useState<{ x: number; y: number } | null>(null);
  const zoomFade = useFade(ZOOM_HOLD_MS);
  const reticleFade = useFade(RETICLE_HOLD_MS);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    size.current = event.nativeEvent.layout;
  }, []);

  const gesture = useMemo(() => {
    /**
     * runOnJS because the zoom has to reach a native promise and a React
     * state update either way. Driving it from the UI thread would buy
     * smoothness the camera cannot deliver anyway - the lens moves in its own
     * steps, well below sixty a second.
     */
    const pinch = Gesture.Pinch()
      .enabled(canZoom)
      .runOnJS(true)
      .onStart(() => {
        pinchBase.current = latestZoom.current;
      })
      .onUpdate((event) => {
        const next = Math.min(range.max, Math.max(range.min, pinchBase.current * event.scale));
        onZoom(next);
        zoomFade.show();
      });

    const tap = Gesture.Tap()
      .enabled(canFocus)
      .runOnJS(true)
      .maxDuration(300)
      .onEnd((event, success) => {
        if (!success) return;
        const { width, height } = size.current;
        if (width === 0 || height === 0) return;
        setReticle({ x: event.x, y: event.y });
        reticleFade.show();
        onFocus(clamp01(event.x / width), clamp01(event.y / height));
        onTapPoint?.({ x: event.x, y: event.y, at: Date.now() }, { width, height });
      });

    return Gesture.Simultaneous(pinch, tap);
  }, [
    canZoom,
    canFocus,
    range.min,
    range.max,
    onZoom,
    onFocus,
    onTapPoint,
    zoomFade.show,
    reticleFade.show,
  ]);

  return (
    <GestureDetector gesture={gesture}>
      <View className="absolute inset-0" onLayout={onLayout} collapsable={false}>
        {reticle ? (
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: reticle.x - 36,
              top: reticle.y - 36,
              opacity: reticleFade.opacity,
            }}
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
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            alignItems: "center",
            opacity: zoomFade.opacity,
          }}
        >
          <View className="rounded-full bg-black/70 px-3 py-1">
            <Mono className="text-base font-semibold">{zoom.toFixed(1)}x</Mono>
          </View>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

/** Visible while something is happening, gone shortly after it stops. */
function useFade(holdMs: number) {
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    opacity.setValue(1);
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }).start();
    }, holdMs);
  }, [holdMs, opacity]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { opacity, show };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
