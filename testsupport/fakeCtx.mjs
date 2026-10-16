/**
 * FAUX CONTEXTE DE MODULE — API publique du kit de test (testsupport/). Voir docs/TESTSUPPORT.md.
 *
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
 *   `topics[topic]` peut aussi être une FONCTION `(opts) => éléments` (opts = ce que le module a passé : `limit`, `from`, `to`), pour tester un module qui demande une plage de dates ;
 *   `ctx.calls.topics` garde chaque appel `[topic, opts]`. Comme le vrai cœur, une plage invalide (`from` > `to`, date illisible) LÈVE une erreur — seulement si `from` ou `to` est passé.
 * - `migration: true` : ctx d'une migration de données. Ajoute `ctx.seedInstance(cible, demande)` (enregistre dans `ctx.calls.seeds` ; résultat réglable par `seedResult`, objet ou fonction `(cible, demande) => résultat`,
 *   défaut `{ created: true, instanceKey: <surnom en minuscules> }`) et `ctx.clearSetting(clé)` (enregistre dans `ctx.calls.cleared` ; `ctx.setting(clé)` renvoie alors undefined). Sans cette option, ni l'un ni l'autre n'existe.
 * - `ctx.api.qr(text)` renvoie un SVG factice contenant le texte ; `ctx.api.brand()` / `site()` valeurs réglables
 * - `ctx.api.mail` : `configured` (option `mailConfigured`, défaut true) et `send` qui enregistre dans `ctx.calls.mail` (résultat réglable via `mailResult`)
 * - `ctx.api.rawg` : `configured` (option `rawgConfigured`, défaut true) et `cover(title)` qui enregistre dans `ctx.calls.rawg` (résultat réglable via `rawgCover`)
 * - `ctx.api.services` : `services` = { nom: { méthode: (args) => valeur } } ; absent → `unavailable`
 * - `ctx.api.services.callAll(nom, méthode, args)` : `serviceInstances` = { nom: [{ instance, name?, methods: { méthode: (args) => valeur } }] } → une entrée par instance (un fournisseur qui lève
 *   donne `{ ok: false, error: "failed" }`) ; sans `serviceInstances[nom]`, UNE entrée tirée de `services[nom]` (comme un service non-each) ; service inconnu → []
 * - `ctx.dumpStore()` : tout le contenu du stockage `[{ id, collection, data }]`, pour les assertions
 * - `ctx.calls` enregistre les appels utiles aux assertions (`calls.writes` : chaque écriture du stockage `{ op, collection }`)
 * - `ctx.visit` : `{ lastVisit }` (option `lastVisit`, défaut : le 1er janvier 1970 = visiteur inconnu)
 * - `rows` : { collection: [données…] } pré-remplit le stockage (pour tester l'affichage de données existantes)
 * - `permissions` : liste des permissions DÉCLARÉES par le manifeste. Si elle est donnée, le contexte REFUSE ce qui n'est pas déclaré, comme le ferait un
 *   cœur strict : `ctx.api.store` sans « storage », `ctx.api.mail` sans « mail », `ctx.api.topics` sans « topics » lèvent une erreur (et `ctx.calls.denied` l'enregistre) ;
 *   `ctx.api.rawg` sans « rawg » répond comme s'il n'y avait pas de clé (comportement du vrai cœur). Absente : tout est permis.
 */
