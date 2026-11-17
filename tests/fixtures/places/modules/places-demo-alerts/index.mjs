// Test fixture: an alerts module that places its settings and lists in Live › Alerts and Live › Rewards (core 0.31.0). Invented names only.
// `?fail=1` makes its journal section throw and `?slow=1` makes it hang: the place page must show "Section unavailable" and stay usable.
const T = (ctx, en, fr) => (String(ctx.locale ?? "en").startsWith("fr") ? fr : en);

export default {
  async adminPanel(ctx) {
    const rows = await ctx.api.store.list("rewards");
    return [
      { type: "table", tab: "rewards", searchable: true, columns: [T(ctx, "Reward", "Récompense"), T(ctx, "Reaction", "Réaction")],
        empty: T(ctx, "No reward yet. Create one on Twitch, it shows here.", "Aucune récompense. Créez-en une sur Twitch, elle s'affiche ici."),
        rowIds: rows.map((r) => r.id), rows: rows.map((r) => [r.data.name, r.data.reaction ?? ""]) },
    ];
  },
  placeSections: {
    journal: {
      async render(ctx, { query }) {
        if (query.fail === "1") throw new Error("demo failure");
        if (query.slow === "1") await new Promise((r) => setTimeout(r, 5000));
        return [{ type: "table", columns: [T(ctx, "When", "Quand"), T(ctx, "Event", "Événement")], rows: [["18:02", T(ctx, "Follow from etoile_nord", "Suivi de etoile_nord")], ["18:05", T(ctx, "Raid from lune_douce", "Raid de lune_douce")]] }];
      },
    },
  },
};
