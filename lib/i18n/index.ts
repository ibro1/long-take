import { I18nManager } from "react-native";

import { loadPreferences, type LanguageChoice } from "@/lib/broadcast/settings";

import { type Language, languageFromLocale, setLanguage } from "./translate";

export {
  bidi,
  currentLanguage,
  type Language,
  LANGUAGES,
  RTL_TEXT,
  type StringKey,
  t,
  textDir,
} from "./translate";

/**
 * The phone's own language, as Android reports it.
 *
 * Read from React Native's I18nManager constants rather than a localisation
 * package - this is one string, and the constants already carry it. Only read:
 * nothing here calls `forceRTL`, see RTL_TEXT for why. `Intl` is the fallback
 * for a runtime that does not expose the identifier.
 */
function deviceLocale(): string {
  try {
    const constants = I18nManager.getConstants?.() as { localeIdentifier?: string } | undefined;
    if (constants?.localeIdentifier) return constants.localeIdentifier;
  } catch {
    // Fall through to Intl.
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

export function resolveLanguage(choice: LanguageChoice): Language {
  return choice === "auto" ? languageFromLocale(deviceLocale()) : choice;
}

/**
 * Puts the saved choice into effect. Called at launch and whenever the
 * viewfinder comes back into focus, because the setting is changed on another
 * tab while this one stays mounted.
 */
export function applyLanguagePreference(): Language {
  const language = resolveLanguage(loadPreferences().language);
  setLanguage(language);
  return language;
}
