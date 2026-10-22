import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Linking, PermissionsAndroid, Platform, Pressable } from "react-native";

import { Block, ChoiceRow, Group, NavRow, Page, SwitchRow } from "@/components/settings/chrome";
import {
  audioDevices,
  CODEC_LABEL,
  dashboardSite,
  deviceLabel,
  recordingsOnPhone,
  totalBytes,
} from "@/components/settings/phone";
import { Text } from "@/components/ui/text";
import { readLog } from "@/lib/broadcast/log";
import { applyLanguagePreference } from "@/lib/i18n";
import { formatBytes } from "@/lib/broadcast/recordings";
import {
  loadPreferences,
  loadSettings,
  type PhoneEncoderSettings,
  type Preferences,
  QUICK_CONTROLS,
  RECORD_QUALITIES,
  recordQualityFor,
  savePreferences,
  SPLIT_BYTES,
} from "@/lib/broadcast/settings";
import * as Broadcaster from "@/modules/framevane-broadcaster";
import type { AudioDevice, RecordingFile } from "@/modules/framevane-broadcaster";

/**
 * The settings that belong to the phone rather than to a destination.
 *
 * Picture size and bitrate are set per destination, on the Destinations tab,
 * because sending to YouTube and sending to a test server are not the same
 * job. What is here is about this phone, this microphone and this network.
 *
 * This screen is a menu and not a list. Everything on it used to be inlined
 * one setting under another, which meant the codec explanation stood between
 * the operator and the recording switch, and the two switches most often
 * reached for were four screenfuls down. So the settings that take a paragraph
 * to choose well - codec, microphone, what to do on a bad connection - are one
 * tap behind a row that shows what they are currently set to, and the two that
 * are simply on or off stay here where a thumb can find them.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<PhoneEncoderSettings>(() => loadSettings());
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [recordings, setRecordings] = useState<RecordingFile[]>(() => recordingsOnPhone());
  const [logLines, setLogLines] = useState(0);
  /**
   * Asked once. It answers a question about the Android version, which does
   * not change while the app is running.
   */
  /**
   * Picking is one press, and backing out of Android's picker is not a
   * failure: an empty answer means the operator changed their mind, and the
   * folder they already had stands. Clearing it is the second press, which is
   * why the row offers it.
   */
  const chooseFolder = useCallback(async () => {
    if (preferences.recordingFolder) {
      setPreferences(savePreferences({ recordingFolder: "" }));
      await Broadcaster.setRecordingFolder("").catch(() => {});
      return;
    }
    const uri = await Broadcaster.pickRecordingFolder().catch(() => "");
    if (!uri) return;
    setPreferences(savePreferences({ recordingFolder: uri }));
    await Broadcaster.setRecordingFolder(uri).catch(() => {});
  }, [preferences.recordingFolder]);

  const [canSaveToGallery] = useState(() => {
    try {
      return Broadcaster.canSaveToGallery();
    } catch {
      return false;
    }
  });
  const [notificationRefused, setNotificationRefused] = useState(false);
  /**
   * Refused is one thing; refused twice is another. After that Android answers
   * the request without ever showing a dialog, so the toggle would fail on
   * every press with no way for the operator to see why or change it.
   */
  const [notificationBlocked, setNotificationBlocked] = useState(false);

  /**
   * Re-read on focus rather than subscribe. Every summary on this screen can
   * be changed by the screen it points at, the microphone list changes when
   * something is plugged in, and the log grows while a broadcast runs - but
   * none of that matters while this screen is not on top of the stack, and a
   * settings screen that re-renders behind a live broadcast is work spent on
   * nobody.
   */
  useFocusEffect(
    useCallback(() => {
      setSettings(loadSettings());
      setPreferences(loadPreferences());
      setDevices(audioDevices());
      setRecordings(recordingsOnPhone());
      setLogLines(readLog().length);
    }, []),
  );

  const toggleBackground = async () => {
    if (preferences.backgroundBroadcast) {
      setPreferences(savePreferences({ backgroundBroadcast: false }));
      setNotificationRefused(false);
      setNotificationBlocked(false);
      await Broadcaster.setBackgroundBroadcast(false).catch(() => {});
      return;
    }

    /**
     * Android 13 and later will not show the foreground-service notification
     * without this permission, and without the notification it will not let
     * the service run at all. Asking here - at the moment the operator turns
     * the setting on - is the only point where the request means anything.
     */
    if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        setNotificationRefused(true);
        setNotificationBlocked(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
        return;
      }
    }

    setNotificationRefused(false);
    setNotificationBlocked(false);
    setPreferences(savePreferences({ backgroundBroadcast: true }));
    await Broadcaster.setBackgroundBroadcast(true).catch(() => {});
  };

  /**
   * In a Custom Tab rather than by handing the link to another app: the
   * operator stays inside Framevane and comes back with one press, which
   * matters when the reason they opened the policy is that a dialog is waiting
   * behind it.
   */
  const openOnTheWeb = async (path: string) => {
    const url = `${dashboardSite()}${path}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // A phone with no browser that answers a Custom Tab may still have one
      // that answers an https link. If neither does, there is nothing here the
      // operator could act on, so nothing is said.
      await Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <Page
      title="Settings"
      intro="Applied the next time you go live, except where it says otherwise."
    >
      <Group title="Viewfinder">
        <NavRow
          label="Quick access"
          detail="Which controls sit on the glass and which go in the menu"
          value={quickAccessSummary(preferences)}
          onPress={() => router.push("/settings/quick-access")}
        />
        {/* Beside the other viewfinder choices, because it changes nothing but
            the words on the glass: the settings pages stay English for now. */}
        <ChoiceRow
          label="Viewfinder language"
          value={preferences.language}
          options={[
            { label: "Phone's", value: "auto" },
            { label: "English", value: "en" },
            { label: "Hausa", value: "ha" },
            { label: "العربية", value: "ar" },
          ]}
          onChange={(language) => {
            setPreferences(savePreferences({ language }));
            applyLanguagePreference();
          }}
        />
        <SwitchRow
          label="Buzz when a control takes"
          detail="A short buzz on going live, ending, recording and muting. A dropped connection always buzzes."
          on={preferences.haptics}
          onPress={() => setPreferences(savePreferences({ haptics: !preferences.haptics }))}
        />
      </Group>

      <Group title="Capture">
        <NavRow
          label="Video"
          detail={`${CODEC_LABEL[settings.videoCodec]}, encoded ${
            settings.preferHardwareCodec ? "on the hardware" : "in software"
          }`}
          onPress={() => router.push("/settings/video")}
        />
        <NavRow
          label="Audio"
          detail={audioSummary(settings, preferences, devices)}
          onPress={() => router.push("/settings/audio")}
        />
        <NavRow
          label="On a bad connection"
          detail={networkSummary(settings)}
          onPress={() => router.push("/settings/network")}
        />
      </Group>

      <Group
        title="Recording"
        footer="Framevane already archives everything it receives, so the copy on the phone is not the one you would normally edit from - it is the one that survives the uplink failing entirely. It costs storage and a little heat. A take is always written to the app's own folder first, because that is the only place Android lets it be written without a storage permission; moving it to the library happens once the recorder has closed the file. Sections are numbered and each one is closed and saved on its own, so a file that goes wrong costs that section and not the whole take; they also close at 3.5 GB whatever the time is set to, which is the largest file a card reader will take. Recording at a different size from the broadcast runs a second video encoder, which costs heat - and it is also the only way the file is kept clear of the network. Matching the broadcast means one encoder feeding both, so when the uplink congests and the bitrate is dropped to keep the picture moving, the recording is dropped with it. A size of its own is written at its own bitrate whatever the connection does. The rungs are the ones that fit the broadcast\'s shape exactly; a size that does not fit is ignored and the log says so."
      >
        <SwitchRow
          label="Record to the phone while broadcasting"
          detail="Starts with the broadcast and stops with it."
          on={preferences.recordWhileStreaming}
          onPress={() =>
            setPreferences(
              savePreferences({ recordWhileStreaming: !preferences.recordWhileStreaming }),
            )
          }
        />
        <SwitchRow
          label="Save to the phone's video library"
          detail={
            canSaveToGallery
              ? "Finished takes move to Movies/Framevane, where the gallery and any video player can open them."
              : "This phone is too old for the video library; takes stay in the app's folder."
          }
          on={preferences.saveToGallery && canSaveToGallery}
          onPress={() => {
            if (!canSaveToGallery) return;
            const next = !preferences.saveToGallery;
            setPreferences(savePreferences({ saveToGallery: next }));
            void Broadcaster.setSaveToGallery(next).catch(() => {});
          }}
        />
        <NavRow
          label="Where recordings are kept"
          detail={
            preferences.recordingFolder
              ? "A folder you picked. Tap to choose a different one."
              : canSaveToGallery
                ? "The phone's video library, in Movies/Framevane."
                : "This app's own folder - this phone is too old for the library."
          }
          value={preferences.recordingFolder ? folderName(preferences.recordingFolder) : undefined}
          onPress={() => void chooseFolder()}
        />
        <ChoiceRow
          label="Record at"
          value={preferences.recordHeight}
          options={RECORD_QUALITIES.map((q) => ({
            label: q.height === 0 ? "Same" : q.label,
            value: q.height,
          }))}
          onChange={(height) => {
            setPreferences(savePreferences({ recordHeight: height }));
            const quality = recordQualityFor(height);
            void Broadcaster.setRecordingQuality(quality.height, quality.bitrate).catch(() => {});
          }}
        />
        <ChoiceRow
          label="Split long recordings"
          value={preferences.splitMinutes}
          options={[
            { label: "Off", value: 0 },
            { label: "15 min", value: 15 },
            { label: "30 min", value: 30 },
            { label: "60 min", value: 60 },
          ]}
          onChange={(minutes) => {
            setPreferences(savePreferences({ splitMinutes: minutes }));
            void Broadcaster.setRecordingSplit(minutes, SPLIT_BYTES).catch(() => {});
          }}
        />
        <NavRow
          label="Recordings on the phone"
          detail={recordingsSummary(recordings)}
          onPress={() => router.push("/settings/recordings")}
        />
      </Group>

      <Group
        title="Carrying on in the background"
        note="Applied now."
        footer="Android will not let an app hold the camera in the background without a notification, so the broadcast runs behind one. Anyone with the phone can see it and stop the broadcast from it."
      >
        <SwitchRow
          label="Keep broadcasting off screen"
          detail="The broadcast carries on behind a notification when the app is not on screen."
          on={preferences.backgroundBroadcast}
          onPress={toggleBackground}
        />
        {notificationRefused ? (
          <Block>
            <Text className="text-xs text-destructive">
              Android needs permission to show that notification, and without it the broadcast
              cannot continue in the background. The setting is still off.
              {notificationBlocked
                ? " Android will not ask again from here, so it has to be turned on in settings."
                : " Allow notifications for Framevane and try again."}
            </Text>
            {notificationBlocked ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Android settings"
                onPress={() => void Linking.openSettings()}
                hitSlop={8}
                className="min-h-[44px] justify-center active:opacity-60"
              >
                <Text className="text-sm font-medium text-primary">Open Android settings</Text>
              </Pressable>
            ) : null}
          </Block>
        ) : null}
      </Group>

      <Group title="Diagnostics">
        <NavRow
          label="Log"
          detail={
            logLines === 0
              ? "Nothing logged this session."
              : `${logLines} ${logLines === 1 ? "line" : "lines"} from this session.`
          }
          onPress={() => router.push("/(tabs)/log")}
        />
      </Group>

      <Group
        title="About"
        footer="The policy and the terms are pages on the Framevane server this phone is paired with, and they open in a browser."
      >
        <NavRow
          label="About Framevane"
          value={String(Constants.expoConfig?.version ?? "")}
          onPress={() => router.push("/settings/about")}
        />
        <NavRow label="Privacy policy" external onPress={() => void openOnTheWeb("/privacy")} />
        <NavRow label="Terms" external onPress={() => void openOnTheWeb("/terms")} />
      </Group>
    </Page>
  );
}

/**
 * The summaries below are the whole argument for a menu: a row that says what
 * is set behind it is read without being opened, so an operator checking the
 * phone before a broadcast confirms four settings in one screenful instead of
 * four taps.
 */
function quickAccessSummary(preferences: Preferences): string {
  const count = preferences.quickAccess.length;
  if (count === QUICK_CONTROLS.length) return "All on the glass";
  return `${count} of ${QUICK_CONTROLS.length}`;
}

function audioSummary(
  settings: PhoneEncoderSettings,
  preferences: Preferences,
  devices: AudioDevice[],
): string {
  /**
   * What the encoder says it is using, which beats what we last asked for -
   * and before the viewfinder has ever been opened it says nothing, which is
   * reported as the choice that was saved rather than as a microphone name
   * this phone has not confirmed.
   */
  const current = devices.find((device) => device.current);
  const input = current
    ? deviceLabel(current)
    : preferences.audioDeviceId === -1
      ? "Android's choice of microphone"
      : "A microphone chosen by hand";
  const gain = settings.micGain === 1 ? "" : ` · ${settings.micGain}× gain`;
  return `${input} · ${settings.audioBitrate / 1000}k ${settings.stereo ? "stereo" : "mono"}${gain}`;
}

function networkSummary(settings: PhoneEncoderSettings): string {
  const bitrate = settings.adaptiveBitrate ? "Sends less rather than stalling" : "Fixed bitrate";
  const reconnect = settings.autoReconnect
    ? `reconnects after ${settings.reconnectDelayMs / 1000}s`
    : "does not reconnect";
  return `${bitrate} · ${reconnect}`;
}

function recordingsSummary(recordings: RecordingFile[]): string {
  if (recordings.length === 0) return "Nothing on the phone yet";
  return `${recordings.length} ${recordings.length === 1 ? "file" : "files"}, ${formatBytes(
    totalBytes(recordings),
  )}`;
}

/**
 * The tail of a document-tree URI, which is the part that means anything.
 *
 * `content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FTakes`
 * is not a folder name to anybody. The last segment after the colon is, and a
 * URI shaped differently - a network provider, a third-party file app - falls
 * back to saying that a folder is set rather than guessing at its name.
 */
function folderName(uri: string): string {
  try {
    const tail = decodeURIComponent(uri).split(":").pop() ?? "";
    const name = tail.split("/").filter(Boolean).pop();
    return name ?? "Chosen";
  } catch {
    return "Chosen";
  }
}
