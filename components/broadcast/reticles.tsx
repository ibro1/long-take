import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
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
 * Dropping one puck onto the other (centres within JOIN_PX) JOINS them: the
 * dropped one snaps onto the other and they sit concentric, the exposure circle
 * around the focus square, so focus and exposure measure the same spot. Joined,
 * a drag moves both, a tap locks or frees both, and a long-press separates them
 * again - the exposure puck springs off to the left. A long-press on a lone puck
 * does nothing, so holding still before a drag never steals the drag.
 *
 * A double-tap sends a puck home - the spot first layout gave it - and frees it;
 * a joined pair goes home to the centre of the picture. A single tap waits for
 * the double-tap to fail first, so a double-tap is never read as two lock taps.
 *
 * Positions are kept normalised (0..1) of the FULL frame, not the picture area,
 * because the parent maps them straight onto the camera view underneath.
 *
 * The drag runs entirely on the UI thread: positions are shared values moved by
 * gesture worklets and drawn by animated transforms, so a JS thread busy with an
 * hour of live stream never makes a puck lag the thumb. Only the results - the
 * focus point, the throttled metering point, a lock toggle, joined or not -
 * cross to JS.
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

/** Centres closer than this on release join the two pucks. */
const JOIN_PX = 36;

/** How far apart a long-press puts a joined pair: exposure goes this far left of focus. */
const SPLIT_PX = 120;

/** Hold time for the long-press that separates a joined pair. */
const SPLIT_HOLD_MS = 400;

/**
 * Longest wait between the two taps of a double-tap. A lone tap (the lock) waits
 * this long for a second one before it counts, so it is kept under the 500ms
 * default to keep the lock feeling immediate.
 */
const DOUBLE_TAP_MS = 300;

/** Home positions across the picture area, as a fraction of its width. */
const EXPO_HOME = 0.35;
const FOCUS_HOME = 0.65;
const PAIR_HOME = 0.5;

/** Quick and only just underdamped: the puck lands with a hint of settle, not a wobble. */
const SNAP_SPRING = { damping: 22, stiffness: 260, mass: 1 } as const;

type Insets = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };

/** Where a drag began, and what the drag is allowed to do (decided once, at start). */
type DragStart = { x: number; y: number; ok: boolean; joined: boolean };

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
 * A home position, normalised to the full frame: `across` of the way over the
 * picture area, vertically centred in it. Shared by first layout (JS) and the
 * double-tap (UI thread) so "home" is the same place for both.
 */
