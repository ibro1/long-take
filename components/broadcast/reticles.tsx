import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { filmic } from "@/lib/theme/filmic";

/**
 * The Filmic-style monitoring reticles: two pucks that live on the picture, one
 * for focus and one for exposure, each dragged to wherever the operator wants
 * that thing measured. Unlike a tap-to-focus flash, they are always on screen -
 * the shot is being judged through them, so they stay put until moved.
 *
 * Focus (the gapped square) racks focus to where it is dropped. Exposure (the
 * gapped circle) is the metering point: the camera reads the light under it, so
 * moving it onto a bright area darkens the picture and onto a dark area brightens
 * it - there is no separate brightness slider, the position is the control.
 *
 * A tap on either puck locks it: its position and its setting freeze (focus held,
 * exposure AE-locked) and it can no longer be dragged. A second tap frees it.
 * Lock state is carried by colour alone (amber free, red locked), as in Filmic -
 * labels or badges on the picture would sit over what is being judged.
 *
 * Positions are kept normalised (0..1) of the FULL frame, not the picture area,
 * because the parent maps them straight onto the camera view underneath.
 *
 * The drag runs entirely on the UI thread: positions are shared values moved by
 * gesture worklets and drawn by animated transforms, so a JS thread busy with an
 * hour of live stream never makes a puck lag the thumb. Only the results - the
 * focus point, the throttled metering point, a lock toggle - cross to JS.
 */

/** Drawn size of either reticle. */
const DRAW = 80;

/** Touch target around the drawing; a little larger so a thumb catches the edge. */
const TOUCH = 96;

/** Half the drawing: how far a centre must stay from the chrome. */
const HALF = DRAW / 2;

const STROKE = 2.5;

/** A soft dark under-stroke so the amber reads over a bright sky or a white wall. */
const SHADOW_STROKE = 4.5;
const SHADOW_COLOR = "rgba(0,0,0,0.35)";

/** Throttle for live metering updates while dragging the exposure puck. */
const EXPO_APPLY_MS = 80;

type Insets = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };

/**
 * Keep the whole drawing inside the picture area, off the chrome, along one
 * axis. If the area is narrower than a reticle, park it in the middle rather
 * than inverting.
 */
function clampAxis(p: number, size: number, insetLo: number, insetHi: number): number {
  "worklet";
  const min = insetLo + HALF;
  const max = size - insetHi - HALF;
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, p));
}

/**
 * Places a puck's touch box over its centre. Clamped here too, not only while
 * dragging, so a rotation or a changed inset never leaves a puck under the chrome.
 */
function usePuckStyle(
  nx: SharedValue<number>,
  ny: SharedValue<number>,
  frameW: SharedValue<number>,
  frameH: SharedValue<number>,
  inset: SharedValue<Insets>,
) {
  return useAnimatedStyle(() => {
    const i = inset.value;
    return {
      transform: [
        { translateX: clampAxis(nx.value * frameW.value, frameW.value, i.left, i.right) - TOUCH / 2 },
        { translateY: clampAxis(ny.value * frameH.value, frameH.value, i.top, i.bottom) - TOUCH / 2 },
      ],
    };
  });
}

const PUCK_BOX = {
  position: "absolute",
  left: 0,
  top: 0,
  width: TOUCH,
  height: TOUCH,
  alignItems: "center",
  justifyContent: "center",
} as const;

