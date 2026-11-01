// Réseaux sociaux de démonstration (le vrai code les demande aux modules installés). Aucun nom de site ni de réseau réel : des liens d'exemple.
export const SOCIAL_TOPIC = "social.link";
export const SOCIAL_SCHEMA = [];
export const MAX_SOCIALS = 10;
export const SOCIAL_REL_TOKENS = ["noopener", "noreferrer", "nofollow", "sponsored", "ugc"];
export const SOCIAL_REFERRER_POLICIES = [];
export const SOCIAL_TARGETS = ["_blank", "_self"];
export const cleanSocialRel = () => null;
export const cleanSocialReferrerPolicy = () => null;
export const cleanSocialTarget = () => null;
export async function loadSocialLinks() {
  return [
    { label: "Exemple A", href: "https://example.org/a", icon: "★", instance: "a", module: "demo", rel: "noopener noreferrer", referrerPolicy: null, target: "_blank" },
    { label: "Exemple B", href: "https://example.org/b", icon: "✉", instance: "b", module: "demo", rel: "noopener noreferrer", referrerPolicy: null, target: "_blank" },
  ];
}
