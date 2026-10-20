// Module de test : chaque forme d'adminAction, et ctx.can lu partout où un module s'exécute.
export default {
  adminPanel: (ctx) => [{ type: "text", text: `panel:${ctx.can?.("notes.view")}` }],
  adminActions: {
    legacy: async () => ({ ok: "legacy" }),
    guarded: { right: "notes.view", run: async (ctx) => ({ ok: `guarded:${ctx.can("phone.edit")}` }) },
    prefixed: { right: "demo-guarded:notes.view", run: async () => ({ ok: "prefixed" }) },
    sensitive: { right: "phone.edit", run: async () => ({ ok: "sensitive" }) },
    foreign: { right: "demo-other:secret.view", run: async () => ({ ok: "foreign" }) },
    bogus: { right: "Not A Right", run: async () => ({ ok: "bogus" }) },
  },
  routes: { probe: async (_request, ctx) => new Response(`route:${ctx.can?.("notes.view")}`) },
  mcp: { probe: async (ctx) => ({ can: ctx.can?.("notes.view") ?? null }) },
  tasks: { probe: { everyMinutes: 1, run: async (ctx) => { globalThis.curiosaTaskCan = ctx.can?.("notes.view"); } } },
};