/**
 * An SVG arc on a circle, angles in degrees measured clockwise from 12 o'clock,
 * so a gap "at the top" is simply the span either side of 0.
 */
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const at = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  };
  const a = at(startDeg);
  const b = at(endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  // Sweep 1 = clockwise on screen, matching the clockwise angle convention.
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

// --- Exposure: open circle, gaps top and bottom ------------------------------
const EXPO_R = 38;
const EXPO_GAP_DEG = 32;
const EXPO_PATHS = [
  arcPath(HALF, HALF, EXPO_R, EXPO_GAP_DEG / 2, 180 - EXPO_GAP_DEG / 2),
  arcPath(HALF, HALF, EXPO_R, 180 + EXPO_GAP_DEG / 2, 360 - EXPO_GAP_DEG / 2),
];

// --- Focus: rounded square, gaps on the left and right sides ------------------
const FOCUS_SIDE = 76;
const FOCUS_R = 8;
const FOCUS_GAP = 22;
const FOCUS_PATHS = (() => {
  const lo = (DRAW - FOCUS_SIDE) / 2;
  const hi = lo + FOCUS_SIDE;
  const gapTop = HALF - FOCUS_GAP / 2;
  const gapBottom = HALF + FOCUS_GAP / 2;
  // Upper bracket runs clockwise (left side up, across the top, right side down),
  // the lower one anticlockwise, so each corner arc bends the right way.
  const upper =
    `M ${lo} ${gapTop} L ${lo} ${lo + FOCUS_R} ` +
    `A ${FOCUS_R} ${FOCUS_R} 0 0 1 ${lo + FOCUS_R} ${lo} ` +
    `L ${hi - FOCUS_R} ${lo} ` +
    `A ${FOCUS_R} ${FOCUS_R} 0 0 1 ${hi} ${lo + FOCUS_R} ` +
    `L ${hi} ${gapTop}`;
  const lower =
    `M ${lo} ${gapBottom} L ${lo} ${hi - FOCUS_R} ` +
    `A ${FOCUS_R} ${FOCUS_R} 0 0 0 ${lo + FOCUS_R} ${hi} ` +
    `L ${hi - FOCUS_R} ${hi} ` +
    `A ${FOCUS_R} ${FOCUS_R} 0 0 0 ${hi} ${hi - FOCUS_R} ` +
    `L ${hi} ${gapBottom}`;
  return [upper, lower];
})();

function ReticleShape({ paths, locked }: { readonly paths: readonly string[]; readonly locked: boolean }) {
  const color = locked ? filmic.color.alert : filmic.color.accent;
  return (
    <Svg width={DRAW} height={DRAW} viewBox={`0 0 ${DRAW} ${DRAW}`} pointerEvents="none">
      {paths.map((d, i) => (
        <Path key={`s${i}`} d={d} stroke={SHADOW_COLOR} strokeWidth={SHADOW_STROKE} strokeLinecap="round" fill="none" />
      ))}
      {paths.map((d, i) => (
        <Path key={`c${i}`} d={d} stroke={color} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
      ))}
    </Svg>
  );
}

export function Reticles({
  canFocus,
  canExpose,
  insets,
  exposureLocked,
  onFocus,
  onExposurePoint,
  onExposureLock,
}: {
  /** False until a camera is open; nothing to focus before that. */
  readonly canFocus: boolean;
  /** False when the lens reports no exposure range to give. */
  readonly canExpose: boolean;
  /** Screen space (px) taken by chrome on each side; pucks stay inside the picture area between them. */
  readonly insets: { left: number; right: number; top: number; bottom: number };
  readonly exposureLocked: boolean;
  /** Focus point, normalised 0..1 of the FULL frame, committed on release. */
  readonly onFocus: (x: number, y: number) => void;
  /** Exposure point, normalised 0..1 of the FULL frame. Called once after first layout with the default position, throttled (80ms) while dragging, and on release. */
  readonly onExposurePoint: (x: number, y: number) => void;
  readonly onExposureLock: (on: boolean) => void;
}) {
  // React only needs to know whether there is anything to draw on yet; the
  // size itself lives in shared values, which is where the worklets read it.
  const [sized, setSized] = useState(false);
  const frameW = useSharedValue(0);
  const frameH = useSharedValue(0);

  // Deps on the inset numbers, not the object: a parent passing a fresh literal
  // each render must not push a new value to the UI thread every render.
  const { left: insetL, right: insetR, top: insetT, bottom: insetB } = insets;
  const inset = useSharedValue<Insets>({ left: insetL, right: insetR, top: insetT, bottom: insetB });
  useEffect(() => {
    inset.value = { left: insetL, right: insetR, top: insetT, bottom: insetB };
  }, [inset, insetL, insetR, insetT, insetB]);

  // Normalised puck centres. Not drawn until the first real layout has placed
  // them, because the defaults sit inside the picture area and that needs the
  // frame and insets.
  const [placed, setPlaced] = useState(false);
  const placedRef = useRef(false);
  const focusX = useSharedValue(0);
  const focusY = useSharedValue(0);
  const expoX = useSharedValue(0);
  const expoY = useSharedValue(0);

  // The callbacks are reached through refs so the gestures are built once:
  // a parent passing fresh closures must not rebuild them under the thumb.
  const insetsRef = useRef<Insets>(insets);
  insetsRef.current = insets;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const onExposurePointRef = useRef(onExposurePoint);
  onExposurePointRef.current = onExposurePoint;
  const onExposureLockRef = useRef(onExposureLock);
  onExposureLockRef.current = onExposureLock;

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      frameW.value = width;
      frameH.value = height;
      setSized(width > 0 && height > 0);
      if (width === 0 || height === 0 || placedRef.current) return;
      // First real layout: place both pucks apart so they read at once, and tell
      // the parent where exposure is metering so the camera and the puck agree
      // before the operator has touched anything.
      const i = insetsRef.current;
      const areaW = Math.max(0, width - i.left - i.right);
      const areaH = Math.max(0, height - i.top - i.bottom);
      const cy = (i.top + areaH / 2) / height;
      const expo = { x: (i.left + areaW * 0.35) / width, y: cy };
      const focus = { x: (i.left + areaW * 0.65) / width, y: cy };
      placedRef.current = true;
      expoX.value = expo.x;
      expoY.value = expo.y;
      focusX.value = focus.x;
      focusY.value = focus.y;
      setPlaced(true);
      onExposurePointRef.current(expo.x, expo.y);
    },
    [frameW, frameH, expoX, expoY, focusX, focusY],
  );

  // Focus lock is a viewfinder state: there is no separate native focus-lock
  // beyond the hold that placing the point already applies, so the lock simply
  // freezes the puck and signals "held". Both locks change rarely, so they stay
  // React state (they recolour the drawing) and are mirrored for the worklets.
  const [focusLocked, setFocusLocked] = useState(false);
  const focusLockedSV = useSharedValue(false);
  useEffect(() => {
    focusLockedSV.value = focusLocked;
  }, [focusLocked, focusLockedSV]);
  const exposureLockedRef = useRef(exposureLocked);
  exposureLockedRef.current = exposureLocked;
  const exposureLockedSV = useSharedValue(exposureLocked);
  useEffect(() => {
    exposureLockedSV.value = exposureLocked;
  }, [exposureLocked, exposureLockedSV]);

  // JS-side landing points for the worklets.
  const emitFocus = useCallback((x: number, y: number) => onFocusRef.current(x, y), []);
  const emitExposurePoint = useCallback((x: number, y: number) => onExposurePointRef.current(x, y), []);
  const toggleFocusLock = useCallback(() => setFocusLocked((v) => !v), []);
  const toggleExposureLock = useCallback(() => onExposureLockRef.current(!exposureLockedRef.current), []);

  // --- Focus puck: drag to rack focus, tap to lock --------------------------
  const focusStart = useSharedValue<Point>({ x: 0, y: 0 });
  const focusGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(canFocus)
      .onStart(() => {
        if (focusLockedSV.value) return;
        // Start from where the puck is drawn (clamped), not the stored value, so
        // the first drag after a rotation does not jump.
        const i = inset.value;
        focusStart.value = {
          x: clampAxis(focusX.value * frameW.value, frameW.value, i.left, i.right),
          y: clampAxis(focusY.value * frameH.value, frameH.value, i.top, i.bottom),
        };
      })
      .onUpdate((e) => {
        const w = frameW.value;
        const h = frameH.value;
        if (focusLockedSV.value || w === 0 || h === 0) return;
        const i = inset.value;
        focusX.value = clampAxis(focusStart.value.x + e.translationX, w, i.left, i.right) / w;
        focusY.value = clampAxis(focusStart.value.y + e.translationY, h, i.top, i.bottom) / h;
      })
      .onEnd(() => {
        if (focusLockedSV.value) return;
        // Rack focus once, on release, rather than spamming tap-to-focus events
        // across the whole drag.
        scheduleOnRN(emitFocus, focusX.value, focusY.value);
      });

    const tap = Gesture.Tap()
      .enabled(canFocus)
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) scheduleOnRN(toggleFocusLock);
      });

    return Gesture.Exclusive(pan, tap);
  }, [canFocus, emitFocus, toggleFocusLock, focusLockedSV, focusStart, focusX, focusY, frameW, frameH, inset]);

  // --- Exposure puck: drag to set metering point, tap to AE-lock ------------
  const expoStart = useSharedValue<Point>({ x: 0, y: 0 });
  const lastExpoApply = useSharedValue(0);
  const expoGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(canExpose)
      .onStart(() => {
        if (exposureLockedSV.value) return;
        const i = inset.value;
        expoStart.value = {
          x: clampAxis(expoX.value * frameW.value, frameW.value, i.left, i.right),
          y: clampAxis(expoY.value * frameH.value, frameH.value, i.top, i.bottom),
        };
      })
      .onUpdate((e) => {
        const w = frameW.value;
        const h = frameH.value;
        if (exposureLockedSV.value || w === 0 || h === 0) return;
        const i = inset.value;
        const x = clampAxis(expoStart.value.x + e.translationX, w, i.left, i.right) / w;
        const y = clampAxis(expoStart.value.y + e.translationY, h, i.top, i.bottom) / h;
        expoX.value = x;
        expoY.value = y;
        // Meter live as it moves, but not every frame: each update is a native
        // camera call on the JS side.
        const now = Date.now();
        if (now - lastExpoApply.value > EXPO_APPLY_MS) {
          lastExpoApply.value = now;
          scheduleOnRN(emitExposurePoint, x, y);
        }
      })
      .onEnd(() => {
        if (exposureLockedSV.value) return;
        scheduleOnRN(emitExposurePoint, expoX.value, expoY.value);
      });

    const tap = Gesture.Tap()
      .enabled(canExpose)
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) scheduleOnRN(toggleExposureLock);
      });

    return Gesture.Exclusive(pan, tap);
  }, [
    canExpose,
    emitExposurePoint,
    toggleExposureLock,
    exposureLockedSV,
    expoStart,
    lastExpoApply,
    expoX,
    expoY,
    frameW,
    frameH,
    inset,
  ]);

  const focusStyle = usePuckStyle(focusX, focusY, frameW, frameH, inset);
  const expoStyle = usePuckStyle(expoX, expoY, frameW, frameH, inset);

  if (!sized || !placed) {
    return <View pointerEvents="box-none" style={{ flex: 1 }} onLayout={onLayout} />;
  }

  return (
    <View pointerEvents="box-none" style={{ flex: 1 }} onLayout={onLayout}>
      {canFocus ? (
        <GestureDetector gesture={focusGesture}>
          <Animated.View
            accessibilityRole="button"
            accessibilityLabel="Focus point"
            accessibilityHint="Drag to move. Tap to lock."
            accessibilityState={{ selected: focusLocked }}
            style={[PUCK_BOX, focusStyle]}
          >
            <ReticleShape paths={FOCUS_PATHS} locked={focusLocked} />
          </Animated.View>
        </GestureDetector>
      ) : null}

      {canExpose ? (
        <GestureDetector gesture={expoGesture}>
          <Animated.View
            accessibilityRole="button"
            accessibilityLabel="Exposure point"
            accessibilityHint="Drag to move. Tap to lock."
            accessibilityState={{ selected: exposureLocked }}
            style={[PUCK_BOX, expoStyle]}
          >
            <ReticleShape paths={EXPO_PATHS} locked={exposureLocked} />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}
