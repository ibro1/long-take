import { useRouter } from "expo-router";
import { memo, useEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { activeConnection } from "@/lib/broadcast/connections";
import { clearLog, readLog, recentLog, subscribeLog } from "@/lib/broadcast/log";
import { postPhoneLog } from "@/lib/broadcast/overlays";
import type { LogEntry, LogLevel } from "@/modules/framevane-broadcaster";

/**
 * What the encoder has said, kept across restarts.
 *
 * Reached from Settings rather than from a tab: nobody opens a log except
 * after something went wrong, and by then they are off the viewfinder anyway.
 * The buffer lives at module level, so a broadcast that failed while this
 * screen was closed is still here to read. "Send to studio" puts the latest
 * lines where whoever is diagnosing the class can read them, without a
 * screenshot.
 */
export default function LogScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<LogEntry[]>(() => readLog());

  /**
   * At most once a second, trailing. Tabs never unmount, so once this screen
   * has been opened it stays subscribed for the life of the app - and a
   * congested broadcast logs several lines a second, each of which re-read and
   * re-rendered the whole list on the JS thread the encoder's callbacks share.
   */
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeLog(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        setEntries(readLog());
      }, REFRESH_MS);
    });
    return () => {
      unsubscribe();
      if (pending) clearTimeout(pending);
    };
  }, []);

  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async () => {
    const connection = activeConnection();
    if (!connection || sending) return;
    setSending(true);
    setSent(null);
    const result = await postPhoneLog(connection, recentLog(300));
    setSending(false);
    setSent(result.ok ? "Sent. It is in the studio under Phone log." : result.message);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center justify-between gap-1 border-b border-border px-5 py-1">
        {/* Text links, so the size is in the box rather than the word: 44
            tall and padded out, with the slop on top for a thumb that misses. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          className="min-h-11 justify-center pr-2"
        >
          <Text className="text-sm text-muted-foreground">Back</Text>
        </Pressable>
        <View className="flex-1">
          <Text className="text-center text-sm font-semibold">Log</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sending ? "Sending the log to the studio" : "Send the log to the studio"}
          accessibilityState={{ disabled: entries.length === 0 || sending }}
          onPress={send}
          hitSlop={8}
          disabled={entries.length === 0 || sending}
          className="min-h-11 justify-center px-2"
        >
          <Text
            className={`text-sm ${entries.length === 0 || sending ? "text-muted-foreground/40" : "text-primary"}`}
          >
            {sending ? "Sending" : "Send"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear the log"
          accessibilityState={{ disabled: entries.length === 0 }}
          // Emptied here as well, rather than a second later when the
          // throttled subscription catches up.
          onPress={() => {
            clearLog();
            setEntries([]);
          }}
          hitSlop={8}
          disabled={entries.length === 0}
          className="min-h-11 justify-center pl-2"
        >
          <Text
            className={`text-sm ${entries.length === 0 ? "text-muted-foreground/40" : "text-muted-foreground"}`}
          >
            Clear
          </Text>
        </Pressable>
      </View>

      {entries.length === 0 ? (
        <View className="flex-1 items-center justify-center p-8">
          <Text className="text-center text-sm text-muted-foreground">
            Nothing logged yet. Connection events, reconnects and encoder errors land here while
            the app is running.
          </Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="p-4 gap-2 pb-12"
          data={entries}
          keyExtractor={keyOf}
          renderItem={renderRow}
          // Only what is on screen and a little either side: the list is read
          // from the top, and 400 mounted rows were 400 rows to diff per line.
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={5}
          ListHeaderComponent={
            <View className="gap-2">
              <Text className="pb-1 text-xs text-muted-foreground">
                {entries.length} {entries.length === 1 ? "line" : "lines"}, newest first. Kept on
                this phone until you clear it. Send puts the latest 300 in the studio.
              </Text>
              {sent ? <Text className="pb-1 text-xs">{sent}</Text> : null}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

/** How often an open log screen catches up with new lines. */
const REFRESH_MS = 1000;

/**
 * Timestamp and message rather than position: the list is newest first, so
 * every new line shifts every index, and an index key re-mounts every row.
 * Two identical lines in the same millisecond share a key, which costs a
 * warning in development and nothing a reader would see.
 */
function keyOf(entry: LogEntry): string {
  return `${entry.at}-${entry.level}-${entry.message}`;
}

function renderRow({ item }: { item: LogEntry }) {
  return <Row entry={item} />;
}

// Memoised so a refresh re-renders only the rows that are new; the entry
// objects themselves never change once logged.
const Row = memo(function Row({ entry }: { entry: LogEntry }) {
  return (
    <View className="flex-row gap-3 rounded-xl border border-border bg-card px-3 py-2">
      <Text className="font-mono text-xs text-muted-foreground">{clock(entry.at)}</Text>
      <View className="flex-1 gap-0.5">
        <Text className={`font-mono text-[10px] uppercase tracking-wide ${LEVEL[entry.level]}`}>
          {entry.level}
        </Text>
        <Text className="text-xs">{entry.message}</Text>
      </View>
    </View>
  );
});

/**
 * Error is the app's own destructive colour so it reads the same as every other
 * failure; warn is amber because a congestion warning is not a failure and
 * should not look like one at a glance.
 */
const LEVEL: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  warn: "text-amber-500",
  error: "text-destructive",
};

/** Wall clock to the second: log lines are read against when something happened. */
function clock(at: number): string {
  const time = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
}
