import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Plus, RotateCcw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { paper } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";
import {
  CURVES,
  GRADE_DEFAULTS,
  type GradeState,
  LOOKS,
  previewLook,
  SWATCH,
} from "@/lib/broadcast/grade";
import { filmic } from "@/lib/theme/filmic";
import { loadLut } from "@/modules/framevane-broadcaster";

/**
 * The colour panel's Looks, Gamma and LUT tabs. Each change goes straight to
 * the camera through [onChange]; the grade is burned into the recording and
 * the stream, which is said once on each tab rather than hidden.
 */

type Props = { readonly state: GradeState; readonly onChange: (next: GradeState) => void };

const COMMIT_MS = 80;

function ResetButton({ onPress, label }: { readonly onPress: () => void; readonly label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      className="active:opacity-60"
      style={styles.reset}
    >
      <RotateCcw size={24} color="#2E7BC6" strokeWidth={2} />
    </Pressable>
  );
}

// --- Looks -----------------------------------------------------------------

export function LooksTab({ state, onChange }: Props) {
  return (
    <View style={styles.body}>
      <View style={styles.headRow}>
        <ResetButton label="No look" onPress={() => onChange({ ...state, look: "none" })} />
        <Text style={styles.note}>Burned into the recording and the stream.</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {LOOKS.filter((l) => l.id !== "none").map((look) => {
          const on = state.look === look.id;
          return (
            <Pressable
              key={look.id}
              accessibilityRole="button"
              accessibilityLabel={`${look.name}. ${look.tagline}`}
              accessibilityState={{ selected: on }}
              onPress={() => onChange({ ...state, look: on ? "none" : look.id })}
              className="active:opacity-70"
              style={[styles.lookTile, on && styles.lookTileOn]}
            >
              <View style={styles.swatch}>
                {SWATCH.map((c) => (
                  <View key={c.join()} style={{ flex: 1, backgroundColor: previewLook(c, look.params) }} />
                ))}
              </View>
              <Text style={[styles.lookName, on && { color: paper.ink }]}>{look.name.toUpperCase()}</Text>
              <Text numberOfLines={2} style={styles.lookTag}>
                {look.tagline}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// --- Gamma -----------------------------------------------------------------

/** The shape of each curve, drawn as Filmic draws its tiles. */
const CURVE_PATHS: Record<number, string> = {
  0: "M2 38 L58 2",
  1: "M2 38 C 22 34, 38 8, 58 2",
  2: "M2 38 C 30 40, 30 0, 58 2",
  3: "M2 32 C 20 22, 40 14, 58 8",
  4: "M2 34 C 8 10, 30 4, 58 3",
};

export function GammaTab({ state, onChange }: Props) {
  return (
    <ScrollView style={styles.body} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
      <View style={styles.headRow}>
        <ResetButton
          label="Reset gamma"
          onPress={() =>
            onChange({
              ...state,
              curve: 0,
              black: GRADE_DEFAULTS.black,
              white: GRADE_DEFAULTS.white,
              shadow: 0,
              highlight: 0,
            })
          }
        />
        <View style={styles.curves}>
          {CURVES.map((c) => {
            const on = state.curve === c.id;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={c.label}
                accessibilityState={{ selected: on }}
                onPress={() => onChange({ ...state, curve: c.id })}
                className="active:opacity-60"
                style={styles.curveTile}
              >
                <Svg width={60} height={40}>
                  <Path
                    d={`${CURVE_PATHS[c.id]} L58 40 L2 40 Z`}
                    fill={on ? "#3A3A3C" : "#8E8E93"}
                    opacity={on ? 1 : 0.6}
                  />
                </Svg>
                <Text style={[styles.curveLabel, on && { color: paper.ink }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <LevelsTrack
        black={state.black}
        white={state.white}
        onChange={(black, white) => onChange({ ...state, black, white })}
      />
      <CentreSlider label="Shadow" value={state.shadow} onChange={(shadow) => onChange({ ...state, shadow })} />
      <CentreSlider
        label="Highlight"
        value={state.highlight}
        onChange={(highlight) => onChange({ ...state, highlight })}
      />
    </ScrollView>
  );
}

const DROP = 34;

/** Black and white points as two drops on one track, 0 to 255. */
function LevelsTrack({
  black,
  white,
  onChange,
}: {
  readonly black: number;
  readonly white: number;
  readonly onChange: (black: number, white: number) => void;
}) {
  const w = useSharedValue(0);
  const lo = useSharedValue(black);
  const hi = useSharedValue(white);
  const last = useSharedValue(0);
  const [shown, setShown] = useState({ black, white });
  useEffect(() => {
    lo.value = black;
    hi.value = white;
    setShown({ black, white });
  }, [black, white, lo, hi]);
  const startLo = useSharedValue(0);
  const startHi = useSharedValue(0);
  const report = (b: number, h: number) => {
    setShown({ black: b, white: h });
    onChange(b, h);
  };
  const drag = (which: "lo" | "hi") => {
    const start = which === "lo" ? startLo : startHi;
    return Gesture.Pan()
      .minDistance(0)
      .hitSlop({ vertical: 12, horizontal: 8 })
      .onBegin(() => {
        start.value = which === "lo" ? lo.value : hi.value;
      })
      .onUpdate((e) => {
        if (w.value <= 0) return;
        const v = start.value + e.translationX / w.value;
        if (which === "lo") lo.value = Math.min(0.5, Math.max(0, Math.min(v, hi.value - 0.05)));
        else hi.value = Math.max(0.5, Math.min(1, Math.max(v, lo.value + 0.05)));
        const now = Date.now();
        if (now - last.value >= COMMIT_MS) {
          last.value = now;
          scheduleOnRN(report, lo.value, hi.value);
        }
      })
      .onFinalize(() => scheduleOnRN(report, lo.value, hi.value));
  };
  const loPan = drag("lo");
  const hiPan = drag("hi");
  const loStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lo.value * w.value - DROP / 2 }] }));
  const hiStyle = useAnimatedStyle(() => ({ transform: [{ translateX: hi.value * w.value - DROP / 2 }] }));
  return (
    <View style={styles.levels} onLayout={(e) => (w.value = e.nativeEvent.layout.width)}>
      <View style={styles.levelsLine} />
      <GestureDetector gesture={loPan}>
        <Animated.View accessibilityLabel="Black point" style={[styles.drop, styles.dropBlack, loStyle]}>
          <Text style={styles.dropTextLight}>{Math.round(shown.black * 255)}</Text>
        </Animated.View>
      </GestureDetector>
      <GestureDetector gesture={hiPan}>
        <Animated.View accessibilityLabel="White point" style={[styles.drop, styles.dropWhite, hiStyle]}>
          <Text style={styles.dropTextDark}>{Math.round(shown.white * 255)}</Text>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** -1..1 with the knob resting in the middle and the value written in it, as Filmic's. */
function CentreSlider({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (v: number) => void;
}) {
  const w = useSharedValue(0);
  const pos = useSharedValue((value + 1) / 2);
  const start = useSharedValue(0);
  const last = useSharedValue(0);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    pos.value = (value + 1) / 2;
    setShown(value);
  }, [value, pos]);
  const report = (t: number) => {
    const v = Math.round((t * 2 - 1) * 10) / 10;
    setShown(v);
    onChange(v);
  };
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      start.value = pos.value;
    })
    .onUpdate((e) => {
      if (w.value <= 0) return;
      pos.value = Math.min(1, Math.max(0, start.value + e.translationX / w.value));
      const now = Date.now();
      if (now - last.value >= COMMIT_MS) {
        last.value = now;
        scheduleOnRN(report, pos.value);
      }
    })
    .onFinalize(() => scheduleOnRN(report, pos.value));
  const reset = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      pos.value = 0.5;
      scheduleOnRN(report, 0.5);
    });
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value * w.value - 22 }] }));
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <GestureDetector gesture={Gesture.Exclusive(reset, pan)}>
        <View
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: shown.toFixed(1) }}
          style={styles.sliderTrack}
          onLayout={(e) => (w.value = e.nativeEvent.layout.width)}
        >
          <View style={styles.sliderLine} />
          <Animated.View style={[styles.sliderKnob, knob]}>
            <Text style={styles.sliderValue}>{shown.toFixed(1)}</Text>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

