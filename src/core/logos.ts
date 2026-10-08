import { isHexColor, luminance } from "./color";

/**
 * JEU DE LOGOS d'un site. Une identité visuelle a rarement un seul logo : le propriétaire envoie ce qu'il a, le site fait au mieux avec ce qu'il a reçu.
 *  - `wide`  : logo horizontal, symbole + nom (en-tête du site) ;
 *  - `square`: icône / logo carré, le symbole seul (petite marque, pastille, avatar, repli du favicon) ;
 *  - `wideDark`, `squareDark` : versions pour un fond SOMBRE (logo clair) ; les versions ci-dessus sont celles pour fond clair ;
 *  - `favicon` : icône de l'onglet ; `share` : image affichée quand on partage le site (réseaux sociaux, messageries).
 * Rien n'est obligatoire : chaque rôle a sa chaîne de repli (voir `pickLogo`), jamais un logo horizontal étiré dans un carré.
 */
export type LogoSet = { wide: string | null; square: string | null; wideDark: string | null; squareDark: string | null; favicon: string | null; share: string | null };
export type LogoRole = "wide" | "icon" | "favicon" | "share" | "any";

export const LOGO_KEYS = { square: "site.logo", wide: "site.logoWide", squareDark: "site.logoDark", wideDark: "site.logoWideDark", favicon: "site.favicon", share: "site.share" } as const;
export const EMPTY_LOGOS: LogoSet = { wide: null, square: null, wideDark: null, squareDark: null, favicon: null, share: null };

/** Le fond du site est-il sombre ? (même seuil que le thème du site). */
export const isDarkBackground = (background: unknown): boolean => isHexColor(background) && luminance(background) <= 0.4;

/** Une image de logo valable : un fichier envoyé sur le site, ou une adresse https. */
export const isLogoUrl = (v: unknown): v is string => typeof v === "string" && (/^\/uploads\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif)$/.test(v) || /^https:\/\/[^\s"'()<>\\]+$/.test(v));

/** `a` d'abord ; sinon l'autre version (mieux qu'aucun logo). */
const either = (a: string | null, b: string | null) => a || b || null;

export function pickLogo(set: LogoSet, role: LogoRole, darkBackground: boolean): string | null {
  const wide = darkBackground ? either(set.wideDark, set.wide) : either(set.wide, set.wideDark);
  const icon = darkBackground ? either(set.squareDark, set.square) : either(set.square, set.squareDark);
  switch (role) {
    case "wide": return wide;
    case "icon": return icon;
    // L'onglet du navigateur : l'icône carrée (version pour fond clair d'abord : les onglets sont le plus souvent clairs), jamais le logo horizontal.
    case "favicon": return set.favicon || either(set.square, set.squareDark);
    // Partage : l'image prévue pour ça, sinon le symbole, sinon le logo horizontal.
    case "share": return set.share || either(icon, wide);
    // Un seul visuel de marque (avatar d'un bandeau, données structurées, kit presse) : le symbole, sinon le logo horizontal.
    default: return either(icon, wide);
  }
}

/** Les logos distincts du jeu, avec leur rôle, pour un kit presse. */
export function listLogos(set: LogoSet): { kind: keyof LogoSet; src: string }[] {
  return (["wide", "square", "wideDark", "squareDark"] as const).flatMap((kind) => (set[kind] ? [{ kind, src: set[kind]! }] : []));
}
