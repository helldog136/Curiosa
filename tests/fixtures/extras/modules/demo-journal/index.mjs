// Module de test : écrit au journal central depuis une action d'administration, une action MCP, une route et une tâche.
export default {
  adminActions: {
    ping: async (ctx) => { await ctx.api.log.write({ action: "thing.done", target: "ping", data: { name: "Alice", count: 3, urgent: true, extra: "écarté" } }); return { ok: "ping" }; },
  },
  routes: { hit: async (_request, ctx) => { const ok = await ctx.api.log.write({ action: "hit", data: { name: "Bob" } }); return new Response(String(ok)); } },
  mcp: { noisy: async (ctx) => ({ ok: await ctx.api.log.write({ action: "thing.done", data: { name: "Robot", count: 1 } }) }) },
  tasks: { tick: { everyMinutes: 1, run: async (ctx) => { await ctx.api.log.write({ action: "thing.failed", data: { name: "Tâche" } }); } } },
};
