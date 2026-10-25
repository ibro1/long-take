import type { Preset } from "./presets";

/**
 * What the Presets page can do to the camera, lent to it by the viewfinder.
 *
 * Saving and applying need the live camera state, which only the viewfinder
 * holds; the Presets page opens in the settings panel over that viewfinder,
 * so the viewfinder registers these while it is mounted. A Presets page with
 * no viewfinder behind it (null here) can still rename and delete.
 */
export type PresetActions = {
  save: (name: string) => void;
  apply: (preset: Preset) => void;
  /** Everything back to auto: exposure, focus, white balance, zoom, grade. */
  reset: () => void;
};

let current: PresetActions | null = null;

export function registerPresetActions(actions: PresetActions | null): void {
  current = actions;
}

export function presetActions(): PresetActions | null {
  return current;
}
