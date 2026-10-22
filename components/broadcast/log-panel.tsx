import { View } from "react-native";

import { Text } from "@/components/ui/text";
import type { LogEntry } from "@/modules/framevane-broadcaster";

import { Panel } from "./chrome";
import { Mono } from "./mono";

/**
 * What the encoder has been doing, newest first.
 *
 * This is the difference between "it stopped" and a diagnosis. A broadcast
 * that failed three minutes ago cannot be explained by a screen that only
 * shows the present, and an operator on site has no adb and no patience for
 * one. Newest first because the answer is almost always at the top, and the
 * level is coloured because the eye finds the red line before it reads any of
 * them.
 */
export function LogPanel({ entries, onClose }: { entries: LogEntry[]; onClose: () => void }) {
  return (
    <Panel title={entries.length > 0 ? `Log · ${entries.length} lines` : "Log"} onClose={onClose}>
      <View className="gap-1">
        {entries.length === 0 ? (
          <Text className="text-sm text-white/70">
            Nothing logged yet. The encoder reports here as it connects.
          </Text>
        ) : (
          entries.map((entry, index) => (
            <View
              // The buffer is append-only and read newest first, so an entry's
              // timestamp and position identify it well enough to key on.
              key={`${entry.at}-${index}`}
              className="flex-row items-start gap-2"
            >
              <Mono className="text-[11px] text-white/70">{clockOf(entry.at)}</Mono>
              <Mono className={`w-9 text-[11px] font-semibold ${colourOf(entry.level)}`}>
                {entry.level === "warn" ? "WARN" : entry.level === "error" ? "ERR" : "INFO"}
              </Mono>
              <Text className="flex-1 text-[11px] leading-4 text-white/80">{entry.message}</Text>
            </View>
          ))
        )}
      </View>
    </Panel>
  );
}

function colourOf(level: LogEntry["level"]): string {
  return level === "error" ? "text-red-400" : level === "warn" ? "text-amber-300" : "text-white/70";
}

/** Wall clock, not elapsed: it has to line up with when someone said it broke. */
function clockOf(at: number): string {
  const time = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}
