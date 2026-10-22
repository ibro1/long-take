import { ar } from "./ar.ts";
import { en, type StringKey } from "./en.ts";
import { ha } from "./ha.ts";

/**
 * The language layer, with nothing in it that needs a phone.
 *
 * Kept free of React Native so the tables and `t` are tested under plain node,
 * like the rest of lib/. Which language is in use is decided in `./index.ts`,
 * which reads the setting and the phone's locale and hands the answer here.
 *
 * Small on purpose. A library would bring plural rules and lazy loading for a
 * few hundred short strings in three languages, and none of the strings here
 * has a plural that a sentence cannot be written around.
 */

export type Language = "en" | "ha" | "ar";
export type { StringKey };

export const LANGUAGES: readonly Language[] = ["en", "ha", "ar"];

export const TABLES: Record<Language, Record<StringKey, string>> = { en, ha, ar };

let current: Language = "en";

export function setLanguage(language: Language): void {
  current = language;
}

export function currentLanguage(): Language {
  return current;
}

/**
 * One string, in the language in use, with `{name}` filled from `vars`.
 *
 * A translation left empty falls back to English rather than drawing a blank
 * chip: the drafts are still being reviewed, and a reviewer who clears a line
 * they are unsure of should not take a word off somebody's viewfinder. A
 * placeholder with no value stays as written, which is ugly enough to be
 * noticed in testing and never throws mid-broadcast.
 */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const template = TABLES[current][key] || en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * The language an unset preference means, from a locale such as `ha_NG`,
 * `ar-EG` or `en-US`. Hausa and Arabic phones get their own language; every
 * other phone gets English, which is the only complete table.
 */
export function languageFromLocale(locale: string | null | undefined): Language {
  const tag = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return tag === "ha" || tag === "ar" ? tag : "en";
}

/**
 * Right-to-left, applied to a piece of text rather than to the app.
 *
 * `I18nManager.forceRTL` would mirror the whole screen - the camera's control
 * column, the level meter, the rails - and only after a restart, which is not
 * a thing to do to a viewfinder an operator has learned by thumb. So the
 * direction is set where the words are: `direction` is what Android's text
 * layout reads for the paragraph, `writingDirection` is what iOS reads, and
 * with both set an Arabic line aligns right and keeps its punctuation at the
 * correct end inside an otherwise left-to-right screen.
 */
export const RTL_TEXT = { direction: "rtl", writingDirection: "rtl" } as const;

/** For the strings that came out of the table: right-to-left when Arabic is in use. */
export function textDir(): typeof RTL_TEXT | undefined {
  return current === "ar" ? RTL_TEXT : undefined;
}

/**
 * Hebrew, Arabic, Syriac, Thaana, N'Ko and the Arabic presentation forms.
 * Enough to recognise the scripts a class here is named in.
 */
const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/**
 * For text somebody typed - a destination, a preset, a group - which is in
 * whatever language they typed it, whatever the app is set to. Decided by the
 * first letter that has a direction, the same rule a browser applies to
 * `dir="auto"`: a name like "1 - مقدمة" is Arabic, and "Class 3 (أ)" is not.
 */
export function bidi(text: string | null | undefined): typeof RTL_TEXT | undefined {
  if (!text) return undefined;
  for (const char of text) {
    if (RTL_CHAR.test(char)) return RTL_TEXT;
    if (LTR_CHAR.test(char)) return undefined;
  }
  return undefined;
}
