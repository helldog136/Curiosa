// Importe un site Grav CMS (le dossier `user/` rapatrié tel quel) dans une SAUVEGARDE du framework, à restaurer ensuite depuis
// l'assistant d'installation (« J'ai déjà une sauvegarde ») ou depuis l'admin. Rien n'est écrit sur un site en service.
//
//   npm run import:grav -- <dossier user/ de Grav> [--out fichier.tar.gz.enc] [--password <mot de passe de la sauvegarde>]
//        [--blog route1,route2] [--owner-email x@y --owner-name "Nom"] [--no-accounts]
//
// Ce que fait la conversion (Grav stocke tout en fichiers : user/pages/NN.slug/<modèle>[.<langue>].md + médias) :
//  - config/site.yaml → nom et accroche du site ; config/system.yaml → langues ;
//  - pages dont le modèle est « blog » (ou listées par --blog) → leurs sous-pages deviennent des articles du Blog ; les autres pages → module Pages ;
//  - frontmatter : title, published, date/publish_date, taxonomy (étiquettes), header_image/image, summary ; `===` (résumé Grav) retiré ;
//  - images → fichiers envoyés du framework (png/jpg/webp/gif ≤ 5 Mo), liens et images relatifs réécrits ;
//  - ancienne adresse ≠ nouvelle → redirection permanente (les liens existants continuent de marcher) ;
//  - comptes Grav (user/accounts/*.yaml) → utilisateurs ; leur mot de passe Grav (bcrypt) reste valable.
// Ce qui ne peut pas être converti (modules Twig, fichiers PDF/vidéo/SVG, images trop lourdes…) est listé dans le rapport, jamais ignoré en silence.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const root = args[0] && !args[0].startsWith("--") ? path.resolve(args[0]) : undefined;
if (!root || !fs.existsSync(path.join(root, "pages"))) { console.error("Usage : npm run import:grav -- <dossier user/ de Grav> [--out f] [--password p] [--blog route,route]\n(le dossier doit contenir pages/)"); process.exit(1); }

// ── base temporaire : l'import ne touche jamais à une base existante ──
const work = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-grav-"));
process.env.DATA_DIR = work;
process.env.DATABASE_URL = `file:${path.join(work, "import.db")}`;
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "ignore", env: process.env });

const { prisma } = await import("@/core/db");
const { createInstance, defaultNames } = await import("@/core/instanceService");
const { BUILTIN_MODULES } = await import("@/modules-builtin");
const { saveUpload, MAX_UPLOAD_BYTES } = await import("@/core/services/uploads");
const { slugify } = await import("@/core/slug");
const R = await import("@/core/modules/registry");
const { createBackup } = await import("@/core/backup/export");
const bcrypt = (await import("bcryptjs")).default;

const report = { warnings: [], notes: [] };
const warn = (m) => report.warnings.push(m);
const readYaml = (f) => { try { return YAML.parse(fs.readFileSync(f, "utf8")) ?? {}; } catch { return {}; } };

// ── configuration Grav ──
const site = readYaml(path.join(root, "config", "site.yaml"));
const system = readYaml(path.join(root, "config", "system.yaml"));
const supported = Array.isArray(system.languages?.supported) ? system.languages.supported.map(String) : [];
const defaultLocale = supported[0] ?? "fr";
const locales = supported.length ? supported : [defaultLocale];
const blogRoutes = new Set((flag("blog") ?? "").split(",").map((s) => s.trim().replace(/^\/|\/$/g, "")).filter(Boolean));

// ── lecture des pages ──
/** @typedef {{route:string, slug:string, order:number|null, visible:boolean, dir:string, templates:Map<string, {locale:string,fm:object,body:string,template:string}>, children:Page[], parent:Page|null}} Page */
function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ""));
  if (!m) return { fm: {}, body: text };
  try { return { fm: YAML.parse(m[1]) ?? {}, body: m[2] }; } catch { warn(`frontmatter illisible ignoré`); return { fm: {}, body: m[2] }; }
}
const parseDirName = (n) => { const m = /^(\d+)\.(.+)$/.exec(n); return m ? { order: Number(m[1]), slug: m[2], visible: true } : { order: null, slug: n, visible: false }; };
const LOCALE_RE = new RegExp(`^(.+?)(?:\\.(${locales.join("|")}))?\\.md$`);
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

