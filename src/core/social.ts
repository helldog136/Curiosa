import type { TopicField } from "@/core/modules/types";
import { collectForCore } from "@/core/services/topics";
import { getSetting } from "@/core/settings";
import { isSafeExternalUrl } from "@/core/url";

/**
 * RÉSEAUX SOCIAUX — une fonctionnalité du cœur, pas d'un module.
 *
 * Le cœur ne connaît aucun réseau : il demande à TOUS les modules actifs qui déclarent fournir le sujet `social.link` leur bouton
 * (un nom, une adresse, une icône) et l'affiche. Chaque réseau est donc un module ; on peut en ajouter autant qu'on veut, y compris
 * plusieurs du même réseau (une instance par chaîne ou par compte).
 */
export const SOCIAL_TOPIC = "social.link";
export const SOCIAL_SCHEMA: TopicField[] = [
  { key: "label", type: "string", required: true },
  { key: "url", type: "url", required: true },
  /** Identifiant d'icône (« twitch », « youtube »…) ou emoji. */
  { key: "icon", type: "string" },
  /** Facultatifs, vérifiés par `cleanSocialRel` / `cleanSocialReferrerPolicy` / `cleanSocialTarget` : une valeur invalide est ignorée (défaut sûr), jamais l'élément. */
  { key: "rel", type: "any" },
  { key: "referrerPolicy", type: "any" },
  { key: "target", type: "any" },
];
export const MAX_SOCIALS = 10;

/** Mots de `rel` qu'un module peut demander (liste fermée), dans l'ordre où le cœur les écrit. */
export const SOCIAL_REL_TOKENS = ["noopener", "noreferrer", "nofollow", "sponsored", "ugc"] as const;
/** Politiques de référent acceptées (valeurs standard ; `unsafe-url`, qui transmet l'adresse complète de la page, est volontairement exclue). */
export const SOCIAL_REFERRER_POLICIES = ["no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "same-origin", "strict-origin", "strict-origin-when-cross-origin"] as const;
export type SocialReferrerPolicy = (typeof SOCIAL_REFERRER_POLICIES)[number];
export const SOCIAL_TARGETS = ["_blank", "_self"] as const;
export type SocialTarget = (typeof SOCIAL_TARGETS)[number];

/** `rel` demandé (texte séparé par des espaces, ou liste) → mots autorisés, sans doublon, ordre fixe ; `null` si rien d'utilisable. `noopener` y est toujours. */
export function cleanSocialRel(value: unknown): string | null {
  const raw = typeof value === "string" ? value.slice(0, 200).split(/\s+/) : Array.isArray(value) ? value.slice(0, 20).map((v) => (typeof v === "string" ? v.slice(0, 40) : "")) : [];
  const asked = new Set(raw.map((v) => v.trim().toLowerCase()));
  const kept = SOCIAL_REL_TOKENS.filter((t) => asked.has(t));
  if (kept.length === 0) return null;
  return (kept.includes("noopener") ? kept : ["noopener", ...kept]).join(" ");
}
export function cleanSocialReferrerPolicy(value: unknown): SocialReferrerPolicy | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (SOCIAL_REFERRER_POLICIES as readonly string[]).includes(v) ? (v as SocialReferrerPolicy) : null;
}
export function cleanSocialTarget(value: unknown): SocialTarget | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (SOCIAL_TARGETS as readonly string[]).includes(v) ? (v as SocialTarget) : null;
}

export type SocialLink = {
  label: string; href: string; icon: string | null; instance: string; module: string;
  /** Toujours renseignés : le cœur applique la demande du module si elle est valable, sinon `noopener noreferrer` et `_blank`. */
  rel: string; referrerPolicy: SocialReferrerPolicy | null; target: SocialTarget;
};

/** Réglages du cœur (ajoutés, jamais migrés : sans eux, rien ne change) : les réseaux masqués et l'ordre des boutons, par clé d'instance. */
export const SOCIAL_HIDDEN_KEY = "social.hidden";
export const SOCIAL_ORDER_KEY = "social.order";

