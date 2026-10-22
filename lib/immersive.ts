import { useFocusEffect } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { setStatusBarHidden } from "expo-status-bar";
import { useCallback } from "react";
import { AppState, Platform } from "react-native";

/**
 * Hides both bars. What the viewfinder does when it gains focus, and again
 * whenever the app's window gets focus back.
 */
function hideSystemBars(): void {
  // A promise that rejects here is not worth interrupting a broadcast for:
  // the cost of failing is a visible bar, which is what we started with.
  setStatusBarHidden(true, "fade");
  if (Platform.OS === "android") {
    /**
     * Visibility only. `setBehaviorAsync` is refused under edge-to-edge - it
     * logs a warning and returns without doing anything - and this app is
     * edge-to-edge, so calling it bought a line of noise in the one log used to
     * diagnose broadcasts and nothing else. The behaviour it would have asked
     * for is what the system already does when the bars are hidden this way:
     * they come back on a swipe and go away again.
     */
    void NavigationBar.setVisibilityAsync("hidden").catch(() => {});
  }
}

/**
 * Gives the whole screen to the picture, the way a camera app does.
 *
 * A viewfinder competing with a status bar and three navigation keys is a
 * viewfinder with two strips of someone else's interface across it, and the
 * operator is framing a shot in what is left. Every camera on a phone hides
 * both and hands them back on a swipe, which is what `overlay-swipe` does: the
 * bars come over the picture when asked for and go away again on their own,
 * rather than pushing the layout around each time.
 *
 * Tied to focus rather than to mounting, because the viewfinder deliberately
 * stays mounted while the operator is on another tab - detaching it would take
 * the camera down - so a component that hid these on mount would keep them
 * hidden on Settings too, and `router.back()` would be a swipe nobody knew to
 * make.
 *
 * And hidden again whenever the window gets focus back. On Android a dialog or
 * a modal is a window of its own, and opening one brings both bars back.
 * Closing it did not put them away - the viewfinder never lost focus as far as
 * the navigator knew, so nothing re-ran - and the navigation bar stayed drawn
 * across the bottom controls: half the record button and the mic chip under a
 * black strip, mid-broadcast. AppState's `focus` is the window regaining focus
 * after any of them - the stop confirmation, a picker, a permission prompt,
 * the notification shade - so one listener covers every one, including the
 * ones added later. Delayed a moment so it lands after the closing window has
 * handed focus back rather than on the way out.
 *
 * Android only. iOS has no navigation bar to hide and its status bar is handled
 * by the root layout.
 */
export function useImmersiveScreen(): void {
  useFocusEffect(
    useCallback(() => {
      hideSystemBars();

      let pending: ReturnType<typeof setTimeout> | null = null;
      const regained = AppState.addEventListener("focus", () => {
        if (pending) clearTimeout(pending);
        pending = setTimeout(hideSystemBars, 200);
      });

      return () => {
        regained.remove();
        if (pending) clearTimeout(pending);
        setStatusBarHidden(false, "fade");
        if (Platform.OS === "android") {
          void NavigationBar.setVisibilityAsync("visible").catch(() => {});
        }
      };
    }, []),
  );
}
