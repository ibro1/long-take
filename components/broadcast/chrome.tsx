import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { Text } from "@/components/ui/text";
import { bidi, t, textDir } from "@/lib/i18n";

import { ChevronIcon, CloseIcon } from "./icons";
import { Mono } from "./mono";

/**
 * The furniture every control on the viewfinder is built from.
 *
 * One contrast rule, applied everywhere: a control is a solid dark disc or
 * pill, and its icon is the only thing inside it. Nothing relies on the video
 * behind it being dark, because the video is not ours - the same button has to
 * read over a stage light and over a black studio. The only chrome that is not
 * on a disc is a word, and words carry a shadow instead; a translucent scrim
 * over the whole frame was the other option and it costs the operator the shot
 * they are framing.
 *
 * Second rule: state is visible without reading. A control that is on is a
 * different colour from one that is off, its icon changes, and its label names
 * the thing or the state it is in, never the next action - "Torch", "Muted",
 * not "Torch off". A white box reading "Torch off" is the bug this replaces;
 * nobody could say whether it meant the torch was off or that pressing it
 * would turn the torch off.
 *
 * Third: the head-up text stops growing at 1.3x. The phone's font size is
 * honoured everywhere it has room to be, and on the glass it has none - at
 * the largest setting a disc's label ran into the next disc and the clock
 * wrapped onto two lines over the picture. `HUD_TEXT` is that cap.
 */

/** The largest the system font setting may make text on the glass. */
export const HUD_TEXT = 1.3;

/**
 * What an on-state means, which decides its colour.
 *
 * `alert` is red - recording, and a muted microphone, which are the two states
 * that change what the audience gets without changing the picture. `warn` is
 * amber for a hold the operator chose and will want to undo. `plain` is white,
 * for a panel that is merely open and means nothing about the broadcast.
 */
export type Tone = "plain" | "warn" | "alert";

const ON_FILL: Record<Tone, string> = {
  plain: "bg-filmic-ink",
  warn: "bg-filmic-accent",
  alert: "bg-filmic-alert",
};

const ON_GLYPH: Record<Tone, string> = {
  plain: "text-filmic-accentink",
  warn: "text-filmic-accentink",
  alert: "text-filmic-ink",
};

/** Off: a dark disc with a hairline so its edge survives on a white subject. */
const OFF_DISC = "bg-filmic-surface/80 border-hairline border-filmic-line";

const DISC = {
  sm: "h-11 w-11",
  md: "h-14 w-14",
  lg: "h-16 w-16",
} as const;

const GLYPH = {
  sm: "h-5 w-5",
  md: "h-6 w-6",
  lg: "h-7 w-7",
} as const;

/**
 * White text over unknown video. A shadow rather than a pill behind every
 * word: at this size the pill is bigger than the word and the screen turns
 * into a wall of boxes.
 */
const LABEL_SHADOW = { textShadowColor: "rgba(0,0,0,0.9)", textShadowRadius: 4 } as const;

/**
 * One control on the glass: torch, mute, record, or the way into a panel.
 *
 * The label is a separate line under the disc, never inside it. Inside a
 * 44-56px circle a word either overflows the fill or has to be shrunk past
 * reading, and in a landscape column it ran off the edge of the screen
 * entirely.
 */
