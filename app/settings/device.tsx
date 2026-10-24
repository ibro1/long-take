import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { Linking, PermissionsAndroid, Platform, Pressable } from "react-native";

import { Block, Group, Page, SwitchRow } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";
import { loadPreferences, type Preferences, savePreferences } from "@/lib/broadcast/settings";
import * as Broadcaster from "@/modules/framevane-broadcaster";

/**
 * How the app treats the phone it runs on: the screen, the heat, the buzz, and
 * whether the broadcast survives the app leaving the screen.
 */
export default function DeviceSettingsScreen() {
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [notificationRefused, setNotificationRefused] = useState(false);
  /**
   * Refused is one thing; refused twice is another. After that Android answers
   * the request without ever showing a dialog, so the toggle would fail on
   * every press with no way for the operator to see why or change it.
   */
  const [notificationBlocked, setNotificationBlocked] = useState(false);

  // Re-read on focus: the Settings tab stays mounted, and the viewfinder can
  // change a preference while this screen is behind it.
  useFocusEffect(
    useCallback(() => {
      setPreferences(loadPreferences());
    }, []),
  );

  const update = (patch: Partial<Preferences>) => setPreferences(savePreferences(patch));

  const toggleBackground = async () => {
    if (preferences.backgroundBroadcast) {
      update({ backgroundBroadcast: false });
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
    update({ backgroundBroadcast: true });
    await Broadcaster.setBackgroundBroadcast(true).catch(() => {});
  };

  return (
    <Page title="Device">
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

      <Group
        title="Screen and heat"
        footer="Charging while streaming adds heat of its own."
      >
        <SwitchRow
          label="Dim the screen after 30 s idle"
          detail="Saves battery and heat on a tripod. A touch brings it back."
          on={preferences.dimWhenIdle}
          onPress={() => update({ dimWhenIdle: !preferences.dimWhenIdle })}
        />
        <SwitchRow
          label="Ease off when the phone gets hot"
          detail="Lowers the bitrate and pauses the viewfinder aids as it heats, before Android throttles it."
          on={preferences.thermalLadder}
          onPress={() => update({ thermalLadder: !preferences.thermalLadder })}
        />
      </Group>

      <Group title="Feedback">
        <SwitchRow
          label="Buzz when a control takes"
          detail="A short buzz on going live, ending, recording and muting. A dropped connection always buzzes."
          on={preferences.haptics}
          onPress={() => update({ haptics: !preferences.haptics })}
        />
      </Group>
    </Page>
  );
}
