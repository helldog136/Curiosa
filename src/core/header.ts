/**
 * MISE EN PAGE DE L'EN-TÊTE, au choix du propriétaire (Réglages → Apparence). Quatre dispositions, toutes alimentées par les mêmes données
 * (logo, menu et groupes de menu, langues, icônes des réseaux sociaux, lien secondaire, bouton) :
 *  - `classic`  : logo à gauche, menu et langues à droite ;
 *  - `twoRows`  : en haut le logo et, à droite, lien secondaire, réseaux et bouton ; dessous le menu et les langues ;
 *  - `centered` : logo centré, menu centré dessous ;
 *  - `minimal`  : logo et un bouton « menu » qui ouvre tout (sobre, aussi sur grand écran).
 */
export const HEADER_LAYOUTS = ["classic", "twoRows", "centered", "minimal"] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];
export const isHeaderLayout = (v: unknown): v is HeaderLayout => (HEADER_LAYOUTS as readonly string[]).includes(String(v));

export type HeaderLink = { label: string; href: string };
export type HeaderConfig = { layout: HeaderLayout; socials: boolean; secondary: HeaderLink | null; button: HeaderLink | null };
export const DEFAULT_HEADER: HeaderConfig = { layout: "classic", socials: true, secondary: null, button: null };

/** Un lien d'en-tête n'existe que s'il a un libellé ET une adresse valable (page du site, https ou mailto). */
export function headerLink(label: unknown, href: unknown): HeaderLink | null {
  const l = typeof label === "string" ? label.trim().slice(0, 60) : "";
  const h = typeof href === "string" ? href.trim() : "";
  return l && /^(\/(?!\/)|https?:\/\/|mailto:)/.test(h) ? { label: l, href: h } : null;
}