const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []);
export async function readSocialPrefs(): Promise<{ hidden: Set<string>; order: string[] }> {
  return { hidden: new Set(keysOf(await getSetting(SOCIAL_HIDDEN_KEY))), order: keysOf(await getSetting(SOCIAL_ORDER_KEY)) };
}

/** Pourquoi un bouton est (ou n'est pas) dans l'en-tête : affiché, masqué par la personne, même adresse qu'un bouton déjà affiché, ou au-delà de la limite. */
export type SocialStatus = "shown" | "hidden" | "duplicate" | "limit";
export type SocialEntry = { link: SocialLink; status: SocialStatus };

/**
 * TOUS les boutons des réseaux actifs avec leur état, dans l'ordre choisi (réglage `social.order`, sinon l'ordre des instances) ; adresses externes sûres seulement.
 * Un bouton masqué ne compte pas dans la limite ni dans les doublons. `max` : nombre de boutons affichés au plus.
 */
export async function loadSocialEntries(locale: string, max = MAX_SOCIALS): Promise<SocialEntry[]> {
  const { hidden, order } = await readSocialPrefs();
  const rank = (instance: string) => { const i = order.indexOf(instance); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const items = (await collectForCore(SOCIAL_TOPIC, SOCIAL_SCHEMA, { locale, limit: 200 })).map((item, index) => ({ item, index })).sort((a, b) => rank(a.item.source.instance) - rank(b.item.source.instance) || a.index - b.index);
  const out: SocialEntry[] = [];
  const seen = new Set<string>();
  let shown = 0;
  for (const { item } of items) {
    const href = String(item.url);
    if (!isSafeExternalUrl(href)) continue;
    const referrerPolicy = cleanSocialReferrerPolicy(item.referrerPolicy);
    // Sans `rel` valable : `noopener noreferrer`. Une politique de référent choisie sans `rel` remplace `noreferrer` (qui l'annulerait).
    const rel = cleanSocialRel(item.rel) ?? (referrerPolicy ? "noopener" : "noopener noreferrer");
    const link: SocialLink = {
      label: String(item.label), href, icon: typeof item.icon === "string" ? item.icon : null, instance: item.source.instance, module: item.source.module,
      rel, referrerPolicy, target: cleanSocialTarget(item.target) ?? "_blank",
    };
    let status: SocialStatus;
    if (hidden.has(link.instance)) status = "hidden";
    else if (seen.has(href)) status = "duplicate";
    else if (shown >= max) status = "limit";
    else { status = "shown"; seen.add(href); shown++; }
    out.push({ link, status });
  }
  return out;
}

/** Les boutons de l'en-tête : les réseaux actifs et affichés, dans l'ordre choisi, sans doublon, `MAX_SOCIALS` au plus. */
export async function loadSocialLinks(locale: string, max = MAX_SOCIALS): Promise<SocialLink[]> {
  return (await loadSocialEntries(locale, max)).filter((e) => e.status === "shown").map((e) => e.link);
}

/** L'ordre complet des réseaux : d'abord ceux de la liste enregistrée (ceux qui n'existent plus sont oubliés), puis les autres dans l'ordre d'arrivée. Pur. */
export function orderedKeys(all: readonly string[], order: readonly string[]): string[] {
  const known = new Set(all);
  const first = [...new Set(order)].filter((k) => known.has(k));
  return [...first, ...all.filter((k) => !first.includes(k))];
}

/** Déplace `key` d'un cran vers le haut ou le bas ; aux extrémités, rien ne change. Pur. */
export function moveKey(keys: readonly string[], key: string, direction: "up" | "down"): string[] {
  const out = [...keys];
  const at = out.indexOf(key);
  const to = direction === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= out.length) return out;
  [out[at], out[to]] = [out[to]!, out[at]!];
  return out;
}

/** D'où vient le bouton : un réseau, une chaîne en direct (Twitch, YouTube) ou une autre page de liens. Sert à la pastille « Origine » du tableau. */
export function socialOrigin(manifest: { id: string; type?: string }): "network" | "channel" | "other" {
  if (manifest.id.endsWith("-channel")) return "channel";
  return manifest.type === "social" ? "network" : "other";
}
