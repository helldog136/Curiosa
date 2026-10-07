import type { Feature } from "./collections";

/**
 * Modèles de collections proposés à l'onboarding et dans l'admin. Ce ne sont
 * que des configurations : un "blog", une liste de codes promo et une liste de
 * réseaux sociaux sont le même objet, réglé différemment.
 */
export type CollectionPreset = {
  id: string;
  key: string;
  basePath: string;
  display: "cards" | "list" | "links" | "codes";
  clickAction: "detail" | "external";
  features: Feature[];
  showInNav: boolean;
  allowGoLinks: boolean;
  names: Record<string, string>;
  descriptions: Record<string, string>;
};

export const PRESETS: CollectionPreset[] = [
  {
    id: "blog",
    key: "blog",
    basePath: "blog",
    display: "cards",
    clickAction: "detail",
    features: ["cover", "summary", "body", "featured"],
    showInNav: true,
    allowGoLinks: false,
    names: { fr: "Blog", en: "Blog" },
    descriptions: { fr: "Actualités et articles.", en: "News and articles." },
  },
  {
    id: "codes",
    key: "codes",
    basePath: "codes",
    display: "codes",
    clickAction: "external",
    features: ["icon", "cover", "summary", "body", "url", "code", "expiresAt"],
    showInNav: true,
    allowGoLinks: true,
    names: { fr: "Codes promo", en: "Promo codes" },
    descriptions: { fr: "Mes partenaires et leurs offres.", en: "My partners and their offers." },
  },
  {
    id: "links",
    key: "links",
    basePath: "links",
    display: "links",
    clickAction: "external",
    features: ["icon", "summary", "url"],
    showInNav: false,
    allowGoLinks: true,
    names: { fr: "Réseaux", en: "Social links" },
    descriptions: { fr: "Où me retrouver.", en: "Where to find me." },
  },
  {
    id: "pages",
    key: "pages",
    basePath: "",
    display: "list",
    clickAction: "detail",
    features: ["cover", "summary", "body"],
    showInNav: false,
    allowGoLinks: false,
    names: { fr: "Pages", en: "Pages" },
    descriptions: { fr: "Pages libres (à propos, collaborer…).", en: "Free-form pages (about, work with me…)." },
  },
];

export function getPreset(id: string): CollectionPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

export function presetName(p: { names: Record<string, string> }, locale: string): string {
  return p.names[locale] ?? p.names.en ?? Object.values(p.names)[0] ?? "";
}
