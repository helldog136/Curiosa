// Test fixture: a chat bot that places its commands, timers and rewards in Live (core 0.31.0). Invented names only.
const T = (ctx, en, fr) => (String(ctx.locale ?? "en").startsWith("fr") ? fr : en);

export default {
  async adminPanel(ctx) {
    const commands = await ctx.api.store.list("commands");
    const timers = await ctx.api.store.list("timers");
    return [
      { type: "table", tab: "commands", searchable: true, columns: [T(ctx, "Command", "Commande"), T(ctx, "Reply", "Réponse")], empty: T(ctx, "No command yet.", "Aucune commande."),
        rowIds: commands.map((r) => r.id), rows: commands.map((r) => [r.data.name, r.data.reply ?? ""]) },
      { type: "table", tab: "timers", searchable: true, columns: [T(ctx, "Message", "Message"), T(ctx, "Every", "Toutes les")], empty: T(ctx, "No timer yet.", "Aucun timer."),
        rowIds: timers.map((r) => r.id), rows: timers.map((r) => [r.data.text, `${r.data.minutes ?? 15} min`]) },
    ];
  },
};
