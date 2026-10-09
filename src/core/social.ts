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
];
export const MAX_SOCIALS = 10;

export type SocialLink = { label: string; href: string; icon: string | null; instance: string; module: string };

/** Les boutons de tous les réseaux actifs, dans l'ordre des instances ; adresses externes sûres seulement, sans doublon. */
export async function loadSocialLinks(locale: string, max = MAX_SOCIALS): Promise<SocialLink[]> {
  const out: SocialLink[] = [];
  const seen = new Set<string>();
  for (const item of await collectForCore(SOCIAL_TOPIC, SOCIAL_SCHEMA, { locale, limit: 200 })) {
    const href = String(item.url);
    if (!isSafeExternalUrl(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ label: String(item.label), href, icon: typeof item.icon === "string" ? item.icon : null, instance: item.source.instance, module: item.source.module });
    if (out.length >= max) break;
  }
  return out;
}
