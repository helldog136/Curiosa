import { buildPalette, FONT_STACKS } from "@/core/color";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getSiteConfig } from "@/core/settings";

/**
 * IDENTITÉ VISUELLE DU SITE — UNE seule source de vérité.
 *
 * Ce que l'administrateur règle dans Réglages (nom, accroche, présentation, logo, couleurs, police) est lu ici, et nulle
 * part ailleurs, pour deux usages : le rendu réel du site (src/app/(site)/layout.tsx utilise la même palette) et la
 * lecture offerte aux modules (`ctx.api.brand()`), par exemple un kit presse. Un module qui montre l'identité ne la
 * stocke donc jamais : il montre ce que le site utilise vraiment, et reste juste si l'apparence change.
 */
export type BrandColor = { key: string; name: string; hex: string; role: string };

export type Brand = {
  name: string;
  tagline: string;
  about: string;
  logo: string | null;
  contactEmail: string;
  colors: BrandColor[];
  font: { key: keyof typeof FONT_STACKS; name: string; stack: string };
  defaultLocale: string;
  locales: string[];
};

// Ordre d'affichage = ordre d'importance. Clé de la palette (src/core/color.ts) → clé de traduction.
const TOKENS: [paletteVar: string, key: string][] = [
  ["--v-accent", "accent"],
  ["--v-accent-fg", "accentFg"],
  ["--v-bg", "bg"],
  ["--v-surface", "surface"],
  ["--v-fg", "fg"],
  ["--v-muted", "muted"],
  ["--v-line", "line"],
];

const FONT_NAMES: Record<keyof typeof FONT_STACKS, string> = { sans: "Sans-serif", serif: "Serif", mono: "Monospace" };

export async function getBrand(locale?: string): Promise<Brand> {
  const config = await getSiteConfig(locale);
  const t = makeTranslator(locale ?? config.defaultLocale);
  const palette = buildPalette(config.background, config.accent);
  return {
    name: config.name,
    tagline: config.tagline,
    about: config.about,
    logo: config.logo,
    contactEmail: config.contactEmail,
    colors: TOKENS.map(([variable, key]) => ({
      key,
      name: t(`brand.color.${key}`),
      hex: palette[variable]!.toUpperCase(),
      role: t(`brand.role.${key}`),
    })),
    font: { key: config.font, name: FONT_NAMES[config.font], stack: FONT_STACKS[config.font] },
    defaultLocale: config.defaultLocale,
    locales: config.locales,
  };
}
