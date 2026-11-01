import { z } from "zod";

/**
 * ADRESSE COURTE DEMANDÉE PAR UN MODULE (`shortLink` du manifeste, cœur après 0.6.3).
 *
 * Les redirections (« liens courts ») appartiennent au CŒUR : un module ne les écrit pas, il en DEMANDE une, et le cœur la crée, la tient à jour et la retire
 * (voir src/core/managedRedirects.ts). Le module ne déclare que des CLÉS de ses propres réglages ; il n'a aucun code à écrire.
 *
 *   "shortLink": { "enabled": "createShortLink", "name": "shortLinkName", "default": "discord", "target": "social.link" }
 *
 *  - `enabled` : réglage `boolean` qui allume la demande (c'est le consentement de la personne : sans lui, rien n'est créé) ;
 *  - `name` : réglage `text` (facultatif) qui porte le nom de l'adresse ; vide ou absent, c'est `default` ;
 *  - `target` : où mène l'adresse. `"social.link"` = l'adresse du bouton que ce module fournit au cœur (réseau social) ; `{ "setting": "<clé>" }` = un réglage
 *    `url` ou `text` du module qui contient une adresse https.
 * Au plus UNE adresse par instance (la clé est au singulier). Un cœur plus ancien ignore la clé : le module marche, sans adresse courte.
 */
export const SHORT_LINK_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SETTING_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/;

export const shortLinkSchema = z.object({
  enabled: z.string().regex(SETTING_KEY),
  name: z.string().regex(SETTING_KEY).optional(),
  default: z.string().regex(SHORT_LINK_NAME, "default must be a short lowercase name like discord (a-z, 0-9, dashes, 32 characters at most)"),
  target: z.union([z.literal("social.link"), z.object({ setting: z.string().regex(SETTING_KEY) }).strict()]),
}).strict();

export type ShortLinkDecl = z.infer<typeof shortLinkSchema>;

type Field = { key: string; type: string };
/** Les raisons pour lesquelles la déclaration ne tient pas avec les réglages du module (vide = tout va bien). */
export function shortLinkIssues(decl: ShortLinkDecl | undefined, settings: readonly Field[], opts: { provides: readonly string[] }): string[] {
  if (!decl) return [];
  const out: string[] = [];
  const by = new Map(settings.map((f) => [f.key, f]));
  if (by.get(decl.enabled)?.type !== "boolean") out.push(`shortLink.enabled "${decl.enabled}" must be a boolean setting of the module`);
  if (decl.name !== undefined && by.get(decl.name)?.type !== "text") out.push(`shortLink.name "${decl.name}" must be a text setting of the module`);
  if (decl.name === decl.enabled) out.push("shortLink.name and shortLink.enabled must be two different settings");
  if (decl.target === "social.link") {
    if (!opts.provides.includes("social.link")) out.push("shortLink.target \"social.link\" needs the module to provide the topic social.link");
  } else {
    const t = by.get(decl.target.setting)?.type;
    if (t !== "url" && t !== "text" && t !== "link") out.push(`shortLink.target.setting "${decl.target.setting}" must be a url or text setting of the module`);
  }
  return out;
}
