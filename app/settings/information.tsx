import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Linking } from "react-native";

import { Group, NavRow, Page, useSettingsNav } from "@/components/settings/chrome";
import { dashboardSite } from "@/components/settings/phone";
import { readLog } from "@/lib/broadcast/log";

/** What the app is, what it has been doing, and the terms it runs under. */
export default function InformationSettingsScreen() {
  const nav = useSettingsNav();
  const [logLines, setLogLines] = useState(0);

  // The log grows while a broadcast runs, so it is counted each time this
  // screen comes up rather than once.
  useFocusEffect(
    useCallback(() => {
      setLogLines(readLog().length);
    }, []),
  );

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
    <Page title="Information">
      <Group title="This app">
        <NavRow
          label="About Long Take"
          value={String(Constants.expoConfig?.version ?? "")}
          onPress={() => nav.go("/settings/about")}
        />
        <NavRow
          label="Log"
          detail={
            logLines === 0
              ? "Nothing logged this session."
              : `${logLines} ${logLines === 1 ? "line" : "lines"} from this session.`
          }
          onPress={() => nav.go("/(tabs)/log")}
        />
      </Group>

      <Group
        title="Legal"
        footer="The policy and the terms are pages on the Framevane server this phone is paired with, and they open in a browser."
      >
        <NavRow label="Privacy policy" external onPress={() => void openOnTheWeb("/privacy")} />
        <NavRow label="Terms" external onPress={() => void openOnTheWeb("/terms")} />
      </Group>
    </Page>
  );
}
