import { Stack, useRouter } from "expo-router";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react-native";
import { cssInterop } from "nativewind";
import { Children, type ReactElement, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";

/**
 * The furniture every settings screen is built from.
 *
 * Settings are read at a glance, usually in the ten minutes before a
 * broadcast, so every screen here is the same shape all the way down: groups
 * of rows in a card, a label and one muted line of detail on the left, the
 * control or a chevron on the right. Anything that takes a paragraph is put
 * under the card as a footer where it can be skipped, rather than inside the
 * row where it pushes the next setting off the screen - the old single-list
 * screen had six paragraphs above the recording switch and the switch was
 * never on the first screenful.
 *
 * Every pressable row is at least 56px tall whatever it holds. This list is
 * scrolled with a thumb while the other hand holds the phone, and a row too
 * short to hit is a setting changed by accident and noticed at the worst
 * moment.
 */

/**
 * Same treatment `lib/icons/iconWithClassName` applies, so `h-5 w-5
 * text-muted-foreground` on a glyph means here what it means everywhere else.
 */
function withClassName(...icons: LucideIcon[]) {
  for (const icon of icons) {
    cssInterop(icon, {
      className: {
        target: "style",
        nativeStyleToProp: { color: true, opacity: true, width: true, height: true },
      },
    });
  }
}

withClassName(ArrowUpRight, ChevronLeft, ChevronRight);

/**
 * These screens are pushed onto the root stack, which draws a header of its
 * own by default. One header per screen, and it is the one below, so that a
 * settings screen looks like the log and the viewfinder rather than like a
 * different app.
 */
const NO_NATIVE_HEADER = { headerShown: false } as const;

/**
 * A whole settings screen: its header, its scroll, and the insets.
 *
 * `bottom` is in the edge list because there is no tab bar under these screens
 * any more - without it the last row sits under the Android navigation bar.
 */
export function Page({
  title,
  intro,
  action,
  children,
}: {
  title: string;
  /** One line under the header saying what the whole screen does. */
  intro?: string;
  /** Anything that belongs beside the title, as Clear does on the log. */
  action?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  /**
   * Always drawn, and never a dead end.
   *
   * The tab bar used to be the way out of this screen and it is gone, so this
   * arrow is the only one. Drawing it conditionally on `canGoBack` was a bet on
   * the navigator reporting history for a jump between tabs - and losing that
   * bet strands the operator on a settings screen with no route back to the
   * viewfinder and nothing on screen to suggest one. So when there is no
   * history to pop, it goes to the viewfinder directly, which is the only place
   * this screen is ever reached from.
   */
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)");
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <Stack.Screen options={NO_NATIVE_HEADER} />
      <View className="flex-row items-center gap-2 border-b border-hairline border-border px-3 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={goBack}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
        >
          <ChevronLeft className="h-6 w-6 text-foreground" />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold">{title}</Text>
        {action}
      </View>
      <ScrollView className="flex-1" contentContainerClassName="gap-5 p-4 pb-16">
        {intro ? <Text className="px-1 text-sm text-muted-foreground">{intro}</Text> : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One group of rows.
 *
 * The hairline between rows is drawn here rather than by the rows themselves
 * because only the group knows which row is first, and a card that opens with
 * a line across it reads as a row that is missing.
 */
export function Group({
  title,
  note,
  footer,
  children,
}: {
  title?: string;
  /** A short line above the card, for something true of the whole group. */
  note?: string;
  /** The explanation, under the card, where it costs nobody a scroll. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const rows = Children.toArray(children) as ReactElement[];

  return (
    <View className="gap-2">
      {title || note ? (
        <View className="gap-1 px-1">
          {title ? (
            <Text className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {title}
            </Text>
          ) : null}
          {note ? <Text className="text-xs text-muted-foreground">{note}</Text> : null}
        </View>
      ) : null}
      <View className="overflow-hidden rounded-xl border border-hairline border-border bg-card">
        {rows.map((row, index) => (
          <View key={row.key} className={index === 0 ? undefined : "border-t border-hairline border-border"}>
            {row}
          </View>
        ))}
      </View>
      {footer ? (
        <View className="gap-1.5 px-1">
          {typeof footer === "string" ? (
            <Text className="text-xs text-muted-foreground">{footer}</Text>
          ) : (
            footer
          )}
        </View>
      ) : null}
    </View>
  );
}

/** A row that goes somewhere: another screen, or a page on the dashboard. */
export function NavRow({
  label,
  detail,
  value,
  external = false,
  onPress,
}: {
  label: string;
  /** What this screen is for, or what is currently set behind it. */
  detail?: string;
  /** A short current value, kept on the right where it can be scanned. */
  value?: string;
  /** Leaves the app for a browser, which the arrow says before it happens. */
  external?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      // Spoken whole, value included: "Video, H.264" says what the row is set
      // to without opening it, which is the row's whole point for the eye too.
      accessibilityRole={external ? "link" : "button"}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={detail}
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-3 px-4 py-2.5 active:opacity-60"
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium">{label}</Text>
        {detail ? (
          <Text numberOfLines={2} className="text-xs text-muted-foreground">
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text numberOfLines={1} className="max-w-[40%] text-sm text-muted-foreground">
          {value}
        </Text>
      ) : null}
      {external ? (
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      )}
    </Pressable>
  );
}

/** On or off, and nothing in between. The whole row is the target. */
export function SwitchRow({
  label,
  detail,
  on,
  onPress,
}: {
  label: string;
  detail?: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityState={{ checked: on }}
      onPress={onPress}
      className="min-h-[56px] flex-row items-center gap-4 px-4 py-2.5 active:opacity-60"
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-sm font-medium">{label}</Text>
        {detail ? <Text className="text-xs text-muted-foreground">{detail}</Text> : null}
      </View>
      <View
        className={`h-7 w-12 justify-center rounded-full px-0.5 ${on ? "bg-filmic-accent" : "bg-muted"}`}
      >
        <View className={`h-6 w-6 rounded-full bg-background ${on ? "self-end" : "self-start"}`} />
      </View>
    </Pressable>
  );
}

/**
 * One of a handful of values, all of them visible at once.
 *
 * Pills rather than a picker: there are never more than five of these and an
 * operator comparing 64k with 128k should not have to open anything to see
 * that both exist. Each pill is its own 44px target.
 */
export function ChoiceRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (value: T) => void;
}) {
  return (
    <View className="gap-2 px-4 py-2.5">
      <Text className="text-sm font-medium">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="button"
              // The row's question with the answer, since a pill alone says
              // "128k" and not what it is 128k of.
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              className={`min-h-[44px] justify-center rounded-full border px-4 ${
                selected ? "border-filmic-accent bg-filmic-accent" : "border-hairline border-border"
              }`}
            >
              <Text
                className={`text-sm ${selected ? "font-semibold text-filmic-accentink" : "text-foreground"}`}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A fact about the app or the phone, not something to be changed. */
export function ReadoutRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-[44px] flex-row items-center justify-between gap-3 px-4 py-2.5">
      <Text className="text-sm text-muted-foreground">{label}</Text>
      <Text className="shrink font-mono text-sm tracking-tight" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Anything a row shape does not fit: a file with a delete, a warning. */
export function Block({ children }: { children: ReactNode }) {
  return <View className="gap-1.5 px-4 py-2.5">{children}</View>;
}
