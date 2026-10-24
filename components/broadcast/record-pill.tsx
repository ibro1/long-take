import { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { filmic } from "@/lib/theme/filmic";

import { Mono } from "./mono";

/**
 * Recording, stated plainly.
 *
 * A recording nobody notices is how an operator ends up with nothing after the
 * event, or with forty minutes of a bag interior. The dot pulses because a
 * static red dot is indistinguishable from decoration, and the clock is there
 * because "is it recording" and "how long has it been recording" get asked in
 * the same glance.
 *
 * It is also how the recording is stopped. Starting one takes a menu, and an
 * operator who started it there has no reason to assume the same row is the
 * way out - the badge is the thing they are already looking at when they want
 * it to end, so the badge is the button. The square says so: a red pill with a
 * stop glyph is the same sentence every camera has spoken since tape.
 */
export function RecordPill({
  seconds,
  elapsed,
  onStop,
}: {
  seconds: number;
  elapsed: string;
  onStop: () => void;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("control.recordingA11y", { time: elapsed })}
      onPress={onStop}
      hitSlop={8}
      className="min-h-[32px] flex-row items-center gap-2 rounded-full bg-filmic-alert px-3 py-1.5 active:opacity-70"
    >
      {/* Inline styles: nativewind does not reach inside an Animated.View. */}
      <Animated.View
        style={{ opacity: pulse, width: 10, height: 10, borderRadius: 5, backgroundColor: filmic.color.ink }}
      />
      <Text maxFontSizeMultiplier={1.3} className="text-xs font-semibold uppercase text-filmic-ink">
        {t("control.rec")}
      </Text>
      <Mono className="text-xs">{elapsed}</Mono>
      {/* Recording to the phone is finite in a way the broadcast is not, and a
          long take is the one most likely to be the take that mattered. */}
      {seconds >= 600 ? <Mono className="text-[10px] text-filmic-ink/80">{t("control.longTake")}</Mono> : null}
      {/* Drawn rather than an icon import: it is a square, and at 10px the
          glyph fonts and the stroke widths of an icon set both fight it. */}
      <View className="h-2.5 w-2.5 rounded-[2px] bg-filmic-ink" />
    </Pressable>
  );
}
