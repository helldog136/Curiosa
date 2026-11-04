import languages from "@/locales/languages.json";

/**
 * The languages Curiosa can name and put in a URL. Data, not code: `src/locales/languages.json` (written by `scripts/i18n-add-language.mjs`).
 * Adding a language there is enough to publish content in it. Its interface texts are `src/locales/<code>.json`; a missing text falls back
 * (requested language -> site main language -> English), never to another language by accident.
 *   status "official"  : English and French, always complete, kept by the maintainers.
 *   status "community" : any other language, contributed by pull request; may be partial.
 */
export type LanguageStatus = "official" | "community";
type LanguageEntry = { name: string; status: LanguageStatus; rtl?: boolean };
const LANGUAGES = languages as Record<string, LanguageEntry>;

export const KNOWN_LOCALES: Record<string, string> = Object.fromEntries(Object.entries(LANGUAGES).map(([code, l]) => [code, l.name]));

export const RTL_LOCALES = new Set(["he", "fa", "ur", ...Object.entries(LANGUAGES).filter(([, l]) => l.rtl).map(([code]) => code)]);

export function isKnownLocale(code: string): boolean {
  return Object.hasOwn(KNOWN_LOCALES, code);
}

export function localeName(code: string): string {
  return KNOWN_LOCALES[code] ?? code;
}

/** "official" for English and French, "community" for every other language. */
export function languageStatus(code: string): LanguageStatus {
  return LANGUAGES[code]?.status === "official" ? "official" : "community";
}

/** The language of last resort, and one of the two that always exist. */
export const FALLBACK_UI_LOCALE = "en";
/** English and French: always supported, in the core and in every module. */
export const REQUIRED_LOCALES = ["en", "fr"] as const;
