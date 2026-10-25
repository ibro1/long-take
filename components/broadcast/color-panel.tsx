import { Cloud, Lamp, Lightbulb, Sun } from "lucide-react-native";
import { useEffect, useState } from "react";
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { paper } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";

/**
 * Filmic's colour panel, opened from the diamond: a light panel beside the
 * leading column with a rail of tabs down its left edge. White balance is the
 * first tab - a colour pad (warm to cool down it, green to magenta across it),
 * TEMP and TINT bars beside it, and the presets along the bottom: tungsten,
 * daylight, cloudy, fluorescent, two slots of the operator's own, and AWB.
 *
 * Everything the finger drags runs on the UI thread and reaches the camera at
 * most every COMMIT_MS, like the rulers.
 */

const KELVIN_MIN = 2000;
const KELVIN_MAX = 10000;
const TINT_MAX = 50;
const COMMIT_MS = 80;

/** Camera2 AWB modes the preset buttons stand for. */
const AWB_AUTO = 1;
const PRESETS = [
  { mode: 2, label: "Tungsten", Icon: Lightbulb },
  { mode: 5, label: "Daylight", Icon: Sun },
  { mode: 6, label: "Cloudy", Icon: Cloud },
  { mode: 3, label: "Fluorescent", Icon: Lamp },
] as const;

export type WhiteBalanceSlot = { kelvin: number; tint: number } | null;

/** Kelvin to 0..1 up the TEMP bar: the top is warm, as the picture will look. */
function tempT(kelvin: number): number {
  return (kelvin - KELVIN_MIN) / (KELVIN_MAX - KELVIN_MIN);
}
function kelvinAt(t: number): number {
  "worklet";
  return Math.round((KELVIN_MIN + Math.min(1, Math.max(0, t)) * (KELVIN_MAX - KELVIN_MIN)) / 10) * 10;
}
/** Tint to 0..1: 0 green, 1 magenta. */
function tintT(tint: number): number {
  return (tint + TINT_MAX) / (2 * TINT_MAX);
}
function tintAt(t: number): number {
  "worklet";
  return Math.round((Math.min(1, Math.max(0, t)) * 2 - 1) * TINT_MAX);
}

