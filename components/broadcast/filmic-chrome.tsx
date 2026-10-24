import type { LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, Line, LinearGradient, Rect, Stop } from "react-native-svg";

import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";

import { Mono } from "./mono";

/**
 * Filmic Pro's viewfinder furniture: the ringed buttons, the floating discs,
 * the badge, the colour diamond and the bottom info panel.
 *
 * Everything token-driven is inline style rather than className, because the
 * active colours are chosen at runtime and NativeWind cannot build a class
 * name it has not seen at compile time.
 */

/** The ring is near-white, not ink: at full ink it out-shouts the icon. */
const RING = "rgba(255,255,255,0.75)";
/** Darker than filmic.panel - these discs sit on the picture with no border. */
const DISC_FILL = "rgba(10,10,12,0.82)";
const PANEL_FILL = "rgba(10,10,12,0.86)";
const DIVIDER = "rgba(255,255,255,0.18)";
const OFF_AIR_BORDER = "rgba(255,255,255,0.28)";

/** Same cap as chrome.tsx's HUD_TEXT; restated so this file stands alone. */
const HUD_TEXT = 1.3;

// size + color props rather than className: the glyph is a fraction of a
// runtime size and its colour is a runtime token, neither of which a static
// class can express.
function Glyph({ icon: Icon, size, color }: { icon: LucideIcon; size: number; color: string }) {
  return <Icon size={size} color={color} />;
}

type Tint = "alert" | "accent";

function tint(tone: Tint): string {
  return tone === "alert" ? filmic.color.alert : filmic.color.accent;
}

// ---------------------------------------------------------------------------

// Press feedback goes through className (`active:opacity-60`), never a style
// function: nativewind's Pressable wrapper drops `style={({ pressed }) => ...}`
// entirely, which took the ring, the disc fill and the info panel's row layout
// with it on the first build.
export function RingButton({
  icon,
  label,
  onPress,
  onLongPress,
  active,
  tone,
  size = 52,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  active?: boolean;
  tone?: Tint;
  size?: number;
}) {
  // Ring and glyph change together, so the state reads from the edge of the
  // eye even when the icon itself is too small to parse.
  const color = active ? tint(tone ?? "accent") : undefined;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      className="active:opacity-60"
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color ?? RING,
        },
      ]}
    >
      <Glyph icon={icon} size={Math.round(size * 0.45)} color={color ?? filmic.color.ink} />
    </Pressable>
  );
}

export function GlassDisc({
  icon,
  label,
  onPress,
  active,
  tone,
  size = 48,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  active?: boolean;
  tone?: Tint;
  size?: number;
}) {
  // No border: the fill is dark enough to hold its edge on a white subject,
  // and a hairline here reads as a second button behind the first.
  const color = active ? tint(tone ?? "accent") : filmic.color.ink;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      className="active:opacity-60"
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: DISC_FILL,
        },
      ]}
    >
      <Glyph icon={icon} size={Math.round(size * 0.45)} color={color} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

export type BroadcastState = "offAir" | "live" | "paused" | "connecting" | "reconnecting";

const BADGE: Record<BroadcastState, { bg: string; fg: string; border?: string }> = {
  live: { bg: filmic.color.alert, fg: filmic.color.ink },
  // Amber for both: each is a hold the audience can see, not an error.
  paused: { bg: filmic.color.accent, fg: filmic.color.accentInk },
  reconnecting: { bg: filmic.color.accent, fg: filmic.color.accentInk },
  connecting: { bg: filmic.color.elevated, fg: filmic.color.ink },
  // Outline only, so off-air never competes with a real state for attention.
  offAir: { bg: "transparent", fg: filmic.color.inkMuted, border: OFF_AIR_BORDER },
};

export function StatusBadge({ state, label }: { state: BroadcastState; label: string }) {
  const look = BADGE[state];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        styles.badge,
        {
          backgroundColor: look.bg,
          borderWidth: look.border ? 1 : 0,
          borderColor: look.border,
        },
      ]}
    >
      <Text maxFontSizeMultiplier={HUD_TEXT} numberOfLines={1} style={[styles.badgeText, { color: look.fg }]}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------

const DIAMOND = 42;

