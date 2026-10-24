import assert from "node:assert/strict";
import { test } from "node:test";

import { createPresetStore, type Preset, type PresetBackend, PRESETS_KEY } from "./presets.ts";

/**
 * The store over a Map instead of MMKV, which is a native module and cannot
 * load under node. The Map is the whole of what MMKV is to this store: a
 * string under a key.
 */
function memory(initial?: Record<string, string>): PresetBackend & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    map,
    getString: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
  };
}

const LOOK: Omit<Preset, "id" | "createdAt"> = {
  name: "Hall, evening",
  video: { width: 1280, height: 720, fps: 30, codec: "h264" },
  exposure: { mode: "manual", iso: 400, exposureNs: 20_000_000 },
  whiteBalance: { mode: "kelvin", kelvin: 3200, tint: 0 },
};

test("an empty phone has no presets", () => {
  assert.deepEqual(createPresetStore(memory()).list(), []);
});

test("a saved preset comes back with an id and a time, and survives a new store", () => {
  const backend = memory();
  const saved = createPresetStore(backend).save(LOOK);
  assert.match(saved.id, /^preset_/);
  assert.equal(typeof saved.createdAt, "number");
  assert.deepEqual(createPresetStore(backend).list(), [saved]);
});

test("two presets saved in the same millisecond do not share an id", () => {
  const store = createPresetStore(memory());
  const a = store.save(LOOK);
  const b = store.save({ ...LOOK, name: "Outdoors" });
  assert.notEqual(a.id, b.id);
  assert.deepEqual(
    store.list().map((p) => p.name),
    ["Hall, evening", "Outdoors"],
  );
});

test("rename changes only the one preset, and a blank name is ignored", () => {
  const store = createPresetStore(memory());
  const a = store.save(LOOK);
  const b = store.save({ ...LOOK, name: "Outdoors" });
  store.rename(a.id, "  Chapel  ");
  store.rename(b.id, "   ");
  assert.deepEqual(
    store.list().map((p) => p.name),
    ["Chapel", "Outdoors"],
  );
});

test("delete removes the one preset", () => {
  const store = createPresetStore(memory());
  const a = store.save(LOOK);
  const b = store.save({ ...LOOK, name: "Outdoors" });
  store.remove(a.id);
  assert.deepEqual(
    store.list().map((p) => p.id),
    [b.id],
  );
});

test("listeners hear every change and stop hearing once unsubscribed", () => {
  const store = createPresetStore(memory());
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  const a = store.save(LOOK);
  store.rename(a.id, "Chapel");
  store.remove(a.id);
  assert.equal(calls, 3);
  store.remove("nothing_here");
  assert.equal(calls, 3, "a delete that changed nothing is not news");
  unsubscribe();
  store.save(LOOK);
  assert.equal(calls, 3);
});

test("a corrupt or foreign value reads as no presets rather than throwing", () => {
  assert.deepEqual(createPresetStore(memory({ [PRESETS_KEY]: "{not json" })).list(), []);
  assert.deepEqual(createPresetStore(memory({ [PRESETS_KEY]: '{"a":1}' })).list(), []);
  assert.deepEqual(
    createPresetStore(memory({ [PRESETS_KEY]: '[{"id":"x"},null,7]' })).list(),
    [],
  );
});
