import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";

import { Group, NavRow, Page } from "@/components/settings/chrome";
import { loadSettings, type PhoneEncoderSettings } from "@/lib/broadcast/settings";

/**
 * Where the broadcast goes and what it does when the road there is bad. The
 * destinations themselves are a screen of their own; this is the way in.
 */
export default function StreamingSettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<PhoneEncoderSettings>(() => loadSettings());

  useFocusEffect(
    useCallback(() => {
      setSettings(loadSettings());
    }, []),
  );

  return (
    <Page title="Streaming">
      <Group footer="Picture size, frame rate and bitrate are set per destination.">
        <NavRow
          label="Destinations"
          detail="Where the broadcast is sent, and at what size"
          onPress={() => router.push("/(tabs)/connections")}
        />
        <NavRow
          label="On a bad connection"
          detail={networkSummary(settings)}
          onPress={() => router.push("/settings/network")}
        />
      </Group>
    </Page>
  );
}

function networkSummary(settings: PhoneEncoderSettings): string {
  const bitrate = settings.adaptiveBitrate ? "Sends less rather than stalling" : "Fixed bitrate";
  const reconnect = settings.autoReconnect
    ? `reconnects after ${settings.reconnectDelayMs / 1000}s`
    : "does not reconnect";
  return `${bitrate} · ${reconnect}`;
}
