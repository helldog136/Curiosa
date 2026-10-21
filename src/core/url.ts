/** Schémas autorisés pour tout lien sortant saisi dans l'admin ou venant d'un module. */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isSafeExternalUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return SAFE_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Lien affichable : externe valide, ou chemin interne ("/page"). Sinon "#". */
export function safeHref(value: string | null | undefined): string {
  if (!value) return "#";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return isSafeExternalUrl(value) ? value : "#";
}

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

const DOMAIN_LIKE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const EMAIL_LIKE = /^[^\s@/:]+@[^\s@/:]+\.[a-z]{2,}$/i;

/**
 * Comprend une adresse saisie à la main AVANT de la valider : espaces autour retirés, `www.monsite.be/contact` et `monsite.be/contact` deviennent
 * `https://…`, une adresse e-mail devient `mailto:…`, `/contact` (page du site) et toute adresse complète sont gardées telles quelles.
 * Ce qui reste incompréhensible est rendu inchangé : c'est alors à la validation de refuser, avec un exemple.
 */
export function normalizeLinkInput(raw: string | null | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("//")) return DOMAIN_LIKE.test(v.slice(2)) ? `https://${v.slice(2)}` : v;
  if (v.startsWith("/")) return v;
  if (DOMAIN_LIKE.test(v)) return `https://${v}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (EMAIL_LIKE.test(v)) return `mailto:${v}`;
  return v;
}
