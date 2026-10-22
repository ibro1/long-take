import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Text } from "@/components/ui/text";

import { ExposureIcon, LockedIcon, UnlockedIcon } from "./icons";
import { Mono } from "./mono";
import { formatEv } from "./stepper";

/**
 * Exposure, beside the thing being exposed.
 *
 * Every phone camera worth using puts this on the picture: tap a face, and a
 * rail appears next to the reticle with a sun on it that slides up for
 * brighter and down for darker. It is on the picture because that is what is
 * being judged - an operator watching a face go grey as somebody opens a
 * curtain wants the correction under the thumb already holding the phone, not
 * two taps into a panel where the face is covered by the panel.
 *
 * The same rail carries the lock, because the two are one decision. Lock holds
 * the metering where it is so a passing shoulder cannot pull the whole picture
 * down; the sun then trims what was locked. Android is explicit that
 * compensation still applies while the lock is on, so the two do not fight.
 *
 * It leaves on its own. A control drawn permanently over the shot is a control
 * competing with the shot, and the stepper in the camera panel is still there
 * for anyone who wants to take their time.
 */

/** The rail's own height, and so the travel one full drag is worth. */
const TRACK = 168;

/** Wide enough to be caught by a thumb aiming at a 2px line. */
const COLUMN = 48;

/** How far from the tapped point the rail sits, clear of the 72px reticle. */
const GAP = 52;

/** Long enough to use, short enough to stop being scenery. */
const IDLE_MS = 4200;

export type FocusPoint = {
  x: number;
  y: number;
  /** Changes on every tap, so the same spot tapped twice still re-shows. */
  at: number;
};

export function ExposureRail({
  point,
  frame,
  value,
  min,
  max,
  evStep,
  locked,
  canLock,
  onChange,
  onLock,
}: {
  /** Where the operator tapped, in pixels within [frame]. Null draws nothing. */
  point: FocusPoint | null;
  /** The picture's own size, so the rail can be kept inside it. */
  frame: { width: number; height: number };
  /** Exposure compensation in the camera's steps, as the stepper uses. */
  value: number;
  min: number;
  max: number;
  evStep: number;
  locked: boolean;
  canLock: boolean;
  onChange: (next: number) => void;
  onLock: (on: boolean) => void;
}) {
  const [shown, setShown] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragBase = useRef(value);
  const latest = useRef(value);
  latest.current = value;

  /** Any touch on the rail puts the clock back to the beginning. */
  const keep = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    opacity.setValue(1);
    setShown(true);
    idle.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start(({ finished }) => {
        // Only if the fade ran to the end: a touch part-way through calls
        // `keep` again, and unmounting under it would take the rail away from
        // a thumb that is on it.
        if (finished) setShown(false);
      });
    }, IDLE_MS);
  }, [opacity]);

  useEffect(() => {
    if (!point) return;
    keep();
  }, [point, keep]);

  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current);
    },
    [],
  );

  const span = max - min;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Same reasoning as the pinch: this ends in a native promise and a
        // React state update, and the lens moves in its own coarse steps.
        .runOnJS(true)
        .onStart(() => {
          dragBase.current = latest.current;
          keep();
        })
        .onUpdate((event) => {
          if (span <= 0) return;
          // Up is brighter, which is why the sign is inverted: screen y grows
          // downwards and exposure does not.
          const steps = Math.round((-event.translationY / TRACK) * span);
          const next = Math.min(max, Math.max(min, dragBase.current + steps));
          if (next !== latest.current) onChange(next);
          keep();
        }),
    [span, min, max, onChange, keep],
  );

  if (!point || !shown || span <= 0) return null;

  /**
   * To the right of the tap unless the tap was near the right edge, and never
   * past either end of the picture. A rail half off the screen is a control
   * that cannot be dragged to its own limit.
   */
  const railHeight = TRACK + (canLock ? 44 : 0) + 26;
  const fitsRight = point.x + GAP + COLUMN <= frame.width;
  const left = fitsRight
    ? Math.min(point.x + GAP, frame.width - COLUMN)
    : Math.max(0, point.x - GAP - COLUMN);
  const top = Math.min(Math.max(0, point.y - railHeight / 2), Math.max(0, frame.height - railHeight));

  // Where the sun sits on the track: the top is the brightest end.
  const travel = TRACK - 30;
  const knobTop = travel - ((value - min) / span) * travel;

  return (
    <Animated.View
      style={{ position: "absolute", left, top, width: COLUMN, opacity }}
      className="items-center"
    >
      {canLock ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: locked }}
          accessibilityLabel="Lock exposure"
          onPress={() => {
            keep();
            onLock(!locked);
          }}
          hitSlop={8}
          className={`mb-2 h-9 w-9 items-center justify-center rounded-full ${
            locked ? "bg-amber-300" : "bg-black/60"
          }`}
        >
          {locked ? (
            <LockedIcon className="h-4 w-4 text-black" />
          ) : (
            <UnlockedIcon className="h-4 w-4 text-white" />
          )}
        </Pressable>
      ) : null}

      <GestureDetector gesture={pan}>
        <View style={{ height: TRACK, width: COLUMN }} collapsable={false}>
          {/* The line the sun travels, drawn thin and dark-edged so it reads
              over a bright picture as well as a dark one. */}
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: COLUMN / 2 - 1, top: 15, bottom: 15, width: 2 }}
            className="rounded-full bg-white/70"
          />
          <View
            pointerEvents="none"
            style={{ position: "absolute", left: COLUMN / 2 - 15, top: knobTop }}
            className={`h-[30px] w-[30px] items-center justify-center rounded-full ${
              locked ? "bg-amber-300" : "bg-white"
            }`}
          >
            <ExposureIcon className="h-4 w-4 text-black" />
          </View>
        </View>
      </GestureDetector>

      <View className="mt-1 rounded-full bg-black/70 px-2 py-0.5">
        <Mono className="text-[11px] font-semibold">{formatEv(value * evStep)}</Mono>
      </View>
      {locked ? (
        <Text className="pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
          AE-L
        </Text>
      ) : null}
    </Animated.View>
  );
}