// --- LUT -------------------------------------------------------------------

const LUT_DIR = `${FileSystem.documentDirectory}luts/`;

export function LutTab({ state, onChange }: Props) {
  const [busy, setBusy] = useState<number | null>(null);

  const importInto = async (slot: number) => {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    if (!asset.name.toLowerCase().endsWith(".cube")) {
      Alert.alert("Not a LUT", "Choose a 3D LUT in .cube format.");
      return;
    }
    setBusy(slot);
    try {
      await FileSystem.makeDirectoryAsync(LUT_DIR, { intermediates: true }).catch(() => {});
      const dest = `${LUT_DIR}${Date.now()}-${asset.name.replace(/[^\w.-]+/g, "_")}`;
      await FileSystem.copyAsync({ from: asset.uri, to: dest });
      // Read it once now, so a broken file is refused at import, not on air.
      await loadLut(dest);
      const luts = [...state.luts];
      luts[slot] = { name: asset.name.replace(/\.cube$/i, ""), path: dest };
      onChange({ ...state, luts, lut: slot });
    } catch (e) {
      Alert.alert("Could not use that LUT", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = (slot: number) => {
    const entry = state.luts[slot];
    if (!entry) return;
    Alert.alert(`Remove ${entry.name}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void FileSystem.deleteAsync(entry.path, { idempotent: true });
          const luts = [...state.luts];
          luts[slot] = null;
          onChange({ ...state, luts, lut: state.lut === slot ? null : state.lut });
        },
      },
    ]);
  };

  return (
    <View style={styles.body}>
      <View style={styles.headRow}>
        <ResetButton label="No LUT" onPress={() => onChange({ ...state, lut: null })} />
        <Text style={styles.note}>Burned into the recording and the stream. Hold a LUT to remove it.</Text>
      </View>
      <ScrollView contentContainerStyle={{ gap: 8 }}>
        {state.luts.map((entry, slot) => {
          const on = state.lut === slot && entry !== null;
          return (
            <Pressable
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={entry ? `${entry.name}${on ? ", in use" : ""}` : "Import a LUT"}
              onPress={() =>
                entry ? onChange({ ...state, lut: on ? null : slot }) : void importInto(slot)
              }
              onLongPress={() => remove(slot)}
              className="active:opacity-70"
              style={[styles.lutSlot, on && styles.lutSlotOn]}
            >
              {entry ? (
                <Text numberOfLines={1} style={[styles.lutName, on && { color: paper.ink }]}>
                  {entry.name}
                </Text>
              ) : busy === slot ? (
                <Text style={styles.lutName}>Reading...</Text>
              ) : (
                <Plus size={30} color={paper.ink} strokeWidth={1.3} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      {state.lut !== null ? (
        <StrengthSlider value={state.lutStrength} onChange={(lutStrength) => onChange({ ...state, lutStrength })} />
      ) : null}
    </View>
  );
}

function StrengthSlider({ value, onChange }: { readonly value: number; readonly onChange: (v: number) => void }) {
  const w = useSharedValue(0);
  const pos = useSharedValue(value);
  const start = useSharedValue(0);
  const last = useSharedValue(0);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    pos.value = value;
    setShown(value);
  }, [value, pos]);
  const report = (t: number) => {
    const v = Math.round(t * 100) / 100;
    setShown(v);
    onChange(v);
  };
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      start.value = pos.value;
    })
    .onUpdate((e) => {
      if (w.value <= 0) return;
      pos.value = Math.min(1, Math.max(0, start.value + e.translationX / w.value));
      const now = Date.now();
      if (now - last.value >= COMMIT_MS) {
        last.value = now;
        scheduleOnRN(report, pos.value);
      }
    })
    .onFinalize(() => scheduleOnRN(report, pos.value));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value * w.value - 22 }] }));
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderLabel}>Strength</Text>
      <GestureDetector gesture={pan}>
        <View style={styles.sliderTrack} onLayout={(e) => (w.value = e.nativeEvent.layout.width)}>
          <View style={styles.sliderLine} />
          <Animated.View style={[styles.sliderKnob, knob]}>
            <Text style={styles.sliderValue}>{Math.round(shown * 100)}</Text>
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 12, gap: 10 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  reset: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  note: { flex: 1, color: paper.inkMuted, fontSize: 12 },
  lookTile: { width: 132, gap: 4, padding: 4, borderRadius: 6 },
  lookTileOn: { backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: filmic.color.accent },
  swatch: { height: 96, borderRadius: 4, overflow: "hidden", flexDirection: "row" },
  lookName: { color: paper.inkMuted, fontSize: 15, fontWeight: "800", letterSpacing: 0.5 },
  lookTag: { color: paper.inkMuted, fontSize: 11, lineHeight: 14 },
  curves: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  curveTile: { alignItems: "center", gap: 2 },
  curveLabel: { color: paper.inkMuted, fontSize: 12 },
  levels: { height: 44, marginHorizontal: DROP / 2, justifyContent: "center" },
  levelsLine: { height: 3, backgroundColor: "#6B6B70", borderRadius: 2 },
  drop: {
    position: "absolute",
    left: 0,
    width: DROP,
    height: DROP,
    borderRadius: DROP / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  dropBlack: { backgroundColor: "#1C1C1E", borderColor: "#1C1C1E" },
  dropWhite: { backgroundColor: "#F2F2F7", borderColor: "#6B6B70" },
  dropTextLight: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  dropTextDark: { color: "#1C1C1E", fontSize: 11, fontWeight: "700" },
  sliderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sliderLabel: { width: 84, color: paper.ink, fontSize: 16 },
  sliderTrack: { flex: 1, height: 46, justifyContent: "center", marginHorizontal: 22 },
  sliderLine: { height: 2, backgroundColor: "#3A3A3C" },
  sliderKnob: {
    position: "absolute",
    left: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "#3A3A3C",
    backgroundColor: paper.page,
    alignItems: "center",
    justifyContent: "center",
  },
  sliderValue: { color: paper.ink, fontSize: 12 },
  lutSlot: {
    height: 52,
    borderRadius: 6,
    backgroundColor: "#D6D6D8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  lutSlotOn: { backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: filmic.color.accent },
  lutName: { color: paper.inkMuted, fontSize: 16, fontWeight: "600" },
});
