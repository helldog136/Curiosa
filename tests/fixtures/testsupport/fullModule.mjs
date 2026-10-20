// Un module fictif COMPLET et conforme (routes, stockage, tâche, MCP, migration, vie privée…), généré en mémoire, qui sert de base aux tests du kit :
// il doit réussir toutes les exigences ; chaque test d'échec en dérive un module fautif en changeant UNE chose.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const manifest = () => ({
  apiVersion: 2,
  id: "full-mod",
  name: { en: "Full module", fr: "Module complet" },
  version: "1.0.0",
  minCore: "0.1.22",
  description: { en: "Collects short messages from visitors and shows them on a page.", fr: "Recueille de courts messages de visiteurs et les affiche sur une page." },
  author: "Test author",
  license: "MIT",
  icon: "🧪",
  main: "index.mjs",
  type: "widget",
  instances: "multiple",
  page: true,
  basePath: "full",
  dataVersion: 2,
  permissions: ["sections", "routes", "storage", "pages", "topics", "mcp", "admin"],
  rights: [{ id: "export", label: { en: "Export the messages", fr: "Exporter les messages" }, help: { en: "Download all messages as a file.", fr: "Télécharger tous les messages dans un fichier." }, sensitive: true, default: { admin: true, editor: false } }],
  privacy: { en: "Your name and message are shown publicly. To have them removed, write to the site's contact.", fr: "Votre nom et votre message sont affichés publiquement. Pour les faire retirer, écrivez au contact du site." },
  provides: [{ topic: "full.item", label: { en: "Messages", fr: "Messages" } }],
  settings: [
    { key: "title", type: "text", default: "Messages", translatable: true, label: { en: "Page title", fr: "Titre de la page" }, help: { en: "Shown at the top of the page.", fr: "Affiché en haut de la page." } },
    { key: "apiKey", type: "secret", optional: true, label: { en: "Access key (optional)", fr: "Clé d'accès (facultatif)" } },
    { key: "site", type: "url", optional: true, label: { en: "Your website (optional)", fr: "Votre site (facultatif)" } },
    { key: "perHour", type: "number", default: 5, advanced: true, label: { en: "Messages per hour", fr: "Messages par heure" } },
  ],
  sections: [{ id: "latest", size: "small", label: { en: "Latest message", fr: "Dernier message" } }],
  mcp: [
    { name: "full_list", readOnly: true, description: "List the latest messages, newest first.", input: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, description: "How many messages at most." } } } },
    { name: "full_remove", destructive: true, default: false, description: "Permanently delete one message.", input: { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 100, description: "Message identifier (from full_list)." } } } },
  ],
});

