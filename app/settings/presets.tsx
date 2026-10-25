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
import { presetActions } from "@/lib/broadcast/preset-actions";

/**
 * Presets, in one place as Filmic has them: save what the camera is doing now,
 * reset it to auto, and apply, rename or delete what was saved.
 *
 * It opens in the settings panel over the viewfinder, so the picture is
 * still in view behind it while a preset is applied. Saving, applying and
 * resetting are lent by the viewfinder (preset-actions.ts); opened with no
 * viewfinder behind it, the page can still rename and delete.
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

  const actions = presetActions();
  const [newName, setNewName] = useState("");
  const save = () => {
    const name = newName.trim();
    if (!name || !actions) return;
    actions.save(name);
    setNewName("");
  };

  return (
    <Page title="Presets">
      {actions ? (
        <Group footer="Saves exposure, white balance and the picture size and rate. Reset puts the camera back to auto.">
          <View className="flex-row items-center gap-2 px-4 py-3">
            <TextInput
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={save}
              returnKeyType="done"
              accessibilityLabel="Name for the new preset"
              placeholder="Name, e.g. Masjid class"
              placeholderTextColor={paper.inkMuted}
              selectionColor={paper.accent}
              style={{ flex: 1, color: paper.ink, fontSize: 15, paddingVertical: 8 }}
            />
            <ActionButton label="Save" primary disabled={!newName.trim()} onPress={save} />
            <ActionButton label="Reset" onPress={actions.reset} />
          </View>
        </Group>
      ) : null}
      {presets.length === 0 ? (
        <Group>
          <Block>
            <Text style={{ color: paper.inkMuted, fontSize: 15, lineHeight: 20 }}>
              No presets yet. Set the camera up the way you want it, name it above, and save.
            </Text>
          </Block>
        </Group>
      ) : (
        <Group title="Saved" footer="Tap Apply to use one. A name is saved when you leave its field.">
          {presets.map((preset) => (
            <PresetRow key={preset.id} preset={preset} onApply={actions ? () => actions.apply(preset) : undefined} />
          ))}
        </Group>
      )}
    </Page>
  );
}

function ActionButton({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="active:opacity-60"
      style={{
        minHeight: 40,
        paddingHorizontal: 16,
        borderRadius: 8,
        justifyContent: "center",
        backgroundColor: disabled ? paper.track : primary ? paper.accent : paper.card,
        borderWidth: primary ? 0 : 1,
        borderColor: paper.line,
      }}
    >
      <Text style={{ color: disabled ? paper.inkMuted : paper.ink, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function PresetRow({ preset, onApply }: { preset: Preset; onApply?: () => void }) {
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
      {onApply ? <ActionButton label="Apply" onPress={onApply} /> : null}
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
