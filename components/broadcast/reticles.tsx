import { useCallback, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Path } from "react-native-svg";

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

type Frame = { width: number; height: number };
type Insets = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };

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
  const [frame, setFrame] = useState<Frame>({ width: 0, height: 0 });

  // Normalised puck centres. Null until the first real layout, because the
  // defaults sit inside the picture area and that needs the frame and insets.
  // Mirrored into refs so a gesture reads the live position at onStart without
  // listing the position in its deps - otherwise every drag frame would rebuild
  // the gesture under the thumb and stutter the drag.
  const [focusN, setFocusN] = useState<Point | null>(null);
  const [expoN, setExpoN] = useState<Point | null>(null);
  const focusNRef = useRef(focusN);
  focusNRef.current = focusN;
  const expoNRef = useRef(expoN);
  expoNRef.current = expoN;

  // Read through refs in onLayout so the callback stays stable and the defaults
  // use whatever insets are current at the moment the frame first measures.
  const insetsRef = useRef<Insets>(insets);
  insetsRef.current = insets;
  const onExposurePointRef = useRef(onExposurePoint);
  onExposurePointRef.current = onExposurePoint;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setFrame({ width, height });
    if (width === 0 || height === 0 || expoNRef.current !== null) return;
    // First real layout: place both pucks apart so they read at once, and tell
    // the parent where exposure is metering so the camera and the puck agree
    // before the operator has touched anything.
    const i = insetsRef.current;
    const areaW = Math.max(0, width - i.left - i.right);
    const areaH = Math.max(0, height - i.top - i.bottom);
    const cy = (i.top + areaH / 2) / height;
    const expo = { x: (i.left + areaW * 0.35) / width, y: cy };
    const focus = { x: (i.left + areaW * 0.65) / width, y: cy };
    expoNRef.current = expo;
    focusNRef.current = focus;
    setExpoN(expo);
    setFocusN(focus);
    onExposurePointRef.current(expo.x, expo.y);
  }, []);

  // Deps on the inset numbers, not the object: a parent passing a fresh literal
  // each render must not rebuild the gestures mid-drag.
  const { left: insetL, right: insetR, top: insetT, bottom: insetB } = insets;

  // Keep the whole drawing inside the picture area, off the chrome. If the area
  // is narrower than a reticle, park it in the middle rather than inverting.
  const clampX = useCallback(
    (px: number) => {
      const min = insetL + HALF;
      const max = frame.width - insetR - HALF;
      if (max < min) return (min + max) / 2;
      return Math.min(max, Math.max(min, px));
    },
    [frame.width, insetL, insetR],
  );
  const clampY = useCallback(
    (py: number) => {
      const min = insetT + HALF;
      const max = frame.height - insetB - HALF;
      if (max < min) return (min + max) / 2;
      return Math.min(max, Math.max(min, py));
    },
    [frame.height, insetT, insetB],
  );

  // Pixel centre of a puck, clamped at render time too so a rotation or a
  // changed inset never leaves a puck under the chrome.
  const toPx = useCallback(
    (n: Point): Point => ({ x: clampX(n.x * frame.width), y: clampY(n.y * frame.height) }),
    [clampX, clampY, frame],
  );

  // Focus lock is a viewfinder state: there is no separate native focus-lock
  // beyond the hold that placing the point already applies, so the lock simply
  // freezes the puck and signals "held".
  const [focusLocked, setFocusLocked] = useState(false);
  const focusLockedRef = useRef(focusLocked);
  focusLockedRef.current = focusLocked;
  const exposureLockedRef = useRef(exposureLocked);
  exposureLockedRef.current = exposureLocked;

  // --- Focus puck: drag to rack focus, tap to lock --------------------------
  const focusStart = useRef<Point>({ x: 0, y: 0 });
  const focusGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(canFocus)
      .runOnJS(true)
      .onStart(() => {
        if (focusLockedRef.current || !focusNRef.current) return;
        // Start from where the puck is drawn (clamped), not the stored value, so
        // the first drag after a rotation does not jump.
        focusStart.current = toPx(focusNRef.current);
      })
      .onUpdate((e) => {
        if (focusLockedRef.current || frame.width === 0 || frame.height === 0) return;
        const px = clampX(focusStart.current.x + e.translationX);
        const py = clampY(focusStart.current.y + e.translationY);
        const next = { x: px / frame.width, y: py / frame.height };
        focusNRef.current = next;
        setFocusN(next);
      })
      .onEnd(() => {
        if (focusLockedRef.current || !focusNRef.current) return;
        // Rack focus once, on release, rather than spamming tap-to-focus events
        // across the whole drag.
        onFocus(focusNRef.current.x, focusNRef.current.y);
      });

    const tap = Gesture.Tap()
      .enabled(canFocus)
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) setFocusLocked((v) => !v);
      });

    return Gesture.Exclusive(pan, tap);
  }, [canFocus, frame, clampX, clampY, toPx, onFocus]);

  // --- Exposure puck: drag to set metering point, tap to AE-lock ------------
  const expoStart = useRef<Point>({ x: 0, y: 0 });
  const lastExpoApply = useRef(0);
  const expoGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(canExpose)
      .runOnJS(true)
      .onStart(() => {
        if (exposureLockedRef.current || !expoNRef.current) return;
        expoStart.current = toPx(expoNRef.current);
      })
      .onUpdate((e) => {
        if (exposureLockedRef.current || frame.width === 0 || frame.height === 0) return;
        const px = clampX(expoStart.current.x + e.translationX);
        const py = clampY(expoStart.current.y + e.translationY);
        const next = { x: px / frame.width, y: py / frame.height };
        expoNRef.current = next;
        setExpoN(next);
        // Meter live as it moves, but not every frame.
        const now = Date.now();
        if (now - lastExpoApply.current > EXPO_APPLY_MS) {
          lastExpoApply.current = now;
          onExposurePoint(next.x, next.y);
        }
      })
      .onEnd(() => {
        if (exposureLockedRef.current || !expoNRef.current) return;
        onExposurePoint(expoNRef.current.x, expoNRef.current.y);
      });

    const tap = Gesture.Tap()
      .enabled(canExpose)
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) onExposureLock(!exposureLockedRef.current);
      });

    return Gesture.Exclusive(pan, tap);
  }, [canExpose, frame, clampX, clampY, toPx, onExposurePoint, onExposureLock]);

  if (frame.width === 0 || frame.height === 0 || !focusN || !expoN) {
    return <View pointerEvents="box-none" style={{ flex: 1 }} onLayout={onLayout} />;
  }

  const focusPx = toPx(focusN);
  const expoPx = toPx(expoN);

  return (
    <View pointerEvents="box-none" style={{ flex: 1 }} onLayout={onLayout}>
      {canFocus ? (
        <GestureDetector gesture={focusGesture}>
          <View
            accessibilityRole="button"
            accessibilityLabel="Focus point"
            accessibilityHint="Drag to move. Tap to lock."
            accessibilityState={{ selected: focusLocked }}
            style={{
              position: "absolute",
              left: focusPx.x - TOUCH / 2,
              top: focusPx.y - TOUCH / 2,
              width: TOUCH,
              height: TOUCH,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ReticleShape paths={FOCUS_PATHS} locked={focusLocked} />
          </View>
        </GestureDetector>
      ) : null}

      {canExpose ? (
        <GestureDetector gesture={expoGesture}>
          <View
            accessibilityRole="button"
            accessibilityLabel="Exposure point"
            accessibilityHint="Drag to move. Tap to lock."
            accessibilityState={{ selected: exposureLocked }}
            style={{
              position: "absolute",
              left: expoPx.x - TOUCH / 2,
              top: expoPx.y - TOUCH / 2,
              width: TOUCH,
              height: TOUCH,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ReticleShape paths={EXPO_PATHS} locked={exposureLocked} />
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}