export function fakeCtx(opts = {}) {
  const {
    moduleId = "fake", key = "fake", name = "Fake", basePath = "fake", locale = "en", defaultLocale = "en", locales = ["en"],
    settings = {}, messages = {}, topics = {}, entries = [], instances = [],
    brand = { name: "Site", tagline: "", about: "", logo: null, contactEmail: "", colors: [], font: { key: "sans", name: "Sans-serif", stack: "sans-serif" }, defaultLocale, locales },
    migration = false, seedResult, rows: seedRows = {}, permissions, lastVisit = new Date(0), site = { name: "Site", tagline: "", logo: null }, theme = { accent: "#e8a23b", accentFg: "#111111", bg: "#121214", surface: "#1b1b1d", fg: "#f4f4f5", muted: "#a1a1a3", line: "#2e2e30", fontKey: "sans", font: "sans-serif" }, services = {}, serviceInstances = {}, mailConfigured = true, mailResult = { ok: true }, rawgConfigured = true, rawgCover = { status: "found", url: "https://media.example.test/cover.jpg" }, siteUrl = "https://example.test",
  } = opts;
  const rows = new Map();
  let seq = 0;
  const calls = { topics: [], qr: [], entries: [], mail: [], png: [], services: [], rawg: [], seeds: [], cleared: [], writes: [], denied: [] };
  const cleared = new Set();
  const store = {
    async add(collection, data) { calls.writes.push({ op: "add", collection }); const id = `r${++seq}`; rows.set(id, { id, collection, createdAt: new Date(Date.now() + seq), data: structuredClone(data) }); return id; },
    async get(id) { const r = rows.get(id); return r ? { id: r.id, createdAt: r.createdAt, data: structuredClone(r.data) } : null; },
    async update(id, data) { if (!rows.has(id)) return false; calls.writes.push({ op: "update", collection: rows.get(id).collection }); rows.get(id).data = structuredClone(data); return true; },
    async list(collection, o) { return [...rows.values()].filter((r) => r.collection === collection).sort((a, b) => b.createdAt - a.createdAt).slice(0, o?.limit ?? 100).map((r) => ({ id: r.id, createdAt: r.createdAt, data: structuredClone(r.data) })); },
    async remove(id) { calls.writes.push({ op: "remove", collection: rows.get(id)?.collection }); rows.delete(id); },
    async count(collection) { return [...rows.values()].filter((r) => r.collection === collection).length; },
  };
  for (const [collection, list] of Object.entries(seedRows)) for (const data of list) { const id = `r${++seq}`; rows.set(id, { id, collection, createdAt: new Date(Date.now() + seq), data: structuredClone(data) }); }
  const allowed = permissions ? new Set(permissions) : null;
  const need = (permission, value) => {
    if (!allowed || allowed.has(permission)) return value;
    calls.denied.push(permission);
    throw new Error(`permission « ${permission} » non déclarée dans module.json (permissions)`);
  };
  // Un membre protégé par une permission : lisible (ou refusé), et remplaçable par un test (`ctx.api.store = autreStockage`) comme un champ ordinaire.
  const guarded = (permission, make) => { let replaced; let made; return { enumerable: true, configurable: true, get: () => (replaced !== undefined ? replaced : need(permission, (made ??= make()))), set: (v) => { replaced = v; } }; };
  const migrationApi = !migration ? {} : {
    seedInstance: async (target, request) => {
      calls.seeds.push([target, request]);
      if (typeof seedResult === "function") return seedResult(target, request);
      return seedResult ?? { created: true, instanceKey: String(request?.nickname ?? target).toLowerCase().replace(/[^a-z0-9]+/g, "-") };
    },
    clearSetting: async (k) => { calls.cleared.push(k); cleared.add(k); },
  };
  return {
    ...migrationApi,
    moduleId,
    instance: { id: `id-${key}`, key, basePath, name },
    locale, defaultLocale, locales,
    setting: (k) => (cleared.has(k) ? undefined : settings[k]),
    theme,
    visit: { lastVisit },
    t: (k, vars) => { let s = messages[k] ?? k; for (const [n, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${n}}`, String(v)); return s; },
    calls,
    /** Tout ce que le module a rangé dans son stockage : [{ id, collection, data }] (sans passer par la permission « storage »). */
    dumpStore: () => [...rows.values()].map((r) => ({ id: r.id, collection: r.collection, data: structuredClone(r.data) })),
    api: Object.defineProperties({
      siteUrl,
      seo: { jsonLd: (data) => (data && typeof data["@type"] === "string" ? { tag: "script", jsonLd: { "@context": "https://schema.org", ...data } } : null) },
      qr: async (text) => { calls.qr.push(text); return `<svg data-qr="${String(text).replace(/"/g, "&quot;")}"></svg>`; },
      png: async (spec) => { calls.png.push(spec); return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } }); },
      services: {
        available: async (name) => name in services,
        call: async (name, method, args) => {
          calls.services.push([name, method, args]);
          const fn = services[name]?.[method];
          if (!services[name]) return { ok: false, reason: "unavailable" };
          if (typeof fn !== "function") return { ok: false, reason: "no_method" };
          try { return { ok: true, value: await fn(args) }; } catch { return { ok: false, reason: "failed" }; }
        },
        callAll: async (name, method, args) => {
          calls.services.push([name, method, args]);
          const list = serviceInstances[name] ?? (services[name] ? [{ instance: key, name, methods: services[name] }] : []);
          return Promise.all(list.map(async (p) => {
            const fn = p.methods?.[method];
            if (typeof fn !== "function") return { instance: p.instance, name: p.name, ok: false, error: "no_method" };
            try { return { instance: p.instance, name: p.name, ok: true, value: await fn(args) }; } catch { return { instance: p.instance, name: p.name, ok: false, error: "failed" }; }
          }));
        },
      },
      rawg: { configured: async () => (!allowed || allowed.has("rawg")) && rawgConfigured, cover: async (title) => { calls.rawg.push(title); if (allowed && !allowed.has("rawg")) return { status: "no-key", url: null }; return typeof rawgCover === "function" ? rawgCover(title) : rawgCover; } },
      site: async () => site,
      brand: async () => brand,
      instances: { list: async () => instances },
      entries: { list: async (o) => { calls.entries.push(o); return entries; } },
    }, {
      // Ces trois capacités demandent une permission : sans elle, le simple fait d'y toucher échoue (voir l'option `permissions`).
      store: guarded("storage", () => store),
      mail: guarded("mail", () => ({ configured: async () => mailConfigured, send: async (m) => { calls.mail.push(m); return typeof mailResult === "function" ? mailResult(m) : mailResult; } })),
      topics: guarded("topics", () => ({ collect: async (topic, o) => {
        calls.topics.push([topic, o]);
        if (o?.from !== undefined || o?.to !== undefined) {
          const ms = (v) => (v === undefined || v === null ? undefined : v instanceof Date ? v.getTime() : /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(String(v)) ? Date.parse(String(v)) : NaN);
          const [a, b] = [ms(o.from), ms(o.to)];
          if (Number.isNaN(a) || Number.isNaN(b) || (a !== undefined && b !== undefined && a > b)) throw new Error("topics.collect: invalid window");
        }
        const source = topics[topic] ?? [];
        const all = typeof source === "function" ? await source(o) : source;
        return o?.limit ? all.slice(0, o.limit) : all;
      } })),
    }),
  };
}