export function ColorDiamond({
  onPress,
  active,
  label,
}: {
  onPress: () => void;
  active?: boolean;
  label: string;
}) {
  // The outline sits on a wrapper 2dp bigger on every side rather than on
  // the gradient square, so turning it on does not shrink the gradient.
  const frame = DIAMOND + 4;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      className="active:opacity-60"
      style={[styles.center, { width: 60, height: 60 }]}
    >
      <View
        style={[
          styles.center,
          {
            width: frame,
            height: frame,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: active ? "#FFFFFF" : "transparent",
            transform: [{ rotate: "45deg" }],
          },
        ]}
      >
        <View style={{ width: DIAMOND, height: DIAMOND, borderRadius: 8, overflow: "hidden" }}>
          {/* The square is drawn unrotated; the parent turns it. Corner (0,0)
              becomes the diamond's top point, so the gradient runs from the
              warm top to the cool bottom-right as Filmic's does. */}
          <Svg width={DIAMOND} height={DIAMOND}>
            <Defs>
              <LinearGradient id="filmicDiamond" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor="#E040A0" />
                <Stop offset="0.32" stopColor="#F5A623" />
                <Stop offset="0.56" stopColor="#9BD84A" />
                <Stop offset="0.78" stopColor="#3EC6E0" />
                <Stop offset="1" stopColor="#7A6BF0" />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={DIAMOND} height={DIAMOND} fill="url(#filmicDiamond)" />
            {/* The square's midlines: after the 45° turn they are the X that
                reads as diagonal on screen. */}
            <Line x1={DIAMOND / 2} y1={0} x2={DIAMOND / 2} y2={DIAMOND} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
            <Line x1={0} y1={DIAMOND / 2} x2={DIAMOND} y2={DIAMOND / 2} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
          </Svg>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

function batteryFill(level: number, charging: boolean): string {
  // Charging wins: a low battery on the cable is not something to act on.
  if (charging) return filmic.color.good;
  if (level <= 0.15) return filmic.color.alert;
  if (level <= 0.3) return filmic.color.accent;
  return filmic.color.ink;
}

function Battery({ level, charging }: { level: number; charging: boolean }) {
  const clamped = Math.max(0, Math.min(1, level));
  // Inner width is the body minus the 1.5dp stroke and a 1dp gap each side.
  const inner = 22 - 2 * (1.5 + 1);
  return (
    <View style={styles.row}>
      {charging ? (
        <Text maxFontSizeMultiplier={HUD_TEXT} style={{ fontSize: 10, color: filmic.color.good, marginRight: 2 }}>
          ⚡
        </Text>
      ) : null}
      <View style={styles.batteryBody}>
        <View
          style={{
            width: inner * clamped,
            height: "100%",
            borderRadius: 1,
            backgroundColor: batteryFill(clamped, charging),
          }}
        />
      </View>
      <View style={styles.batteryNub} />
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

export function InfoPanel({
  fps,
  resolution,
  timecode,
  hot,
  subline,
  battery,
  warn,
  onPress,
  onLongPress,
}: {
  fps: number | null;
  resolution: string | null;
  timecode: string;
  hot: boolean;
  subline?: string | null;
  battery: { level: number; charging: boolean };
  warn?: boolean;
  onPress?: () => void;
  /** Holding the panel answers "how long will the battery last". */
  onLongPress?: () => void;
}) {
  const percent = Math.round(Math.max(0, Math.min(1, battery.level)) * 100);
  const summary = [
    `${fps ?? "unknown"} frames per second`,
    resolution ?? "resolution unknown",
    timecode,
    `battery ${percent} percent${battery.charging ? ", charging" : ""}`,
  ].join(", ");

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole="button"
      accessibilityLabel={summary}
      className="active:opacity-60"
      style={[styles.panel, warn ? { borderWidth: 1, borderColor: filmic.color.accent } : null]}
    >
      <View>
        {/* FPS hangs off the top of the number, the way Filmic sets it, so the
            figure keeps its full height in a 62dp panel. */}
        <View style={[styles.row, { alignItems: "flex-start" }]}>
          <Text maxFontSizeMultiplier={HUD_TEXT} style={[styles.fps, { color: filmic.color.ink }]}>
            {`${fps ?? "–"}`}
          </Text>
          <Text maxFontSizeMultiplier={HUD_TEXT} style={[styles.fpsUnit, { color: filmic.color.ink }]}>
            FPS
          </Text>
        </View>
        <Text maxFontSizeMultiplier={HUD_TEXT} style={[styles.resolution, { color: filmic.color.ink }]}>
          {resolution ?? "–"}
        </Text>
      </View>

      <Divider />

      <View style={styles.center}>
        {/* Thin tabular digits: the clock is the biggest thing in the panel
            and must not jitter sideways as it ticks. */}
        <Text
          maxFontSizeMultiplier={HUD_TEXT}
          numberOfLines={1}
          style={[styles.timecode, { color: hot ? filmic.color.alert : filmic.color.ink }]}
        >
          {timecode}
        </Text>
        {subline ? (
          <Text maxFontSizeMultiplier={HUD_TEXT} numberOfLines={1} style={[styles.subline, { color: filmic.color.inkMuted }]}>
            {subline}
          </Text>
        ) : null}
      </View>

      <Divider />

      <View style={[styles.center, { gap: 3 }]}>
        <Battery level={battery.level} charging={battery.charging} />
        <Mono className="text-[11px]">{`${percent}%`}</Mono>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center" },
  badge: {
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  panel: {
    height: 62,
    borderRadius: 14,
    backgroundColor: PANEL_FILL,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  fps: { fontSize: 20, lineHeight: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  fpsUnit: { fontSize: 9, lineHeight: 11, fontWeight: "700", marginLeft: 2, marginTop: 1 },
  resolution: { fontSize: 14, lineHeight: 17, fontWeight: "500" },
  timecode: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "200",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  subline: { fontSize: 10, lineHeight: 12 },
  divider: { width: 1, height: 34, backgroundColor: DIVIDER },
  batteryBody: {
    width: 22,
    height: 11,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: filmic.color.inkMuted,
    padding: 1,
    justifyContent: "center",
  },
  batteryNub: {
    width: 2,
    height: 5,
    marginLeft: 1,
    borderTopRightRadius: 1,
    borderBottomRightRadius: 1,
    backgroundColor: filmic.color.inkMuted,
  },
});
