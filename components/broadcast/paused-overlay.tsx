import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

import { Text } from "@/components/ui/text";

import { useReducedMotion } from "./connection-overlay";
import { Mono } from "./mono";
import { formatUptime } from "@/lib/broadcast/useBroadcast";
import { t, textDir } from "@/lib/i18n";

/**
 * The broadcast is paused: the picture is held and the microphone is off,
 * while the connection stays exactly where it was.
 *
 * Pause is the one state that looks identical to working. The preview keeps
 * moving on the phone, the uptime keeps counting, the socket is still open -
 * and viewers are watching a still with no sound. So this is drawn to be read
 * from across a room and from the corner of an eye: a border around the whole
 * frame, breathing, and a line that says what viewers are getting. A broadcast
 * paused by accident that nobody noticed is worse than one that stopped.
 */
/** Tailwind's amber-400, the colour the pause controls already use. */
const AMBER = "#fbbf24";

export function PausedOverlay({ live, seconds }: { live: boolean; seconds: number }) {
  const breath = useRef(new Animated.Value(0.5)).current;
  const reduced = useReducedMotion();

  useEffect(() => {
    /**
     * Held at full strength instead of breathing when the phone asks for less
     * motion. The border and the word are what make the pause readable; the
     * breathing only makes it catch the eye, and that is the part to give up.
     */
    if (reduced) {
      breath.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0.5, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, reduced]);

  return (
    <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
      {/* Inline styles: nativewind does not reach inside an Animated.View. */}
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderWidth: 4,
          borderColor: AMBER,
          opacity: breath,
        }}
      />
      <Animated.View style={{ opacity: breath, alignItems: "center", gap: 4 }}>
        <View className="rounded-xl bg-amber-400 px-5 py-2.5">
          <Text
            style={textDir()}
            className="text-center text-xl font-bold uppercase tracking-wide text-black"
          >
            {t("overlay.paused")}
          </Text>
          <Text style={textDir()} className="text-center text-xs text-black/80">
            {live ? t("overlay.pausedLive") : t("overlay.pausedIdle")}
          </Text>
        </View>
        {live ? (
          <View className="rounded-full bg-black/70 px-3 py-1">
            <Mono className="text-xs">{t("overlay.pausedAt", { time: formatUptime(seconds) })}</Mono>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}
