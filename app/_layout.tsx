import "./global.css";
import { startCrashReporting } from "@/lib/crash-reporting";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { type Theme, ThemeProvider } from "@react-navigation/native";
import { SplashScreen, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PortalHost } from "@/components/primitives/portal";
import { UpdatePrompt, UpdateProvider } from "@/components/updates/update-prompt";
import { PerfProbe } from "@/components/diagnostics/perf-probe";
import { setAndroidNavigationBar } from "@/lib/android-navigation-bar";
import { DARK_THEME, LIGHT_THEME } from "@/lib/constants";
import { useColorScheme } from "@/lib/useColorScheme";
import { getItem, setItem } from "@/lib/storage";
import { useFrameworkReady } from "@/hooks/useFrameworkReady";
import { Inter_400Regular, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { useEffect } from "react";
import { syncAccount } from "@/lib/broadcast/connections";


export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

/**
 * Before anything else runs, so a crash during startup is still reported. A
 * report that only covers the app once it is working is the wrong half.
 */
startCrashReporting();

// Prevent the splash screen from auto-hiding before getting the color scheme.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colorScheme, setColorScheme } = useColorScheme();

  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_600SemiBold,
  });

  useFrameworkReady();

  /**
   * Dark, and it stays dark.
   *
   * app.json declares `userInterfaceStyle: "dark"` and every screen is drawn
   * for it - the viewfinder is hard-coded dark, because a white panel beside a
   * picture is a lamp pointed at the operator in a dark hall. Nativewind's
   * colour scheme follows the phone anyway, so when Android flipped to light -
   * on a schedule, at sunrise, without anyone touching anything - the settings
   * screens went white on their own while the viewfinder stayed black.
   *
   * The old code only looked once, at mount, so a flip while the app was open
   * or backgrounded was never corrected. This watches the value instead of
   * sampling it: any drift away from dark is put back.
   *
   * There is a ThemeToggle component in this repo and nothing renders it. If a
   * light theme is ever wanted, this is the line to change, and the screens
   * have to be looked at in it first.
   */
  useEffect(() => {
    /**
     * Set, not checked.
     *
     * Nativewind reports `undefined` while it has been given no scheme of its
     * own - which is also the state in which it follows the phone. Our hook
     * masks that as "dark" for callers who only want to draw something, so a
     * guard comparing against "dark" sees what it wants and leaves nativewind
     * unset, still following the phone, which is the bug. Setting it
     * unconditionally is what actually pins it.
     */
    setColorScheme("dark");
    setAndroidNavigationBar("dark");
    setItem("theme", "dark");
  }, [setColorScheme]);

  // And put it back if anything moves it afterwards.
  useEffect(() => {
    if (colorScheme !== "dark") setColorScheme("dark");
  }, [colorScheme, setColorScheme]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  /**
   * A linked phone asks its studio for the stream list once at start, so a
   * stream added or renamed on the laptop overnight is there before anybody
   * opens Destinations. Quiet: a phone opened with no signal keeps yesterday's
   * list, and a revoked link is said on the Destinations screen, which is
   * where the streams it took away were.
   */
  useEffect(() => {
    void syncAccount();
  }, []);


  return (
    <>
      <ThemeProvider value={colorScheme === "dark" ? DARK_THEME : LIGHT_THEME}>
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        <GestureHandlerRootView style={{ flex: 1 }}>
          <BottomSheetModalProvider>
            {/* Around the navigator, not beside it: the viewfinder draws the
                prompt in its own banner column, and has to read the same one
                update this runs. */}
            <UpdateProvider>
              <Stack>
                <Stack.Screen name="(tabs)" options={{ title: "Framevane", headerShown: false }} />
              </Stack>
              {/* Floats over whatever screen is up, and only ever when an
                  update is downloaded and the phone is not on air. */}
              <UpdatePrompt />
              {/* Draws nothing; records performance when About's hidden
                  switch is on, and does nothing at all when it is off. */}
              <PerfProbe />
            </UpdateProvider>
          </BottomSheetModalProvider>
        </GestureHandlerRootView>
      </ThemeProvider>
      {/* Dropdowns and dialogs render through this; it must stay mounted. */}
      <PortalHost />
    </>
  );
}
