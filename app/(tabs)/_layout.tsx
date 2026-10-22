import { Tabs } from "expo-router";

import { Globe } from "@/lib/icons/Globe";
import { Send } from "@/lib/icons/Send";
import { Settings } from "@/lib/icons/Settings";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function TabLayout() {
  return (
    /**
     * The viewfinder tab stays attached while the operator is on another one.
     *
     * React Navigation detaches a blurred tab on Android by default, and
     * detaching means Android destroys the fragment's view - which takes the
     * camera preview with it. The native view answers that by releasing the
     * camera, the encoder and the microphone in `onDetachedFromWindow`, and it
     * only claims the module's single-preview slot in its constructor, so
     * coming back leaves a preview on screen that the module no longer knows
     * about: going live, switching camera and the torch all fail after a trip
     * to Destinations. A phone that is about to broadcast should not be tearing
     * its camera down and rebuilding it because somebody checked a setting.
     */
    /**
     * The bar itself is gone, but these are still tabs.
     *
     * A broadcaster is a viewfinder, and a row of labelled tabs across the
     * bottom of one is a strip of picture spent on navigation that is used
     * twice a session. The controls that matter are on the glass, and
     * Destinations and Settings are reached from there.
     *
     * Kept as tabs rather than rebuilt as a stack because of the note below:
     * these screens must stay mounted. Pushing Settings onto a stack would
     * unmount the viewfinder and take the camera down with it, which is the
     * failure `detachInactiveScreens={false}` exists to prevent. Hiding the bar
     * costs nothing; changing the navigator would cost the camera.
     */
    <Tabs
      detachInactiveScreens={false}
      screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Broadcast",
          // The viewfinder is the app; it opens here and the tab bar stays out
          // of the picture.
          tabBarIcon: () => <Send className="text-foreground" />,
        }}
      />
      <Tabs.Screen
        name="connections"
        options={{
          title: "Destinations",
          tabBarIcon: () => <Globe className="text-foreground" />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: () => <Settings className="text-foreground" />,
        }}
      />
      {/**
       * The log is a whole scrolling screen but not a place anyone goes looking
       * on purpose - they arrive from Settings, after a broadcast went wrong.
       * `href: null` registers the route without spending a fourth slot in a
       * tab bar that already sits under the viewfinder.
       */}
      <Tabs.Screen name="log" options={{ title: "Log", href: null }} />
    </Tabs>
  );
}
