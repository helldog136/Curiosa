import { z } from "zod";

/**
 * ADRESSES QUE LE SITE DONNE À UN SERVICE TIERS (cœur après 0.6.1) : ce que la page « Adresse du site » de l'administration a besoin de savoir pour préparer un changement de domaine.
 * Deux clés du manifeste, toutes deux FACULTATIVES et sans danger pour un cœur plus ancien (il les ignore : aucun `minCore` à déclarer) :
 *
 *   "returnAddresses": [{ "path": "/m/{instance}/oauth/callback", "label": { "fr": "Twitch", "en": "Twitch" }, "where": { "fr": "Console des développeurs Twitch, « URL de redirection OAuth »", "en": "…" } }]
 *     Une ADRESSE DE RETOUR (OAuth…) que la personne a enregistrée chez le service tiers. `path` commence par `/m/` ou `/api/` ; `{instance}` est remplacé par la clé de l'instance.
 *     Le cœur affiche l'ancienne et la nouvelle adresse complètes, à copier. `label` : le nom du service. `where` : où l'enregistrer chez lui (une phrase).
 *
 *   "siteAddressUses": [{ "label": { "fr": "Home Assistant", "en": "Home Assistant" }, "where": { "fr": "Dans Home Assistant : Appareils et services, Curiosa, Reconfigurer", "en": "…" } }]
 *     Un endroit HORS DU SITE où la personne a tapé l'adresse du site (une intégration, un script, une application) et qu'il faut mettre à jour à la main.
 *
 * Le cœur ne contacte jamais le service tiers et ne modifie rien : il LISTE (pour les instances actives du module) et laisse la personne faire.
 */
const localized = z.union([z.string().min(1).max(300), z.record(z.string(), z.string().max(300))]);

/** Chemin d'une adresse de retour : `/m/…` ou `/api/…`, lettres, chiffres, `-`, `_`, `.`, `/` et `{instance}`. Ni paramètre, ni `..`, ni `//`. */
export const RETURN_PATH_RE = /^\/(?:m|api)\/[A-Za-z0-9_./{}-]{1,160}$/;

export const returnAddressSchema = z.object({
  path: z.string().regex(RETURN_PATH_RE, "path must start with /m/ or /api/ (letters, digits, - _ . / and {instance} only)"),
  label: localized,
  where: localized.optional(),
}).strict();

export const siteAddressUseSchema = z.object({
  label: localized,
  where: localized,
}).strict();

export type ReturnAddressDecl = z.infer<typeof returnAddressSchema>;
export type SiteAddressUseDecl = z.infer<typeof siteAddressUseSchema>;

export const MAX_ADDRESS_DECLS = 5;

/** Les raisons pour lesquelles une adresse de retour est inutilisable (vide = tout va bien). */
export function returnAddressIssues(list: readonly ReturnAddressDecl[] | undefined): string[] {
  const out: string[] = [];
  for (const [i, a] of (list ?? []).entries()) {
    if (a.path.includes("..") || a.path.includes("//")) out.push(`returnAddresses[${i}].path must not contain ".." or "//"`);
    const holes = a.path.match(/\{[^}]*\}/g) ?? [];
    if (holes.some((h) => h !== "{instance}")) out.push(`returnAddresses[${i}].path: the only placeholder is {instance}`);
  }
  if (new Set((list ?? []).map((a) => a.path)).size < (list ?? []).length) out.push("returnAddresses: duplicate path");
  return out;
}

/** L'adresse complète d'une adresse de retour pour une instance : `base` est l'adresse du site (sans « / » final). */
export function returnAddressUrl(base: string, path: string, instanceKey: string): string {
  return `${base.replace(/\/+$/, "")}${path.replace(/\{instance\}/g, instanceKey)}`;
}
