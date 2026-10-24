import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MonitorMode } from "@/modules/framevane-broadcaster";

/**
 * The display-only monitoring aids, as a segmented pill over the picture - the
 * scope row from the camera-monitoring design. Only the modes that exist
 * natively appear; zebras and false colour join as those filters land.
 *
 * A monitoring aid is a framing/focusing help, not broadcast state, so the
 * active segment is neutral white, never the live green. Going on air clears
 * the aid (the native side does it), so the control is disabled while live and
 * says so.
 */
const MODES: { mode: MonitorMode; label: string }[] = [
  { mode: "off", label: "Off" },
  { mode: "peaking", label: "Peaking" },
];

export function MonitoringSelector({
  value,
  onChange,
  disabled,
}: {
  readonly value: MonitorMode;
  readonly onChange: (mode: MonitorMode) => void;
  readonly disabled?: boolean;
}) {
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View style={[styles.pill, disabled && styles.pillDisabled]}>
        {MODES.map(({ mode, label }) => {
          const active = value === mode;
          return (
            <Pressable
              key={mode}
              disabled={disabled}
              onPress={() => onChange(mode)}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled }}
              style={[styles.segment, active && !disabled && styles.segmentActive]}
            >
              <Text style={[styles.label, active && !disabled && styles.labelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {disabled ? <Text style={styles.offAir}>off on air</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 4 },
  pill: {
    flexDirection: "row",
    backgroundColor: "rgba(28,28,32,0.72)",
    borderRadius: 999,
    padding: 3,
  },
  pillDisabled: { opacity: 0.45 },
  segment: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  segmentActive: { backgroundColor: "#FAFAFA" },
  label: { color: "#FAFAFA", fontSize: 14, fontWeight: "600" },
  labelActive: { color: "#14101F" },
  offAir: { color: "rgba(250,250,250,0.6)", fontSize: 11 },
});
