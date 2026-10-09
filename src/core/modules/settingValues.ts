import type { SettingField } from "./types";

/**
 * Valeurs de réglages : fonctions pures (aucune base de données), partagées par l'admin, le serveur et `ctx.setting()`.
 */

/** Motif HTML (`pattern`) d'un lien : une page du site (/contact), une adresse https:// ou une adresse mailto:. */
export const LINK_PATTERN = String.raw`(\/|\/[^\/\s][^\s]*|https:\/\/[^\s\/][^\s]*|mailto:[^\s@]+@[^\s@]+\.[^\s@]+)`;
const LINK_RE = new RegExp(`^${LINK_PATTERN}$`);

/** Un lien de réglage valide ? (valeur déjà « trimée ») */
export function isValidLink(raw: string): boolean {
  return raw.length <= 2000 && LINK_RE.test(raw);
}

/** Référence au site dans un défaut : `"site:name"` ou `"site:tagline"`. */
export const SITE_DEFAULTS = ["name", "tagline"] as const;
export type SiteDefault = (typeof SITE_DEFAULTS)[number];

export function siteDefaultRef(def: unknown): SiteDefault | null {
  if (typeof def !== "string" || !def.startsWith("site:")) return null;
  const ref = def.slice(5);
  return (SITE_DEFAULTS as readonly string[]).includes(ref) ? (ref as SiteDefault) : null;
}

/** Défaut d'un réglage une fois les références au site résolues (`site` : nom et accroche du site DANS LA LANGUE du champ). */
export function resolveDefault(field: Pick<SettingField, "default">, site: { name: string; tagline: string }): string | number | boolean | undefined {
  const ref = siteDefaultRef(field.default);
  return ref ? site[ref] : field.default;
}

/** Le réglage a-t-il un défaut qui suit le site ? */
export const followsSite = (field: Pick<SettingField, "default">): boolean => siteDefaultRef(field.default) !== null;

/**
 * Faut-il enregistrer la valeur saisie ? Non si elle est vide, ou si elle est identique au défaut qui suit le site :
 * le champ continue alors de suivre le site quand celui-ci change.
 */
export function shouldStore(field: Pick<SettingField, "default">, raw: string, resolved: string | number | boolean | undefined): boolean {
  if (raw === "") return false;
  return !(followsSite(field) && raw === String(resolved ?? ""));
}
