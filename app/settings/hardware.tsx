import { useRouter } from "expo-router";
import { Pressable } from "react-native";

import { Block, Group, Page, paper } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";

/**
 * Where the Hardware and Stabilization tiles land.
 *
 * Lens, focus, exposure, white balance and stabilisation change the picture,
 * and a setting that changes the picture belongs where the picture is: the
 * viewfinder's Camera panel, behind the colour diamond. Duplicating them here
 * would mean two places that can disagree about what the camera is doing, so
 * this page says where they are and takes the operator there.
 */
export default function HardwareSettingsScreen() {
  const router = useRouter();

  return (
    <Page title="Hardware and stabilization">
      <Group>
        <Block>
          <Text style={{ color: paper.ink, fontSize: 15, lineHeight: 20 }}>
            Lens, focus, exposure, white balance and stabilization are set on the viewfinder, so you
            can see what each one does to the picture. Tap the colour diamond to open the Camera
            panel.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the viewfinder"
            onPress={() => router.navigate("/(tabs)")}
            className="mt-2 min-h-[44px] items-center justify-center rounded-full px-4 active:opacity-60"
            style={{ backgroundColor: paper.accent }}
          >
            <Text className="font-semibold" style={{ color: paper.accentInk, fontSize: 15 }}>
              Open the viewfinder
            </Text>
          </Pressable>
        </Block>
      </Group>
    </Page>
  );
}
