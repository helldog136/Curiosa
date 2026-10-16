// SONDES : fait tourner le code du module avec un faux contexte (sans serveur, sans réseau, sans base) dans plusieurs situations
// — réglages par défaut, réglages remplis, données HOSTILES — et note tout ce qu'il produit. Les exigences de conformité lisent ces observations.
// Rien n'est exécuté tant qu'une exigence n'en a pas besoin ; le résultat est calculé une fois par module (`observe(m)`).
import { format } from "node:util";
import { fakeCtx } from "./fakeCtx.mjs";
import { watchNetwork } from "./loader.mjs";

// ── Données hostiles ────────────────────────────────────────────────────────────────────────────────────────────────
// Un seul texte hostile, qui contient de quoi casser une page (balise, script, sortie d'attribut). S'il ressort tel quel d'un module, c'est qu'il n'échappe pas.
export const HOSTILE = `"' onmouseover=PROBEATTR x='"></style></script><img src=x onerror=PROBEIMG><script>PROBESCRIPT</script>`;
export const HOSTILE_URL = "javascript:PROBEJS(1)";
export const CANARY = "SECRET-CANARY-7f3a91";
const THEME = { accent: "#e8a23b", accentFg: "#111111", bg: "#121214", surface: "#1b1b1d", fg: "#f4f4f5", muted: "#a1a1a3", line: "#2e2e30", accent2: "#5b8def" };
const TIMEOUT = 8000;
// Chaque appel de route vient d'un « visiteur » différent : un limiteur de débit en mémoire du module (partagé entre les situations) ne doit pas masquer les autres vérifications.
let visitor = 0;
const nextIp = () => `203.0.${Math.floor(++visitor / 250) % 250}.${(visitor % 250) + 1}`;

const withTimeout = (p, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} : trop long (plus de ${TIMEOUT / 1000} s)`)), TIMEOUT).unref())]);

// ── Réglages d'une instance ─────────────────────────────────────────────────────────────────────────────────────────
function resolveDefault(field) {
  const d = field.default;
  if (typeof d === "string" && d.startsWith("theme:")) return THEME[d.slice(6)];
  if (typeof d === "string" && d === "site:name") return "Site";
  if (typeof d === "string" && d === "site:tagline") return "";
  return d;
}

/** Valeur d'un réglage selon la situation : "defaults" | "filled" | "hostile" | "hostileUrl". */
export function settingValue(field, mode) {
  const d = resolveDefault(field);
  if (field.type === "secret") return mode === "defaults" ? undefined : CANARY;
  if (mode === "defaults") return d;
  const urlish = field.type === "url" || field.type === "link" || field.type === "image" || field.type === "video";
  if (mode === "hostile") {
    if (field.type === "text" || field.type === "textarea" || urlish) return HOSTILE;
    if (field.type === "color") return `#fff" onmouseover=PROBEATTR x="`;
    if (field.type === "select") return d ?? field.options?.[0]?.value;
    return d;
  }
  if (mode === "hostileUrl") return urlish ? HOSTILE_URL : settingValue(field, "filled");
  // filled : une valeur plausible pour chaque réglage
  if (d !== undefined && field.type !== "text" && field.type !== "textarea") return d;
  switch (field.type) {
    case "text": case "textarea": return d !== undefined && d !== "" ? d : "Demo text";
    case "url": case "link": return d ?? "https://example.org/demo";
    case "number": return d ?? 3;
    case "boolean": return d ?? false;
    case "select": return d ?? field.options?.[0]?.value;
    case "color": return d ?? "#336699";
    case "image": return d ?? "/uploads/demo.png";
    case "video": return d ?? "/uploads/demo.mp4";
    default: return d;
  }
}

const settingsFor = (manifest, mode) => Object.fromEntries((manifest.settings ?? []).map((f) => [f.key, settingValue(f, mode)]).filter(([, v]) => v !== undefined));
const optionsFor = (decl, mode) => Object.fromEntries((decl?.options ?? []).map((f) => [f.key, settingValue(f, mode)]).filter(([, v]) => v !== undefined));

