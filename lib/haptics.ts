import { Vibration } from "react-native";

import { loadPreferences } from "@/lib/broadcast/settings";

/**
 * A press that took, felt rather than seen.
 *
 * The operator's eyes are on the class, and the controls that matter most -
 * going live, ending, recording, muting - are the ones pressed without
 * looking. A tap that lands silently gets tapped again, and for every one of
 * these a second tap is the opposite of what was meant.
 *
 * Two lengths only. Going on and off air is the longer one, because it is the
 * one worth telling apart from a mute through a pocket; the rest are a tick.
 * The alarms for a dropped connection are elsewhere and are not switched off
 * by the setting read here.
 *
 * The setting is read on each buzz rather than held, because it is changed on
 * the Settings tab while the viewfinder stays mounted behind it.
 */
const TICK_MS = 30;
const MARK_MS = 90;

function enabled(): boolean {
  try {
    return loadPreferences().haptics;
  } catch {
    return false;
  }
}

/** Record, mute: a control whose state just changed. */
export function tick(): void {
  if (enabled()) Vibration.vibrate(TICK_MS);
}

/** On air, off air. */
export function mark(): void {
  if (enabled()) Vibration.vibrate(MARK_MS);
}
