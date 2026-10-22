import { View } from "react-native";

import { Text } from "@/components/ui/text";

import { Mono } from "./mono";

/**
 * How full the send queue is.
 *
 * Two numbers - forty of six hundred - are arithmetic the operator has to do
 * while something is going wrong. The fraction is the signal, and it is the
 * earliest one there is: the queue fills before the bitrate drops and long
 * before the picture stutters, because frames pile up here while the socket
 * is still politely claiming to be fine. A bar answers "is it filling" at a
 * glance, and the numbers stay for whoever has to report them.
 */

/** Filling. Nothing is wrong yet, but the uplink is no longer keeping up. */
const WARN = 0.25;

/** Frames are about to be thrown away. */
const BAD = 0.6;

export function BufferMeter({ items, capacity }: { items: number; capacity: number }) {
  const fraction = capacity > 0 ? Math.min(1, items / capacity) : 0;
  const tone = fraction >= BAD ? "bg-red-500" : fraction >= WARN ? "bg-amber-400" : "bg-green-500";

  return (
    <View className="gap-1.5">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm text-white/70">Send queue</Text>
        <Mono className="text-sm">
          {capacity > 0 ? `${Math.round(fraction * 100)}% · ${items}/${capacity}` : "-"}
        </Mono>
      </View>
      <View className="h-2 overflow-hidden rounded-full bg-white/15">
        <View className={`h-2 rounded-full ${tone}`} style={{ width: `${fraction * 100}%` }} />
      </View>
      {fraction >= WARN ? (
        <Text className="text-xs text-white/70">
          {fraction >= BAD
            ? "The queue is close to full. Frames will be dropped before the bitrate recovers."
            : "The queue is filling. The uplink is not keeping up with the encoder."}
        </Text>
      ) : null}
    </View>
  );
}
