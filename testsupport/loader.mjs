// Charge un dossier de module comme le fait Curiosa : manifeste (module.json), code (le fichier « main »), textes (locales/*.json), README.
// Ne lève JAMAIS : tout ce qui ne va pas est noté dans `m.loadErrors`, et la suite de conformité le transforme en explication lisible.
//
//   const m = await loadModuleDir("/chemin/vers/mon-module");
//   m.manifest      manifeste lu (objet brut) ;  m.parsed.ok / m.parsed.manifest : résultat de parseManifest
//   m.definition    ce que le module exporte par défaut ({ sections, routes, mcp… })
//   m.locales       { fr: {...}, en: {...} }
//   m.network       accès réseau tentés PENDANT le chargement du code (doit rester vide)
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadCore } from "./core.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const CODE_RE = /\.(mjs|js|cjs)$/;

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, base, out);
    else out.push({ file: path.relative(base, full), full, symlink: e.isSymbolicLink() });
    if (e.isSymbolicLink() && e.isDirectory()) out.push({ file: path.relative(base, full), full, symlink: true });
  }
  return out;
}

/** Surveille le réseau pendant `fn` : fetch, http(s), connexions TCP et résolutions DNS sont refusés et notés. */
export async function watchNetwork(fn) {
  const attempts = [];
  const note = (kind, what) => attempts.push(`${kind} ${String(what).slice(0, 200)}`);
  const saved = { fetch: globalThis.fetch, hreq: http.request, hget: http.get, sreq: https.request, sget: https.get, connect: net.Socket.prototype.connect, lookup: dns.lookup };
  const refuse = (kind) => (target, ...rest) => { note(kind, typeof target === "string" ? target : target?.href ?? target?.hostname ?? target?.host ?? "?"); void rest; throw new Error("network disabled by the conformance suite"); };
  globalThis.fetch = async (input) => { note("fetch", typeof input === "string" ? input : input?.url ?? input); throw new TypeError("fetch failed"); };
  http.request = refuse("http"); http.get = refuse("http"); https.request = refuse("https"); https.get = refuse("https");
  net.Socket.prototype.connect = function (...args) { note("tcp", JSON.stringify(args[0])); throw new Error("network disabled by the conformance suite"); };
  dns.lookup = (host, ...rest) => { note("dns", host); const cb = rest.find((x) => typeof x === "function"); if (cb) cb(new Error("network disabled by the conformance suite")); };
  try {
    const value = await fn();
    return { value, attempts };
  } finally {
    globalThis.fetch = saved.fetch;
    http.request = saved.hreq; http.get = saved.hget; https.request = saved.sreq; https.get = saved.sget;
    net.Socket.prototype.connect = saved.connect; dns.lookup = saved.lookup;
  }
}

/** Charge le module du dossier `dir`. */
export async function loadModuleDir(dir, { siblings = [] } = {}) {
  const core = await loadCore();
  const root = path.resolve(dir);
  const m = {
    dir: root, name: path.basename(root), core, siblings,
    exists: false, loadErrors: [], manifestText: "", manifest: null, parsed: null,
    definition: {}, locales: {}, files: [], sources: [], code: "", readme: null, network: [], bytes: 0, symlinks: [],
  };
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { m.loadErrors.push({ kind: "dir", message: `le dossier « ${dir} » n'existe pas` }); return m; }
  m.exists = true;

  m.files = walk(root);
  m.symlinks = m.files.filter((f) => f.symlink).map((f) => f.file);
  m.bytes = m.files.reduce((n, f) => { try { return n + (f.symlink ? 0 : fs.statSync(f.full).size); } catch { return n; } }, 0);
  for (const f of m.files) if (!f.symlink && CODE_RE.test(f.file)) { try { m.sources.push({ file: f.file, text: fs.readFileSync(f.full, "utf8") }); } catch { /* illisible : ignoré */ } }
  m.code = m.sources.map((s) => s.text).join("\n");

  const manifestFile = path.join(root, "module.json");
  if (!fs.existsSync(manifestFile)) m.loadErrors.push({ kind: "manifest-missing", message: "le fichier module.json est absent à la racine du dossier" });
  else {
    m.manifestText = fs.readFileSync(manifestFile, "utf8");
    try { m.manifest = JSON.parse(m.manifestText); } catch (e) { m.loadErrors.push({ kind: "manifest-json", message: `module.json n'est pas un JSON valide (${String(e.message).slice(0, 160)})` }); }
  }
  if (m.manifest) m.parsed = core.parseManifest(JSON.parse(JSON.stringify(m.manifest)));

  const localeDir = path.join(root, "locales");
  if (fs.existsSync(localeDir)) {
    for (const f of fs.readdirSync(localeDir)) {
      if (!f.endsWith(".json")) continue;
      try { m.locales[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(localeDir, f), "utf8")); } catch (e) { m.loadErrors.push({ kind: "locale-json", message: `locales/${f} n'est pas un JSON valide (${String(e.message).slice(0, 120)})` }); }
    }
  }
  const readmeFile = path.join(root, "README.md");
  if (fs.existsSync(readmeFile)) m.readme = fs.readFileSync(readmeFile, "utf8");

  const main = m.manifest?.main;
  if (typeof main === "string" && main) {
    const file = path.resolve(root, main);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) m.loadErrors.push({ kind: "main-missing", message: `le fichier principal « ${main} » (champ main de module.json) est introuvable dans le dossier` });
    else {
      try {
        const { value, attempts } = await watchNetwork(() => import(`${pathToFileURL(file).href}?conformance=${Date.now()}`));
        m.network = attempts;
        m.definition = value?.default ?? {};
        if (value?.default === undefined) m.loadErrors.push({ kind: "no-default", message: `« ${main} » n'exporte rien par défaut : ajoutez « export default { … } »` });
        else if (typeof m.definition !== "object" || m.definition === null || Array.isArray(m.definition)) { m.loadErrors.push({ kind: "default-type", message: `« ${main} » doit exporter par défaut un objet ({ sections, routes… })` }); m.definition = {}; }
      } catch (e) {
        m.loadErrors.push({ kind: "import", message: `le code de « ${main} » ne se charge pas : ${String(e?.message ?? e).split("\n")[0].slice(0, 200)}` });
      }
    }
  }
  return m;
}

/** Lecture légère d'un module voisin (manifeste et texte du code, sans l'exécuter) : sert aux comparaisons entre modules (un propriétaire par donnée). */
export function readModuleLight(dir) {
  const root = path.resolve(dir);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
    const code = walk(root).filter((f) => !f.symlink && CODE_RE.test(f.file)).map((f) => fs.readFileSync(f.full, "utf8")).join("\n");
    return { id: manifest.id ?? path.basename(root), dir: root, manifest, code };
  } catch {
    return null;
  }
}
