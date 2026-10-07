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
