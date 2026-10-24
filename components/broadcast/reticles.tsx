import { useCallback, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Text } from "@/components/ui/text";

import { ExposureIcon, FocusIcon, LockedIcon } from "./icons";

/**
 * The Filmic-style monitoring reticles: two pucks that live on the picture, one
 * for focus and one for exposure, each dragged to wherever the operator wants
 * that thing measured. Unlike a tap-to-focus flash, they are always on screen -
 * the shot is being judged through them, so they stay put until moved.
 *
 * Focus (the square) racks focus to where it is dropped. Exposure (the circle
 * with the sun) is the metering point: the camera reads the light under it, so
 * moving it onto a bright area darkens the picture and onto a dark area brightens
 * it - there is no separate brightness slider, the position is the control.
 *
 * A tap on either puck locks it: its position and its setting freeze (focus held,
 * exposure AE-locked) and it can no longer be dragged. A second tap frees it.
 *
 * Positions are kept normalised (0..1) so a reticle stays on the same part of
 * the picture when the phone turns or the frame is remeasured.
 */

/** The focus square's side, big enough to grab, small enough to aim. */
const FOCUS_SIZE = 76;

/** The exposure puck's diameter. */
const EXPO_SIZE = 64;

/** Throttle for live metering updates while dragging the exposure puck. */
const EXPO_APPLY_MS = 80;

type Frame = { width: number; height: number };