export function ColorPanel({
  manualWhiteBalance,
  whiteBalanceModes,
  whiteBalance,
  onWhiteBalance,
  kelvin,
  tint,
  sensorKelvin,
  onKelvin,
  slots,
  onSaveSlot,
}: {
  /** The lens takes a temperature and tint; without it only the presets work. */
  readonly manualWhiteBalance: boolean;
  readonly whiteBalanceModes: number[];
  /** The preset mode in force, or -1 while a temperature is set by hand. */
  readonly whiteBalance: number;
  readonly onWhiteBalance: (mode: number) => void;
  /** The temperature set by hand, or null on a preset or auto. */
  readonly kelvin: number | null;
  readonly tint: number;
  /** Where the pad starts when nothing has been set by hand. */
  readonly sensorKelvin: number;
  readonly onKelvin: (kelvin: number, tint: number) => void;
  readonly slots: { a: WhiteBalanceSlot; b: WhiteBalanceSlot };
  readonly onSaveSlot: (slot: "a" | "b", value: WhiteBalanceSlot) => void;
}) {
  const shownKelvin = kelvin ?? sensorKelvin;
  const [readout, setReadout] = useState({ kelvin: shownKelvin, tint });
  useEffect(() => setReadout({ kelvin: shownKelvin, tint }), [shownKelvin, tint]);

  // Pad and bars share these, so dragging one moves the others with it.
  const temp = useSharedValue(tempT(shownKelvin));
  const tnt = useSharedValue(tintT(tint));
  useEffect(() => {
    temp.value = tempT(shownKelvin);
    tnt.value = tintT(tint);
  }, [shownKelvin, tint, temp, tnt]);

  const commit = (t: number, g: number) => {
    const next = { kelvin: kelvinAt(t), tint: tintAt(g) };
    setReadout(next);
    onKelvin(next.kelvin, next.tint);
  };

  const offered = PRESETS.filter((p) => whiteBalanceModes.includes(p.mode));
  const auto = kelvin === null && whiteBalance === AWB_AUTO;

  const slotButton = (slot: "a" | "b") => {
    const saved = slots[slot];
    return (
      <Pressable
        key={slot}
        accessibilityRole="button"
        accessibilityLabel={`Slot ${slot.toUpperCase()}`}
        accessibilityHint={saved ? "Tap to apply; hold to save the current balance over it" : "Tap to save the current balance here"}
        // Empty: a tap stores what is on the pad. Filled: a tap recalls it,
        // and holding stores over it - so neither slot ever looks dead.
        onPress={() =>
          saved
            ? onKelvin(saved.kelvin, saved.tint)
            : onSaveSlot(slot, { kelvin: readout.kelvin, tint: readout.tint })
        }
        onLongPress={() => onSaveSlot(slot, { kelvin: readout.kelvin, tint: readout.tint })}
        className="active:opacity-60"
        style={[styles.preset, saved && kelvin === saved.kelvin && tint === saved.tint && styles.presetOn]}
      >
        <Text style={styles.slotText}>{slot.toUpperCase()}</Text>
        {/* What the slot holds, so a filled one reads differently from an empty one. */}
        <Text style={styles.slotValue}>{saved ? `${saved.kelvin}K` : "save"}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.body}>
      <View style={styles.top}>
        <Pad temp={temp} tint={tnt} enabled={manualWhiteBalance} onCommit={commit} />
        <Bar
          kind="temp"
          value={temp}
          other={tnt}
          enabled={manualWhiteBalance}
          onCommit={commit}
          caption="TEMP"
          readout={`${readout.kelvin}K`}
        />
        <Bar
          kind="tint"
          value={tnt}
          other={temp}
          enabled={manualWhiteBalance}
          onCommit={commit}
          caption="TINT"
          readout={readout.tint > 0 ? `+${readout.tint}` : `${readout.tint}`}
        />
      </View>
      <View style={styles.presets}>
        {offered.map(({ mode, label, Icon }) => {
          const on = kelvin === null && whiteBalance === mode;
          return (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: on }}
              onPress={() => onWhiteBalance(mode)}
              className="active:opacity-60"
              style={[styles.preset, on && styles.presetOn]}
            >
              <Icon size={26} color={paper.ink} strokeWidth={1.4} />
            </Pressable>
          );
        })}
        {manualWhiteBalance ? [slotButton("a"), slotButton("b")] : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Auto white balance"
          accessibilityState={{ selected: auto }}
          onPress={() => onWhiteBalance(AWB_AUTO)}
          className="active:opacity-60"
          style={[styles.awb, auto && styles.awbOn]}
        >
          <Text style={[styles.awbText, auto && { color: filmic.color.accent }]}>AWB</Text>
        </Pressable>
      </View>
      {!manualWhiteBalance ? (
        <Text style={styles.note}>This lens offers presets only; it does not take a temperature by hand.</Text>
      ) : null}
    </View>
  );
}