// ── Sources de données simulées ─────────────────────────────────────────────────────────────────────────────────────
function topicItems(schema, mode, n = 3) {
  const text = mode === "hostile" ? HOSTILE : "Demo";
  return Array.from({ length: n }, (_, i) => ({
    ...Object.fromEntries((schema ?? []).map((f) => [f.key, ({
      string: `${text} ${i}`, url: mode === "hostile" ? HOSTILE_URL : "https://example.org/demo", number: i + 1, boolean: true,
      "string[]": [`${text} ${i}`], datetime: "2026-10-14T20:30:00Z",
    })[f.type] ?? text])),
    source: { instance: "other", module: "other", name: mode === "hostile" ? HOSTILE : "Other" },
  }));
}

const entriesFor = (mode) => Array.from({ length: 3 }, (_, i) => {
  const t = mode === "hostile" ? HOSTILE : "Demo";
  return { id: `e${i}`, slug: `demo-${i}`, cover: mode === "hostile" ? HOSTILE_URL : "/uploads/demo.png", icon: null, tags: [t], fields: { note: t }, title: `${t} ${i}`, summary: t, body: t, url: mode === "hostile" ? HOSTILE_URL : "https://example.org/", code: t, path: `/demo-${i}`, publishedAt: new Date("2026-10-01T10:00:00Z") };
});

/** Copie « hostile » d'un stockage : tout texte libre devient le texte hostile ; les mots de statut (« approved »…) restent, et chaque valeur de statut connue est essayée. */
export function hostileRows(dump, statusWords) {
  const enumLike = (v) => typeof v === "string" && /^[a-z_-]{1,24}$/.test(v);
  const hostile = (v) => (typeof v === "string" ? (enumLike(v) ? v : HOSTILE) : Array.isArray(v) ? v.map(hostile) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hostile(x)])) : v);
  const out = {};
  const push = (collection, data) => { (out[collection] ??= []); if (out[collection].length < 60) out[collection].push(data); };
  for (const row of dump) {
    const base = hostile(row.data);
    push(row.collection, base);
    for (const [k, v] of Object.entries(row.data ?? {})) if (enumLike(v)) for (const w of statusWords) if (w !== v) push(row.collection, { ...base, [k]: w });
  }
  return out;
}

// ── Capture de ce que le module fait ───────────────────────────────────────────────────────────────────────────────
async function captured(fn) {
  const lines = [];
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(saved)) console[k] = (...args) => { lines.push(format(...args)); };
  try {
    const { value, attempts } = await watchNetwork(fn);
    return { value, lines, network: attempts };
  } finally { Object.assign(console, saved); }
}

/** Arguments plausibles pour une action MCP, d'après son schéma. */
export function argsFromSchema(input, mode = "benign") {
  const out = {};
  for (const [k, p] of Object.entries(input?.properties ?? {})) {
    if (p.enum?.length) out[k] = p.enum[0];
    else if (p.type === "string") out[k] = mode === "hostile" ? HOSTILE.slice(0, p.maxLength ?? 200) : "demo";
    else if (p.type === "integer" || p.type === "number") out[k] = Math.min(p.maximum ?? 5, Math.max(p.minimum ?? 1, 1));
    else if (p.type === "boolean") out[k] = false;
    else if (p.type === "array") out[k] = [];
  }
  return out;
}

