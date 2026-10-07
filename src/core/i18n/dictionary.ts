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

export function makeTranslator(locale: string): Translator {
  const primary = DICTIONARIES[locale];
  const fallback = DICTIONARIES[FALLBACK_UI_LOCALE] ?? {};
  return (key, vars) => {
    let text = primary?.[key] ?? fallback[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  };
}
