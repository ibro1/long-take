import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { LucideIcon } from "lucide-react-native";

import { Text } from "@/components/ui/text";

/**
 * Everything that does not earn a place on the glass.
 *
 * A viewfinder has room for the controls reached for with the phone already
 * raised - switch camera, mute, torch, pause, shutter, go live - and every
 * further disc added to that rail competes with the picture for the same
 * hand and the same glance. The rest are settings that happen before a
 * broadcast, and settings can afford a second tap and a written label.
 *
 * A sheet rather than another screen, because leaving the viewfinder is the
 * expensive thing here: the camera preview is a native view, and navigating
 * away tears it down and builds it again.
 */

export type MoreItem = {
  icon: LucideIcon;
  label: string;
  /** What choosing it does, when the label alone would be a guess. */
  hint?: string;
  /** Shown as on, for the things that are a state rather than an action. */
  on?: boolean;
  onPress: () => void;
};

export function MoreSheet({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: MoreItem[];
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      // Android's back gesture should close the sheet rather than leave the
      // screen behind it.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* The dim area round the sheet closes it, and says so to a screen
          reader rather than being an unlabelled thing that does something. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the menu"
        className="flex-1 justify-end bg-black/60"
        onPress={onClose}
      >
        {/* Stops a tap on the sheet itself from closing it. Not a control, so
            a screen reader is told it is nothing at all. */}
        <Pressable
          accessibilityRole="none"
          accessibilityLabel="Menu"
          importantForAccessibility="no"
          onPress={() => {}}
        >
          <SafeAreaView edges={["bottom"]} className="rounded-t-3xl bg-neutral-900">
            <View className="items-center pb-1 pt-2">
              <View className="h-1 w-10 rounded-full bg-white/25" />
            </View>

            <ScrollView className="max-h-[60vh]" contentContainerClassName="pb-2">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    accessibilityHint={item.hint}
                    accessibilityState={{ selected: item.on }}
                    onPress={() => {
                      onClose();
                      item.onPress();
                    }}
                    // 56px, so the row is a comfortable target rather than a
                    // line of text that happens to be tappable.
                    className="min-h-14 flex-row items-center gap-3 px-5 py-3 active:bg-white/10"
                  >
                    <Icon className={`h-5 w-5 ${item.on ? "text-green-400" : "text-white"}`} />
                    <View className="flex-1">
                      <Text className={`text-base ${item.on ? "text-green-400" : "text-white"}`}>
                        {item.label}
                      </Text>
                      {item.hint ? (
                        <Text className="text-xs text-white/70">{item.hint}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
