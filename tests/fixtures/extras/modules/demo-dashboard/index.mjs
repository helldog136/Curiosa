// Module de test : propose des tâches, une action rapide et deux cartes au tableau de bord (la seconde échoue : elle doit disparaître seule).
export default {
  dashboard: {
    tasks: { pending: async (ctx) => Number(ctx.setting("pending") ?? 0) },
    cards: {
      count: async (ctx) => ({ value: Number(ctx.setting("pending") ?? 0) + 4, detail: ctx.instance.name }),
      boom: async () => { throw new Error("panne volontaire"); },
    },
  },
};
