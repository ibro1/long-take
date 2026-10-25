import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

/**
 * Filmic's input gain: a white bar across the level meter, dragged up for
 * more and down for less. The middle is the microphone as it comes (gain 1);
 * the top doubles it, the bottom silences it. The meter under it reads the
 * gained signal, so the bar and the bars agree.
 *
 * On the UI thread, reaching the microphone at most every COMMIT_MS.
 */
const MAX_GAIN = 2;
const COMMIT_MS = 80;
const HANDLE = 3;

export function GainHandle({
  gain,
  height,
  width,
  onGain,
}: {
  readonly gain: number;
  /** The meter's drawn height; the bar travels the whole of it. */
  readonly height: number;
  readonly width: number;
  readonly onGain: (gain: number) => void;
}) {
  const pos = useSharedValue(gain / MAX_GAIN);
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const last = useSharedValue(0);

  useEffect(() => {
    if (!dragging.value) pos.value = Math.min(1, Math.max(0, gain / MAX_GAIN));
  }, [gain, pos, dragging]);

  const commit = (t: number) => onGain(Math.round(t * MAX_GAIN * 100) / 100);

  const pan = Gesture.Pan()
    .minDistance(1)
    .hitSlop({ horizontal: 18, vertical: 14 })
    .onBegin(() => {
      dragging.value = true;
      start.value = pos.value;
    })
    .onUpdate((e) => {
      pos.value = Math.min(1, Math.max(0, start.value - e.translationY / height));
      const now = Date.now();
      if (now - last.value >= COMMIT_MS) {
        last.value = now;
        scheduleOnRN(commit, pos.value);
      }
    })
    .onFinalize(() => {
      dragging.value = false;
      scheduleOnRN(commit, pos.value);
    });

  // A double tap puts it back to the microphone as it comes.
  const reset = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      pos.value = 0.5;
      scheduleOnRN(commit, 0.5);
    });

  const bar = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - pos.value) * height - HANDLE / 2 }] }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(reset, pan)}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Microphone gain"
        accessibilityValue={{ text: `${Math.round(gain * 100)} percent` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) =>
          onGain(Math.min(MAX_GAIN, Math.max(0, gain + (e.nativeEvent.actionName === "increment" ? 0.1 : -0.1))))
        }
        style={[StyleSheet.absoluteFill, { height, width }]}
      >
        <Animated.View pointerEvents="none" style={[styles.bar, { width: width + 8, left: -4 }, bar]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    top: 0,
    height: HANDLE,
    borderRadius: 1,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 2,
  },
});
