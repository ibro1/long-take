import {
  Cpu,
  Hand,
  Info,
  Layers,
  type LucideIcon,
  Mic,
  RadioTower,
  SlidersHorizontal,
  Smartphone,
  Video,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import ConnectionsScreen from "@/app/(tabs)/connections";
import AboutPage from "@/app/settings/about";
import AudioPage from "@/app/settings/audio";
import DevicePage from "@/app/settings/device";
import InformationPage from "@/app/settings/information";
import InterfacePage from "@/app/settings/interface";
import NetworkPage from "@/app/settings/network";
import PresetsPage from "@/app/settings/presets";
import QuickAccessPage from "@/app/settings/quick-access";
import RecordingsPage from "@/app/settings/recordings";
import StreamingPage from "@/app/settings/streaming";
import VideoPage from "@/app/settings/video";
import { paper, SettingsPanelContext, type SettingsPanelNav } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";

/**
 * The settings pages that open inside the panel. Anything not here - the
 * Destinations editor, the Log - is a real screen: the panel closes and the
 * router takes over.
 */
const PANEL_PAGES: Record<string, ComponentType> = {
  "/(tabs)/connections": ConnectionsScreen,
  "/settings/video": VideoPage,
  "/settings/audio": AudioPage,
  "/settings/device": DevicePage,
  "/settings/presets": PresetsPage,
  "/settings/streaming": StreamingPage,
  "/settings/interface": InterfacePage,
  "/settings/information": InformationPage,
  "/settings/network": NetworkPage,
  "/settings/about": AboutPage,
  "/settings/quick-access": QuickAccessPage,
  "/settings/recordings": RecordingsPage,
};

/**
 * Settings as Filmic lays them out: nine words on a light panel, three by
 * three, each under a line icon.
 *
 * A list asks the operator to read; a grid of nine asks them to recognise, and
 * the second is what a hand does in the minute before going live. The grid is
 * drawn twice - over the viewfinder as an overlay, and full screen as the
 * Settings tab - so the tiles, their order and where they go are decided here
 * once.
 *
 * Plain English, like the settings pages behind it: those are not translated
 * yet, and a translated door into an English room is a promise broken one tap
 * later.
 */

export type SettingsTile =
  | "video"
  | "audio"
  | "hardware"
  | "device"
  | "presets"
  | "stabilization"
  | "streaming"
  | "interface"
  | "information";

export const SETTINGS_TILES: { id: SettingsTile; label: string; icon: LucideIcon }[] = [
  { id: "video", label: "Video", icon: Video },
  { id: "audio", label: "Audio", icon: Mic },
  { id: "hardware", label: "Hardware", icon: Cpu },
  { id: "device", label: "Device", icon: Smartphone },
  { id: "presets", label: "Presets", icon: Layers },
  { id: "stabilization", label: "Stabilization", icon: Hand },
  { id: "streaming", label: "Streaming", icon: RadioTower },
  { id: "interface", label: "Interface", icon: SlidersHorizontal },
  { id: "information", label: "Information", icon: Info },
];

const ROUTES: Record<SettingsTile, string | null> = {
  video: "/settings/video",
  audio: "/settings/audio",
  device: "/settings/device",
  presets: "/settings/presets",
  streaming: "/settings/streaming",
  interface: "/settings/interface",
  information: "/settings/information",
  // Lens, focus, exposure and stabilisation are set where the picture is, on
  // the viewfinder's Camera panel. The overlay can open that directly; the
  // full-screen grid sends these to /settings/hardware, which says so.
  hardware: null,
  stabilization: null,
};

/**
 * Where a tile goes, or null for the two that live on the viewfinder's Camera
 * panel rather than on a settings page.
 */
export function routeForTile(tile: SettingsTile): string | null {
  return ROUTES[tile];
}

/**
 * The nine tiles on their panel, with the hairlines between them.
 *
 * The lines are each tile's right and bottom border, dropped on the last
 * column and the last row, so the grid has lines inside and none round the
 * edge - the panel's own rounded edge is the frame.
 */
export function SettingsTiles({
  onTile,
  tileHeight,
}: {
  onTile: (tile: SettingsTile) => void;
  /** Square-ish: the overlay passes its column width, the full screen less. */
  tileHeight: number;
}) {
  return (
    <View
      className="flex-row flex-wrap overflow-hidden rounded-2xl"
      style={{ backgroundColor: paper.page }}
    >
      {SETTINGS_TILES.map((tile, index) => {
        const Icon = tile.icon;
        const lastColumn = index % 3 === 2;
        const lastRow = index >= 6;
        return (
          <Pressable
            key={tile.id}
            accessibilityRole="button"
            accessibilityLabel={tile.label}
            accessibilityHint={`Opens ${tile.label} settings`}
            onPress={() => onTile(tile.id)}
            className="items-center justify-center gap-2 active:opacity-60"
            style={{
              width: "33.3333%",
              height: tileHeight,
              borderColor: paper.line,
              borderRightWidth: lastColumn ? 0 : StyleSheet.hairlineWidth,
              borderBottomWidth: lastRow ? 0 : StyleSheet.hairlineWidth,
            }}
          >
            <Icon size={36} color={paper.ink} strokeWidth={1.5} />
            <Text numberOfLines={1} style={{ color: paper.ink, fontSize: 15, lineHeight: 20 }}>
              {tile.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The grid as an overlay on whatever is under it, which in practice is the
 * live picture: dimmed, not hidden, so the operator still sees the room.
 *
 * Inner pages open in the same panel, the same size as the grid, as Filmic's
 * do - never full screen. The panel keeps a stack: back steps out one page at a
 * time to the grid, Android's back button included.
 *
 * Absolute fill rather than a React Native Modal, because a Modal is a new
 * window and Android's immersive flags do not carry into it - the status and
 * navigation bars would come back over the picture every time it opened.
 */
export function SettingsGrid({
  open,
  onClose,
  onTile,
  openTo = null,
  pages,
}: {
  open: boolean;
  onClose: () => void;
  onTile: (tile: SettingsTile) => void;
  /** Open straight onto this page rather than the grid (the destination pill). */
  openTo?: string | null;
  /**
   * Pages the host draws itself because they need its live state - the
   * viewfinder's Hardware and Stabilization pages drive the running camera.
   */
  pages?: Record<string, ComponentType>;
}) {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const [stack, setStack] = useState<string[]>([]);

  // Every opening starts at the grid, or at the page it was opened for.
  useEffect(() => {
    setStack(open && openTo ? [openTo] : []);
  }, [open, openTo]);

  const allPages = useMemo(() => ({ ...PANEL_PAGES, ...pages }), [pages]);

  const nav = useMemo<SettingsPanelNav>(
    () => ({
      go: (route) => {
        if (allPages[route]) {
          setStack((pages) => [...pages, route]);
          return;
        }
        // A real screen (Destinations, the Log): leave the panel for it.
        onClose();
        // Typed routes are a union of literals; these are known paths.
        router.push(route as never);
      },
      back: () => setStack((stackNow) => stackNow.slice(0, -1)),
      close: onClose,
    }),
    [allPages, onClose, router],
  );

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 0) nav.back();
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, stack.length, nav, onClose]);

  if (!open) return null;

  const landscape = width > height;
  const panelWidth = landscape ? Math.min(width * 0.48, 560) : width - 24;
  // Square tiles where the screen allows, squeezed to fit a short landscape
  // screen with a margin, never shorter than a thumb.
  const tileHeight = Math.max(72, Math.min(panelWidth / 3, (height - 48) / 3));

  return (
    <View className="absolute inset-0 items-center justify-center" style={{ zIndex: 50 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close settings"
        onPress={onClose}
        className="absolute inset-0"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      />
      <View
        accessibilityViewIsModal
        style={{
          width: panelWidth,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 12,
          borderRadius: 16,
        }}
      >
        {stack.length === 0 ? (
          <SettingsTiles
            tileHeight={tileHeight}
            onTile={(tile) => {
              // Hardware and stabilisation open the host's own pages when it
              // has them; otherwise the host decides.
              const route = ROUTES[tile] ?? (allPages[`/settings/${tile}`] ? `/settings/${tile}` : null);
              if (route) nav.go(route);
              else onTile(tile);
            }}
          />
        ) : (
          <View style={{ height: tileHeight * 3, borderRadius: 16, overflow: "hidden" }}>
            <SettingsPanelContext.Provider value={nav}>
              {(() => {
                const Current = allPages[stack.at(-1) ?? ""];
                return Current ? <Current /> : null;
              })()}
            </SettingsPanelContext.Provider>
          </View>
        )}
      </View>
    </View>
  );
}
