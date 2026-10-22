import { useState } from "react";

import { ChoiceRow, Group, Page, SwitchRow } from "@/components/settings/chrome";
import { loadSettings, type PhoneEncoderSettings, saveSettings } from "@/lib/broadcast/settings";

/**
 * What the encoder does when the uplink cannot carry what it is being asked to
 * send. Both of these are what stands between a wobbly connection and a
 * broadcast that ends in the middle, and both take effect at the next one.
 */
export default function NetworkSettingsScreen() {
  const [settings, setSettings] = useState<PhoneEncoderSettings>(() => loadSettings());

  const update = (patch: Partial<PhoneEncoderSettings>) => setSettings(saveSettings(patch));

  return (
    <Page title="On a bad connection" intro="Applied the next time you go live.">
      <Group title="Bitrate">
        <SwitchRow
          label="Send less rather than stall"
          detail="Drops the bitrate when the uplink cannot carry it, and climbs back slowly."
          on={settings.adaptiveBitrate}
          onPress={() => update({ adaptiveBitrate: !settings.adaptiveBitrate })}
        />
      </Group>

      <Group
        title="Reconnecting"
        footer={
          settings.autoReconnect
            ? undefined
            : "With this off, a dropped connection ends the broadcast and the wait below is not used."
        }
      >
        <SwitchRow
          label="Reconnect by itself"
          detail="A phone that changes cell tower comes back on its own instead of going off air."
          on={settings.autoReconnect}
          onPress={() => update({ autoReconnect: !settings.autoReconnect })}
        />
        <ChoiceRow
          label="Wait between attempts"
          value={settings.reconnectDelayMs}
          options={[
            { label: "2s", value: 2_000 },
            { label: "4s", value: 4_000 },
            { label: "8s", value: 8_000 },
          ]}
          onChange={(reconnectDelayMs) => update({ reconnectDelayMs })}
        />
      </Group>
    </Page>
  );
}
