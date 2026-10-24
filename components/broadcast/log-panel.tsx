import { FlatList, useWindowDimensions, View } from "react-native";

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
  const { width, height } = useWindowDimensions();
  const wide = width > height;

  return (
    <Panel title={entries.length > 0 ? `Log · ${entries.length} lines` : "Log"} onClose={onClose}>
      {entries.length === 0 ? (
        <Text className="text-sm text-white/70">
          Nothing logged yet. The encoder reports here as it connects.
        </Text>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={keyOf}
          renderItem={renderEntry}
          // Only the rows in view are mounted. Mapping all 400 rebuilt every
          // one of them on each new line, on the JS thread the viewfinder's
          // live readouts are drawn from.
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={5}
          contentContainerStyle={{ gap: 4 }}
          // A bounded height of its own, under the panel's cap, so the list
          // scrolls itself and only renders a window. Inside the panel's
          // unbounded scroll it would measure as tall as all 400 rows and
          // mount every one of them anyway.
          style={{ maxHeight: height * (wide ? 0.6 : 0.38) }}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        />
      )}
    </Panel>
  );
}

/**
 * Timestamp and message rather than position: the list is newest first, so
 * every new line shifts every index, and an index key re-mounts every row.
 */
function keyOf(entry: LogEntry): string {
  return `${entry.at}-${entry.level}-${entry.message}`;
}

function renderEntry({ item: entry }: { item: LogEntry }) {
  return (
    <View className="flex-row items-start gap-2">
      <Mono className="text-[11px] text-white/70">{clockOf(entry.at)}</Mono>
      <Mono className={`w-9 text-[11px] font-semibold ${colourOf(entry.level)}`}>
        {entry.level === "warn" ? "WARN" : entry.level === "error" ? "ERR" : "INFO"}
      </Mono>
      <Text className="flex-1 text-[11px] leading-4 text-white/80">{entry.message}</Text>
    </View>
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
