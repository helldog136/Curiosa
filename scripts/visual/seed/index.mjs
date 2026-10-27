// Amorçage du site de référence. Lancé PAR `site.mjs prepare` dans le dossier du cœur, avec le « register » des tests (alias @/ et .ts) et le préchargement déterministe :
//   node --import ./tests/helpers/register.mjs -r scripts/visual/preload.cjs scripts/visual/seed/index.mjs
// Variables : DATA_DIR, DATABASE_URL (déjà migrée), VISUAL_EXTRAS (dépôt des modules). Écrit tout dans la base et DATA_DIR : rien n'est lu sur le réseau.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { demoImage, demoLogoSvg } from "../lib/images.mjs";
import { FIXED_NOW } from "../config.mjs";

const EXTRAS = process.env.VISUAL_EXTRAS;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CORE = process.cwd();
const bcrypt = (await import(pathToFileURL(path.join(CORE, "node_modules/bcryptjs/index.js")).href)).default;
const { prisma } = await import("@/core/db");
const { setSetting } = await import("@/core/settings");
const { MODULES_DIR } = await import("@/core/config");
const R = await import("@/core/modules/registry");
const { createInstance } = await import("@/core/instanceService");
const { createEntry } = await import("@/core/content/service");
const { storeUpload } = await import("@/core/services/uploads");

const { buildContext } = await import("@/core/modules/context");
const { listInstances } = await import("@/core/instances");

const NOW = new Date(FIXED_NOW);
const day = (n, h = 10) => new Date(NOW.getTime() + n * 86400000 + (h - 10) * 3600000);

// ─── 1. cœur ───
await prisma.user.create({ data: { email: "owner@example.org", name: "Responsable", role: "owner", passwordHash: await bcrypt.hash("visual-harness-only", 4), locale: "fr" } });
const S = (k, v, l = "") => setSetting(k, v, l);
const both = async (k, fr, en) => { await S(k, fr, "fr"); await S(k, en, "en"); };
await S("i18n.default", "fr"); await S("i18n.enabled", ["fr", "en"]); await S("i18n.adminDefault", "fr"); await S("i18n.autoDetect", false);
await both("site.name", "Atelier Démo", "Demo Workshop");
await both("site.tagline", "Créations, événements et coulisses", "Creations, events and behind the scenes");
await both("site.about", "Un site de démonstration : **un atelier**, des projets, un agenda et une communauté.\n\nTout ce que vous voyez ici est fictif.", "A demo site: **a workshop**, projects, a calendar and a community.\n\nEverything you see here is fictional.");
await both("footer.text", "© Atelier Démo · Site de démonstration", "© Demo Workshop · Demo site");
await S("site.contactEmail", "contact@example.org");
await S("news.toggle", true); await S("stats.enabled", false); await S("feed.showLink", true); await S("setup.completed", true);

// Logos : deux SVG (clair / sombre) + un carré, et une image de partage.
const up = async (buf, ext) => storeUpload(buf, ext);
const logoSquare = await up(demoLogoSvg("square"), "svg");
const logoWide = await up(demoLogoSvg("wide"), "svg");
const logoWideDark = await up(demoLogoSvg("wide", true), "svg");
await S("site.logo", logoSquare); await S("site.logoWide", logoWide); await S("site.logoWideDark", logoWideDark);

// ─── 2. modules : tous ceux du catalogue (copie du dossier, comme une installation locale) ───
const ids = fs.readdirSync(path.join(EXTRAS, "modules")).filter((d) => fs.existsSync(path.join(EXTRAS, "modules", d, "module.json"))).sort();
const inst = {}; const bad = [];
for (const id of ids) {
  const src = path.join(EXTRAS, "modules", id), dst = path.join(MODULES_DIR, id);
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.cpSync(src, dst, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(src, "module.json"), "utf8"));
  await prisma.module.create({ data: { id, source: "git", version: m.version } });
  R.resetModuleRegistry();
  const mod = await R.getModule(id).catch(() => null);
  if (!mod) { bad.push(id); continue; }
  const created = await createInstance(prisma, { manifest: mod.manifest, names: { fr: mod.manifest.name?.fr ?? id, en: mod.manifest.name?.en ?? id } });
  inst[id] = created;
}
R.resetModuleRegistry();
if (bad.length) console.error("modules non chargés :", bad.join(", "));

