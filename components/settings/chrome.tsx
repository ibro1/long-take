import { useIsFocused } from "@react-navigation/native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react-native";
import { vars } from "nativewind";
import { Children, createContext, type ReactElement, type ReactNode, useContext } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";

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
 * Filmic's settings are a light panel, not the dark chrome of the viewfinder:
 * they are read in a lit room before the broadcast, and the switch from
 * picture to paper says "you are configuring now, not shooting".
 *
 * The app is pinned to dark mode, so the semantic classes (`bg-card`,
 * `text-foreground`) resolve to the dark palette. The primitives below use
 * these literals instead, and `Page` re-points the semantic variables for
 * everything inside it - so a footer or a Block a page draws itself with
 * `text-muted-foreground` is dark grey on paper rather than the dark theme's
 * pale grey, which would all but vanish on it.
 */
export const paper = {
  page: "#EEEEEE",
  card: "#FFFFFF",
  ink: "#1C1C1E",
  inkMuted: "#6B6B70",
  line: "rgba(0,0,0,0.12)",
  /** The off track of a switch and the outline of an unselected pill. */
  track: "#D1D1D6",
  accent: filmic.color.accent,
  accentInk: filmic.color.accentInk,
} as const;

/** Space-separated HSL, the form global.css declares its variables in. */
const LIGHT_VARS = vars({
  "--background": "0 0% 93%",
  "--foreground": "240 3% 11%",
  "--card": "0 0% 100%",
  "--card-foreground": "240 3% 11%",
  "--popover": "0 0% 100%",
  "--popover-foreground": "240 3% 11%",
  "--primary": "240 3% 11%",
  "--primary-foreground": "0 0% 100%",
  "--secondary": "240 5% 90%",
  "--secondary-foreground": "240 3% 11%",
  "--muted": "240 5% 83%",
  "--muted-foreground": "240 2% 43%",
  "--accent": "240 5% 90%",
  "--accent-foreground": "240 3% 11%",
  "--destructive": "4 80% 46%",
  "--destructive-foreground": "0 0% 100%",
  "--border": "0 0% 88%",
  "--input": "0 0% 88%",
  "--ring": "40 90% 58%",
});

/** 15pt labels, as Filmic sets them; detail one step down. */
const LABEL = { color: paper.ink, fontSize: 15, lineHeight: 20 } as const;
const DETAIL = { color: paper.inkMuted, fontSize: 13, lineHeight: 17 } as const;
const HAIRLINE = { borderColor: paper.line } as const;

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
/**
 * Set when a settings page is drawn inside the viewfinder's settings panel
 * rather than as a screen of its own - Filmic opens every inner page in the
 * same centred panel as the grid, over the picture, never full screen.
 */
export type SettingsPanelNav = {
  /** Open another settings page in the panel, or leave for a real screen. */
  go: (route: string) => void;
  /** One page back; from the first page, back to the grid. */
  back: () => void;
  /** Close the panel and return to the viewfinder. */
  close: () => void;
};
export const SettingsPanelContext = createContext<SettingsPanelNav | null>(null);

/**
 * Navigation for settings pages that works in both places: inside the panel
 * it stays in the panel; as a screen it is the router.
 */
export function useSettingsNav(): SettingsPanelNav {
  const panel = useContext(SettingsPanelContext);
  const router = useRouter();
  if (panel) return panel;
  return {
    // Typed routes are a union of literals; these pages pass known paths.
    go: (route) => router.push(route as never),
    back: () => (router.canGoBack() ? router.back() : router.replace("/(tabs)")),
    close: () => router.navigate("/(tabs)"),
  };
}

/**
 * A page's frame inside the settings panel: a slim header with the way back
 * and the title, over the body. Page uses it with its own scroller; a screen
 * that has its own scroller (Destinations) uses it directly.
 */
