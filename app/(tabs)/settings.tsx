import { type Href, useRouter } from "expo-router";
import { useWindowDimensions } from "react-native";

import { Page } from "@/components/settings/chrome";
import { routeForTile, type SettingsTile, SettingsTiles } from "@/components/settings/settings-grid";

/**
 * Settings, as nine tiles on a light panel - the same grid the viewfinder
 * opens over the picture, full screen here.
 *
 * This used to be a menu of rows, and before that one long list. A grid of
 * nine is the shape Filmic operators already know, and every setting that was
 * on this screen has a tile to live behind: recording under Video, the
 * background broadcast and haptics under Device, quick access and language
 * under Interface, the bad-connection rules under Streaming, and the log, the
 * policy and the terms under Information.
 *
 * Hardware and Stabilization have no page of their own. Lens, focus and
 * stabilisation are set on the viewfinder's Camera panel, where the operator
 * can see what they do; their tiles open a short page that says so and goes
 * there.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();

  // Square tiles in portrait. In landscape a third of the width is taller
  // than the screen, so the grid is held to what fits under the header.
  const inner = width - 32;
  const tileHeight = Math.max(72, Math.min(inner / 3, (height - 140) / 3));

  const open = (tile: SettingsTile) => {
    router.push((routeForTile(tile) ?? "/settings/hardware") as Href);
  };

  return (
    <Page title="Settings">
      <SettingsTiles onTile={open} tileHeight={tileHeight} />
    </Page>
  );
}
