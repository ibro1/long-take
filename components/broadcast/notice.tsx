import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

import { Text } from "@/components/ui/text";

/**
 * One line that says what just happened, then goes.
 *
 * A photo written, a recording started, a recorder that failed. None of it is
 * worth a dialog: an alert mid-broadcast takes the screen away from the
 * operator to tell them something they already asked for. The key prop is what
 * restarts the fade, so the same message twice still reads as twice.
 */
export function Notice({ text, at, tone }: { text: string; at: number; tone: "plain" | "bad" }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!text) return;
    opacity.setValue(1);
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: 600,
      delay: tone === "bad" ? 5000 : 2200,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [text, at, tone, opacity]);

  if (!text) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{ opacity, alignItems: "center", paddingHorizontal: 16, paddingBottom: 4 }}
    >
      <View className={`rounded-full px-3 py-1.5 ${tone === "bad" ? "bg-filmic-alert" : "bg-filmic-surface/80"}`}>
        <Text className="text-xs text-filmic-ink">{text}</Text>
      </View>
    </Animated.View>
  );
}
