import { memo, useSyncExternalStore } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import {
  type ChipWord,
  platformChips,
  studioStatusSnapshot,
  subscribeStudioStatus,
} from "@/lib/broadcast/studio-status";
import { type StringKey, t, textDir } from "@/lib/i18n";

import { Chip, HUD_TEXT } from "./chrome";

const WORD: Record<ChipWord, StringKey> = {
  live: "studio.live",
  waiting: "studio.waiting",
  starting: "studio.starting",
  ended: "studio.ended",
  unpublished: "studio.unpublished",
};

const SPOKEN: Record<ChipWord, StringKey> = {
  live: "studio.liveA11y",
  waiting: "studio.waitingA11y",
  starting: "studio.startingA11y",
  ended: "studio.endedA11y",
  unpublished: "studio.unpublishedA11y",
};

const DOT = { good: "bg-filmic-good", warn: "bg-filmic-accentink", plain: "bg-filmic-inkmuted" } as const;

/**
 * "YouTube: live", beside the uptime.
 *
 * The phone's own chip says the phone is sending; this one says whether
 * anybody can watch. Amber for the case the whole thing exists for - the phone
 * has been up for most of a minute and YouTube is still not live - because
 * that is the failure that looked healthy from every screen the operator had.
 *
 * Subscribed to the store rather than handed the answer, and memoised on the
 * one prop it takes, so a poll re-renders this chip and the clock ticking
 * re-renders nothing here. Hidden when the destination is not paired with a
 * studio or the studio names no platform: an empty chip is a question.
 */
export const StudioChip = memo(function StudioChip({ settled }: { settled: boolean }) {
  const status = useSyncExternalStore(subscribeStudioStatus, studioStatusSnapshot, studioStatusSnapshot);
  const chips = platformChips(status, settled);
  if (chips.length === 0) return null;

  const warn = chips.some((chip) => chip.tone === "warn");
  const spoken = chips.map((chip) => t(SPOKEN[chip.word], { platform: chip.name })).join(" ");

  return (
    <View accessible accessibilityLabel={spoken} accessibilityLiveRegion={warn ? "polite" : "none"}>
      <Chip tone={warn ? "warn" : "plain"}>
        {chips.map((chip, index) => (
          <View key={chip.name} className="flex-row items-center gap-1">
            {index > 0 ? (
              <Text
                maxFontSizeMultiplier={HUD_TEXT}
                className={`text-xs ${warn ? "text-filmic-accentink/70" : "text-filmic-inkmuted"}`}
              >
                ·
              </Text>
            ) : null}
            <View className={`h-1.5 w-1.5 rounded-full ${DOT[chip.tone]}`} />
            <Text
              maxFontSizeMultiplier={HUD_TEXT}
              style={textDir()}
              className={`text-xs font-semibold ${warn ? "text-filmic-accentink" : "text-filmic-ink"}`}
            >
              {chip.name}: {t(WORD[chip.word])}
            </Text>
          </View>
        ))}
      </Chip>
    </View>
  );
});
