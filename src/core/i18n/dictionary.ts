import { FALLBACK_UI_LOCALE } from "./locales";
import fr from "@/locales/fr.json";
import en from "@/locales/en.json";

/**
 * Textes de l'interface (site public + admin). Pour ajouter une langue
 * d'interface : créer src/locales/<code>.json et l'enregistrer ici.
 */
const DICTIONARIES: Record<string, Record<string, string>> = { fr, en };

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

export function makeTranslator(locale: string): Translator {
  const primary = DICTIONARIES[locale];
  const fallback = DICTIONARIES[FALLBACK_UI_LOCALE] ?? {};
  return (key, vars) => {
    const n = countOf(vars);
    const one = n !== null && isSingular(primary ? locale : FALLBACK_UI_LOCALE, n) ? (primary?.[`${key}.one`] ?? fallback[`${key}.one`]) : undefined;
    let text = one ?? primary?.[key] ?? fallback[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}
