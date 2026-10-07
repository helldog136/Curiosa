// Importe un site Grav CMS (le dossier `user/` rapatrié tel quel) dans une SAUVEGARDE du framework, à restaurer ensuite depuis
// l'assistant d'installation (« J'ai déjà une sauvegarde ») ou depuis l'admin. Rien n'est écrit sur un site en service.
//
//   npm run import:grav -- <dossier user/ de Grav> [--out fichier.tar.gz.enc] [--password <mot de passe de la sauvegarde>]
//        [--blog route1,route2] [--domain monsite.be] [--owner-email x@y --owner-name "Nom"] [--no-accounts]
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
const defaultLocale = String(system.languages?.default_lang ?? site.default_lang ?? supported[0] ?? "fr");
const configured = supported.length ? supported : [defaultLocale];
const blogRoutes = new Set((flag("blog") ?? "").split(",").map((s) => s.trim().replace(/^\/|\/$/g, "")).filter(Boolean));

// ── lecture des pages ──
/** @typedef {{route:string, slug:string, order:number|null, visible:boolean, dir:string, templates:Map<string, {locale:string,fm:object,body:string,template:string}>, children:Page[], parent:Page|null}} Page */
function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ""));
  if (!m) return { fm: {}, body: text };
  try { return { fm: YAML.parse(m[1]) ?? {}, body: m[2] }; } catch { warn(`frontmatter illisible ignoré`); return { fm: {}, body: m[2] }; }
}
const parseDirName = (n) => { const m = /^(\d+)\.(.+)$/.exec(n); return m ? { order: Number(m[1]), slug: m[2], visible: true } : { order: null, slug: n, visible: false }; };
const LOCALE_RE = new RegExp(`^(.+?)(?:\\.(${[...new Set([...configured, defaultLocale])].join("|")}))?\\.md$`);
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

function readPage(dir, parent, route) {
  const name = path.basename(dir);
  const { order, slug: folderSlug, visible } = parseDirName(name);
  /** @type {Page} */
  const page = { route: "", slug: folderSlug, order, visible, dir, templates: new Map(), children: [], modules: [], parent, media: [] };
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
    // Blocs modulaires (« 01._intro ») : leur contenu est fondu dans la page qui les porte.
    if (parseDirName(f.name).slug.startsWith("_")) { page.modules.push(readPage(path.join(dir, f.name), page, page.route)); continue; }
    page.children.push(readPage(path.join(dir, f.name), page, page.route));
  }
  const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.slug.localeCompare(b.slug);
  page.children.sort(byOrder); page.modules.sort(byOrder);
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
// Une page « blog » qui a des sous-pages devient SA PROPRE collection d'articles (ex. /blog, /nos-sponsors) : les adresses restent identiques.
const isBlogRoot = (p) => blogRoutes.has(p.route) || (blogRoutes.size === 0 && mainOf(p)?.template === "blog" && p.children.length > 0);
const blogRoots = all.filter(isBlogRoot);
const dest = new Map(); // page → "skip" | "pages" | "external" | { blog: racine }
for (const p of all) {
  const t = mainOf(p);
  if (!t) { dest.set(p, "skip"); continue; }
  if (isBlogRoot(p)) { dest.set(p, "skip"); continue; } // la liste est celle du module
  if (t.template === "external" && t.fm.external_url) { dest.set(p, "external"); continue; }
  dest.set(p, p.parent && blogRoots.includes(p.parent) ? { blog: p.parent } : "pages");
}

// langues réellement présentes dans les pages (une langue « supportée » sans contenu n'est pas proposée aux visiteurs)
const usedLocales = new Set(all.flatMap((p) => [...p.templates.keys()]));
const enabledLocales = [defaultLocale, ...configured.filter((l) => l !== defaultLocale && usedLocales.has(l))];