export function ControlButton({
  icon: Icon,
  label,
  showLabel = true,
  on = false,
  tone = "plain",
  size = "sm",
  disabled = false,
  labelCarriesState = false,
  toggle = false,
  spoken,
  className,
  onPress,
}: {
  icon: LucideIcon;
  /** Names the thing the control governs, in every state it can be in. */
  label: string;
  /**
   * The label already says the state - "Muted" - so a screen reader is not
   * also told "selected", which read "Mic, selected" and left the listener
   * to work out that selected meant silent.
   */
  labelCarriesState?: boolean;
  /**
   * An on/off control rather than an action or a panel: announced as a switch
   * that is on or off, which is what a screen reader user needs to hear about
   * the torch, and not as a button that is "selected".
   */
  toggle?: boolean;
  /**
   * What a screen reader says, when the drawn word alone does not carry the
   * state. The torch's disc reads "Torch" whichever way it is - a visible
   * "Torch off" is ambiguous (is it off, or does this turn it off?) - but a
   * listener has no fill colour to go on and is told "Torch on".
   */
  spoken?: string;
  /** Dropped where a column has no vertical room to spare, as in landscape. */
  showLabel?: boolean;
  on?: boolean;
  tone?: Tone;
  size?: keyof typeof DISC;
  disabled?: boolean;
  className?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={toggle ? "switch" : "button"}
      accessibilityState={
        toggle
          ? { checked: on, disabled }
          : labelCarriesState
            ? { disabled }
            : { selected: on, disabled }
      }
      accessibilityLabel={spoken ?? label}
      disabled={disabled}
      onPress={onPress}
      className={`items-center gap-1 ${className ?? ""}`}
    >
      <View
        className={`items-center justify-center rounded-full ${DISC[size]} ${
          disabled ? "bg-filmic-surface/40 border-hairline border-filmic-line" : on ? ON_FILL[tone] : OFF_DISC
        }`}
      >
        <Icon
          className={`${GLYPH[size]} ${
            disabled ? "text-filmic-inkmuted" : on ? ON_GLYPH[tone] : "text-filmic-ink"
          }`}
        />
      </View>
      {showLabel ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={HUD_TEXT}
          style={LABEL_SHADOW}
          className={`text-[10px] font-medium ${disabled ? "text-filmic-inkmuted" : "text-filmic-ink"}`}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Going on air and coming off it - the one control that is not a disc, because
 * it is not one of a set. It is the widest thing on the screen and the only
 * one that changes colour wholesale, so a thumb finds it without looking and
 * cannot mistake it for the row of small round buttons above.
 */
export function PrimaryButton({
  label,
  icon: Icon,
  mode,
  compact = false,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  /** `blocked` still presses: it goes and gets the destination it is missing. */
  mode: "start" | "stop" | "blocked";
  compact?: boolean;
  onPress: () => void;
}) {
  const fill =
    mode === "stop"
      ? "bg-filmic-ink"
      : mode === "start"
        ? "bg-filmic-alert"
        : "bg-filmic-surface/80 border-hairline border-filmic-line";
  const ink = mode === "stop" ? "text-filmic-accentink" : "text-filmic-ink";

  /**
   * The button's width is fixed by what sits beside it, so a long label is
   * sized down rather than clipped. "END BROADCAST" truncated to "END BROADC…"
   * on the one control that stops a live stream is not a trade worth making.
   */
  const tight = compact || label.length > 12;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`flex-row items-center justify-center gap-1.5 rounded-xl ${
        compact ? "h-14 px-2" : "h-16 px-4"
      } ${fill}`}
    >
      <Icon className={`h-5 w-5 ${ink}`} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={HUD_TEXT}
        className={`shrink font-bold uppercase tracking-wide ${tight ? "text-sm" : "text-base"} ${ink}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A readout on the glass: dark, small, and never pressable unless told to be. */
export function Chip({
  children,
  tone = "plain",
  className,
}: {
  children: ReactNode;
  tone?: "plain" | "warn";
  className?: string;
}) {
  const fill = tone === "warn" ? "bg-filmic-accent" : "bg-filmic-surface/80 border-hairline border-filmic-line";
  return (
    <View className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${fill} ${className ?? ""}`}>
      {children}
    </View>
  );
}

/**
 * Where this broadcast is going. Sits directly above the button that sends it,
 * because "go live" without knowing where is the mistake worth preventing, and
 * the name is the only thing on the screen the operator cannot deduce from the
 * picture.
 */
export function DestinationChip({
  name,
  compact = false,
  onPress,
}: {
  name: string | null;
  compact?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name ? t("destination.a11y", { name }) : t("destination.choose")}
      onPress={onPress}
      // Drawn small so it does not compete with the shutter; touched at full size.
      hitSlop={10}
      className={`flex-row items-center gap-1.5 rounded-full border-hairline px-3 py-1.5 ${
        name ? "border-filmic-line bg-filmic-surface/80" : "border-filmic-accent/60 bg-filmic-surface/80"
      } ${compact ? "" : "max-w-full self-center"}`}
    >
      {/* Two lines rather than one, and directed by the name's own first
          letter: an Arabic or Hausa class name is longer, and drawn in a
          fallback font wider than Inter, so one line cut it to a first word
          that several classes share. */}
      <Text
        numberOfLines={2}
        maxFontSizeMultiplier={HUD_TEXT}
        style={name ? bidi(name) : textDir()}
        className={`shrink text-xs ${name ? "text-filmic-ink" : "font-semibold text-filmic-accent"}`}
      >
        {name ?? t("destination.none")}
      </Text>
      {/* Never the thing that gives way. The name shrinks; the mark saying this
          opens something has to survive a long name. */}
      <ChevronIcon className="h-3.5 w-3.5 shrink-0 text-filmic-inkmuted" />
    </Pressable>
  );
}