export function Reticles({
  canFocus,
  canExpose,
  rightInset,
  exposureLocked,
  onFocus,
  onExposurePoint,
  onExposureLock,
}: {
  /** False until a camera is open; nothing to focus before that. */
  readonly canFocus: boolean;
  /** False when the lens reports no exposure range to give. */
  readonly canExpose: boolean;
  /** Width of the landscape control column to keep the pucks clear of, or 0. */
  readonly rightInset: number;
  readonly exposureLocked: boolean;
  /** Autofocus point, normalised 0..1, committed when the puck is dropped. */
  readonly onFocus: (x: number, y: number) => void;
  /** Exposure metering point, normalised 0..1, updated while dragging. */
  readonly onExposurePoint: (x: number, y: number) => void;
  readonly onExposureLock: (on: boolean) => void;
}) {
  const [frame, setFrame] = useState<Frame>({ width: 0, height: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setFrame(e.nativeEvent.layout);
  }, []);

  // Normalised puck centres. Start offset from each other so both read at once.
  // Mirrored into refs so a gesture reads the live position at onStart without
  // listing the position in its deps - otherwise every drag frame would rebuild
  // the gesture under the thumb and stutter the drag.
  const [focusN, setFocusN] = useState({ x: 0.42, y: 0.5 });
  const [expoN, setExpoN] = useState({ x: 0.6, y: 0.5 });
  const focusNRef = useRef(focusN);
  focusNRef.current = focusN;
  const expoNRef = useRef(expoN);
  expoNRef.current = expoN;

  // Focus lock is a viewfinder state: there is no separate native focus-lock
  // beyond the hold that placing the point already applies, so the lock simply
  // freezes the puck and signals "held".
  const [focusLocked, setFocusLocked] = useState(false);
  const focusLockedRef = useRef(focusLocked);
  focusLockedRef.current = focusLocked;
  const exposureLockedRef = useRef(exposureLocked);
  exposureLockedRef.current = exposureLocked;

  // The reachable area, keeping a puck off the edge and out from under the
  // landscape control column.
  const bounds = useMemo(() => {
    const right = Math.max(0, frame.width - rightInset);
    return { left: 0, top: 0, right, bottom: frame.height };
  }, [frame, rightInset]);

  const clampX = useCallback(
    (px: number, half: number) => Math.min(bounds.right - half, Math.max(bounds.left + half, px)),
    [bounds],
  );
  const clampY = useCallback(
    (px: number, half: number) => Math.min(bounds.bottom - half, Math.max(bounds.top + half, px)),
    [bounds],
  );

  // --- Focus puck: drag to rack focus, tap to lock --------------------------
  const focusStart = useRef({ x: 0, y: 0 });
  const focusGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(canFocus)
      .runOnJS(true)
      .onStart(() => {
        if (focusLockedRef.current) return;
        focusStart.current = {
          x: focusNRef.current.x * frame.width,
          y: focusNRef.current.y * frame.height,
        };
      })
      .onUpdate((e) => {
        if (focusLockedRef.current || frame.width === 0 || frame.height === 0) return;
        const half = FOCUS_SIZE / 2;
        const px = clampX(focusStart.current.x + e.translationX, half);
        const py = clampY(focusStart.current.y + e.translationY, half);
        setFocusN({ x: px / frame.width, y: py / frame.height });
      })
      .onEnd(() => {
        if (focusLockedRef.current) return;
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
  }, [canFocus, frame, clampX, clampY, onFocus]);

  // --- Exposure puck: drag to set metering point, tap to AE-lock ------------
  const expoStart = useRef({ x: 0, y: 0 });
  const lastExpoApply = useRef(0);
  const expoGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(canExpose)
      .runOnJS(true)
      .onStart(() => {
        if (exposureLockedRef.current) return;
        expoStart.current = {
          x: expoNRef.current.x * frame.width,
          y: expoNRef.current.y * frame.height,
        };
      })
      .onUpdate((e) => {
        if (exposureLockedRef.current || frame.width === 0 || frame.height === 0) return;
        const half = EXPO_SIZE / 2;
        const px = clampX(expoStart.current.x + e.translationX, half);
        const py = clampY(expoStart.current.y + e.translationY, half);
        const nx = px / frame.width;
        const ny = py / frame.height;
        setExpoN({ x: nx, y: ny });
        // Meter live as it moves, but not every frame.
        const now = Date.now();
        if (now - lastExpoApply.current > EXPO_APPLY_MS) {
          lastExpoApply.current = now;
          onExposurePoint(nx, ny);
        }
      })
      .onEnd(() => {
        if (exposureLockedRef.current) return;
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
  }, [canExpose, frame, clampX, clampY, onExposurePoint, onExposureLock]);

  if (frame.width === 0 && frame.height === 0) {
    return <View pointerEvents="box-none" style={{ flex: 1 }} onLayout={onLayout} />;
  }

  const focusPx = { x: focusN.x * frame.width, y: focusN.y * frame.height };
  const expoPx = { x: expoN.x * frame.width, y: expoN.y * frame.height };

  return (
    <View pointerEvents="box-none" style={{ flex: 1 }} onLayout={onLayout}>
      {canFocus ? (
        <GestureDetector gesture={focusGesture}>
          <View
            style={{
              position: "absolute",
              left: focusPx.x - FOCUS_SIZE / 2,
              top: focusPx.y - FOCUS_SIZE / 2,
              width: FOCUS_SIZE,
              height: FOCUS_SIZE,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 10,
                borderWidth: 1.5,
                borderColor: focusLocked ? "#FCD34D" : "rgba(255,255,255,0.92)",
              }}
            />
            <FocusIcon className={focusLocked ? "h-4 w-4 text-amber-300" : "h-4 w-4 text-white/90"} />
            <View style={{ position: "absolute", bottom: -16 }}>
              <Badge text={focusLocked ? "AF·L" : "AF"} locked={focusLocked} />
            </View>
          </View>
        </GestureDetector>
      ) : null}

      {canExpose ? (
        <GestureDetector gesture={expoGesture}>
          <View
            style={{
              position: "absolute",
              left: expoPx.x - EXPO_SIZE / 2,
              top: expoPx.y - EXPO_SIZE / 2,
              width: EXPO_SIZE,
              height: EXPO_SIZE,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: EXPO_SIZE / 2,
                borderWidth: 2,
                borderColor: exposureLocked ? "#FCD34D" : "rgba(255,255,255,0.95)",
                backgroundColor: "rgba(0,0,0,0.22)",
              }}
            />
            {exposureLocked ? (
              <LockedIcon className="h-4 w-4 text-amber-300" />
            ) : (
              <ExposureIcon className="h-5 w-5 text-white" />
            )}
            <View style={{ position: "absolute", bottom: -16 }}>
              <Badge text={exposureLocked ? "AE·L" : "AE"} locked={exposureLocked} />
            </View>
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

function Badge({ text, locked }: { readonly text: string; readonly locked: boolean }) {
  return (
    <View className="rounded bg-black/60 px-1.5 py-0.5">
      <Text
        className={`text-[9px] font-semibold uppercase tracking-wide ${
          locked ? "text-amber-300" : "text-white/90"
        }`}
      >
        {text}
      </Text>
    </View>
  );
}
