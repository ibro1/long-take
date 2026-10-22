import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { Block, Group, Page } from "@/components/settings/chrome";
import { recordingsOnPhone, stamp, totalBytes } from "@/components/settings/phone";
import { Text } from "@/components/ui/text";
import {
  durationOf,
  forgetDuration,
  formatBytes,
  formatDuration,
} from "@/lib/broadcast/recordings";
import * as Broadcaster from "@/modules/framevane-broadcaster";
import type { RecordingFile } from "@/modules/framevane-broadcaster";

/**
 * The copies kept on the phone.
 *
 * Read from the filesystem every time this screen opens rather than from any
 * list the app keeps, so what is shown is what is actually there - a recording
 * deleted by a file manager, or one written while the app was killed, are both
 * accounted for without the app having to have been watching.
 */
export default function RecordingsScreen() {
  const [recordings, setRecordings] = useState<RecordingFile[]>(() => recordingsOnPhone());

  useFocusEffect(
    useCallback(() => {
      setRecordings(recordingsOnPhone());
    }, []),
  );

  /**
   * Hands the file to whatever the phone plays video with.
   *
   * The row looked like a list item and did nothing when pressed, which reads
   * as the app having lost the recording. There is no player in here and there
   * should not be - the phone has several, and one of them is already the
   * operator's choice.
   *
   * Through a content URI rather than a path: Android has refused to accept a
   * file:// URI across an app boundary since Nougat, and the recordings live in
   * this app's own external files directory, so nothing else can read the path
   * even if it were allowed to try.
   */
  const openRecording = async (recording: RecordingFile) => {
    try {
      await Broadcaster.openRecording(recording.path);
    } catch (error) {
      /**
       * The reason, not a guess at it. This alert used to say no video player
       * had opened the file, which named the wrong culprit - there were
       * players, and the failure was ours - and threw away the only evidence
       * of what actually went wrong.
       */
      const reason = error instanceof Error ? error.message : String(error);
      Alert.alert(
        "That did not open",
        `${recording.name} is still on the phone.\n\n${reason}${
          recording.inLibrary
            ? ""
            : "\n\nThis one is in the app's own folder, which the gallery cannot see. Turn on \"Save to the phone's video library\" in Settings and new recordings will go where every player can reach them."
        }`,
      );
    }
  };

  const removeRecording = (recording: RecordingFile) => {
    Alert.alert(
      `Delete ${recording.name}?`,
      "It goes from the phone for good. What Framevane received is still on the server.",
      [
        { text: "Keep" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            /**
             * A delete that failed used to be swallowed here, and the list was
             * then re-read and drawn - so a refusal looked like a deletion,
             * and a refusal that also broke the read looked like every
             * recording being deleted at once. Both of those happened.
             */
            let removed = false;
            let reason = "";
            try {
              removed = await Broadcaster.deleteRecording(recording.path);
            } catch (error) {
              reason = error instanceof Error ? error.message : String(error);
            }

            if (!removed) {
              Alert.alert(
                "That was not deleted",
                `${recording.name} is still on the phone.${reason ? `\n\n${reason}` : ""}`,
              );
              return;
            }

            // The duration table is ours and the file is not; it goes when the
            // file goes.
            forgetDuration(recording.path);
            setRecordings(recordingsOnPhone());
          },
        },
      ],
    );
  };

  return (
    <Page title="Recordings">
      <Group
        note={
          recordings.length === 0
            ? undefined
            : `${recordings.length} on the phone, ${formatBytes(totalBytes(recordings))} in all, newest first.`
        }
        footer={
          recordings.length === 0
            ? undefined
            : "Read from the phone each time this screen opens, so it is what is actually there. Deleting removes the file. Recordings in the library are in Movies/Framevane - the gallery, a file manager and a USB cable all reach them."
        }
      >
        {recordings.length === 0 ? (
          <Block>
            <Text className="text-sm text-muted-foreground">
              Nothing recorded yet. Turn on "Record to the phone while broadcasting" in Settings
              and the files will be listed here.
            </Text>
          </Block>
        ) : (
          recordings.map((recording) => {
            // The library keeps a duration of its own, which is the better
            // one: it survives the app being killed mid-take and it is there
            // for recordings this install never made. The table we keep from
            // the recorder's own events covers everything still in the app
            // folder.
            const ms = recording.durationMs > 0 ? recording.durationMs : durationOf(recording.path);
            return (
              <View
                key={recording.path}
                className="min-h-[56px] flex-row items-center gap-3 pr-4 py-3"
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Play ${recording.name}`}
                  onPress={() => void openRecording(recording)}
                  className="min-h-[44px] flex-1 justify-center gap-0.5 pl-4 active:opacity-60"
                >
                  <Text className="font-mono text-xs" numberOfLines={1}>
                    {recording.name}
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {stamp(recording.modifiedAt)} · {formatBytes(recording.bytes)}
                    {ms === null ? "" : ` · ${formatDuration(ms)}`}
                  </Text>
                  {/* Said only of the ones it is true of. A recording in the
                      library needs no explanation - it is where the operator
                      already looks for video. */}
                  {recording.inLibrary ? null : (
                    <Text className="text-[11px] text-muted-foreground/70">
                      App folder only - not in the gallery
                    </Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${recording.name}`}
                  onPress={() => removeRecording(recording)}
                  hitSlop={8}
                  className="min-h-[44px] justify-center px-2 active:opacity-60"
                >
                  <Text className="text-sm text-destructive">Delete</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </Group>
    </Page>
  );
}
