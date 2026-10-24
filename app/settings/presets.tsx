import { useFocusEffect } from "@react-navigation/native";
import { Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { Block, Group, Page, paper } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";
import {
  deletePreset,
  listPresets,
  type Preset,
  renamePreset,
  subscribePresets,
} from "@/lib/broadcast/presets";

/**
 * The looks saved from the viewfinder, to be named and tidied.
 *
 * Saving and applying happen in the viewfinder's drawer, with the picture in
 * front of the operator - a preset applied blind from a settings screen is a
 * surprise at the next broadcast. This screen only renames and deletes.
 */
export default function PresetsSettingsScreen() {
  const [presets, setPresets] = useState<Preset[]>(() => listPresets());

  // Subscribed rather than read once: the drawer can save a preset while this
  // tab sits mounted behind the viewfinder.
  useEffect(() => subscribePresets(() => setPresets(listPresets())), []);
  useFocusEffect(
    useCallback(() => {
      setPresets(listPresets());
    }, []),
  );

  return (
    <Page
      title="Presets"
      intro="Saved and applied from the viewfinder's drawer. Rename or delete them here."
    >
      {presets.length === 0 ? (
        <Group>
          <Block>
            <Text style={{ color: paper.inkMuted, fontSize: 15, lineHeight: 20 }}>
              No presets yet. Set up the picture on the viewfinder and save it from the drawer.
            </Text>
          </Block>
        </Group>
      ) : (
        <Group title="Saved" footer="A name is saved when you leave the field.">
          {presets.map((preset) => (
            <PresetRow key={preset.id} preset={preset} />
          ))}
        </Group>
      )}
    </Page>
  );
}

function PresetRow({ preset }: { preset: Preset }) {
  const [name, setName] = useState(preset.name);

  // A rename from elsewhere replaces what is in the field, unless the field is
  // what changed it.
  useEffect(() => setName(preset.name), [preset.name]);

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      // A blank name is not saved; the field goes back to the one it had.
      setName(preset.name);
      return;
    }
    if (trimmed !== preset.name) renamePreset(preset.id, trimmed);
  };

  return (
    <View className="min-h-[56px] flex-row items-center gap-3 px-4 py-2">
      <View className="flex-1 gap-0.5">
        <TextInput
          value={name}
          onChangeText={setName}
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
          accessibilityLabel={`Name of preset ${preset.name}`}
          placeholder="Preset name"
          placeholderTextColor={paper.inkMuted}
          selectionColor={paper.accent}
          style={{ color: paper.ink, fontSize: 15, paddingVertical: 4 }}
        />
        <Text style={{ color: paper.inkMuted, fontSize: 13, lineHeight: 17 }}>
          {presetSummary(preset)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete preset ${preset.name}`}
        onPress={() => deletePreset(preset.id)}
        hitSlop={8}
        className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
      >
        <Trash2 size={20} color={paper.inkMuted} />
      </Pressable>
    </View>
  );
}

/** One line a preset can be told apart by without applying it. */
function presetSummary(preset: Preset): string {
  const video = `${preset.video.height}p${preset.video.fps}`;
  const exposure =
    preset.exposure.mode === "auto"
      ? `Auto exposure${preset.exposure.ev ? ` ${preset.exposure.ev > 0 ? "+" : ""}${preset.exposure.ev} EV` : ""}`
      : `ISO ${preset.exposure.iso} · 1/${Math.round(1e9 / preset.exposure.exposureNs)}`;
  const wb =
    preset.whiteBalance.mode === "kelvin" ? `${preset.whiteBalance.kelvin}K` : "Preset white balance";
  return `${video} · ${exposure} · ${wb}`;
}
