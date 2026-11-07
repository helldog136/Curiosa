import { APPEARANCE_HREF, NAVIGATION_HREF, REDIRECTS_HREF, SETTINGS_SITE_HREF, SOCIAL_HREF, entriesHref, entryHref, instanceHref } from "@/core/adminLinks";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;

/**
 * Où le bouton « Corriger » mène : un écran de l'administration, JAMAIS une autre adresse (aucune redirection ouverte, même si le rapport gardé en base était modifié).
 * Chaque forme correspond à une page qui existe dans app/admin/(panel) — un test le vérifie dans le dépôt. Une forme inconnue ou mal écrite donne null (pas de bouton).
 */
export function fixHref(f: unknown, defaultLocale = ""): string | null {
  if (!Array.isArray(f)) return null;
  const [kind, a, b, c] = f as unknown[];
  switch (kind) {
    case "e": {
      if (typeof a !== "string" || !ID.test(a) || typeof c !== "string" || !ID.test(c)) return null;
      const locale = typeof b === "string" && LOCALE.test(b) && b !== defaultLocale ? b : undefined;
      return entryHref(a, { c, locale });
    }
    case "l": return typeof a === "string" && ID.test(a) ? entriesHref(a) : null;
    case "i": return typeof a === "string" && ID.test(a) ? instanceHref(a) : null;
    case "n": return NAVIGATION_HREF;
    case "r": return REDIRECTS_HREF;
    case "x": return SOCIAL_HREF;
    case "s": return a === "appearance" ? APPEARANCE_HREF : SETTINGS_SITE_HREF;
    default: return null;
  }
}
