import { Pressable, StyleSheet, Text } from "react-native";

import { useReadout } from "@/lib/broadcast/readouts";
import { formatKbps } from "@/lib/broadcast/units";
import { filmic } from "@/lib/theme/filmic";

import { formatEv } from "./stepper";

/**
 * Filmic Pro's top readout line ("ISO 1594  1/24  5500K  MIN 10  H264 75"):
 * the camera's state in one glance, written straight onto the picture.
 *
 * No background - a bar would crop the top of the shot - so legibility over a
 * bright sky comes from a soft text shadow instead. Units are light and values
 * bold, so the eye lands on the numbers. Tabular figures keep the bitrate from
 * jittering sideways as it ticks.
 *
 * This is the only piece of the screen that subscribes to the bitrate, so the
 * per-second tick re-renders this strip and nothing else.
 */

/** Same head-up cap as chrome.tsx's HUD_TEXT; restated so this file stands alone. */
const HUD_TEXT = 1.3;
const SIZE = filmic.type.body;

type Part = { text: string; bold?: boolean; color?: string };

function Item({ parts }: { parts: Part[] }) {
  return (
    <Text numberOfLines={1} maxFontSizeMultiplier={HUD_TEXT} style={styles.item}>
      {parts.map((part, i) => (
        <Text
          key={i}
          style={[part.bold ? styles.bold : styles.light, part.color ? { color: part.color } : null]}
        >
          {i > 0 ? " " : ""}
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

/** "2500 kbps" -> value "2500", unit "kbps", so the unit can sit light. */
function splitUnit(formatted: string): [string, string] {
  const space = formatted.lastIndexOf(" ");
  return space < 0 ? [formatted, ""] : [formatted.slice(0, space), formatted.slice(space + 1)];
}

export function ReadoutStrip({
  zoom,
  exposure,
  evStep,
  exposureLocked,
  whiteBalance,
  codec,
  resolution,
  fps,
  live,
  onPress,
}: {
  zoom: number;
  exposure: number;
  evStep: number;
  exposureLocked: boolean;
  whiteBalance: string;
  codec: string;
  resolution: string | null;
  fps: number | null;
  live: boolean;
  onPress: () => void;
}) {
  const bitrate = useReadout((r) => r.bitrate);

  const zoomText = `${zoom.toFixed(1)}×`;
  const [evValue, evUnit] = splitUnit(formatEv(exposure * evStep));
  // Off air the encoder's last figure is stale; a dash says "nothing leaving".
  const [rateValue, rateUnit] = live ? splitUnit(formatKbps(bitrate)) : ["—", ""];
  const codecText = codec.toUpperCase();
  const resText = resolution ?? "—";
  const fpsText = fps != null ? String(Math.round(fps)) : "—";

  const evParts: Part[] = [
    { text: evValue, bold: true },
    { text: evUnit },
  ];
  // Amber matches the locked exposure reticle, so the two read as one state.
  if (exposureLocked) evParts.push({ text: "AE·L", bold: true, color: filmic.color.accent });

  const label = [
    `Zoom ${zoomText}`,
    `${formatEv(exposure * evStep)}${exposureLocked ? ", exposure locked" : ""}`,
    `White balance ${whiteBalance}`,
    live ? `Bitrate ${formatKbps(bitrate)}` : "Off air",
    `Codec ${codecText}`,
    `${resText}${fps != null ? ` at ${fpsText} frames per second` : ""}`,
  ].join(", ");

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="active:opacity-60"
      style={styles.strip}
    >
      <Item parts={[{ text: zoomText, bold: true }]} />
      <Item parts={evParts} />
      <Item parts={[{ text: whiteBalance, bold: true }]} />
      <Item parts={rateUnit ? [{ text: rateValue, bold: true }, { text: rateUnit }] : [{ text: rateValue, bold: true }]} />
      <Item parts={[{ text: codecText, bold: true }]} />
      <Item
        parts={[
          { text: resText, bold: true },
          { text: fpsText, bold: true },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: filmic.space.sm,
    paddingVertical: filmic.space.xs,
  },
  item: {
    // Shrinkable so six items share a narrow portrait width instead of overflowing.
    flexShrink: 1,
    color: filmic.color.ink,
    fontSize: SIZE,
    fontVariant: ["tabular-nums"],
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  light: { fontWeight: "300" },
  bold: { fontWeight: "700" },
});
