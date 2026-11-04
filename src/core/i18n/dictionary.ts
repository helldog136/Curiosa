import { FALLBACK_UI_LOCALE } from "./locales";
import { DICTIONARIES } from "@/locales/index";

/**
 * Interface texts (public site + admin). To add a language: create `src/locales/<code>.json` and run `node scripts/i18n-add-language.mjs --sync`
 * (it lists the file in `src/locales/index.ts`); no code to write. See docs/TRANSLATING.md.
 */
export { DICTIONARIES };

export const UI_LOCALES = Object.keys(DICTIONARIES);

export type Translator = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Pluriel : si les variables portent un nombre (`n` ou `count`) et que le dictionnaire a une variante `<clé>.one`, c'est elle qui sert au singulier
 * (français : 0 et 1 ; anglais : 1). Ainsi « 1 personne » / « 2 personnes », « 1 person » / « 2 people », sans « (s) ».
 */
export function isSingular(locale: string, n: number): boolean {
  return locale === "fr" ? n >= 0 && n < 2 : n === 1;
}
const countOf = (vars?: Record<string, string | number>): number | null => {
  const raw = vars?.n ?? vars?.count;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Translator. Fallback chain for a missing text: requested language -> site main language (`siteDefault`) -> English. Never another language by accident.
 * A language without a dictionary uses the chain as if all its texts were missing.
 */
export function makeTranslator(locale: string, siteDefault?: string): Translator {
  const primary = DICTIONARIES[locale];
  const main = siteDefault && siteDefault !== locale ? DICTIONARIES[siteDefault] : undefined;
  const fallback = DICTIONARIES[FALLBACK_UI_LOCALE] ?? {};
  return (key, vars) => {
    // The first dictionary of the chain that has the text (an empty text, as in a language skeleton, counts as missing); the singular variant and the plural rule come from that same language.
    const found: [string, Record<string, string> | undefined][] = [[locale, primary], [siteDefault ?? "", main], [FALLBACK_UI_LOCALE, fallback]];
    const [from, source] = found.find(([, dict]) => !!dict?.[key]?.trim()) ?? [FALLBACK_UI_LOCALE, fallback];
    const n = countOf(vars);
    const one = n !== null && isSingular(from, n) ? source?.[`${key}.one`] : undefined;
    let text = one ?? source?.[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}
