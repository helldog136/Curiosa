// Module modèle : la plus petite chose complète qui passe toute la suite de conformité. Copiez ce dossier et changez-le pas à pas.
// Règles du jeu : aucun import du cœur (tout passe par `ctx`), tout texte venu d'ailleurs est échappé avant d'entrer dans du HTML.

/** Échappe le texte avant de le mettre dans du HTML (le bloc `html` est brut). */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const definition = {
  sections: {
    // Une section de la page d'accueil (permission « sections » + déclarée dans module.json).
    welcome(ctx) {
      const signature = String(ctx.setting("signature") ?? "").trim();
      return [{ type: "html", html: `<p>${esc(ctx.setting("message") || ctx.t("fallback"))}</p>${signature ? `<p><em>${esc(signature)}</em></p>` : ""}` }];
    },
  },
  // Une action pour les assistants IA (permission « mcp »), en lecture seule.
  mcp: {
    my_module_message: (ctx) => ({ message: ctx.setting("message") || ctx.t("fallback") }),
  },
};

export default definition;