function readPage(dir, parent, route) {
  const name = path.basename(dir);
  const { order, slug: folderSlug, visible } = parseDirName(name);
  /** @type {Page} */
  const page = { route: "", slug: folderSlug, order, visible, dir, templates: new Map(), children: [], parent, media: [] };
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isFile() && f.name.endsWith(".md")) {
      const m = LOCALE_RE.exec(f.name); if (!m) continue;
      const { fm, body } = splitFrontmatter(fs.readFileSync(path.join(dir, f.name), "utf8"));
      const locale = m[2] ?? defaultLocale;
      page.templates.set(locale, { locale, fm, body, template: m[1] });
    } else if (f.isFile() && !f.name.endsWith(".md") && !f.name.endsWith(".yaml") && !f.name.endsWith(".json")) {
      page.media.push(f.name);
    }
  }
  const main = page.templates.get(defaultLocale) ?? [...page.templates.values()][0];
  if (main?.fm?.slug) page.slug = String(main.fm.slug);
  page.route = [route, page.slug].filter(Boolean).join("/");
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!f.isDirectory()) continue;
    if (f.name.startsWith("_")) { warn(`bloc modulaire ignoré : ${path.relative(path.join(root, "pages"), path.join(dir, f.name))} (à recréer à la main)`); continue; }
    page.children.push(readPage(path.join(dir, f.name), page, page.route));
  }
  page.children.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.slug.localeCompare(b.slug));
  return page;
}
const topDirs = fs.readdirSync(path.join(root, "pages"), { withFileTypes: true }).filter((d) => d.isDirectory());
for (const d of topDirs) if (d.name.startsWith("_")) warn(`bloc modulaire ignoré : ${d.name} (à recréer à la main)`);
const top = topDirs.filter((d) => !d.name.startsWith("_"))
  .map((d) => readPage(path.join(root, "pages", d.name), null, ""));
top.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
const all = []; const walk = (p) => { all.push(p); p.children.forEach(walk); }; top.forEach(walk);

// ── où va chaque page ──
const mainOf = (p) => p.templates.get(defaultLocale) ?? [...p.templates.values()][0];
const isBlogRoot = (p) => blogRoutes.has(p.route) || (blogRoutes.size === 0 && mainOf(p)?.template === "blog");
const blogRoots = all.filter(isBlogRoot);
const dest = new Map(); // page → "blog" | "pages" | "skip"
for (const p of all) {
  const t = mainOf(p);
  if (!t) { dest.set(p, "skip"); continue; }
  if (isBlogRoot(p)) { dest.set(p, "skip"); continue; } // la liste du blog est celle du module
  dest.set(p, p.parent && blogRoots.includes(p.parent) ? "blog" : "pages");
}

// ── instance et site ──
const owner = { email: flag("owner-email"), name: flag("owner-name") };
const accountDir = path.join(root, "accounts");
const accounts = has("no-accounts") || !fs.existsSync(accountDir) ? [] : fs.readdirSync(accountDir).filter((f) => f.endsWith(".yaml")).map((f) => ({ username: f.replace(/\.yaml$/, ""), ...readYaml(path.join(accountDir, f)) })).filter((a) => a.email);
const users = [];
const randomPw = () => crypto.randomBytes(15).toString("base64url");
for (const a of accounts) {
  const isAdmin = a.access?.admin?.super === true || a.access?.admin?.login === true;
  let hash = typeof a.hashed_password === "string" && /^\$2[aby]\$/.test(a.hashed_password) ? a.hashed_password : null;
  let temp = null;
  if (!hash) { temp = randomPw(); hash = await bcrypt.hash(temp, 12); warn(`compte « ${a.username} » : pas de mot de passe réutilisable, mot de passe provisoire à lui donner : ${temp}`); }
  users.push({ a, role: a.access?.admin?.super === true ? "owner" : isAdmin ? "admin" : "editor", hash });
}
if (!users.some((u) => u.role === "owner")) {
  if (users.length) { users[0].role = "owner"; warn(`aucun super-administrateur Grav : « ${users[0].a.username} » devient propriétaire`); }
  else {
    const temp = randomPw();
    users.push({ a: { email: owner.email ?? "admin@example.invalid", fullname: owner.name ?? "Administrateur", username: "admin" }, role: "owner", hash: await bcrypt.hash(temp, 12) });
    warn(`aucun compte Grav : propriétaire créé (${owner.email ?? "admin@example.invalid"}), mot de passe provisoire : ${temp}`);
  }
}
const created = [];
for (const u of users) created.push(await prisma.user.create({ data: { email: String(u.a.email).toLowerCase(), name: String(u.a.fullname ?? u.a.username), role: u.role, passwordHash: u.hash, locale: defaultLocale } }));
const authorId = created[users.findIndex((u) => u.role === "owner")].id;