// ─── 3. aides pour les amorçages de modules ───
const views = new Map((await listInstances()).map((v) => [v.moduleId, v]));
const imgCache = new Map();
const helpers = {
  prisma, NOW, day, up, demoImage, S, both, ids, inst,
  view: (id) => views.get(id),
  set: (id, key, value, locale = "") => setSetting(`instance.${inst[id].id}.${key}`, value, locale),
  setBoth: async (id, key, fr, en) => { await setSetting(`instance.${inst[id].id}.${key}`, fr, "fr"); await setSetting(`instance.${inst[id].id}.${key}`, en, "en"); },
  async ctx(id, locale = "fr", row = inst[id]) { R.resetModuleRegistry(); const mod = await R.getModule(id); const v = (await listInstances()).find((x) => x.id === row.id); return buildContext(mod, v, locale); },
  /** Appelle une action d'administration du module (mêmes validations qu'à l'écran), avec tous les droits. Lève une erreur si le module refuse. */
  async act(id, action, values, { locale = "fr", row = inst[id] } = {}) {
    R.resetModuleRegistry();
    const mod = await R.getModule(id);
    const ctx = await helpers.ctx(id, locale, row);
    ctx.can = () => true;
    const spec = mod.def.adminActions?.[action]; const fn = typeof spec === "function" ? spec : spec?.run;
    if (typeof fn !== "function") throw new Error(`${id} : pas d'action ${action} (${Object.keys(mod.def.adminActions ?? {}).join(", ")})`);
    const r = await fn(ctx, values);
    if (r?.error) throw new Error(`${id}.${action} : ${r.error}`);
    if (r?.errors && Object.keys(r.errors).length) throw new Error(`${id}.${action} : ${JSON.stringify(r.errors)}`);
    return r;
  },
  /** Le module (définition chargée) et un contexte d'administration complet, pour les amorçages qui parlent directement au stockage. */
  async raw(id, { locale = "fr", row = inst[id] } = {}) { R.resetModuleRegistry(); const mod = await R.getModule(id); const ctx = await helpers.ctx(id, locale, row); ctx.can = () => true; return { mod, ctx, dir: path.join(MODULES_DIR, id) }; },
  /** Image de démonstration (cachée par clé) : renvoie /uploads/<nom>. */
  async img(n = 0, w = 800, h = 450, fmt = "png") { const k = `${n}|${w}|${h}|${fmt}`; if (!imgCache.has(k)) imgCache.set(k, await up(await demoImage(w, h, n, fmt), fmt === "jpeg" ? "jpg" : "png")); return imgCache.get(k); },
  /** Une instance de plus d'un module (surnom obligatoire) : `display` / `clickAction` / `basePath` peuvent être imposés. */
  async extra(id, { nickname, fr, en, display, clickAction, basePath }) {
    R.resetModuleRegistry();
    const mod = await R.getModule(id);
    const row = await createInstance(prisma, { manifest: mod.manifest, nickname, basePath, names: { fr: fr ?? nickname, en: en ?? fr ?? nickname } });
    if (display || clickAction) await prisma.moduleInstance.update({ where: { id: row.id }, data: { ...(display ? { display } : {}), ...(clickAction ? { clickAction } : {}) } });
    R.resetModuleRegistry();
    return row;
  },
  async setOn(row, key, value, locale = "") { await setSetting(`instance.${row.id}.${key}`, value, locale); },
  /** Une entrée de contenu publiée à une date donnée, avec traductions. `tr` : { en: { title, summary, body } }. */
  async entry(target, { fr, en, at = NOW, ...rest }) {
    const row = typeof target === "string" ? inst[target] : target;
    const e = await createEntry(prisma, { instanceId: row.id, locale: "fr", status: "published", title: fr.title, summary: fr.summary ?? "", body: fr.body ?? "", ...rest });
    await prisma.entry.update({ where: { id: e.id }, data: { publishedAt: at } });
    if (en) await prisma.entryTranslation.create({ data: { entryId: e.id, instanceId: row.id, locale: "en", slug: (await import("@/core/slug")).slugify(en.title), title: en.title, summary: en.summary ?? "", body: en.body ?? "" } });
    return e;
  },
  home: [],
  /** Données partagées entre amorçages (identifiants de catégories de contacts, etc.). */
  shared: {},
};

// Amorçages propres à chaque module : seed/modules/<id>.mjs (export par défaut : async (h) => {}).
const done = [];
const FIRST = ["contacts", "game-covers", "calendar-manual", "game-suggestions"];
for (const id of [...FIRST.filter((x) => ids.includes(x)), ...ids.filter((x) => !FIRST.includes(x))]) {
  const f = path.join(HERE, "modules", `${id}.mjs`);
  if (!fs.existsSync(f) || (process.env.VISUAL_ONLY && !process.env.VISUAL_ONLY.split(",").includes(id))) continue;
  const fn = (await import(pathToFileURL(f).href)).default;
  await fn(helpers, inst[id]);
  R.resetModuleRegistry();
  done.push(id);
}

// ─── 4. accueil et menu ───
const socialsFile = path.join(HERE, "socials.mjs");
if (fs.existsSync(socialsFile)) await (await import(pathToFileURL(socialsFile).href)).default(helpers);
const homeFile = path.join(HERE, "home.mjs");
if (fs.existsSync(homeFile)) await (await import(pathToFileURL(homeFile).href)).default(helpers);

console.log(JSON.stringify({ modules: ids.length, instances: Object.keys(inst).length, seeded: done, bad }));
await prisma.$disconnect();
