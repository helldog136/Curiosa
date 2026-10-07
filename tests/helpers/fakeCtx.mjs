/**
 * Contexte de module factice, pour tester le code d'un module sans base de données ni serveur.
 *
 *   const ctx = fakeCtx({ settings: { days: 7 }, entries: [...], topics: { "sponsor.card": [...] }, locale: "fr" });
 *   await def.sections.upcoming(ctx, { count: 3 });
 *
 * - `ctx.setting(k)` lit `settings` (valeur absente → undefined, comme le vrai contexte sans défaut)
 * - `ctx.theme` : le thème du site (option `theme`)
 * - `ctx.t(k, vars)` lit `messages` (clé → texte, variables {x} remplacées) ; clé inconnue → la clé
 * - `ctx.api.store` : stockage en mémoire, isolé par appel de fakeCtx (mêmes méthodes que le vrai)
 * - `ctx.api.topics.collect(topic)` renvoie `topics[topic]` ; `ctx.api.entries.list()` renvoie `entries`
 * - `ctx.api.qr(text)` renvoie un SVG factice contenant le texte ; `ctx.api.brand()` / `site()` valeurs réglables
 * - `ctx.api.mail` : `configured` (option `mailConfigured`, défaut true) et `send` qui enregistre dans `ctx.calls.mail` (résultat réglable via `mailResult`)
 * - `ctx.calls` enregistre les appels utiles aux assertions
 */
export function fakeCtx(opts = {}) {
  const {
    moduleId = "fake", key = "fake", name = "Fake", basePath = "fake", locale = "en", defaultLocale = "en", locales = ["en"],
    settings = {}, messages = {}, topics = {}, entries = [], instances = [],
    brand = { name: "Site", tagline: "", about: "", logo: null, contactEmail: "", colors: [], font: { key: "sans", name: "Sans-serif", stack: "sans-serif" }, defaultLocale, locales },
    site = { name: "Site", tagline: "", logo: null }, theme = { accent: "#e8a23b", accentFg: "#111111", bg: "#121214", surface: "#1b1b1d", fg: "#f4f4f5", muted: "#a1a1a3", line: "#2e2e30", fontKey: "sans", font: "sans-serif" }, mailConfigured = true, mailResult = { ok: true }, siteUrl = "https://example.test",
  } = opts;
  const rows = new Map();
  let seq = 0;
  const calls = { topics: [], qr: [], entries: [], mail: [], png: [] };
  const store = {
    async add(collection, data) { const id = `r${++seq}`; rows.set(id, { id, collection, createdAt: new Date(Date.now() + seq), data: structuredClone(data) }); return id; },
    async get(id) { const r = rows.get(id); return r ? { id: r.id, createdAt: r.createdAt, data: structuredClone(r.data) } : null; },
    async update(id, data) { if (!rows.has(id)) return false; rows.get(id).data = structuredClone(data); return true; },
    async list(collection, o) { return [...rows.values()].filter((r) => r.collection === collection).sort((a, b) => b.createdAt - a.createdAt).slice(0, o?.limit ?? 100).map((r) => ({ id: r.id, createdAt: r.createdAt, data: structuredClone(r.data) })); },
    async remove(id) { rows.delete(id); },
    async count(collection) { return [...rows.values()].filter((r) => r.collection === collection).length; },
  };
  return {
    moduleId,
    instance: { id: `id-${key}`, key, basePath, name },
    locale, defaultLocale, locales,
    setting: (k) => settings[k],
    theme,
    t: (k, vars) => { let s = messages[k] ?? k; for (const [n, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${n}}`, String(v)); return s; },
    calls,
    api: {
      siteUrl,
      qr: async (text) => { calls.qr.push(text); return `<svg data-qr="${String(text).replace(/"/g, "&quot;")}"></svg>`; },
      png: async (spec) => { calls.png.push(spec); return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } }); },
      store,
      mail: { configured: async () => mailConfigured, send: async (m) => { calls.mail.push(m); return typeof mailResult === "function" ? mailResult(m) : mailResult; } },
      topics: { collect: async (topic, o) => { calls.topics.push([topic, o]); const all = topics[topic] ?? []; return o?.limit ? all.slice(0, o.limit) : all; } },
      site: async () => site,
      brand: async () => brand,
      instances: { list: async () => instances },
      entries: { list: async (o) => { calls.entries.push(o); return entries; } },
    },
  };
}
