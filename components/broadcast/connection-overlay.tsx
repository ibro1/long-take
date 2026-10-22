import { useEffect, useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { Text } from "@/components/ui/text";
import { formatUptime } from "@/lib/broadcast/useBroadcast";
import { t, textDir } from "@/lib/i18n";

import { Mono } from "./mono";

/**
 * The two states a broadcast can be in without the operator having done
 * anything: dropped and dialling back in, and given up.
 *
 * Both used to be a word in the small chip in the corner, which is the one
 * place on the screen nobody looks while teaching. A phone on a stand at the
 * back of a hall is read from across the room, so these take the whole frame
 * the way the pause does - a border round the picture and one large word -
 * and they say what viewers are getting, because that is the question.
 *
 * Neither moves. The pause breathes because pause looks identical to working
 * and needs to catch the eye; these are the opposite case, already alarming,
 * and a pulsing frame on top of a dead stream adds panic rather than
 * information. It also leaves nothing to switch off for reduced motion.
 */

/** Tailwind's amber-400, the colour the pause already uses for "not normal". */
const AMBER = "#fbbf24";
/** Tailwind's red-500, the colour the failure banner is drawn in. */
const RED = "#ef4444";

export function ReconnectingOverlay({ seconds }: { seconds: number }) {
  return (
    <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderWidth: 4,
          borderColor: AMBER,
        }}
      />
      <View
        className="items-center gap-1"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={t("overlay.reconnectingA11y")}
      >
        <View className="rounded-xl bg-amber-400 px-5 py-2.5">
          <Text
            style={textDir()}
            className="text-center text-3xl font-bold uppercase tracking-wide text-black"
          >
            {t("overlay.reconnecting")}
          </Text>
          <Text style={textDir()} className="text-center text-xs text-black/80">
            {t("overlay.reconnectingBody")}
          </Text>
        </View>
        {seconds > 0 ? (
          <View className="rounded-full bg-black/70 px-3 py-1">
            <Mono className="text-xs">{t("overlay.onAirFor", { time: formatUptime(seconds) })}</Mono>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function OffAirOverlay() {
  return (
    <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderWidth: 4,
          borderColor: RED,
        }}
      />
      <View
        className="rounded-xl bg-red-600 px-5 py-2.5"
        accessibilityLiveRegion="assertive"
        accessibilityLabel={t("overlay.offAirA11y")}
      >
        <Text
          style={textDir()}
          className="text-center text-3xl font-bold uppercase tracking-wide text-white"
        >
          {t("overlay.offAir")}
        </Text>
        <Text style={textDir()} className="text-center text-xs text-white/85">
          {t("overlay.offAirBody")}
        </Text>
      </View>
    </View>
  );
}

/**
 * Whether the operator has asked the phone for less motion.
 *
 * Read from Android's own setting and followed while the screen is up, so
 * turning it on mid-broadcast takes effect without leaving the viewfinder.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (!cancelled) setReduced(on);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return reduced;
}
