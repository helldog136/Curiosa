import type { ParsedManifest } from "@/core/modules/manifest";
import { defineModule } from "@/core/modules/types";
import type { BuiltinModule } from "..";

export const manifest: ParsedManifest = {
  apiVersion: 2,
  id: "hero",
  name: { en: "Home banner", fr: "Bandeau d'accueil" },
  version: "1.0.0",
  description: { en: "Big title and intro for the top of the home page. Place its section where you want it.", fr: "Grand titre et introduction pour le haut de l'accueil. Placez sa section où vous voulez." },
  author: "Vitrine",
  license: "MIT",
  icon: "🏁",
  starter: true,
  instances: "multiple",
  sections: [{ id: "hero", label: { en: "Banner", fr: "Bandeau" } }],
  permissions: ["sections"],
  settings: [
    { key: "title", type: "text", translatable: true, label: { en: "Title", fr: "Titre" }, help: { en: "Empty = the site name.", fr: "Vide = le nom du site." } },
    { key: "text", type: "textarea", translatable: true, label: { en: "Intro", fr: "Introduction" }, help: { en: "Empty = the site tagline.", fr: "Vide = l'accroche du site." } },
    { key: "showLogo", type: "boolean", default: true, label: { en: "Show the logo", fr: "Afficher le logo" } },
  ],
};

export const locales: BuiltinModule["locales"] = {};

export const definition = defineModule({
  sections: {
    async hero(ctx) {
      const site = await ctx.api.site(ctx.locale);
      return [
        {
          type: "hero",
          title: ctx.setting("title") || site.name,
          text: ctx.setting("text") || site.tagline || undefined,
          image: ctx.setting<boolean>("showLogo") && site.logo ? site.logo : undefined,
        },
      ];
    },
  },
});