/** The colour pad: temperature down it (warm at the top), tint across it. */
function Pad({
  temp,
  tint,
  enabled,
  onCommit,
}: {
  readonly temp: SharedValue<number>;
  readonly tint: SharedValue<number>;
  readonly enabled: boolean;
  readonly onCommit: (temp: number, tint: number) => void;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const last = useSharedValue(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    w.value = width;
    h.value = height;
    setSize({ w: width, h: height });
  };
  const move = (x: number, y: number, final: boolean) => {
    "worklet";
    if (w.value <= 0 || h.value <= 0) return;
    tint.value = Math.min(1, Math.max(0, x / w.value));
    temp.value = Math.min(1, Math.max(0, 1 - y / h.value));
    const now = Date.now();
    if (final || now - last.value >= COMMIT_MS) {
      last.value = now;
      scheduleOnRN(onCommit, temp.value, tint.value);
    }
  };
  const pan = Gesture.Pan()
    .enabled(enabled)
    .minDistance(0)
    .onBegin((e) => move(e.x, e.y, false))
    .onUpdate((e) => move(e.x, e.y, false))
    .onEnd((e) => move(e.x, e.y, true));
  const marker = useAnimatedStyle(() => ({
    transform: [{ translateX: tint.value * w.value - 13 }, { translateY: (1 - temp.value) * h.value - 13 }],
  }));
  return (
    <GestureDetector gesture={pan}>
      <View accessibilityLabel="White balance pad" onLayout={onLayout} style={[styles.pad, !enabled && { opacity: 0.4 }]}>
        {size.w > 0 ? (
          <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="warmCool" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#F7B14E" />
                <Stop offset="0.5" stopColor="#E9A9A0" />
                <Stop offset="1" stopColor="#5DC9E8" />
              </LinearGradient>
              <LinearGradient id="greenMagenta" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#7BD86A" stopOpacity="0.35" />
                <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
                <Stop offset="1" stopColor="#F05CC8" stopOpacity="0.4" />
              </LinearGradient>
            </Defs>
            <Rect width={size.w} height={size.h} rx={6} fill="url(#warmCool)" />
            <Rect width={size.w} height={size.h} rx={6} fill="url(#greenMagenta)" />
          </Svg>
        ) : null}
        <Animated.View pointerEvents="none" style={[styles.marker, marker]} />
      </View>
    </GestureDetector>
  );
}

/** TEMP or TINT as a gradient bar with a gap at the value, dragged up and down. */
function Bar({
  kind,
  value,
  other,
  enabled,
  onCommit,
  caption,
  readout,
}: {
  readonly kind: "temp" | "tint";
  readonly value: SharedValue<number>;
  readonly other: SharedValue<number>;
  readonly enabled: boolean;
  readonly onCommit: (temp: number, tint: number) => void;
  readonly caption: string;
  readonly readout: string;
}) {
  const [hh, setHh] = useState(0);
  const h = useSharedValue(0);
  const last = useSharedValue(0);
  const move = (y: number, final: boolean) => {
    "worklet";
    if (h.value <= 0) return;
    value.value = Math.min(1, Math.max(0, 1 - y / h.value));
    const now = Date.now();
    if (final || now - last.value >= COMMIT_MS) {
      last.value = now;
      if (kind === "temp") scheduleOnRN(onCommit, value.value, other.value);
      else scheduleOnRN(onCommit, other.value, value.value);
    }
  };
  const pan = Gesture.Pan()
    .enabled(enabled)
    .minDistance(0)
    .onBegin((e) => move(e.y, false))
    .onUpdate((e) => move(e.y, false))
    .onEnd((e) => move(e.y, true));
  const gap = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - value.value) * h.value - 4 }] }));
  const stops =
    kind === "temp"
      ? ["#F08A2E", "#D9C04A", "#5BC0DE", "#2D8CE0"]
      : ["#E64CD7", "#E8A8DF", "#B5E3A0", "#4FE036"];
  const id = `bar-${kind}`;
  return (
    <View style={styles.barColumn}>
      <GestureDetector gesture={pan}>
        <View
          accessibilityLabel={caption}
          accessibilityValue={{ text: readout }}
          onLayout={(e) => {
            h.value = e.nativeEvent.layout.height;
            setHh(e.nativeEvent.layout.height);
          }}
          style={[styles.bar, !enabled && { opacity: 0.4 }]}
        >
          {hh > 0 ? (
            <Svg width={46} height={hh} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  {stops.map((c, i) => (
                    <Stop key={c} offset={i / (stops.length - 1)} stopColor={c} />
                  ))}
                </LinearGradient>
              </Defs>
              <Rect width={46} height={hh} rx={5} fill={`url(#${id})`} />
            </Svg>
          ) : null}
          <Animated.View pointerEvents="none" style={[styles.barGap, gap]} />
        </View>
      </GestureDetector>
      <Text style={styles.caption}>{caption}</Text>
      <Text style={styles.readout}>{readout}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: 12, gap: 10 },
  top: { flex: 1, flexDirection: "row", gap: 14 },
  pad: { flex: 1, borderRadius: 6, overflow: "hidden" },
  marker: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },
  barColumn: { width: 54, alignItems: "center", gap: 2 },
  bar: { width: 46, flex: 1, borderRadius: 5, overflow: "hidden" },
  barGap: { position: "absolute", left: 0, right: 0, top: 0, height: 8, backgroundColor: paper.page },
  caption: { color: paper.inkMuted, fontSize: 11, letterSpacing: 0.6, marginTop: 4 },
  readout: { color: paper.ink, fontSize: 13, fontWeight: "700" },
  presets: { flexDirection: "row", gap: 6, alignItems: "center" },
  preset: {
    flex: 1,
    height: 46,
    borderRadius: 6,
    backgroundColor: "#D6D6D8",
    alignItems: "center",
    justifyContent: "center",
  },
  presetOn: { backgroundColor: "#FFFFFF", borderWidth: 2, borderColor: filmic.color.accent },
  slotText: { color: paper.ink, fontSize: 22, fontWeight: "300", lineHeight: 26 },
  slotValue: { color: paper.inkMuted, fontSize: 9, letterSpacing: 0.3 },
  awb: { flex: 1.1, height: 46, alignItems: "center", justifyContent: "center" },
  awbOn: { borderTopWidth: 2, borderBottomWidth: 2, borderColor: filmic.color.accent },
  awbText: { color: paper.ink, fontSize: 18, fontWeight: "500" },
  note: { color: paper.inkMuted, fontSize: 12 },
});