const INDEX = `
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clean = (v, max) => String(v ?? "").replace(/[\\u0000-\\u001f\\u007f]/g, " ").trim().slice(0, max);
const safeUrl = (v) => (/^https:\\/\\//.test(String(v ?? "")) ? String(v) : null);
const hits = new Map();
const rows = async (ctx) => (await ctx.api.store.list("messages", { limit: 200 })).map((r) => ({ id: r.id, name: String(r.data.name ?? ""), text: String(r.data.text ?? "") }));

export default {
  sections: {
    async latest(ctx) {
      const [last] = await rows(ctx);
      return last ? [{ type: "html", html: "<p><strong>" + esc(last.name) + "</strong> " + esc(last.text) + "</p>" }] : [{ type: "markdown", text: ctx.t("empty") }];
    },
  },
  async page(ctx, { segments }) {
    if (segments.length) return { notFound: true, blocks: [] };
    const site = safeUrl(ctx.setting("site"));
    const list = await rows(ctx);
    return {
      title: ctx.setting("title") || ctx.t("title"),
      blocks: [
        { type: "form", action: ctx.instance.key + "/sign", fields: [{ name: "name", label: ctx.t("name"), required: true }, { name: "text", label: ctx.t("text"), kind: "textarea", required: true }], submitLabel: ctx.t("send"), successText: ctx.t("thanks") },
        { type: "html", html: list.map((r) => "<p>" + esc(r.name) + ": " + esc(r.text) + "</p>").join("") || esc(ctx.t("empty")) },
        ...(site ? [{ type: "links", items: [{ label: ctx.t("site"), href: site }] }] : []),
        { type: "embed", src: "https://example.org/player", title: "Player" },
      ],
    };
  },
  routes: {
    async sign(request, ctx) {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      const ip = request.headers.get("x-forwarded-for") || "local";
      const now = Date.now();
      const recent = (hits.get(ctx.instance.key + ip) ?? []).filter((t) => now - t < 3600000);
      recent.push(now);
      hits.set(ctx.instance.key + ip, recent);
      if (recent.length > Number(ctx.setting("perHour") ?? 5)) return Response.json({ ok: false }, { status: 429 });
      let form;
      try { form = await request.formData(); } catch { return Response.json({ ok: false }, { status: 400 }); }
      const name = clean(form.get("name"), 60);
      const text = clean(form.get("text"), 500);
      if (!name || !text) return Response.json({ ok: false }, { status: 400 });
      if ((await ctx.api.store.count("messages")) >= 1000) return Response.json({ ok: false }, { status: 503 });
      await ctx.api.store.add("messages", { name, text });
      return Response.json({ ok: true });
    },
  },
  exports: {
    "full.item": async (ctx) => (await rows(ctx)).map((r) => ({ title: r.name, summary: r.text })),
  },
  mcp: {
    async full_list(ctx, args) { return (await rows(ctx)).slice(0, Number(args.limit) || 20); },
    async full_remove(ctx, args) { await ctx.api.store.remove(String(args.id)); return { ok: true }; },
  },
  tasks: {
    tick: {
      everyMinutes: 5,
      async run(ctx) {
        const feed = await ctx.api.net.request({ url: "https://example.org/feed" }); // borné, pause après un 429 ; ne lève jamais
        if (!feed.ok) { /* service indisponible : on réessaiera */ }
        const known = (await ctx.api.store.list("state", { limit: 5 }))[0];
        if (known) await ctx.api.store.update(known.id, { at: 1 });
        else await ctx.api.store.add("state", { at: 1 });
      },
    },
  },
  migrations: { 2: async () => {} },
  adminDownloads: {
    messages: {
      right: "export",
      contentType: "text/csv",
      filename: () => "messages",
      async *generate(ctx) {
        yield "name,text\\n";
        let cursor = null;
        do {
          const page = await ctx.api.store.page("messages", { limit: 1000, cursor });
          for (const r of page.items) yield JSON.stringify(String(r.data.name ?? "")) + "," + JSON.stringify(String(r.data.text ?? "")) + "\\n";
          cursor = page.next;
        } while (cursor);
      },
    },
  },
};
`;

export const files = () => ({
  "module.json": JSON.stringify(manifest(), null, 2),
  "index.mjs": INDEX,
  "locales/en.json": JSON.stringify({ title: "Messages", empty: "No message yet.", name: "Your name", text: "Your message", send: "Send", thanks: "Thank you!", site: "Website" }, null, 2),
  "locales/fr.json": JSON.stringify({ title: "Messages", empty: "Aucun message pour l'instant.", name: "Votre nom", text: "Votre message", send: "Envoyer", thanks: "Merci !", site: "Site" }, null, 2),
  "README.md": "# Module complet\n\nRecueille de courts messages de visiteurs et les affiche sur une page. Réglages : le titre de la page, une clé d'accès (facultatif) et l'adresse de votre site (facultatif). Limites : un message de 500 caractères au plus, cinq envois par heure et par visiteur.\n",
});

/** Écrit un module dans un dossier temporaire (nommé comme son id) et renvoie son chemin. `edit(files)` change les fichiers avant l'écriture ; une valeur `null` supprime le fichier. */
export function makeModule(edit, root = fs.mkdtempSync(path.join(os.tmpdir(), "ts-"))) {
  const f = files();
  edit?.(f);
  const dir = path.join(root, "full-mod");
  for (const [rel, content] of Object.entries(f)) {
    if (content === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

/** Supprime un dossier créé par makeModule (le dossier temporaire parent seulement). */
export const dispose = (dir) => fs.rmSync(path.dirname(dir), { recursive: true, force: true });

/** Modifie le manifeste d'un jeu de fichiers : edit(manifestObjet). */
export const editManifest = (f, edit) => { const m = JSON.parse(f["module.json"]); edit(m); f["module.json"] = JSON.stringify(m, null, 2); };
