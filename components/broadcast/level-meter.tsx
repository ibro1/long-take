import { useEffect, useSyncExternalStore } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { levelSnapshot, notePainted, subscribeLevel } from "@/lib/broadcast/level-store";

/**
 * The microphone level, as a column of segments.
 *
 * Silence is the one broadcast fault the picture cannot show: everything looks
 * right and nobody hears anything, and the operator finds out from a comment
 * ten minutes in. A bar that moves while you talk answers "is the microphone
 * working" in the one moment the answer is cheap - before going live.
 *
 * Segments rather than a smooth bar, because a segment count is readable out
 * of the corner of an eye while you are doing something else; a continuous
 * bar has to be looked at.
 */
const SEGMENTS = 12;

/** Above this the microphone is clipping and the audio is already damaged. */
const HOT = 0.82;

export function LevelMeter({ muted }: { muted: boolean }) {
  /**
   * Subscribed here rather than passed in. The level changes about eight times
   * a second, and taking it as a prop meant the screen that owns the prop had
   * to re-render that often to deliver it - see lib/broadcast/level-store.ts.
   */
  const peak = useSyncExternalStore(subscribeLevel, levelSnapshot, levelSnapshot);

  // Runs after every commit: the count of samples that reached the screen.
  useEffect(() => {
    notePainted();
  });

  // Peak arrives as 0-100. Speech sits low on a linear scale, so the meter is
  // curved to put normal speaking voice in the middle of the column where the
  // movement is visible, the way an audio meter is.
  const level = muted ? 0 : Math.min(1, (peak / 100) ** 0.5);
  const lit = Math.round(level * SEGMENTS);

  return (
    <View className="items-center gap-1.5">
      <View className="gap-[3px]">
        {Array.from({ length: SEGMENTS }, (_, index) => {
          // Drawn top down, filled bottom up.
          const position = (SEGMENTS - index) / SEGMENTS;
          const on = SEGMENTS - index <= lit;
          return (
            <View
              key={index}
              className={`h-2 w-4 rounded-[2px] ${
                on ? (position > HOT ? "bg-filmic-alert" : "bg-filmic-good") : "bg-filmic-line"
              }`}
            />
          );
        })}
      </View>
      {muted ? (
        <Text className="text-[10px] font-semibold uppercase text-filmic-alert">Muted</Text>
      ) : null}
    </View>
  );
}