export function PanelFrame({
  title,
  action,
  onBack,
  children,
}: {
  title: string;
  action?: ReactNode;
  /** Where back goes when it is not the previous panel page - a form's cancel. */
  onBack?: () => void;
  children: ReactNode;
}) {
  const panel = useContext(SettingsPanelContext);
  return (
    <View className="flex-1" style={[LIGHT_VARS, { backgroundColor: paper.page }]}>
      <View
        className="flex-row items-center gap-1 border-b border-hairline px-2 py-1"
        style={HAIRLINE}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack ?? panel?.back}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
        >
          <ChevronLeft size={22} color={paper.ink} />
        </Pressable>
        <Text className="flex-1 font-semibold" style={{ color: paper.ink, fontSize: 16 }}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}

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

  // Inside the settings panel: the same page, framed by the panel - no
  // screen header, no status bar, no safe area; back steps within the panel.
  const panel = useContext(SettingsPanelContext);
  if (panel) {
    return (
      <PanelFrame title={title} action={action}>
        <ScrollView className="flex-1" contentContainerClassName="gap-4 p-3 pb-6">
          {intro ? (
            <Text className="px-1" style={DETAIL}>
              {intro}
            </Text>
          ) : null}
          {children}
        </ScrollView>
      </PanelFrame>
    );
  }

  return (
    <View className="flex-1" style={LIGHT_VARS}>
      <SafeAreaView
        className="flex-1"
        style={{ backgroundColor: paper.page }}
        edges={["top", "bottom"]}
      >
        <Stack.Screen options={NO_NATIVE_HEADER} />
        <PaperStatusBar />
        <View
          className="flex-row items-center gap-2 border-b border-hairline px-3 py-2"
          style={HAIRLINE}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
            hitSlop={8}
            className="h-11 w-11 items-center justify-center rounded-full active:opacity-60"
          >
            <ChevronLeft size={24} color={paper.ink} />
          </Pressable>
          <Text className="flex-1 font-semibold" style={{ color: paper.ink, fontSize: 17 }}>
            {title}
          </Text>
          {action}
        </View>
        <ScrollView className="flex-1" contentContainerClassName="gap-5 p-4 pb-16">
          {intro ? (
            <Text className="px-1" style={DETAIL}>
              {intro}
            </Text>
          ) : null}
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/**
 * Dark status-bar glyphs over the paper, while this screen is the one on top.
 *
 * The root layout asks for light glyphs because the rest of the app is dark.
 * Settings is a tab that stays mounted behind the viewfinder, so mounting this
 * unconditionally would leave dark glyphs over the Destinations screen after a
 * visit here; rendering it only while focused pops it off the status-bar stack
 * the moment the operator leaves.
 */
export function PaperStatusBar() {
  const focused = useIsFocused();
  return focused ? <StatusBar style="dark" /> : null;
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
            <Text
              className="text-[11px] font-semibold uppercase tracking-widest"
              style={{ color: paper.inkMuted }}
            >
              {title}
            </Text>
          ) : null}
          {note ? <Text style={DETAIL}>{note}</Text> : null}
        </View>
      ) : null}
      <View
        className="overflow-hidden rounded-xl border border-hairline"
        style={{ ...HAIRLINE, backgroundColor: paper.card }}
      >
        {rows.map((row, index) => (
          <View
            key={row.key}
            className={index === 0 ? undefined : "border-t border-hairline"}
            style={index === 0 ? undefined : HAIRLINE}
          >
            {row}
          </View>
        ))}
      </View>
      {footer ? (
        <View className="gap-1.5 px-1">
          {typeof footer === "string" ? (
            <Text style={DETAIL}>{footer}</Text>
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
        <Text className="font-medium" style={LABEL}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={DETAIL}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text numberOfLines={1} className="max-w-[40%]" style={{ ...LABEL, color: paper.inkMuted }}>
          {value}
        </Text>
      ) : null}
      {external ? (
        <ArrowUpRight size={16} color={paper.inkMuted} />
      ) : (
        <ChevronRight size={20} color={paper.inkMuted} />
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
        <Text className="font-medium" style={LABEL}>
          {label}
        </Text>
        {detail ? <Text style={DETAIL}>{detail}</Text> : null}
      </View>
      <View
        className="h-7 w-12 justify-center rounded-full px-0.5"
        style={{ backgroundColor: on ? paper.accent : paper.track }}
      >
        <View
          className={`h-6 w-6 rounded-full ${on ? "self-end" : "self-start"}`}
          style={{ backgroundColor: paper.card }}
        />
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
      <Text className="font-medium" style={LABEL}>
        {label}
      </Text>
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
              className="min-h-[44px] justify-center rounded-full border px-4 active:opacity-60"
              style={
                selected
                  ? { borderColor: paper.accent, backgroundColor: paper.accent }
                  : { borderColor: paper.track, backgroundColor: paper.card }
              }
            >
              <Text
                className={selected ? "font-semibold" : undefined}
                style={{ ...LABEL, color: selected ? paper.accentInk : paper.ink }}
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
      <Text style={{ ...LABEL, color: paper.inkMuted }}>{label}</Text>
      <Text
        className="shrink font-mono tracking-tight"
        style={{ ...LABEL, color: paper.ink }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** Anything a row shape does not fit: a file with a delete, a warning. */
export function Block({ children }: { children: ReactNode }) {
  return <View className="gap-1.5 px-4 py-2.5">{children}</View>;
}
