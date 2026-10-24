/**
 * Saved looks: a picture size, an exposure and a white balance, under a name.
 *
 * A preset is saved and applied from the viewfinder's drawer, where the
 * operator can see what it does to the picture; Settings only lists, renames
 * and deletes them. The store is a list under one key rather than a key per
 * preset, because the list is the thing that is read - there are never more
 * than a handful, and one read is one parse.
 *
 * The storage is injected. MMKV is a native module and these tests run under
 * plain node, so the store is built by `createPresetStore` over anything with
 * `getString` and `set`, and the functions exported at the bottom bind it to
 * the app's MMKV the first time one of them is called - never at import, which
 * is what lets the test import this file at all.
 */

export type Preset = {
  id: string;
  name: string;
  createdAt: number;
  video: { width: number; height: number; fps: number; codec: string };
  exposure: { mode: "auto"; ev: number } | { mode: "manual"; iso: number; exposureNs: number };
  whiteBalance:
    | { mode: "preset"; awb: number }
    | { mode: "kelvin"; kelvin: number; tint: number };
};

/** The two calls of MMKV's this store needs, and all a fake has to provide. */
export type PresetBackend = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
};

export const PRESETS_KEY = "framevane.presets";

export function createPresetStore(backend: PresetBackend) {
  const listeners = new Set<() => void>();

  /**
   * Read back defensively: the list is JSON written by whichever build saved
   * it, and a corrupt or foreign value should read as no presets rather than
   * throw inside a settings screen.
   */
  function list(): Preset[] {
    const raw = backend.getString(PRESETS_KEY);
    if (!raw) return [];
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter(isPreset) : [];
    } catch {
      return [];
    }
  }

  function write(presets: Preset[]) {
    backend.set(PRESETS_KEY, JSON.stringify(presets));
    for (const listener of listeners) listener();
  }

  function save(preset: Omit<Preset, "id" | "createdAt">): Preset {
    const createdAt = Date.now();
    const saved: Preset = {
      ...preset,
      name: preset.name.trim() || "Preset",
      id: `preset_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt,
    };
    write([...list(), saved]);
    return saved;
  }

  /** A blank name is ignored rather than saved: a preset nobody can tell apart. */
  function rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const presets = list();
    if (!presets.some((p) => p.id === id)) return;
    write(presets.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }

  function remove(id: string) {
    const presets = list();
    const next = presets.filter((p) => p.id !== id);
    if (next.length !== presets.length) write(next);
  }

  /** For `useSyncExternalStore`, and anything else that draws the list. */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return { list, save, rename, remove, subscribe };
}

function isPreset(value: unknown): value is Preset {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<Preset>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.createdAt === "number" &&
    !!p.video &&
    typeof p.video.width === "number" &&
    typeof p.video.height === "number" &&
    !!p.exposure &&
    !!p.whiteBalance
  );
}

let appStore: ReturnType<typeof createPresetStore> | null = null;

/**
 * The app's store, over MMKV. Required lazily for the reason at the top: an
 * import here would load the native module the moment a test imported the
 * file.
 */
function store() {
  if (!appStore) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { storage } = require("../storage") as typeof import("../storage");
    appStore = createPresetStore(storage);
  }
  return appStore;
}

export function listPresets(): Preset[] {
  return store().list();
}

export function savePreset(preset: Omit<Preset, "id" | "createdAt">): Preset {
  return store().save(preset);
}

export function renamePreset(id: string, name: string): void {
  store().rename(id, name);
}

export function deletePreset(id: string): void {
  store().remove(id);
}

export function subscribePresets(listener: () => void): () => void {
  return store().subscribe(listener);
}
