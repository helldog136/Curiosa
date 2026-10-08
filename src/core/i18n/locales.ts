/**
 * Langues que le framework sait nommer et préfixer dans l'URL. Ajouter une
 * langue ici suffit pour pouvoir publier du contenu dedans ; les textes de
 * l'interface (src/locales/<code>.json) retombent sur l'anglais tant que le
 * fichier n'existe pas.
 */
export const KNOWN_LOCALES: Record<string, string> = {
  fr: "Français",
  en: "English",
  nl: "Nederlands",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  pl: "Polski",
  ru: "Русский",
  uk: "Українська",
  tr: "Türkçe",
  ar: "العربية",
  ja: "日本語",
  ko: "한국어",
  zh: "中文",
  sv: "Svenska",
  da: "Dansk",
  fi: "Suomi",
  no: "Norsk",
  cs: "Čeština",
  ro: "Română",
  hu: "Magyar",
  el: "Ελληνικά",
};

export const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

export function isKnownLocale(code: string): boolean {
  return Object.hasOwn(KNOWN_LOCALES, code);
}

export function localeName(code: string): string {
  return KNOWN_LOCALES[code] ?? code;
}

export const FALLBACK_UI_LOCALE = "en";
