import { makeNetClient } from "./fakeNet.mjs";
import { createHash } from "node:crypto";

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
 * - `legacy: { clé: valeur }` (cœur 0.2.0) : réglages hérités déclarés dans `legacySettings`. Ajoute `ctx.legacy` : `keys()`, `get(clé)` (valeur, ou null si vide/absente),
 *   `clear(clé)` (enregistre dans `ctx.calls.legacyCleared` ; `get` renvoie alors null). Une clé absente de l'objet est NON DÉCLARÉE : `get`/`clear` lèvent, comme le vrai cœur.
 *   Sans cette option, `ctx.legacy` n'existe pas (cœur plus ancien).
 * - `ctx.api.qr(text)` renvoie un SVG factice contenant le texte ; `ctx.api.brand()` / `site()` valeurs réglables
 * - `ctx.api.mail` : `configured` (option `mailConfigured`, défaut true) et `send` qui enregistre dans `ctx.calls.mail` (résultat réglable via `mailResult`)
 * - `ctx.api.rawg` : `configured` (option `rawgConfigured`, défaut true) et `cover(title)` qui enregistre dans `ctx.calls.rawg` (résultat réglable via `rawgCover`, objet ou fonction `(titre) => résultat` ;
 *   le vrai cœur peut y ajouter `name`, `id` et `ambiguous`, tous facultatifs). `candidates(title)` (cœur 0.2.10) enregistre dans `ctx.calls.rawgCandidates` ; résultat réglable via `rawgCandidates`
 *   (défaut `{ status: "none", candidates: [] }` ; un candidat est `{ id, name, year, platforms, url }`, 6 au plus dans le vrai cœur)
 * - `ctx.api.visitor.fingerprint(request, scope?)` (cœur 0.2.6) : même règle que le cœur (DERNIÈRE entrée de `X-Forwarded-For`, sinon `X-Real-IP`, sinon « local »), empreinte de 22 caractères avec un sel fixe de test (jamais l'adresse) ; propre à `scope` et au module
 * - `ctx.api.privacy.declarations()` (permission « privacy », cœur 0.2.6) : renvoie `privacyDeclarations` (option ; défaut `{ modules: [], truncated: false }`) ; sans la permission déclarée : `{ modules: [], truncated: false }`
 * - `ctx.api.services` : `services` = { nom: { méthode: (args) => valeur } } ; absent → `unavailable`
 * - `ctx.api.services.callAll(nom, méthode, args)` : `serviceInstances` = { nom: [{ instance, name?, methods: { méthode: (args) => valeur } }] } → une entrée par instance (un fournisseur qui lève
 *   donne `{ ok: false, error: "failed" }`) ; sans `serviceInstances[nom]`, UNE entrée tirée de `services[nom]` (comme un service non-each) ; service inconnu → []
 * - `ctx.api.net` : le VRAI client réseau du cœur (pauses 429, quota, disjoncteur, file bornée, délais…), avec un état neuf par fakeCtx et branché sur
 *   `globalThis.fetch` : combinez-le avec `withFakeFetch` / `fakeFetch` et `netReplies` (testsupport/fakeNet.mjs). Chaque demande est notée dans `ctx.calls.net`
 *   (`{ url, method }`) et chaque ligne de journal dans `ctx.calls.netLog`. Options : `netLimits` (bornes raccourcies ; par défaut l'attente avant la reprise
 *   est réduite à quelques ms), `netBudgetMs` (temps restant d'une page publique simulé ; défaut null = hors page), `net` (remplace tout `ctx.api.net`).
 * - `ctx.api.services.providers(nom)` : une entrée par élément de `serviceInstances[nom]` (`id` = « id-<instance> », la première est `master`) ; sinon UNE entrée tirée de
 *   `services[nom]` ; service inconnu → []. `call(nom, méthode, args, { provider: id })` appelle cette instance-là (inconnue → `{ ok: false, reason: "unavailable" }`).
 * - `ctx.resolveChoice(clé)` (réglage « choice », cœur 0.2.0) : `choices` = { clé: résolution } (par ex. `{ status: "chosen", id: "id-x", label: "X" }`, ou une fonction
 *   `() => résolution`) ; clé absente → `{ status: "none" }`. Chaque appel est noté dans `ctx.calls.choices`.
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
    migration = false, seedResult, legacy, rows: seedRows = {}, permissions, lastVisit = new Date(0), site = { name: "Site", tagline: "", logo: null }, theme = { accent: "#e8a23b", accentFg: "#111111", bg: "#121214", surface: "#1b1b1d", fg: "#f4f4f5", muted: "#a1a1a3", line: "#2e2e30", fontKey: "sans", font: "sans-serif" }, services = {}, serviceInstances = {}, mailConfigured = true, mailResult = { ok: true }, privacyDeclarations = { modules: [], truncated: false }, rawgConfigured = true, rawgCover = { status: "found", url: "https://media.example.test/cover.jpg" }, rawgCandidates = { status: "none", candidates: [] }, siteUrl = "https://example.test",
    net: netOverride, netLimits, netBudgetMs = null, choices = {},
  } = opts;
  const rows = new Map();
  let seq = 0;
  const calls = { topics: [], qr: [], entries: [], mail: [], png: [], services: [], rawg: [], rawgCandidates: [], seeds: [], cleared: [], legacyCleared: [], writes: [], denied: [], net: [], netLog: [], choices: [] };
  let netClient;
  const client = () => (netClient ??= makeNetClient({ limits: { retryMinMs: 1, retryMaxMs: 5, ...netLimits }, log: (line) => calls.netLog.push(line) }));
  const net = netOverride ?? {
    async request(req) {
      calls.net.push({ url: req?.url, method: req?.method ?? "GET" });
      return (await client()).request(req, { module: moduleId, budgetMs: netBudgetMs });
    },
    async health() { return (await client()).health(); },
    budgetMs: () => netBudgetMs,
  };
  const cleared = new Set();
  const store = {
    async add(collection, data) { calls.writes.push({ op: "add", collection }); const id = `r${++seq}`; rows.set(id, { id, collection, createdAt: new Date(Date.now() + seq), data: structuredClone(data) }); return id; },
    async get(id) { const r = rows.get(id); return r ? { id: r.id, createdAt: r.createdAt, data: structuredClone(r.data) } : null; },
    async update(id, data) { if (!rows.has(id)) return false; calls.writes.push({ op: "update", collection: rows.get(id).collection }); rows.get(id).data = structuredClone(data); return true; },
    async list(collection, o) { return [...rows.values()].filter((r) => r.collection === collection).sort((a, b) => b.createdAt - a.createdAt).slice(0, o?.limit ?? 100).map((r) => ({ id: r.id, createdAt: r.createdAt, data: structuredClone(r.data) })); },
    // Lecture par pages (curseur factice = position) : de quoi essayer un générateur de téléchargement qui lit « par pages » (adminDownloads).
    async page(collection, o) {
      const asc = o?.order === "asc";
      const all = [...rows.values()].filter((r) => r.collection === collection).sort((a, b) => (asc ? 1 : -1) * (a.createdAt - b.createdAt));
      const start = Math.max(0, Number(o?.cursor ?? 0) || 0);
      const limit = Math.min(Math.max(1, o?.limit ?? 100), 1000);
      return { items: all.slice(start, start + limit).map((r) => ({ id: r.id, createdAt: r.createdAt, data: structuredClone(r.data) })), next: start + limit < all.length ? String(start + limit) : null };
    },
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
  const legacyValues = legacy && typeof legacy === "object" ? { ...legacy } : null;
  const legacyCheck = (k) => { if (!legacyValues || !Object.hasOwn(legacyValues, k)) throw Object.assign(new Error(`"${k}" is not declared in legacySettings`), { code: "undeclared" }); };
  const legacyApi = !legacyValues ? {} : {
    legacy: {
      keys: () => Object.keys(legacyValues),
      get: async (k) => { legacyCheck(k); const v = legacyValues[k]; return v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v; },
      clear: async (k) => { legacyCheck(k); calls.legacyCleared.push(k); legacyValues[k] = null; },
    },
  };
  return {
    ...migrationApi,
    ...legacyApi,
    moduleId,
    instance: { id: `id-${key}`, key, basePath, name },
    locale, defaultLocale, locales,
    setting: (k) => (cleared.has(k) ? undefined : settings[k]),
    async resolveChoice(k) {
      calls.choices.push(k);
      const r = choices[k];
      return structuredClone(typeof r === "function" ? await r() : r ?? { status: "none" });
    },
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
        providers: async (name) => {
          const list = serviceInstances[name] ?? (services[name] ? [{ instance: `${name}-provider`, name, methods: services[name] }] : []);
          return list.slice(0, 50).map((p, i) => ({ id: `id-${p.instance}`, key: p.instance, name: p.name ?? p.instance, module: p.module ?? "provider", version: p.version ?? 1, each: !!serviceInstances[name], master: i === 0 }));
        },
        call: async (name, method, args, opts) => {
          calls.services.push([name, method, args]);
          if (opts?.provider !== undefined) {
            const list = serviceInstances[name] ?? (services[name] ? [{ instance: `${name}-provider`, methods: services[name] }] : []);
            const target = list.find((p) => `id-${p.instance}` === opts.provider);
            if (!target) return { ok: false, reason: "unavailable" };
            const pick = target.methods?.[method];
            if (typeof pick !== "function") return { ok: false, reason: "no_method" };
            try { return { ok: true, value: await pick(args) }; } catch { return { ok: false, reason: "failed" }; }
          }
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
      visitor: {
        fingerprint: (request, scope) => {
          const h = request?.headers ?? request;
          const get = (n) => (typeof h?.get === "function" ? h.get(n) : null);
          const chain = String(get("x-forwarded-for") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
          const ip = chain.length ? chain[chain.length - 1] : String(get("x-real-ip") ?? "").trim() || "local";
          return createHash("sha256").update(`fake-salt\n${moduleId}\n${String(scope ?? "").slice(0, 64)}\n${ip}`).digest("base64url").slice(0, 22);
        },
      },
      privacy: { declarations: async () => ((!allowed || allowed.has("privacy")) ? structuredClone(privacyDeclarations) : { modules: [], truncated: false }) },
      rawg: { configured: async () => (!allowed || allowed.has("rawg")) && rawgConfigured, cover: async (title) => { calls.rawg.push(title); if (allowed && !allowed.has("rawg")) return { status: "no-key", url: null }; return typeof rawgCover === "function" ? rawgCover(title) : rawgCover; }, candidates: async (title) => { calls.rawgCandidates.push(title); if (allowed && !allowed.has("rawg")) return { status: "no-key", candidates: [] }; return typeof rawgCandidates === "function" ? rawgCandidates(title) : rawgCandidates; } },
      net,
      site: async () => site,
      brand: async () => brand,
      instances: { list: async () => instances },
      entries: { list: async (o) => { calls.entries.push(o); return entries; } },
    }, {
      // Ces trois capacités demandent une permission : sans elle, le simple fait d'y toucher échoue (voir l'option `permissions`).
      store: guarded("storage", () => store),
      mail: guarded("mail", () => ({ configured: async () => mailConfigured, send: async (m) => { calls.mail.push(m); return typeof mailResult === "function" ? mailResult(m) : mailResult; } })),
      topics: guarded("topics", () => ({
        // Une seule page (`next: null`), comme un sujet fourni par un module ; le curseur factice « n » reprend à partir du n-ième élément.
        collectPage: async (topic, o) => {
          calls.topics.push([topic, o]);
          const source = topics[topic] ?? [];
          const all = typeof source === "function" ? await source(o) : source;
          const from = Number(o?.cursor ?? 0) || 0, size = o?.limit ?? 50;
          return { items: all.slice(from, from + size), next: from + size < all.length ? String(from + size) : null };
        },
        collect: async (topic, o) => {
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
