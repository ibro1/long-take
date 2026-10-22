import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";

import { Mono } from "./mono";

/**
 * Exposure compensation, as minus / value / plus.
 *
 * A stepper rather than a slider, deliberately. The camera's range is a
 * handful of its own discrete steps, and a stepper lands on exactly one of
 * them - a slider has to be rounded to the same steps anyway, so it offers
 * precision it cannot keep. It is also the control you can work one-handed
 * without your thumb covering the picture you are judging the exposure of,
 * which is the entire task. The cost is that walking the full range takes
 * several presses, so the step is scaled to cross it in about a dozen.
 *
 * The camera counts in its own steps and the operator thinks in EV, so the
 * steps go to the camera and the EV goes on the screen. Holding the value
 * returns to 0 EV: it is the gesture Larix taught everyone, and it is the one
 * you want when the shot has changed and the correction no longer applies.
 *
 * The pill beside it locks the metering rather than switching it off. The two
 * are not alternatives and they are not exclusive: the lock stops the camera
 * re-deciding when someone crosses the shot, and the stepper corrects whatever
 * it decided, locked or not.
 */

/** How many presses it should take to go from one end of the range to the other. */
const PRESSES_ACROSS = 12;

export function Stepper({
  label,
  value,
  min,
  max,
  evStep,
  locked,
  canLock,
  onChange,
  onLock,
}: {
  label: string;
  /** In the camera's own steps, which is what goes back out of onChange. */
  value: number;
  min: number;
  max: number;
  evStep: number;
  /** Whether the metering is held where it is. */
  locked: boolean;
  /** Whether this camera offers the lock; the pill is not drawn without it. */
  canLock: boolean;
  onChange: (next: number) => void;
  onLock: (on: boolean) => void;
}) {
  const step = Math.max(1, Math.round((max - min) / PRESSES_ACROSS));
  const nudge = (direction: number) =>
    onChange(Math.min(max, Math.max(min, value + direction * step)));

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-white">{label}</Text>
        {canLock ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: locked }}
            accessibilityLabel="Lock exposure"
            onPress={() => onLock(!locked)}
            className={`min-h-[32px] justify-center rounded-full px-3 py-1 ${
              locked ? "bg-white" : "bg-white/10"
            }`}
          >
            <Text className={`text-xs font-semibold ${locked ? "text-black" : "text-white"}`}>
              {locked ? "Locked" : "Lock"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: lower`}
          accessibilityState={{ disabled: value <= min }}
          onPress={() => nudge(-1)}
          disabled={value <= min}
          className={`h-11 flex-1 items-center justify-center rounded-xl ${
            value <= min ? "bg-white/5" : "bg-white/10"
          }`}
        >
          <Text className={`text-lg ${value <= min ? "text-white/30" : "text-white"}`}>-</Text>
        </Pressable>

        {/*
          The value is the reset: a long press returns it to 0 EV. Said as a
          hint, because a screen reader user has no way to discover a long
          press on what is announced as a number.
        */}
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={`${label} ${formatEv(value * evStep)}`}
          accessibilityHint="Double tap and hold to reset to 0 EV."
          accessibilityValue={{ text: formatEv(value * evStep) }}
          accessibilityActions={[
            { name: "increment" },
            { name: "decrement" },
            { name: "longpress", label: "Reset to 0 EV" },
          ]}
          onAccessibilityAction={(event) => {
            const action = event.nativeEvent.actionName;
            if (action === "increment") nudge(1);
            else if (action === "decrement") nudge(-1);
            else if (action === "longpress") onChange(0);
          }}
          onLongPress={() => onChange(0)}
          className="w-24 items-center"
        >
          {/* Signed, because the sign is the whole meaning: 0 EV is what the
              camera chose and everything else is a correction to it. */}
          {/* Always the compensation, never the word "auto": it applies
              whether the metering is locked or not, so hiding it behind a
              state was hiding a number the operator had set. */}
          <Mono className="text-base font-semibold">{formatEv(value * evStep)}</Mono>
          <Text className="text-[10px] text-white/70">
            {value === 0 ? "hold to reset" : `hold to reset · ${formatEv(min * evStep)} to ${formatEv(max * evStep)}`}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: higher`}
          accessibilityState={{ disabled: value >= max }}
          onPress={() => nudge(1)}
          disabled={value >= max}
          className={`h-11 flex-1 items-center justify-center rounded-xl ${
            value >= max ? "bg-white/5" : "bg-white/10"
          }`}
        >
          <Text className={`text-lg ${value >= max ? "text-white/30" : "text-white"}`}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** `+1.0 EV`, `-0.7 EV`, `0.0 EV`. One decimal: thirds of a stop read as 0.3. */
export function formatEv(ev: number): string {
  const rounded = Math.abs(ev) < 0.05 ? 0 : ev;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} EV`;
}