const HONEYPOTS = new Set(["website", "hp", "honeypot", "_honey", "trap", "_gotcha"]);
function fieldNames(m, route, forms) {
  const fromForms = forms.filter((f) => f.action === route || String(f.action).endsWith(`/${route}`)).flatMap((f) => f.fields.map((x) => x.name));
  const fromSource = [...m.code.matchAll(/\.get\(\s*["']([A-Za-z_][\w-]{0,40})["']\s*\)/g)].map((x) => x[1]);
  const names = [...new Set([...fromForms, ...fromSource])].filter((n) => !HONEYPOTS.has(n));
  return names.length ? names : ["name", "message", "email", "text", "title", "url", "comment"];
}

function collectForms(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => collectForms(v, out));
  else if (value && typeof value === "object") {
    if (value.type === "form" && Array.isArray(value.fields)) out.push({ action: String(value.action ?? ""), fields: value.fields });
    if (value.type === "adminForm" && Array.isArray(value.fields)) out.push({ action: String(value.action ?? ""), fields: value.fields, admin: true });
    if (value.type === "table" && Array.isArray(value.rowActions)) for (const ra of value.rowActions) if (ra?.action) out.push({ action: String(ra.action), fields: [], admin: true, row: true });
    for (const v of Object.values(value)) if (v && typeof v === "object") collectForms(v, out);
  }
  return out;
}

async function readResponse(res) {
  if (!(res instanceof Response)) return { status: 0, notResponse: true, headers: {}, body: "" };
  const headers = Object.fromEntries(res.headers.entries());
  // Un flux qui ne se termine jamais (SSE d'un overlay) : on lit ce qui arrive en un instant puis on le ferme.
  if (/event-stream/i.test(headers["content-type"] ?? "")) { try { await res.body?.cancel(); } catch { /* déjà fermé */ } return { status: res.status, headers, body: "", streaming: true }; }
  let body = "";
  try { body = (await Promise.race([res.text(), new Promise((resolve) => setTimeout(() => resolve(""), 3000).unref())])).slice(0, 200_000); } catch { /* corps illisible */ }
  return { status: res.status, headers, body };
}

// ── Une situation complète ──────────────────────────────────────────────────────────────────────────────────────────
/** Le faux contexte d'une situation (voir runScenario). */
export function makeCtx(m, scenario) {
  const manifest = m.parsed?.ok ? m.parsed.manifest : m.manifest ?? {};
  const mode = scenario.mode;
  const hostile = mode === "hostile" || mode === "hostileUrl";
  const locale = scenario.locale ?? "fr";
  const consumes = Object.fromEntries((manifest.consumes ?? []).map((c) => [c.topic, topicItems(c.schema, hostile ? "hostile" : "benign")]));
  return fakeCtx({
    moduleId: manifest.id ?? m.name, key: "probe", name: hostile ? HOSTILE : "Probe", basePath: "probe", locale, defaultLocale: "fr", locales: ["fr", "en"],
    settings: settingsFor(manifest, mode), messages: m.locales[locale] ?? m.locales.en ?? m.locales.fr ?? {},
    topics: consumes, entries: entriesFor(hostile ? "hostile" : "benign"), rows: scenario.rows ?? {},
    site: { name: hostile ? HOSTILE : "Site", tagline: hostile ? HOSTILE : "Tagline", logo: "/uploads/logo.png" },
    brand: { name: hostile ? HOSTILE : "Site", tagline: hostile ? HOSTILE : "", about: hostile ? HOSTILE : "", logo: "/uploads/logo.png", logos: [], contactEmail: "owner@example.org", colors: [], font: { key: "sans", name: "Sans-serif", stack: "sans-serif" }, defaultLocale: "fr", locales: ["fr", "en"] },
    permissions: scenario.permissions ?? manifest.permissions ?? [],
    instances: [{ id: "i-other", key: "other", module: "other", basePath: "other", name: hostile ? HOSTILE : "Other", adminPath: "/admin/instances/i-other" }],
    theme: { ...THEME, fontKey: "sans", font: "sans-serif" },
    lastVisit: new Date("2026-01-01T00:00:00Z"),
  });
}

/**
 * Fait tourner chaque partie du module dans une situation et renvoie les observations :
 *   outputs   [{ kind, name, ok, error?, value }] — blocs, pages, overlay, réponses de routes, résultats MCP…
 *   console   lignes écrites par le module dans la console ;
 *   denied    permissions refusées par le faux contexte (le module a utilisé une capacité non déclarée) ;
 *   network   accès réseau tentés ;  writes  écritures du stockage ;  mail  e-mails demandés ;  store  contenu final du stockage.
 */
export async function runScenario(m, scenario) {
  const manifest = m.parsed?.ok ? m.parsed.manifest : m.manifest ?? {};
  const def = m.definition ?? {};
  const mode = scenario.mode; // "defaults" | "filled" | "hostile" | "hostileUrl"
  const hostile = mode === "hostile" || mode === "hostileUrl";
  const locale = scenario.locale ?? "fr";
  const ctx = makeCtx(m, scenario);
  const outputs = [];
  const record = async (kind, name, fn) => {
    try {
      const value = await withTimeout(Promise.resolve().then(fn), `${kind} ${name}`);
      outputs.push({ kind, name, ok: true, value });
      return value;
    } catch (error) {
      outputs.push({ kind, name, ok: false, error: String(error?.message ?? error), stack: String(error?.stack ?? "") });
      return undefined;
    }
  };
  const forms = [];
  const entryForms = [];
  const noteForms = (v) => { if (v) forms.push(...collectForms(v)); };
  // La fiche (fausse) dont on « édite » l'entrée quand le module ajoute une section à l'éditeur d'un autre module.
  const entryTarget = { id: "e0", title: hostile ? HOSTILE : "Demo 0", slug: "demo-0", path: "/other/demo-0", instance: "other", published: true };
  const run = async () => {
    const hostileText = hostile ? HOSTILE : "Demo";
    for (const decl of manifest.sections ?? []) if (typeof def.sections?.[decl.id] === "function") noteForms(await record("section", decl.id, () => def.sections[decl.id](ctx, optionsFor(decl, mode))));
    for (const [slot, fn] of Object.entries(def.slots ?? {})) if (typeof fn === "function") noteForms(await record("slot", slot, () => fn({ ...ctx, page: { key: "probe", basePath: "probe" }, entry: { id: "e0", title: hostileText, slug: "demo-0" } })));
    if (typeof def.page === "function") {
      for (const segments of [[], ["page", "2"], ["demo"], ...(hostile ? [[HOSTILE], [HOSTILE, HOSTILE]] : [])]) noteForms(await record("page", `/${segments.join("/")}`, () => def.page(ctx, { segments })));
    }
    if (typeof def.overlay === "function") {
      const queryNames = [...new Set([...m.code.matchAll(/(?:query|searchParams|params)\.get\(\s*["']([\w-]{1,30})["']\s*\)/g)].map((x) => x[1]))];
      await record("overlay", "", () => def.overlay(ctx, { query: new URLSearchParams() }));
      if (hostile) await record("overlay", "?hostile", () => def.overlay(ctx, { query: new URLSearchParams(Object.fromEntries((queryNames.length ? queryNames : ["theme", "id", "mode"]).map((n) => [n, HOSTILE]))) }));
    }
    for (const [topic, fn] of Object.entries(def.exports ?? {})) if (typeof fn === "function") await record("export", topic, () => fn(ctx, { locale, limit: 20, tags: [] }));
    if (typeof def.news === "function") await record("news", "", () => def.news(ctx));
    if (typeof def.adminBadge === "function") await record("adminBadge", "", () => def.adminBadge(ctx));
    if (typeof def.adminPanel === "function") {
      const panel = await record("adminPanel", "", () => def.adminPanel(ctx, { query: {} }));
      noteForms(panel);
      if (hostile) noteForms(await record("adminPanel", "?hostile", () => def.adminPanel(ctx, { query: { id: HOSTILE, tab: HOSTILE, edit: HOSTILE, q: HOSTILE } })));
    }
    for (const decl of manifest.entryPanels ?? []) {
      const panel = def.entryPanels?.[decl.id];
      if (!panel || typeof panel.render !== "function") continue;
      const blocks = await record("entryPanel", decl.id, () => panel.render(ctx, entryTarget, { advanced: mode === "filled", role: mode === "filled" ? "admin" : "editor" }));
      if (blocks) entryForms.push(...collectForms(blocks).map((f) => ({ ...f, panel: decl.id })));
    }
    if (def.backup && typeof def.backup.readable === "function") await record("backup", "readable", () => def.backup.readable(ctx));
    if (!scenario.skipActions) {
      for (const [name, fn] of Object.entries(def.mcp ?? {})) {
        const decl = (manifest.mcp ?? []).find((a) => a.name === name);
        if (typeof fn !== "function") continue;
        const before = ctx.calls.writes.length + ctx.calls.mail.length;
        const value = await record("mcp", name, () => fn(ctx, argsFromSchema(decl?.input, hostile ? "hostile" : "benign"), { name: "probe" }));
        outputs[outputs.length - 1].wrote = ctx.calls.writes.length + ctx.calls.mail.length - before;
        void value;
      }
      const adminFieldNames = [...new Set(forms.flatMap((f) => f.fields.map((x) => x.name)))];
      for (const [name, fn] of Object.entries(def.adminActions ?? {})) {
        if (typeof fn !== "function") continue;
        const names = adminFieldNames.length ? adminFieldNames : [...new Set([...m.code.matchAll(/\bvalues(?:\.([A-Za-z_]\w*)|\[\s*["']([\w-]+)["']\s*\])/g)].map((x) => x[1] ?? x[2]))];
        await record("adminAction", name, () => fn(ctx, Object.fromEntries((names.length ? names : ["id", "name"]).map((n) => [n, hostile ? HOSTILE : n === "id" ? "r1" : "demo"]))));
      }
    }
    if (!scenario.skipActions) {
      for (const [id, panel] of Object.entries(def.entryPanels ?? {})) {
        const names = [...new Set(entryForms.filter((f) => f.panel === id).flatMap((f) => f.fields.map((x) => x.name)))];
        for (const [name, fn] of Object.entries(panel?.actions ?? {})) {
          if (typeof fn !== "function") continue;
          await record("entryPanelAction", `${id}.${name}`, () => fn(ctx, entryTarget, Object.fromEntries((names.length ? names : ["id", "name"]).map((n) => [n, hostile ? HOSTILE : n === "id" ? "r1" : "demo"]))));
        }
      }
    }
    if (!scenario.skipRoutes) await runRoutes();
  };

  async function runRoutes() {
    for (const [route, fn] of Object.entries(def.routes ?? {})) {
      if (typeof fn !== "function") continue;
      const url = `https://example.test/m/probe/${route}`;
      const names = fieldNames(m, route, forms);
      const fill = (v) => Object.fromEntries(names.map((n) => [n, v]));
      const call = async (label, init, qs = "") => {
        const before = { writes: ctx.calls.writes.length, mail: ctx.calls.mail.length, bytes: JSON.stringify(ctx.dumpStore()).length };
        const headers = { "x-forwarded-for": init.ip ?? nextIp(), origin: "https://example.test", ...(init.headers ?? {}) };
        const out = await record("route", `${label} ${route}`, async () => readResponse(await fn(new Request(url + qs, { method: init.method, body: init.body, headers }), ctx)));
        const last = outputs[outputs.length - 1];
        last.route = route; last.label = label; last.method = init.method ?? "GET";
        last.stored = JSON.stringify(ctx.dumpStore()).length - before.bytes;
        last.wrote = ctx.calls.writes.length - before.writes; last.mailed = ctx.calls.mail.length - before.mail;
        return out;
      };
      const reqInit = (method, body, headers = {}) => ({ method, body, headers });
      const form = (obj) => { const f = new FormData(); for (const [k, v] of Object.entries(obj)) f.set(k, v); return f; };
      if (scenario.routeSet === "protection") {
        const burstIp = nextIp();
        for (let i = 0; i < 40; i++) {
          const f = form(Object.fromEntries(names.map((n) => [n, n.toLowerCase().includes("mail") ? "ada@example.org" : `Demo ${i} ${n}`])));
          const res = await call("POST-burst", { method: "POST", body: f, headers: {}, ip: burstIp });
          if (res && res.status === 429) break;
        }
        continue;
      }
      const hv = hostile ? HOSTILE : "Demo";
      const mailish = (n, v) => (n.toLowerCase().includes("mail") && !hostile ? "ada@example.org" : v);
      await call("GET", { method: "GET" });
      await call("GET?params", { method: "GET" }, `?${new URLSearchParams({ ...Object.fromEntries(names.map((n) => [n, hv])), next: "https://evil.example/x", redirect: "https://evil.example/x", return: "//evil.example", url: "https://evil.example/x" })}`);
      await call("POST-form", reqInit("POST", form({ ...Object.fromEntries(names.map((n) => [n, mailish(n, `${hv} ${n}`)])), next: "https://evil.example/x", redirect: "https://evil.example/x", return: "https://evil.example/x" })));
      await call("POST-json", reqInit("POST", JSON.stringify({ ...fill(hv), next: "https://evil.example/x", redirect: "https://evil.example/x" }), { "content-type": "application/json" }));
      if (!hostile) {
        await call("POST-garbage", reqInit("POST", "{not json", { "content-type": "application/json" }));
        await call("POST-empty", reqInit("POST", ""));
        await call("POST-huge", reqInit("POST", form(Object.fromEntries(names.map((n) => [n, "x".repeat(2_000_000)])))));
        await call("PUT", { method: "PUT", body: "x" });
        await call("DELETE", { method: "DELETE" });
      }
    }
  }

  const obs = await captured(run).catch((error) => ({ value: undefined, lines: [], network: [], fatal: String(error?.message ?? error) }));
  return {
    scenario, outputs, forms, entryForms, console: obs.lines, network: obs.network, fatal: obs.fatal,
    denied: [...new Set(ctx.calls.denied)], writes: ctx.calls.writes, mail: ctx.calls.mail, store: ctx.dumpStore(), calls: ctx.calls,
  };
}

// ── L'ensemble des observations d'un module (calculé à la demande, une fois) ────────────────────────────────────────
const cache = new WeakMap();

export function observe(m) {
  if (cache.has(m)) return cache.get(m);
  const task = (async () => {
    const out = { runs: {}, hostile: [], plain: [] };
    if (!m.parsed?.ok) return out;
    const statusWords = [...new Set([...m.code.matchAll(/["']([a-z_]{3,20})["']/g)].map((x) => x[1]))].filter((w) => ["approved", "pending", "published", "visible", "public", "active", "open", "done", "accepted", "validated", "rejected", "hidden", "draft", "to_review", "reviewed", "confirmed"].includes(w)).slice(0, 8);
    const base = [
      ["defaults", { mode: "defaults", locale: "fr" }],
      ["filled-en", { mode: "filled", locale: "en" }],
      ["filled", { mode: "filled", locale: "fr" }],
    ];
    for (const [name, sc] of base) out.runs[name] = await runScenario(m, sc);
    // le stockage rempli par les routes du scénario « filled » sert de modèle aux données hostiles
    const rows = hostileRows(out.runs.filled.store, statusWords);
    for (const [name, sc] of [
      ["hostile", { mode: "hostile", locale: "fr", rows }],
      ["hostileUrl", { mode: "hostileUrl", locale: "fr", rows }],
    ]) out.runs[name] = await runScenario(m, sc);
    out.runs.protection = await runScenario(m, { mode: "filled", locale: "fr", routeSet: "protection", skipActions: true });
    out.hostile = [out.runs.hostile, out.runs.hostileUrl];
    out.plain = [out.runs.defaults, out.runs["filled-en"], out.runs.filled];
    return out;
  })();
  cache.set(m, task);
  return task;
}