// ── comptes ──
const owner = { email: flag("owner-email"), name: flag("owner-name") };
const accountDir = path.join(root, "accounts");
const accounts = has("no-accounts") || !fs.existsSync(accountDir) ? [] : fs.readdirSync(accountDir).filter((f) => f.endsWith(".yaml")).map((f) => ({ username: f.replace(/\.yaml$/, ""), ...readYaml(path.join(accountDir, f)) })).filter((a) => a.email && a.state !== "disabled");
const users = [];
const randomPw = () => crypto.randomBytes(15).toString("base64url");
for (const a of accounts) {
  const adm = a.access?.admin ?? {};
  // super-administrateur → propriétaire ; accès à la configuration → administrateur ; sinon rédacteur
  const role = adm.super === true ? "owner" : adm.configuration === true ? "admin" : "editor";
  let hash = typeof a.hashed_password === "string" && /^\$2[aby]\$/.test(a.hashed_password) ? a.hashed_password : null;
  if (!hash) { const temp = randomPw(); hash = await bcrypt.hash(temp, 12); warn(`compte « ${a.username} » : pas de mot de passe réutilisable, mot de passe provisoire à lui donner : ${temp}`); }
  if (a.twofa_enabled === true) warn(`compte « ${a.username} » : la double authentification de Grav n'existe pas ici`);
  users.push({ a, role, hash });
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
for (const u of users) created.push(await prisma.user.create({ data: { email: String(u.a.email).toLowerCase(), name: String(u.a.fullname ?? u.a.username), role: u.role, passwordHash: u.hash, locale: enabledLocales.includes(u.a.language) ? u.a.language : defaultLocale } }));
const authorId = created[users.findIndex((u) => u.role === "owner")].id;

// ── réglages du site ──
const setting = (key, value, locale = "") => prisma.setting.create({ data: { key, locale, value: JSON.stringify(value) } });
await setting("i18n.default", defaultLocale); await setting("i18n.enabled", enabledLocales); await setting("i18n.adminDefault", defaultLocale); await setting("setup.completed", true);
const siteName = String(site.title ?? "Mon site");
const tagline = site.metadata?.description ?? site.description;
for (const l of enabledLocales) { await setting("site.name", siteName, l); if (tagline) await setting("site.tagline", String(tagline), l); }

// ── textes ──
const toDate = (v) => { if (!v) return null; const d = new Date(v instanceof Date ? v : String(v)); return Number.isNaN(d.getTime()) ? null : d; };
function summaryOf(fm, body) {
  const given = fm.summary?.text ?? (typeof fm.summary === "string" ? fm.summary : null) ?? fm.subtitle ?? fm.metadata?.description;
  if (given) return String(given).slice(0, 300);
  const first = body.split(/\n\s*\n/).map((x) => x.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`]/g, "").trim()).find((x) => x.length > 20);
  return first ? (first.length > 200 ? `${first.slice(0, 197).trimEnd()}…` : first) : "";
}
/** HTML brut (non accepté par le framework) → équivalent Markdown quand c'est possible : vidéos et publications intégrées deviennent des liens. */
function htmlToMarkdown(text, page) {
  let out = text
    .replace(/<script[\s\S]*?<\/script>/gi, () => { return ""; })
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>\s*<\/iframe>/gi, (_, src) => {
      const yt = /youtube(?:-nocookie)?\.com\/embed\/([\w-]{6,})/.exec(src);
      const tw = /player\.twitch\.tv\/?\?(?:[^"']*&)?(channel|video)=([\w]+)/.exec(src);
      const url = yt ? `https://www.youtube.com/watch?v=${yt[1]}` : tw ? (tw[1] === "channel" ? `https://www.twitch.tv/${tw[2]}` : `https://www.twitch.tv/videos/${tw[2]}`) : src.split("?")[0];
      report.notes.push(`${page.route} : vidéo intégrée → lien (${url})`);
      return `\n\n[▶ Voir la vidéo](${url})\n\n`;
    })
    .replace(/<blockquote[^>]*instagram-media[\s\S]*?<\/blockquote>/gi, (m) => {
      const link = /data-instgrm-permalink=["']([^"']+)["']/.exec(m)?.[1]?.split("?")[0];
      if (link) report.notes.push(`${page.route} : publication Instagram intégrée → lien (${link})`);
      return link ? `\n\n[Voir sur Instagram](${link})\n\n` : "";
    })
    .replace(/<br\s*\/?>/gi, "\n");
  const stripped = out.replace(/<\/?(?!https?:)[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, () => { return ""; });
  if (stripped !== out) warn(`HTML brut retiré dans « ${page.route} » : mise en forme à vérifier`);
  return stripped.replace(/\n{3,}/g, "\n\n");
}

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

// ── collections et adresses ──
await R.getEnabledModules();
const mk = async (id, opts = {}) => { const m = BUILTIN_MODULES.find((b) => b.manifest.id === id).manifest; return { m, inst: await createInstance(prisma, { manifest: m, ...opts, names: opts.names ?? defaultNames(m, enabledLocales) }) }; };
const hero = await mk("hero");
const blogs = new Map(); // page racine → { inst, base }
for (const root of blogRoots) {
  const t = mainOf(root);
  const names = Object.fromEntries(enabledLocales.map((l) => [l, String(root.templates.get(l)?.fm.title ?? t.fm.title ?? root.slug)]));
  const body = (t.body ?? "").trim();
  const b = await mk("blog", { names, basePath: slugify(root.route.replace(/\//g, "-")), descriptions: Object.fromEntries(enabledLocales.map((l) => [l, summaryOf(root.templates.get(l)?.fm ?? t.fm, root.templates.get(l)?.body ?? body)])) });
  blogs.set(root, { inst: b.inst, base: b.inst.basePath });
}
const hasPages = [...dest.values()].some((d) => d === "pages");
const pagesMod = hasPages ? await mk("pages") : null;
const mainBlog = blogRoots.length ? blogs.get(blogRoots.find((r) => r.route === "blog") ?? blogRoots[0]) : null;
await setting("home.sections", [{ id: "hero", instance: hero.inst.key, section: "hero", options: {} }, ...(mainBlog ? [{ id: "blog", instance: mainBlog.inst.key, section: "latest", options: { count: 3 } }] : [])]);

const newPath = new Map();
const used = new Map(); // instance → slugs pris
for (const p of all) {
  const d = dest.get(p); if (d === "skip" || d === "external") continue;
  const key = d === "pages" ? "pages" : d.blog.route;
  const set = used.get(key) ?? new Set(); used.set(key, set);
  let slug = slugify(p.slug) || "page"; let n = 2;
  while (set.has(slug)) slug = `${slugify(p.slug)}-${n++}`;
  set.add(slug); p.newSlug = slug;
  newPath.set(p.route, d === "pages" ? `/${slug}` : `/${blogs.get(d.blog).base}/${slug}`);
}
for (const [r, b] of blogs) newPath.set(r.route, `/${b.base}`); // la liste de la collection elle-même
const homeRoute = String(system.home?.alias ?? "/home").replace(/^\//, "");
const domain = flag("domain")?.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
function mapLink(href, page) {
  // lien absolu vers ce même site (--domain) → lien interne, traité comme tel
  if (domain) { const own = new RegExp(`^https?://(?:www\\.)?${domain.replace(/\./g, "\\.")}(/[^?#]*)?([?#].*)?$`, "i").exec(href); if (own) href = `${own[1] ?? "/"}${own[2] ?? ""}`; }
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href;
  const [rawPath, tail = ""] = href.split(/(?=[?#])/);
  const abs = (rawPath.startsWith("/") ? rawPath : path.posix.join("/", page.route, rawPath)).replace(/^\/+|\/+$/g, "");
  const noLang = abs.replace(new RegExp(`^(${configured.join("|")})(/|$)`), "");
  const target = newPath.get(abs) ?? newPath.get(noLang) ?? (noLang === "" || noLang === homeRoute ? "/" : null);
  return target ? `${target}${tail}` : href;
}
async function convertBody(body, page) {
  let text = body.replace(/^===\s*$/m, "").replace(/\r\n/g, "\n");
  text = htmlToMarkdown(text, page);
  if (/\{\{|\{%/.test(text)) warn(`Twig laissé tel quel dans « ${page.route} » : à relire`);
  for (const m of [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]) {
    const src = m[2].split("?")[0];
    if (/^(https?:)?\/\//.test(src)) continue;
    const up = await importImage(path.join(page.dir, decodeURIComponent(src)), page.route);
    text = text.split(m[0]).join(up ? `![${m[1]}](${up})` : `![${m[1]}](${src})`);
  }
  text = text.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, label, href, title) => {
    const [h] = href.split("?");
    if (/\.(pdf|docx?|xlsx?|zip|mp4|mp3|svg)$/i.test(h) && !/^https?:/.test(h)) warn(`fichier non importé, lien conservé (${page.route}) : ${href}`);
    return `[${label}](${mapLink(href, page)}${title})`;
  });
  return text.trim();
}
/** Texte d'une page dans une langue : son corps, puis ses blocs modulaires (titre + contenu) quand elle en a. */
async function pageText(p, locale) {
  const t = p.templates.get(locale); if (!t) return null;
  let text = await convertBody(t.body, p);
  for (const m of p.modules) {
    const mt = m.templates.get(locale) ?? m.templates.get(defaultLocale) ?? [...m.templates.values()][0];
    if (!mt) continue;
    if (/recent-posts|latest/i.test(mt.template)) { report.notes.push(`${p.route} : bloc « ${mt.fm.title} » (derniers articles) non repris — l'accueil du framework affiche déjà les derniers articles`); continue; }
    let block = await convertBody(mt.body, { ...m, route: `${p.route}/${m.slug}`, dir: m.dir });
    if (mt.fm.button_text && mt.fm.button_url) block += `\n\n[${mt.fm.button_text}](${mapLink(String(mt.fm.button_url), p)})`;
    const title = mt.fm.show_title === "1" || mt.fm.show_title === 1 ? `## ${mt.fm.title}\n\n` : "";
    if (block.trim()) text += `${text ? "\n\n" : ""}${title}${block}`;
    const img = mt.fm.featured_image; if (img) { const up = await importImage(path.join(m.dir, String(img)), p.route); if (up && !p.blockCover) p.blockCover = up; }
  }
  return text;
}

// ── entrées ──
const redirects = [];
let nEntries = 0;
for (const p of all) {
  const d = dest.get(p);
  if (d === "external") {
    redirects.push({ path: p.route, targetUrl: String(mainOf(p).fm.external_url), permanent: false });
    report.notes.push(`« ${p.route} » pointait vers un site externe (${mainOf(p).fm.external_url}) : devient une redirection /${p.route}`);
    continue;
  }
  if (d === "skip") continue;
  const inst = (d === "pages" ? pagesMod : blogs.get(d.blog)).inst;
  const base = mainOf(p);
  const fm = base.fm;
  const published = fm.published !== false;
  const mtime = (() => { try { return fs.statSync(path.join(p.dir, `${base.template}${base.locale === defaultLocale && fs.existsSync(path.join(p.dir, `${base.template}.md`)) ? "" : `.${base.locale}`}.md`)).mtime; } catch { return null; } })();
  const date = toDate(fm.publish_date) ?? toDate(fm.date) ?? toDate(fm.sitemap?.lastmod) ?? mtime;
  const coverName = [fm.featured_image, fm.header_image, fm.image].find((x) => typeof x === "string") ?? (d !== "pages" ? p.media.find((f) => IMAGE.test(f)) : undefined);
  let cover = coverName ? await importImage(path.join(p.dir, coverName), p.route) : null;
  const tags = [...new Set([...(fm.taxonomy?.tag ?? []), ...(fm.taxonomy?.category ?? [])].map(String))];
  const texts = new Map();
  for (const [locale] of p.templates) if (enabledLocales.includes(locale)) texts.set(locale, await pageText(p, locale));
  if (!cover) cover = p.blockCover ?? null;
  const entry = await prisma.entry.create({ data: {
    instanceId: inst.id, status: published ? "published" : "draft", publishedAt: published ? (date ?? new Date()) : null,
    cover, tags: JSON.stringify(tags), position: p.order ?? 0, fields: "{}", sourceLocale: base.locale, authorId, ...(date ? { createdAt: date } : {}),
  } });
  for (const [locale, text] of texts) {
    const t = p.templates.get(locale);
    await prisma.entryTranslation.create({ data: { entryId: entry.id, instanceId: inst.id, locale, slug: p.newSlug, title: String(t.fm.title ?? p.slug), summary: summaryOf(t.fm, text), body: text } });
  }
  nEntries++;
  const fresh = newPath.get(p.route);
  if (p.route === homeRoute) { report.notes.push(`la page d'accueil Grav (« ${p.route} ») est importée comme page « ${p.newSlug} » : l'accueil du framework se compose de sections (admin → Accueil)`) ; }
  else if (fresh !== `/${p.route}`) redirects.push({ path: p.route, targetUrl: fresh, entryId: entry.id, permanent: true });
}
const seen = new Set();
for (const r of redirects) { if (seen.has(r.path)) continue; seen.add(r.path); await prisma.redirect.create({ data: r }); }
for (const [r, b] of blogs) report.notes.push(`la page Grav « ${r.route} » est une collection d'articles, servie sous /${b.base}`);

// ── sauvegarde ──
const backupPassword = flag("password") ?? crypto.randomBytes(15).toString("base64url");
const { buffer, filename } = await createBackup(backupPassword);
const outFile = flag("out") ?? path.resolve(filename);
fs.writeFileSync(outFile, buffer);
const lines = [
  `Import Grav → ${outFile}`, `${nEntries} pages/articles, ${users.length} compte(s), ${redirects.length} redirection(s), ${[...uploadCache.values()].filter(Boolean).length} image(s) importée(s), langues : ${enabledLocales.join(", ")}`,
  ...[...new Set(report.notes)].map((n) => `• ${n}`), ...(report.warnings.length ? ["", "À vérifier :", ...[...new Set(report.warnings)].map((w) => `⚠ ${w}`)] : ["", "Aucun avertissement."]),
];
fs.writeFileSync(`${outFile}.rapport.txt`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
console.log(`\nMot de passe de la sauvegarde : ${backupPassword}`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(0);
