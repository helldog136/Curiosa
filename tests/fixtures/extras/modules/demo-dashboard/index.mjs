// Module de test : propose des tâches, une action rapide et deux cartes au tableau de bord (la seconde échoue : elle doit disparaître seule).
export default {
  dashboard: {
    tasks: { pending: async (ctx) => { if (ctx.setting("pending") === 99) await new Promise((r) => setTimeout(r, 4000)); return Number(ctx.setting("pending") ?? 0); } }, // 99 : réponse trop lente (essais à l'écran)
    cards: {
      count: async (ctx) => ({ value: Number(ctx.setting("pending") ?? 0) + 4, detail: ctx.instance.name }),
      boom: async () => { throw new Error("panne volontaire"); },
    },
  },
};
