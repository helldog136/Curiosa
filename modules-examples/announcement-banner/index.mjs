// Module d'exemple. Un module est un simple module ES : pas d'installation de
// dépendances, pas de build. Il exporte par défaut un objet qui déclare ce
// qu'il apporte au site (voir docs/MODULES.md).
//
// @type {import("../../src/core/modules/types").ModuleDefinition}
export default {
  slots: {
    // Bannière tout en haut de chaque page.
    "layout.banner": (ctx) => {
      if (!ctx.setting("enabled")) return null;
      const text = ctx.setting("text"); // déjà résolu pour la langue du visiteur
      if (!text) return null;
      return [{ type: "banner", text, href: ctx.setting("link") || undefined, tone: ctx.setting("tone") }];
    },

    // Petit bloc en haut de la page d'accueil.
    "home.top": (ctx) => {
      const note = ctx.setting("homeText");
      return note ? [{ type: "markdown", text: note }] : null;
    },
  },
};