/**
 * A panel scrolls rather than growing. In landscape it is a sheet down one side
 * of the picture and can afford most of the height; in portrait it sits over
 * the bottom of the frame and must leave the shot visible above it, which is
 * the half the operator is actually framing.
 */
/** A pinned footer's button and padding, taken off the scroll in landscape. */
const FOOTER_ROOM = 76;

export function Panel({
  title,
  onClose,
  children,
  footer,
  tall = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * More of the portrait screen, for a panel the operator is there to read
   * rather than glance at - the check before going live, which at 46% hid
   * "Going out" and "Copy on this phone" below the fold on a 360x780 phone,
   * so the two things it exists to show needed a scroll nobody made. The
   * screen hosting it is expected to clear room under it.
   */
  tall?: boolean;
  /**
   * Kept below the scrolling part, always in view. For the one action a panel
   * exists to reach - a panel capped at half the screen had pushed the check's
   * own Go live button below the fold, so the thing it was there to confirm
   * needed a scroll to find.
   */
  footer?: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const wide = width > height;

  return (
    <View className="rounded-xl bg-filmic-surface">
      <View className="flex-row items-center justify-between gap-2 pl-4 pr-2 pt-3 pb-1">
        <Text
          style={bidi(title)}
          className="flex-1 text-xs font-semibold uppercase tracking-wide text-filmic-inkmuted"
        >
          {title}
        </Text>
        {/* A second way out. Pressing the panel's own button again also closes
            it, but that button is off at the edge of the screen and an operator
            who opened a panel by accident should not have to find it again. */}
        {/* 40 drawn, 48 touched: the header stays one line high, the target
            does not shrink with it. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={onClose}
          hitSlop={4}
          className="h-10 w-10 items-center justify-center rounded-full bg-filmic-elevated"
        >
          <CloseIcon className="h-4 w-4 text-filmic-ink" />
        </Pressable>
      </View>
      <ScrollView
        /**
         * Less room for the scroll when a footer is pinned below it. In
         * landscape the phone is barely 360 tall, and 72% of it plus the
         * header plus a pinned button came to more than the screen - the panel
         * is centred, so the title and the button were both clipped. Portrait
         * has the height to spare at 46%.
         */
        style={{
          maxHeight: height * (wide ? 0.72 : tall ? 0.56 : 0.46) - (footer && wide ? FOOTER_ROOM : 0),
        }}
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer ? <View className="px-4 pb-4 pt-1">{footer}</View> : null}
    </View>
  );
}

/**
 * One choice in a panel. The hint is drawn whenever there is one: it used to
 * appear only on the selected row, so a row that is an action rather than a
 * choice - Reset zoom, which is never "selected" - carried a hint nobody ever
 * saw and reset the zoom without a word.
 */
export function Row({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-11 flex-row items-center justify-between gap-2 rounded-xl px-3 py-2 ${
        selected ? "bg-filmic-accent" : "bg-filmic-elevated"
      }`}
    >
      {/* Directed by its own words: rows carry names somebody typed - a
          preset, a microphone - as well as the app's own labels. */}
      <Text
        style={bidi(label)}
        className={`flex-1 text-sm ${selected ? "font-semibold text-filmic-accentink" : "text-filmic-ink"}`}
      >
        {label}
      </Text>
      <Text className={`text-xs font-semibold ${selected ? "text-filmic-accentink" : "text-filmic-inkmuted"}`}>
        {hint ?? (selected ? "In use" : "")}
      </Text>
    </Pressable>
  );
}

/** On/off for one camera feature. Reads as a state, not as a question. */
export function Toggle({
  label,
  hint,
  on,
  onPress,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      className="flex-row items-center justify-between rounded-xl bg-filmic-elevated px-3 py-2.5"
    >
      <View className="flex-1 pr-3">
        <Text style={bidi(label)} className="text-sm text-filmic-ink">
          {label}
        </Text>
        {hint ? (
          <Text style={bidi(hint)} className="text-xs text-filmic-inkmuted">
            {hint}
          </Text>
        ) : null}
      </View>
      <View
        className={`h-7 w-12 justify-center rounded-full px-0.5 ${on ? "bg-filmic-accent" : "bg-filmic-line"}`}
      >
        <View className={`h-6 w-6 rounded-full ${on ? "ml-auto bg-filmic-accentink" : "bg-filmic-inkmuted"}`} />
      </View>
    </Pressable>
  );
}

/** A label on the left, the number on the right, in figures that do not jump. */
export function Readout({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="text-sm text-filmic-inkmuted">{label}</Text>
      <Mono className="text-sm">{value}</Mono>
    </View>
  );
}

/**
 * Something has gone wrong with the connection and the operator has to know
 * without hunting. Full width at the top of the frame, over the picture,
 * because a fault the operator misses is the broadcast lost.
 */
export function Banner({
  tone,
  text,
  action,
  secondary,
  onDismiss,
}: {
  tone: "bad" | "warn";
  text: string;
  action?: { label: string; onPress: () => void };
  /**
   * A second, quieter way out - "Open log" beside "Go live again". Drawn as an
   * outline so the two are never mistaken for each other under pressure.
   */
  secondary?: { label: string; onPress: () => void };
  /**
   * Offered where the condition can outlast the operator's interest in being
   * told about it.
   *
   * A phone that reports itself warm for a whole broadcast left this banner
   * over the picture for an hour, saying the same thing it had said in the
   * first second. A warning nobody can put away stops being a warning and
   * becomes part of the furniture - and it was covering the shot.
   */
  onDismiss?: () => void;
}) {
  return (
    <View
      className={`flex-row items-start gap-2 rounded-xl p-3 ${
        tone === "bad" ? "bg-filmic-alert" : "bg-filmic-accent"
      }`}
    >
      <View className="flex-1 gap-2">
        <Text
          style={textDir()}
          className={`text-sm ${tone === "bad" ? "text-filmic-ink" : "text-filmic-accentink"}`}
        >
          {text}
        </Text>
        {action || secondary ? (
          <View className="flex-row flex-wrap gap-2">
            {action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.label}
                onPress={action.onPress}
                hitSlop={6}
                className="min-h-9 justify-center self-start rounded-full bg-filmic-ink px-3 py-1.5"
              >
                <Text className="text-xs font-semibold text-filmic-accentink">{action.label}</Text>
              </Pressable>
            ) : null}
            {secondary ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={secondary.label}
                onPress={secondary.onPress}
                hitSlop={6}
                className="min-h-9 justify-center self-start rounded-full border-hairline border-filmic-ink/80 px-3 py-1.5"
              >
                <Text className="text-xs font-semibold text-filmic-ink">{secondary.label}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.dismiss")}
          onPress={onDismiss}
          hitSlop={10}
          className="h-8 w-8 items-center justify-center rounded-full active:bg-filmic-base/20"
        >
          <Text className="text-base font-semibold text-filmic-ink">×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The shutter: the one control this screen exists for.
 *
 * A circle rather than a rectangle, because that is what a camera's record
 * control is everywhere else and a thumb finds it without the eye leaving the
 * shot. The ring around it is fixed and the fill inside it changes, so going
 * live and coming off air is one shape changing state rather than two different
 * buttons in the same place - the same language a phone camera uses between
 * record and stop.
 *
 * The label is carried by `accessibilityLabel` rather than drawn inside, except
 * off air, where two words are what tells a first-time operator which control
 * starts the broadcast. Those two words are the label itself, not a second
 * wording: the circle said SET UP while a screen reader said "Choose
 * destination", and an operator being talked through it by someone with
 * TalkBack on was told to press a button that, to them, did not exist.
 */
export function ShutterButton({
  label,
  mode,
  compact = false,
  onPress,
}: {
  label: string;
  mode: "start" | "stop" | "blocked";
  compact?: boolean;
  onPress: () => void;
}) {
  const size = compact ? "h-16 w-16" : "h-20 w-20";
  const inner = compact ? "h-[52px] w-[52px]" : "h-[66px] w-[66px]";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`${size} items-center justify-center rounded-full border-[3px] border-filmic-ink active:opacity-80`}
    >
      {mode === "stop" ? (
        // A square inside the ring, which is stop everywhere a camera is.
        <View className={`${compact ? "h-6 w-6" : "h-7 w-7"} rounded-[4px] bg-filmic-alert`} />
      ) : (
        <View
          className={`${inner} items-center justify-center rounded-full ${
            mode === "blocked" ? "bg-filmic-surface/80" : "bg-filmic-alert"
          }`}
        >
          <Text
            className={`text-center font-bold text-filmic-ink ${compact ? "text-[10px]" : "text-xs"}`}
            numberOfLines={2}
            maxFontSizeMultiplier={HUD_TEXT}
          >
            {/* One word to a line: the circle is too narrow for two side by side. */}
            {label.toUpperCase().replace(" ", "\n")}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
