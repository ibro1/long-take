import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";

import { ChoiceRow, Group, NavRow, Page, SwitchRow, useSettingsNav } from "@/components/settings/chrome";
import {
  loadPreferences,
  type Preferences,
  QUICK_CONTROLS,
  savePreferences,
} from "@/lib/broadcast/settings";
import { applyLanguagePreference } from "@/lib/i18n";

/**
 * What is drawn on the glass: which controls, in which language, and how the
 * focus and exposure aids look. Nothing here changes what is sent.
 */
export default function InterfaceSettingsScreen() {
  const nav = useSettingsNav();
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());

  // Quick access is changed one screen further in, so its summary is re-read
  // when the operator comes back.
  useFocusEffect(
    useCallback(() => {
      setPreferences(loadPreferences());
    }, []),
  );

  const update = (patch: Partial<Preferences>) => setPreferences(savePreferences(patch));

  return (
    <Page title="Interface" intro="Changes what is drawn on the viewfinder, not what is sent.">
      <Group title="Viewfinder">
        <NavRow
          label="Quick access"
          detail="Which controls sit on the glass and which go in the menu"
          value={quickAccessSummary(preferences)}
          onPress={() => nav.go("/settings/quick-access")}
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
            update({ language });
            applyLanguagePreference();
          }}
        />
        <SwitchRow
          label="Readout strip"
          detail="The line of numbers along the viewfinder: bitrate, time, battery and heat."
          on={preferences.readoutStrip}
          onPress={() => update({ readoutStrip: !preferences.readoutStrip })}
        />
      </Group>

      <Group
        title="Aids"
        footer="Peaking paints the edges that are in focus; pick the colour that stands out against the scene. Zebras stripe whatever is brighter than the threshold - lower warns earlier."
      >
        <ChoiceRow
          label="Peaking colour"
          value={preferences.peakingColor}
          options={[
            { label: "Red", value: "#FF3B30" },
            { label: "Yellow", value: "#FFD60A" },
            { label: "Blue", value: "#0A84FF" },
            { label: "Green", value: "#34C759" },
          ]}
          onChange={(peakingColor) => update({ peakingColor })}
        />
        <ChoiceRow
          label="Zebra threshold"
          value={preferences.zebraThreshold}
          options={[
            { label: "90%", value: 0.9 },
            { label: "95%", value: 0.95 },
            { label: "98%", value: 0.98 },
          ]}
          onChange={(zebraThreshold) => update({ zebraThreshold })}
        />
      </Group>
    </Page>
  );
}

function quickAccessSummary(preferences: Preferences): string {
  const count = preferences.quickAccess.length;
  if (count === QUICK_CONTROLS.length) return "All on the glass";
  return `${count} of ${QUICK_CONTROLS.length}`;
}
