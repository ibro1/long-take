import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";
import type { MonitorMode } from "@/modules/framevane-broadcaster";

import { FalseColorIcon, MonitorOffIcon, PeakingIcon, ZebraIcon } from "./icons";

/**
 * The display-only monitoring aids, as a Filmic-style icon scope row over the
 * picture. Only the modes that exist natively appear.
 *
 * A monitoring aid is a framing/focusing help, not broadcast state, so the
 * active segment is neutral white, never the live amber or green. Going on air
 * clears the aid (the native side does it), so the control is disabled while
 * live and says so.
 */
const MODES: {
  mode: MonitorMode;
  label: string;
  Icon: typeof MonitorOffIcon;
}[] = [
  { mode: "off", label: "Off", Icon: MonitorOffIcon },
  { mode: "peaking", label: "Peaking", Icon: PeakingIcon },
  { mode: "zebra", label: "Zebra", Icon: ZebraIcon },
  { mode: "falsecolor", label: "False colour", Icon: FalseColorIcon },
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
  const current = MODES.find((m) => m.mode === value) ?? MODES[0];
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.pill, disabled && styles.pillDisabled]}>
        {MODES.map(({ mode, label, Icon }) => {
          const active = value === mode;
          const on = active && !disabled;
          return (
            <Pressable
              key={mode}
              disabled={disabled}
              onPress={() => onChange(mode)}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: active, disabled }}
              style={[styles.segment, on && styles.segmentActive]}
            >
              <Icon
                className={on ? "h-[18px] w-[18px] text-filmic-accentink" : "h-[18px] w-[18px] text-filmic-ink"}
              />
            </Pressable>
          );
        })}
      </View>
      {/* The active aid, named once below the strip - the icons carry it, the
          word confirms it without crowding each segment. */}
      <Text style={styles.caption}>{disabled ? "off on air" : current.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 3 },
  pill: {
    flexDirection: "row",
    backgroundColor: filmic.color.panel,
    borderRadius: filmic.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: filmic.color.line,
    padding: 3,
    gap: 2,
  },
  pillDisabled: { opacity: 0.45 },
  segment: {
    minHeight: 40,
    minWidth: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: filmic.radius.pill,
  },
  segmentActive: { backgroundColor: filmic.color.ink },
  caption: {
    color: filmic.color.inkMuted,
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
