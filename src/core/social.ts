import type { TopicField } from "@/core/modules/types";
import { collectForCore } from "@/core/services/topics";
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

/** Les boutons de tous les réseaux actifs, dans l'ordre des instances ; adresses externes sûres seulement, sans doublon. */
export async function loadSocialLinks(locale: string, max = MAX_SOCIALS): Promise<SocialLink[]> {
  const out: SocialLink[] = [];
  const seen = new Set<string>();
  for (const item of await collectForCore(SOCIAL_TOPIC, SOCIAL_SCHEMA, { locale, limit: 200 })) {
    const href = String(item.url);
    if (!isSafeExternalUrl(href) || seen.has(href)) continue;
    seen.add(href);
    const referrerPolicy = cleanSocialReferrerPolicy(item.referrerPolicy);
    // Sans `rel` valable : `noopener noreferrer`. Une politique de référent choisie sans `rel` remplace `noreferrer` (qui l'annulerait).
    const rel = cleanSocialRel(item.rel) ?? (referrerPolicy ? "noopener" : "noopener noreferrer");
    out.push({
      label: String(item.label), href, icon: typeof item.icon === "string" ? item.icon : null, instance: item.source.instance, module: item.source.module,
      rel, referrerPolicy, target: cleanSocialTarget(item.target) ?? "_blank",
    });
    if (out.length >= max) break;
  }
  return out;
}
