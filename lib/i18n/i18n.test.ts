import assert from "node:assert/strict";
import { test } from "node:test";

import { ar } from "./ar.ts";
import { en } from "./en.ts";
import { ha } from "./ha.ts";
import { bidi, languageFromLocale, RTL_TEXT, setLanguage, t, TABLES, textDir } from "./translate.ts";

/**
 * The tables are typed against the English one, which catches a missing key at
 * compile time - but only in a build that type-checks, and a table can still
 * carry a key English no longer has, or drop a placeholder the code fills in.
 * These run on every `npm test`.
 */

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");

test("every key exists in all three tables, and nothing else does", () => {
  const keys = Object.keys(en).sort();
  for (const [name, table] of Object.entries({ ha, ar })) {
    assert.deepEqual(Object.keys(table).sort(), keys, `${name} has the same keys as en`);
    for (const key of keys) {
      const value = (table as Record<string, string>)[key];
      assert.equal(typeof value, "string", `${name}.${key} is a string`);
      assert.ok(value.trim().length > 0, `${name}.${key} is not empty`);
    }
  }
});

test("every translation keeps the placeholders the code fills in", () => {
  for (const [name, table] of Object.entries(TABLES)) {
    for (const [key, english] of Object.entries(en)) {
      assert.equal(
        placeholders((table as Record<string, string>)[key]),
        placeholders(english),
        `${name}.${key} keeps its placeholders`,
      );
    }
  }
});

test("t interpolates, and leaves a placeholder with no value as written", () => {
  setLanguage("en");
  assert.equal(t("mic.chip", { name: "Bluetooth" }), "Input: Bluetooth");
  assert.equal(t("preflight.picture", { height: 720, fps: 30, rate: "2500 kbps", name: "Class 3" }),
    "720p · 30 fps · 2500 kbps to Class 3");
  assert.equal(t("mic.chip"), "Input: {name}");
  assert.equal(t("mic.chip", {}), "Input: {name}");
  assert.equal(t("hud.offAir"), "Off air");
});

test("t follows the language in use, and a value is not read as a pattern", () => {
  try {
    setLanguage("ar");
    assert.equal(t("hud.offAir"), ar["hud.offAir"]);
    assert.ok(t("mic.chip", { name: "USB" }).includes("USB"));
    setLanguage("ha");
    assert.equal(t("hud.offAir"), ha["hud.offAir"]);
    setLanguage("en");
    assert.equal(t("mic.chip", { name: "$& {n}" }), "Input: $& {n}");
  } finally {
    setLanguage("en");
  }
});

test("the phone's locale picks Hausa or Arabic, and English for everything else", () => {
  assert.equal(languageFromLocale("ha_NG"), "ha");
  assert.equal(languageFromLocale("ar-EG"), "ar");
  assert.equal(languageFromLocale("AR"), "ar");
  assert.equal(languageFromLocale("en-US"), "en");
  assert.equal(languageFromLocale("fr_FR"), "en");
  assert.equal(languageFromLocale(""), "en");
  assert.equal(languageFromLocale(undefined), "en");
});

test("direction is right-to-left for Arabic, by language and by a name's first letter", () => {
  try {
    setLanguage("ar");
    assert.equal(textDir(), RTL_TEXT);
    setLanguage("en");
    assert.equal(textDir(), undefined);
  } finally {
    setLanguage("en");
  }
  assert.equal(bidi("الصف الثالث"), RTL_TEXT);
  assert.equal(bidi("1 - مقدمة"), RTL_TEXT, "digits have no direction; the first letter decides");
  assert.equal(bidi("Class 3 (أ)"), undefined);
  assert.equal(bidi("Ajin Hausa ɗaya"), undefined);
  assert.equal(bidi(""), undefined);
  assert.equal(bidi(null), undefined);
});
