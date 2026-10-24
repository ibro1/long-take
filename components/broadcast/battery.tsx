import { View } from "react-native";

/**
 * The charge, as a bar rather than only a number.
 *
 * The percentage is exact and the bar is not, which is the point: a number has
 * to be read, and this sits in the corner of a viewfinder that someone is
 * looking past. A shape that is mostly empty says "find a charger" before the
 * digits have been focused on, and it says it in the same glance that checks
 * whether the picture is still framed.
 *
 * Drawn out of views rather than taken from the icon set, because a battery
 * glyph is a fixed picture of a full battery - the level is the whole content
 * here, so it has to be the thing that moves.
 */

/** Matches the thresholds the chip around this uses to pick its tone. */
const LOW = 0.4;
const CRITICAL = 0.15;

export function BatteryBar({ level, charging }: { level: number; charging: boolean }) {
  const clamped = Math.max(0, Math.min(1, level));

  // Charging is not a warning however little is in it - the situation is
  // already being dealt with, so it reads as ordinary.
  const fill = charging
    ? "bg-filmic-good"
    : clamped <= CRITICAL
      ? "bg-filmic-alert"
      : clamped <= LOW
        ? "bg-filmic-accent"
        : "bg-filmic-ink";

  return (
    <View className="flex-row items-center" accessibilityElementsHidden importantForAccessibility="no">
      <View className="h-3 w-6 justify-center rounded-[3px] border border-filmic-inkmuted p-[1.5px]">
        {/*
          A sliver is kept at the very bottom so the bar never reads as an empty
          outline, which looks like a missing reading rather than a flat battery.
        */}
        <View
          className={`h-full rounded-[1px] ${fill}`}
          style={{ width: `${Math.max(6, clamped * 100)}%` }}
        />
      </View>
      {/* The terminal, which is what makes the rectangle a battery. */}
      <View className="h-1.5 w-[2px] rounded-r-[1px] bg-filmic-inkmuted" />
    </View>
  );
}