const setting = (key, value, locale = "") => prisma.setting.create({ data: { key, locale, value: JSON.stringify(value) } });
await setting("i18n.default", defaultLocale); await setting("i18n.enabled", locales); await setting("i18n.adminDefault", defaultLocale); await setting("setup.completed", true);
await setting("site.name", String(site.title ?? "Mon site"), defaultLocale);
const tagline = site.metadata?.description ?? site.description; if (tagline) await setting("site.tagline", String(tagline), defaultLocale);
for (const l of locales) if (l !== defaultLocale) { await setting("site.name", String(site.title ?? "Mon site"), l); if (tagline) await setting("site.tagline", String(tagline), l); }

await R.getEnabledModules();
const mk = async (id) => { const m = BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest; return { m, inst: await createInstance(prisma, { manifest: m, names: defaultNames(m, locales) }) }; };
const hero = await mk("hero");
const wantsBlog = [...dest.values()].includes("blog");
const blog = wantsBlog ? await mk("blog") : null;
const pagesMod = [...dest.values()].includes("pages") ? await mk("pages") : null;
await setting("home.sections", [{ id: "hero", instance: hero.inst.key, section: "hero", options: {} }, ...(blog ? [{ id: "blog", instance: blog.inst.key, section: "latest", options: { count: 3 } }] : [])]);

// ── images ──
const uploadCache = new Map();
async function importImage(file, ctx) {
  if (uploadCache.has(file)) return uploadCache.get(file);
  let out = null;
  if (!fs.existsSync(file)) warn(`image introuvable (${ctx}) : ${path.relative(root, file)}`);
  else if (!IMAGE.test(file)) warn(`format non pris en charge (${ctx}) : ${path.relative(root, file)}`);
  else if (fs.statSync(file).size > MAX_UPLOAD_BYTES) warn(`image > 5 Mo non importée (${ctx}) : ${path.relative(root, file)} — à réduire puis envoyer depuis l'admin`);
  else { out = await saveUpload(fs.readFileSync(file)); if (!out) warn(`image illisible (${ctx}) : ${path.relative(root, file)}`); }
  uploadCache.set(file, out);
  return out;
}

