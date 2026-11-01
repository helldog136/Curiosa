/**
 * LE BLOC `social` D'UN MANIFESTE (cœur 0.7.0) : sa forme et sa validation. Les données viennent d'un manifeste ou d'un index lu sur le réseau : tailles bornées,
 * expressions régulières refusées si elles risquent un calcul sans fin. Séparé de `socialRecognize.ts` pour que le navigateur n'embarque pas la validation.
 */
import { z } from "zod";

const SAFE_RE_MAX = 200;
/** Une expression régulière venue d'un fichier : courte, compilable, sans quantificateur imbriqué (« (a+)+ »). */
const regexText = z.string().min(1).max(SAFE_RE_MAX).refine((s) => {
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(s) || /\\[1-9]/.test(s)) return false;
  try { new RegExp(s); return true; } catch { return false; }
}, "invalid or unsafe regular expression");
const host = z.string().min(3).max(100).regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
const localizedExample = z.union([z.string().min(1).max(200), z.record(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2,4})?$/), z.string().min(1).max(200))]);

export const socialSpecSchema = z.object({
  /** Texte du bouton (« Instagram »). */
  name: z.string().min(1).max(60),
  /** Identifiant d'icône (« instagram »). */
  icon: z.string().min(1).max(40).optional(),
  /** Sites acceptés, sous-domaines compris ; `null` : n'importe quel serveur, mais une forme de profil est exigée (réseaux fédérés comme Mastodon). */
  hosts: z.array(host).max(10).nullable(),
  /** Adresse d'un compte, `{h}` = son nom ; `null` : l'adresse complète est obligatoire. */
  template: z.string().max(200).regex(/^https:\/\//).nullable(),
  /** Un exemple d'adresse (texte, ou un texte par langue). */
  example: localizedExample.optional(),
  /** Forme d'un nom de compte saisi seul. */
  handle: regexText.optional(),
  /** Texte devant le nom de compte dans le bouton (« u/ »). */
  tag: z.string().max(10).optional(),
  /** [adresse courte, vrai site] : « fb.me » devient « www.facebook.com ». */
  aliases: z.array(z.tuple([host, host])).max(10).optional(),
  /** [forme courte (expression), adresse complète avec {1}] : « r/communaute » devient une adresse. */
  forms: z.array(z.tuple([regexText, z.string().max(200).regex(/^https:\/\//)])).max(10).optional(),
  /** Façons dont une adresse désigne un compte. */
  shapes: z.array(z.object({
    re: regexText, host: regexText.optional(), fromHost: z.boolean().optional(), handle: z.boolean().optional(),
    prefix: z.string().max(10).optional(), withHost: z.boolean().optional(), template: z.string().max(200).regex(/^https:\/\//).optional(),
  })).max(10).optional(),
  /** Accepte `@nom@serveur`. */
  fediverse: z.boolean().optional(),
});
export type SocialSpec = z.infer<typeof socialSpecSchema>;

/** Valide un bloc `social` venu d'un manifeste ou d'un index : le bloc valide, ou `undefined` (un bloc abîmé est ignoré, jamais une erreur). */
export function parseSocialSpec(raw: unknown): SocialSpec | undefined {
  const r = socialSpecSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