function homePoint(across: number, w: number, h: number, i: Insets): Point {
  "worklet";
  const areaW = Math.max(0, w - i.left - i.right);
  const areaH = Math.max(0, h - i.top - i.bottom);
  return { x: (i.left + areaW * across) / w, y: (i.top + areaH / 2) / h };
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
      const expo = homePoint(EXPO_HOME, width, height, i);
      const focus = homePoint(FOCUS_HOME, width, height, i);
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
  const focusLockedRef = useRef(focusLocked);
  focusLockedRef.current = focusLocked;
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

  // Joined or not. The UI thread owns it - a drop joins and a long-press splits,
  // both inside worklets - and React gets a copy only to word the accessibility
  // hints. A pair needs both pucks on screen, so losing either one splits it.
  const pairable = canFocus && canExpose;
  const joinedSV = useSharedValue(false);
  const [joined, setJoined] = useState(false);
  useEffect(() => {
    if (pairable) return;
    joinedSV.value = false;
    setJoined(false);
  }, [pairable, joinedSV]);

  // JS-side landing points for the worklets.
  const emitFocus = useCallback((x: number, y: number) => onFocusRef.current(x, y), []);
  const emitExposurePoint = useCallback((x: number, y: number) => onExposurePointRef.current(x, y), []);
  const toggleFocusLock = useCallback(() => setFocusLocked((v) => !v), []);
  const toggleExposureLock = useCallback(() => onExposureLockRef.current(!exposureLockedRef.current), []);
  // A joined pair locks as one. They can differ - a free puck may be dropped onto
  // a locked one - so rather than flip each (which would keep them out of step),
  // a tap frees both if either is held, and holds both otherwise.
  const togglePairLock = useCallback(() => {
    const next = !(focusLockedRef.current || exposureLockedRef.current);
    setFocusLocked(next);
    if (exposureLockedRef.current !== next) onExposureLockRef.current(next);
  }, []);
  const unlockFocus = useCallback(() => setFocusLocked(false), []);
  const unlockExposure = useCallback(() => {
    if (exposureLockedRef.current) onExposureLockRef.current(false);
  }, []);

  // --- Both pucks: drag, tap to lock, double-tap home, long-press to split ---
  // One builder for both, because joined they behave as one: whichever puck
  // the thumb lands on (exposure, drawn on top) has to drive the pair.
  const focusDrag = useSharedValue<DragStart>({ x: 0, y: 0, ok: false, joined: false });
  const expoDrag = useSharedValue<DragStart>({ x: 0, y: 0, ok: false, joined: false });
  const lastExpoApply = useSharedValue(0);
  const [focusGesture, expoGesture] = useMemo(() => {
    const build = (isFocus: boolean) => {
      const enabled = isFocus ? canFocus : canExpose;
      const selfX = isFocus ? focusX : expoX;
      const selfY = isFocus ? focusY : expoY;
      const otherX = isFocus ? expoX : focusX;
      const otherY = isFocus ? expoY : focusY;
      const selfLocked = isFocus ? focusLockedSV : exposureLockedSV;
      const otherLocked = isFocus ? exposureLockedSV : focusLockedSV;
      const drag = isFocus ? focusDrag : expoDrag;
      const emitSelf = isFocus ? emitFocus : emitExposurePoint;

      const pan = Gesture.Pan()
        .enabled(enabled)
        .onStart(() => {
          // A locked puck never moves, and a pair moves only if neither half is
          // held. Decided once here so a drag cannot change its mind halfway.
          const together = joinedSV.value;
          const ok = !selfLocked.value && !(together && otherLocked.value);
          // Start from where the puck is drawn (clamped), not the stored value, so
          // the first drag after a rotation does not jump.
          const i = inset.value;
          drag.value = {
            x: clampAxis(selfX.value * frameW.value, frameW.value, i.left, i.right),
            y: clampAxis(selfY.value * frameH.value, frameH.value, i.top, i.bottom),
            ok,
            joined: together,
          };
        })
        .onUpdate((e) => {
          const w = frameW.value;
          const h = frameH.value;
          const d = drag.value;
          if (!d.ok || w === 0 || h === 0) return;
          const i = inset.value;
          const x = clampAxis(d.x + e.translationX, w, i.left, i.right) / w;
          const y = clampAxis(d.y + e.translationY, h, i.top, i.bottom) / h;
          selfX.value = x;
          selfY.value = y;
          if (d.joined) {
            otherX.value = x;
            otherY.value = y;
          }
          // Meter live as it moves, but not every frame: each update is a native
          // camera call on the JS side. Focus still waits for the release.
          if (!isFocus || d.joined) {
            const now = Date.now();
            if (now - lastExpoApply.value > EXPO_APPLY_MS) {
              lastExpoApply.value = now;
              scheduleOnRN(emitExposurePoint, x, y);
            }
          }
        })
        .onEnd(() => {
          const d = drag.value;
          if (!d.ok) return;
          const x = selfX.value;
          const y = selfY.value;
          if (d.joined) {
            // Rack focus once, on release, rather than spamming tap-to-focus
            // events across the whole drag; exposure settles on the same spot.
            scheduleOnRN(emitFocus, x, y);
            scheduleOnRN(emitExposurePoint, x, y);
            return;
          }
          // Dropped close enough to the other puck: join. Measured between the
          // drawn (clamped) centres, which is what the operator is lining up.
          const w = frameW.value;
          const h = frameH.value;
          if (pairable && !joinedSV.value && w > 0 && h > 0) {
            const i = inset.value;
            const ox = clampAxis(otherX.value * w, w, i.left, i.right);
            const oy = clampAxis(otherY.value * h, h, i.top, i.bottom);
            const dx = x * w - ox;
            const dy = y * h - oy;
            if (dx * dx + dy * dy < JOIN_PX * JOIN_PX) {
              const jx = ox / w;
              const jy = oy / h;
              // Pin the other to its drawn spot too, so the pair's two stored
              // points are the same number, not merely drawn in the same place.
              otherX.value = jx;
              otherY.value = jy;
              selfX.value = withSpring(jx, SNAP_SPRING);
              selfY.value = withSpring(jy, SNAP_SPRING);
              joinedSV.value = true;
              scheduleOnRN(setJoined, true);
              // Only the dropped puck moved; the other is already measuring there.
              scheduleOnRN(emitSelf, jx, jy);
              return;
            }
          }
          scheduleOnRN(emitSelf, x, y);
        });

      // Only a joined pair has anything to split. On a lone puck the hold is
      // failed the moment the finger lands, so it can never win the race and
      // cancel a drag that starts after a pause.
      const split = Gesture.LongPress()
        .enabled(enabled && pairable)
        .minDuration(SPLIT_HOLD_MS)
        .maxDistance(10)
        .onTouchesDown((_e, manager) => {
          if (!joinedSV.value) manager.fail();
        })
        .onStart(() => {
          const w = frameW.value;
          const h = frameH.value;
          // Splitting moves the exposure puck, and a locked puck never moves:
          // a held pair is freed with a tap first.
          if (!joinedSV.value || exposureLockedSV.value || w === 0 || h === 0) return;
          const i = inset.value;
          const fx = clampAxis(focusX.value * w, w, i.left, i.right);
          const fy = clampAxis(focusY.value * h, h, i.top, i.bottom);
          // Left of focus as asked; but against the left edge the clamp would
          // leave the two still overlapping, so then go right if that is roomier.
          const left = clampAxis(fx - SPLIT_PX, w, i.left, i.right);
          const right = clampAxis(fx + SPLIT_PX, w, i.left, i.right);
          const ex = fx - left >= SPLIT_PX || fx - left >= right - fx ? left : right;
          joinedSV.value = false;
          scheduleOnRN(setJoined, false);
          expoX.value = withSpring(ex / w, SNAP_SPRING);
          expoY.value = withSpring(fy / h, SNAP_SPRING);
          scheduleOnRN(emitExposurePoint, ex / w, fy / h);
        });

      // Home, and freed: the way back from a puck parked somewhere unhelpful.
      const home = Gesture.Tap()
        .enabled(enabled)
        .numberOfTaps(2)
        .maxDelay(DOUBLE_TAP_MS)
        .maxDistance(10)
        .onEnd((_e, success) => {
          const w = frameW.value;
          const h = frameH.value;
          if (!success || w === 0 || h === 0) return;
          const i = inset.value;
          if (joinedSV.value) {
            const c = homePoint(PAIR_HOME, w, h, i);
            focusX.value = withSpring(c.x, SNAP_SPRING);
            focusY.value = withSpring(c.y, SNAP_SPRING);
            expoX.value = withSpring(c.x, SNAP_SPRING);
            expoY.value = withSpring(c.y, SNAP_SPRING);
            focusLockedSV.value = false;
            scheduleOnRN(unlockFocus);
            scheduleOnRN(unlockExposure);
            scheduleOnRN(emitFocus, c.x, c.y);
            scheduleOnRN(emitExposurePoint, c.x, c.y);
            return;
          }
          const c = homePoint(isFocus ? FOCUS_HOME : EXPO_HOME, w, h, i);
          selfX.value = withSpring(c.x, SNAP_SPRING);
          selfY.value = withSpring(c.y, SNAP_SPRING);
          if (isFocus) {
            focusLockedSV.value = false;
            scheduleOnRN(unlockFocus);
          } else {
            scheduleOnRN(unlockExposure);
          }
          scheduleOnRN(emitSelf, c.x, c.y);
        });

      const tap = Gesture.Tap()
        .enabled(enabled)
        .maxDistance(10)
        .onEnd((_e, success) => {
          if (!success) return;
          if (joinedSV.value) scheduleOnRN(togglePairLock);
          else scheduleOnRN(isFocus ? toggleFocusLock : toggleExposureLock);
        });

      // Drag first; failing that the double-tap, and only once that has failed
      // too the single tap - so one tap of a double never toggles the lock. The
      // hold races the lot: past SPLIT_HOLD_MS without moving it wins, and a
      // drag that starts sooner cancels it.
      return Gesture.Race(split, Gesture.Exclusive(pan, home, tap));
    };
    return [build(true), build(false)] as const;
  }, [
    canFocus,
    canExpose,
    pairable,
    emitFocus,
    emitExposurePoint,
    toggleFocusLock,
    toggleExposureLock,
    togglePairLock,
    unlockFocus,
    unlockExposure,
    focusLockedSV,
    exposureLockedSV,
    joinedSV,
    focusDrag,
    expoDrag,
    lastExpoApply,
    focusX,
    focusY,
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

  // Joined, the two boxes sit on one centre, so the drawings come out
  // concentric with no extra layout: the r=38 circle meets the 76 square at the
  // middle of each side, where one or the other has its gap. Exposure is drawn
  // last and so takes the touch, and its gesture drives the pair.
  const hint = joined
    ? "Joined to the other point. Drag to move both. Tap to lock both. Double-tap to centre. Long-press to separate."
    : "Drag to move, or drop on the other point to join them. Tap to lock. Double-tap to reset.";

  return (
    <View pointerEvents="box-none" style={{ flex: 1 }} onLayout={onLayout}>
      {canFocus ? (
        <GestureDetector gesture={focusGesture}>
          <Animated.View
            accessibilityRole="button"
            accessibilityLabel="Focus point"
            accessibilityHint={hint}
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
            accessibilityHint={hint}
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