// ── adresses : ancienne route → nouvelle adresse ──
const newPath = new Map();
const usedSlug = { blog: new Set(), pages: new Set() };
for (const p of all) {
  const d = dest.get(p); if (d === "skip") continue;
  let slug = slugify(p.slug) || "page"; const used = usedSlug[d];
  let n = 2; while (used.has(slug)) slug = `${slugify(p.slug)}-${n++}`;
  used.add(slug);
  p.newSlug = slug;
  newPath.set(p.route, d === "blog" ? `/blog/${slug}` : `/${slug}`);
}
const homeRoute = String(system.home?.alias ?? "/home").replace(/^\//, "");
function mapLink(href, page) {
  if (/^([a-z]+:|#|mailto:|tel:)/i.test(href)) return href;
  const [rawPath, tail = ""] = href.split(/(?=[?#])/);
  const abs = (rawPath.startsWith("/") ? rawPath : path.posix.join("/", page.route, rawPath)).replace(/^\/+|\/+$/g, "");
  const target = newPath.get(abs) ?? (abs === "" ? "/" : null);
  return target ? `${target}${tail}` : href;
}
function summaryOf(fm, body) {
  const given = fm.summary?.text ?? (typeof fm.summary === "string" ? fm.summary : null) ?? fm.metadata?.description;
  if (given) return String(given).slice(0, 300);
  const first = body.split(/\n\s*\n/).map((s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/[#>*_`[\]]|\([^)]*\)/g, "").trim()).find((s) => s.length > 20);
  return first ? (first.length > 200 ? `${first.slice(0, 197).trimEnd()}…` : first) : "";
}
async function convertBody(body, page) {
  let text = body.replace(/^===\s*$/m, "").replace(/\r\n/g, "\n");
  if (/\{\{|\{%|\[\/?[a-z-]+(?:=[^\]]*)?\]/i.test(text) && /\{\{|\{%/.test(text)) warn(`Twig/shortcodes laissés tels quels dans « ${page.route} » : à relire`);
  const images = [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)];
  for (const m of images) {
    const src = m[2].split("?")[0];
    if (/^(https?:)?\/\//.test(src)) continue;
    const file = src.startsWith("/") ? path.join(root, "..", src) : path.join(page.dir, decodeURIComponent(src));
    const up = await importImage(file, page.route);
    text = text.split(m[0]).join(up ? `![${m[1]}](${up})` : `![${m[1]}](${src})`);
  }
  text = text.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, label, href, title) => {
    const [h] = href.split("?");
    if (/\.(pdf|docx?|xlsx?|zip|mp4|mp3|svg)$/i.test(h) && !/^https?:/.test(h)) warn(`fichier non importé, lien conservé (${page.route}) : ${href}`);
    return `[${label}](${mapLink(href, page)}${title})`;
  });
  return text.trim();
}

// ── entrées ──
const toDate = (v) => { if (!v) return null; const d = new Date(v instanceof Date ? v : String(v)); return Number.isNaN(d.getTime()) ? null : d; };
const redirects = [];
let nEntries = 0;
for (const p of all) {
  const d = dest.get(p); if (d === "skip") continue;
  const inst = (d === "blog" ? blog : pagesMod).inst;
  const base = p.templates.get(defaultLocale) ?? [...p.templates.values()][0];
  const fm = base.fm;
  const published = fm.published !== false;
  const date = toDate(fm.publish_date) ?? toDate(fm.date);
  const cover = fm.header_image ?? fm.image;
  let coverUrl = null;
  const coverName = typeof cover === "string" ? cover : p.media.find((f) => IMAGE.test(f));
  if (coverName && d === "blog") coverUrl = await importImage(path.join(p.dir, coverName), p.route);
  const tags = [...new Set([...(fm.taxonomy?.tag ?? []), ...(fm.taxonomy?.category ?? [])].map(String))];
  const entry = await prisma.entry.create({ data: {
    instanceId: inst.id, status: published ? "published" : "draft", publishedAt: published ? (date ?? new Date()) : null,
    cover: coverUrl, tags: JSON.stringify(tags), position: p.order ?? 0, fields: "{}", sourceLocale: base.locale, authorId, ...(date ? { createdAt: date } : {}),
  } });
  for (const [locale, t] of p.templates) {
    if (!locales.includes(locale)) continue;
    const text = await convertBody(t.body, p);
    await prisma.entryTranslation.create({ data: {
      entryId: entry.id, instanceId: inst.id, locale, slug: p.newSlug,
      title: String(t.fm.title ?? p.slug), summary: summaryOf(t.fm, text), body: text,
    } });
  }
  nEntries++;
  const fresh = newPath.get(p.route);
  const old = p.route === homeRoute ? null : p.route;
  if (old && fresh !== `/${old}`) redirects.push({ path: old, targetUrl: fresh, entryId: entry.id });
  if (p.route === homeRoute) report.notes.push(`la page d'accueil Grav (« ${p.route} ») est importée comme page « ${p.newSlug} » : l'accueil du framework se compose de sections (Mes sites → Accueil)`);
}
const seen = new Set();
for (const r of redirects) { if (seen.has(r.path)) continue; seen.add(r.path); await prisma.redirect.create({ data: { ...r, permanent: true } }); }
if (blog) report.notes.push(`le blog Grav « ${blogRoots.map((b) => b.route).join(", ")} » est servi sous /blog (anciennes adresses redirigées)`);

// ── sauvegarde ──
const backupPassword = flag("password") ?? crypto.randomBytes(15).toString("base64url");
const { buffer, filename } = await createBackup(backupPassword);
const outFile = flag("out") ?? path.resolve(filename);
fs.writeFileSync(outFile, buffer);
const lines = [
  `Import Grav → ${outFile}`, `${nEntries} pages/articles, ${users.length} compte(s), ${redirects.length} redirection(s), ${uploadCache.size} image(s) vues, langues : ${locales.join(", ")}`,
  ...report.notes.map((n) => `• ${n}`), ...(report.warnings.length ? ["", "À vérifier :", ...[...new Set(report.warnings)].map((w) => `⚠ ${w}`)] : ["", "Aucun avertissement."]),
];
fs.writeFileSync(`${outFile}.rapport.txt`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nMot de passe de la sauvegarde : ${backupPassword}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(0);
