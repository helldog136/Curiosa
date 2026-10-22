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
      const locale = typeof b === "string" && LOCALE.test(b) && b !== defaultLocale ? `&locale=${b}` : "";
      return `/admin/entries/${a}?c=${c}${locale}`;
    }
    case "l": return typeof a === "string" && ID.test(a) ? `/admin/entries?c=${a}` : null;
    case "i": return typeof a === "string" && ID.test(a) ? `/admin/instances/${a}` : null;
    case "n": return "/admin/navigation";
    case "r": return "/admin/redirects";
    case "x": return "/admin/social";
    case "s": return a === "appearance" ? "/admin/settings#appearance" : "/admin/settings#site";
    default: return null;
  }
}

/** Les écrans que fixHref peut désigner (modèles de route de app/admin/(panel)), pour le test de cohérence. */
export const FIX_ROUTES = ["entries/[id]", "entries", "instances/[id]", "navigation", "redirects", "social", "settings"] as const;
