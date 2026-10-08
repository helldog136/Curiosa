import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule, type Block } from "@/core/modules/types";
import type { BuiltinModule } from "..";

/**
 * KIT PRESSE — une vitrine, rien d'autre.
 *
 * Ce module ne stocke AUCUNE donnée. Tout ce qu'il montre (nom, accroche, présentation, logo, couleurs,
 * police, email de contact) est réglé dans l'admin du cœur (Réglages → Identité et Apparence) et lu via
 * `ctx.api.brand()`. Changer le thème du site change donc le kit presse, sans rien refaire ici, et le kit
 * montre toujours ce que le site utilise vraiment.
 */
export const manifest: ParsedManifest = {
  apiVersion: 2,
  id: "press-kit",
  name: { en: "Press kit", fr: "Kit presse" },
  version: "1.0.0",
  description: {
    en: "A public page presenting your identity to press and partners: presentation, logo, colors, font, contact. It only displays what you set in Settings — nothing to maintain here.",
    fr: "Une page publique qui présente votre identité à la presse et aux partenaires : présentation, logo, couleurs, police, contact. Elle n'affiche que ce que vous réglez dans Réglages — rien à entretenir ici.",
  },
  author: "Helldog136",
  license: "Curiosa License 1.0",
  icon: "📰",
  type: "widget",
  instances: "single",
  page: true,
  basePath: "press-kit",
  consumes: [],
  provides: [],
  sections: [],
  permissions: ["pages"],
  settings: [
    { key: "showTypography", type: "boolean", default: true, advanced: true, label: { en: "Show the font", fr: "Afficher la police" } },
    { key: "showContact", type: "boolean", default: true, advanced: true, label: { en: "Show the contact email", fr: "Afficher l'email de contact" } },
  ],
};

export const locales: BuiltinModule["locales"] = {
  en: { title: "Press kit", intro: "Everything you need to talk about {name}: who we are, our logo, colors and font. Feel free to use them to present us.", about: "About", short: "Short description (copy)", long: "Long description (copy)", visuals: "Logo", logo: "Logo", colors: "Colors", colorsHelp: "Click a code to copy it.", typography: "Typography", contact: "Contact", languages: "Available in" },
  fr: { title: "Kit presse", intro: "Tout ce qu'il faut pour parler de {name} : qui nous sommes, notre logo, nos couleurs et notre police. Utilisez-les librement pour nous présenter.", about: "Qui sommes-nous", short: "Description courte (à copier)", long: "Description longue (à copier)", visuals: "Logo", logo: "Logo", colors: "Couleurs", colorsHelp: "Cliquez sur un code pour le copier.", typography: "Typographie", contact: "Contact", languages: "Disponible en" },
};

/** Texte brut d'un Markdown simple, pour les descriptions à copier. */
const plain = (md: string) => md.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();

export const definition = defineModule({
  async page(ctx) {
    const t = ctx.t;
    const brand = await ctx.api.brand(ctx.locale);
    const blocks: Block[] = [{ type: "markdown", text: t("intro", { name: brand.name }) }];

    if (brand.about) blocks.push({ type: "heading", text: t("about") }, { type: "markdown", text: brand.about });

    const copies: Block[] = [];
    if (brand.tagline) copies.push({ type: "copy", label: t("short"), text: brand.tagline });
    if (brand.about) copies.push({ type: "copy", label: t("long"), text: plain(brand.about) });
    blocks.push(...copies);

    if (brand.logo) blocks.push({ type: "heading", text: t("visuals") }, { type: "downloads", items: [{ src: brand.logo, label: t("logo") }] });

    blocks.push(
      { type: "heading", text: t("colors") },
      { type: "markdown", text: `*${t("colorsHelp")}*` },
      { type: "swatches", items: brand.colors.map((c) => ({ name: c.name, hex: c.hex, role: c.role })) },
    );

    if (ctx.setting<boolean>("showTypography") !== false) {
      blocks.push({ type: "heading", text: t("typography") }, { type: "markdown", text: `**${brand.font.name}** — \`${brand.font.stack}\`` });
    }
    if (ctx.setting<boolean>("showContact") !== false && brand.contactEmail) {
      blocks.push({ type: "heading", text: t("contact") }, { type: "markdown", text: `[${brand.contactEmail}](mailto:${brand.contactEmail})` });
    }
    return { title: t("title"), description: brand.tagline || undefined, blocks };
  },
});
