import { useFocusEffect } from "@react-navigation/native";
import { createContext, type ReactNode, useCallback, useContext, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Text } from "@/components/ui/text";
import { type UpdatePrompt as UpdatePromptState, useUpdatePrompt } from "@/lib/updates";

/**
 * The one thing an over-the-air update shows the operator: a downloaded update
 * is sitting there, and restarting applies it.
 *
 * The policy runs once, in `UpdateProvider` at the root - it downloads, and
 * two copies of it would download twice - and the card is drawn in one of two
 * places. Over most screens it floats at the top. On the viewfinder it does
 * not: it was absolutely positioned a fixed distance down, which is exactly
 * where the viewfinder's banners are, so an update and a dropped connection
 * were drawn on top of each other and neither could be read. The viewfinder
 * hosts it instead, in its own banner column under whatever banner is up, and
 * while it does the floating copy stands aside.
 */

const UpdateContext = createContext<UpdatePromptState | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const update = useUpdatePrompt();
  return <UpdateContext.Provider value={update}>{children}</UpdateContext.Provider>;
}

/**
 * How many focused screens are drawing the card themselves. A count rather
 * than a flag, so a screen losing focus cannot clear another's claim.
 */
let hosts = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const hosted = () => hosts > 0;

/**
 * Claims the card for this screen while it has focus. `enabled` is for a
 * screen that only sometimes has somewhere to put it - the viewfinder behind
 * its permission gate has no banner column.
 */
export function useHostUpdatePrompt(enabled: boolean) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      hosts += 1;
      for (const listener of listeners) listener();
      return () => {
        hosts -= 1;
        for (const listener of listeners) listener();
      };
    }, [enabled]),
  );
}

/** Floats at the top of whatever screen is up, unless that screen hosts it. */
export function UpdatePrompt() {
  const update = useContext(UpdateContext);
  const isHosted = useSyncExternalStore(subscribe, hosted, hosted);

  if (!update || update.status !== "ready" || isHosted) return null;

  return (
    <SafeAreaView className="absolute inset-x-0 top-0" edges={["top"]} pointerEvents="box-none">
      <View className="mx-4 mt-14">
        <UpdateBody update={update} />
      </View>
    </SafeAreaView>
  );
}

/** The card alone, for a screen that places it in its own layout. */
export function UpdateCard() {
  const update = useContext(UpdateContext);
  if (!update || update.status !== "ready") return null;
  return <UpdateBody update={update} />;
}

function UpdateBody({ update }: { update: UpdatePromptState }) {
  return (
    <View className="gap-3 rounded-2xl bg-black/85 p-4">
      <View className="gap-1">
        <Text className="text-sm font-semibold text-white">Update ready</Text>
        <Text className="text-xs text-white/70">
          A new version of Framevane is downloaded. Restarting the app applies it and takes a
          moment. It will not happen while you are on air.
        </Text>
      </View>

      <View className="flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restart now to update"
          onPress={update.accept}
          className="min-h-12 flex-1 items-center justify-center rounded-xl bg-white px-4"
        >
          <Text className="text-sm font-semibold text-black">Restart now</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Update later"
          onPress={update.dismiss}
          className="min-h-12 items-center justify-center rounded-xl bg-white/10 px-5"
        >
          <Text className="text-sm text-white">Later</Text>
        </Pressable>
      </View>
    </View>
  );
}
