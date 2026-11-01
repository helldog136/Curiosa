import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/core/db";
import { RESERVED_PATHS, UPLOADS_DIR, siteUrl } from "@/core/config";
import { pickName, type InstanceView } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { getSetting, getSiteConfig, type NavItem } from "@/core/settings";
import { loadSocialLinks } from "@/core/social";
import { classifyHref, clip, displayUrl, extractRefs, hostKey, normalizePath, stripLocale } from "./refs";
import type { Fix, Group, Item, LinkTask, LinkTotals, Notes, Severity, Stats } from "./types";

/**
 * CONTRÔLE DU CONTENU — regarder le site. Le cœur lit sa base DIRECTEMENT (par paquets de 200, jamais tout d'un coup) : pages publiées, traductions réelles de chaque entrée,
 * menu, redirections, réglages, fichiers envoyés. Rien n'est modifié et aucun site n'est contacté ici : les liens externes à visiter sont seulement RÉCOLTÉS (voir run.ts et probe.ts).
 */
/** Nom d'un fichier envoyé (copie de `UPLOAD_NAME_RE` de services/uploads.ts : ne pas l'importer, ce fichier écrit sur le disque et ferait tracer tout le projet à la compilation ; un test garde les deux identiques). */
export const UPLOAD_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm|svg)$/;

export const LIMITS = {
  /** Entrées lues au plus (au-delà, le rapport le dit). */
  entries: 5000,
  batch: 200,
  /** Lignes gardées par remarque. */
  items: 40,
  /** Liens externes visités par vérification. */
  links: 200,
  /** Liens visités par site et par vérification. */
  perHost: 25,
  sources: 3,
  uploads: 2000,
  redirects: 200,
  fields: 20,
} as const;

type Add = (id: string, loc: string | null, sev: Severity, item: Item, weight?: number) => void;

class Groups {
  private map = new Map<string, Group>();
  add: Add = (id, loc, sev, item, weight = 1) => {
    const key = `${id}|${loc ?? ""}`;
    let g = this.map.get(key);
    if (!g) { g = { id, loc: loc ?? null, sev, count: 0, items: [] }; this.map.set(key, g); }
    g.count += 1;
    if (id === "alt") g.total = (g.total ?? 0) + weight;
    if (g.items.length < LIMITS.items) g.items.push(item);
  };
  list(): Group[] { return [...this.map.values()]; }
}

/** Ce que le contrôle sait d'une instance : un extrait de ce que le registre des modules en dit (remplaçable dans les tests). */
export type ScanInstance = {
  id: string; key: string; name: string; basePath: string | null; showInNav: boolean; fallbackToDefault: boolean; allowGoLinks: boolean;
  /** Les entrées ont une page à elles servie par le cœur (rubrique ou racine, clic = détail). */
  ownsPages: boolean;
  /** Le module sert lui-même les pages de cette adresse : on ne peut pas dire ce qui y existe. */
  modulePages: boolean;
  /** Le module ajoute lui-même des éléments au menu. */
  navSlot: boolean;
};

export async function loadScanInstances(defaultLocale: string): Promise<ScanInstance[]> {
  return (await getActiveInstances()).map(({ instance, mod }) => {
    const i: InstanceView = instance;
    const modulePages = typeof mod.def.page === "function";
    return {
      id: i.id, key: i.key, name: pickName(i, defaultLocale, defaultLocale), basePath: i.basePath, showInNav: i.showInNav, fallbackToDefault: i.fallbackToDefault, allowGoLinks: i.allowGoLinks,
      ownsPages: !!mod.manifest.content && !modulePages && i.basePath !== null && i.clickAction === "detail",
      modulePages, navSlot: typeof mod.def.slots?.["nav.items"] === "function",
    };
  });
}

export type ScanOptions = {
  checkLinks: boolean;
  maxLinks: number;
  /** Où reprendre dans la liste des liens quand il y en a plus que `maxLinks`. */
  cursor: number;
  skipHosts: Set<string>;
  instances?: ScanInstance[];
  now?: number;
};

export type ScanResult = { groups: Group[]; links: LinkTask[]; linkTotals: LinkTotals; stats: Stats; notes: Notes; locales: string[] };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const isIsoLocale = (l: string) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i.test(l);

/** Lit le site (voir l'en-tête). Ne lève pas pour une rubrique ou un réglage illisible : ils sont notés dans `notes`. */
export async function scanContent(options: ScanOptions): Promise<ScanResult> {
  const now = options.now ?? Date.now();
  const config = await getSiteConfig();
  const defaultLocale = config.defaultLocale;
  const locales = [...new Set([defaultLocale, ...config.locales])].filter(isIsoLocale).slice(0, 12);
  const multi = locales.length > 1;
  let ownHost = "";
  try { ownHost = new URL(siteUrl).host; } catch { /* adresse du site illisible : les liens vers soi-même seront traités comme externes */ }

  const instances = options.instances ?? (await loadScanInstances(defaultLocale));
  const byId = new Map(instances.map((i) => [i.id, i]));
  const ids = instances.map((i) => i.id);
  const byBase = new Map(instances.filter((i) => i.basePath).map((i) => [i.basePath!.toLowerCase(), i]));
  const root = instances.find((i) => i.basePath === "") ?? null;
  const groups = new Groups();
  const notes: Notes = { capped: false, unreadable: [], skipped: { host: 0, ignored: 0 }, modulePages: instances.some((i) => i.modulePages), multi };
  const stats: Stats = { instances: 0, pages: 0, images: 0, links: 0 };

  /* ── Passe 1 : les adresses qui existent (légère : pas de texte) ── */
  const known = new Map<string, { expired: boolean }>(); // chemin public (sans langue) → état
  const goKnown = new Set<string>(); // `<instance>/<slug>` des liens /go/…
  const publishedWhere = (afterId: string | null) => ({ status: "published", publishedAt: { lte: new Date(now) }, instanceId: { in: ids }, ...(afterId ? { id: { gt: afterId } } : {}) });
  let seen = 0;
  try {
    for (let after: string | null = null; ; ) {
      const rows: { id: string; instanceId: string; expiresAt: Date | null; translations: { slug: string }[] }[] = await prisma.entry.findMany({
        where: publishedWhere(after), orderBy: { id: "asc" }, take: LIMITS.batch,
        select: { id: true, instanceId: true, expiresAt: true, translations: { select: { slug: true } } },
      });
      for (const e of rows) {
        const inst = byId.get(e.instanceId);
        if (!inst) continue;
        const expired = !!e.expiresAt && e.expiresAt.getTime() < now;
        for (const tr of e.translations) {
          const slug = tr.slug.toLowerCase();
          const base = inst.basePath ? `/${inst.basePath.toLowerCase()}` : "";
          known.set(`${base}/${slug}`, { expired });
          goKnown.add(`${inst.key.toLowerCase()}/${slug}`);
        }
      }
      seen += rows.length;
      if (rows.length < LIMITS.batch) break;
      if (seen >= LIMITS.entries) { notes.capped = true; break; }
      after = rows[rows.length - 1]!.id;
    }
  } catch { notes.unreadable.push("*"); }

  // Redirections (raccourcis de liens) : un raccourci éteint ne mène nulle part.
  const redirects = new Map<string, boolean>();
  const redirectRows = await prisma.redirect.findMany({ orderBy: { id: "asc" }, take: LIMITS.redirects, select: { path: true, targetUrl: true, active: true, entryId: true } }).catch(() => []);
  for (const r of redirectRows) redirects.set(r.path.replace(/^\/+/, "").toLowerCase(), r.active);

  const uploadsSeen = new Map<string, boolean>();
  async function uploadExists(name: string): Promise<boolean | null> {
    if (!UPLOAD_NAME.test(name)) return null;
    const cached = uploadsSeen.get(name);
    if (cached !== undefined) return cached;
    if (uploadsSeen.size >= LIMITS.uploads) return null;
    const ok = await fs.stat(path.join(UPLOADS_DIR, name)).then((s) => s.isFile(), () => false);
    uploadsSeen.set(name, ok);
    return ok;
  }
  const uploadName = (src: string): string | null => {
    const m = /^\/uploads\/([^/?#]+)/.exec(src.trim());
    return m ? m[1]!.toLowerCase() : null;
  };

  function resolveInternal(p: string): "ok" | "broken" | "expired" {
    const clean = stripLocale(normalizePath(p), locales);
    const segs = clean.split("/").filter(Boolean);
    const first = segs[0];
    if (!first) return "ok";
    if (first === "go") return segs.length === 3 && !goKnown.has(`${segs[1]}/${segs[2]}`) ? "broken" : "ok";
    if (RESERVED_PATHS.has(first)) return "ok";
    const inst = byBase.get(first);
    if (inst) {
      if (inst.modulePages || segs.length === 1) return "ok";
      const hit = segs.length === 2 ? known.get(`/${first}/${segs[1]}`) : undefined;
      return hit ? (hit.expired ? "expired" : "ok") : "broken";
    }
    if (redirects.has(segs.join("/"))) return redirects.get(segs.join("/")) ? "ok" : "broken";
    if (root) {
      if (root.modulePages) return "ok";
      const hit = segs.length === 1 ? known.get(`/${first}`) : undefined;
      if (hit) return hit.expired ? "expired" : "ok";
    }
    return "broken";
  }

  /* ── Liens externes à visiter ── */
  const candidates = new Map<string, LinkTask>();
  let linkCount = 0;
  const addCandidate = (url: string, kind: "link" | "image", label: string, source: { f: Fix | null; w: string }) => {
    linkCount++;
    let c = candidates.get(url);
    if (!c) { c = { u: url, k: kind, label: clip(label, 80), s: [] }; candidates.set(url, c); }
    if (kind === "image") c.k = "image";
    if (c.s.length < LIMITS.sources && !c.s.some((x) => JSON.stringify(x.f) === JSON.stringify(source.f))) c.s.push(source);
  };

  /** Un lien ou une image trouvé quelque part : interne (on le vérifie ici) ou externe (on le récolte). Renvoie ce qu'il faut faire remonter. */
  async function checkRef(href: string, kind: "link" | "image", text: string, where: { loc: string | null; title: string; w: string; fix: Fix | null; keyBase: string }) {
    const c = classifyHref(href, ownHost);
    if (!c) return;
    if (c.kind === "external") { addCandidate(c.url, kind, text || where.title, { f: where.fix, w: where.title || where.w }); return; }
    stats.links++;
    if (c.path.startsWith("/uploads/")) {
      const name = uploadName(c.path);
      const exists = name ? await uploadExists(name) : null;
      if (exists === false) groups.add("upload_missing", where.loc, "important", { k: `up:${where.keyBase}:${name}`, t: where.title, w: where.w, d: ["file", clip(name, 80)], f: where.fix });
      return;
    }
    if (kind === "image") return; // une image du site hors /uploads (fichier du thème…) : rien à dire
    const state = resolveInternal(c.path);
    const label = text ? clip(text, 80) : c.path;
    if (state === "broken") groups.add("internal", where.loc, "important", { k: `in:${where.keyBase}:${c.path}`, t: where.title, w: where.w, d: ["path", c.path, label], f: where.fix });
    else if (state === "expired") groups.add("expired_linked", where.loc, "advised", { k: `ex:${where.keyBase}:${c.path}`, t: where.title, w: where.w, d: ["path", c.path, label], f: where.fix });
  }

  /* ── Passe 2 : les textes ── */
  const titles = new Map<string, (Item & { loc: string })[]>(); // le doublon se juge sur TOUTE la rubrique : cette table vit pendant tout le parcours
  const pages = new Set<string>();
  const activeInstances = new Set<string>();
  seen = 0;
  for (let after: string | null = null; ; ) {
    let rows;
    try {
      rows = await prisma.entry.findMany({ where: publishedWhere(after), orderBy: { id: "asc" }, take: LIMITS.batch, include: { translations: true } });
    } catch { notes.unreadable.push("*"); break; }
    for (const e of rows) {
      const inst = byId.get(e.instanceId);
      if (!inst) continue;
      activeInstances.add(inst.id);
      pages.add(e.id);
      const enabled = e.translations.filter((tr) => locales.includes(tr.locale));
      const ref = enabled.find((tr) => tr.locale === e.sourceLocale) ?? enabled.find((tr) => tr.locale === defaultLocale) ?? enabled[0];
      const available = locales.filter((l) => enabled.some((tr) => tr.locale === l)); // dans l'ordre des langues du site
      const fixFor = (loc: string): Fix => ["e", e.id, loc, inst.key];

      for (const tr of enabled) {
        const loc = tr.locale;
        const title = tr.title.trim();
        const summary = tr.summary.trim();
        const fix = fixFor(loc);
        const label = title;
        const where = { loc, title: label, w: inst.name, fix, keyBase: `${e.id}:${loc}` };
        if (!title) groups.add("title_empty", loc, "important", { k: `te:${e.id}:${loc}`, t: "", w: inst.name, f: fix });
        else if (title.length >= 3) {
          const key = `${inst.id}|${loc}|${norm(title)}`;
          const list = titles.get(key) ?? titles.set(key, []).get(key)!;
          list.push({ k: `dup:${e.id}:${loc}`, t: label, w: inst.name, f: fix, loc });
        }
        if (inst.ownsPages && title && !summary) groups.add("summary", loc, "advised", { k: `sum:${e.id}:${loc}`, t: label, w: inst.name, f: fix });
        if (e.cover && !title && !summary) groups.add("cover_alone", loc, "info", { k: `cv:${e.id}:${loc}`, t: "", w: inst.name, f: fix });

        const refs = extractRefs(tr.body);
        const missing = refs.images.filter((im) => im.alt === "").length;
        stats.images += refs.images.length;
        if (missing) groups.add("alt", loc, "important", { k: `alt:${e.id}:${loc}`, t: label, w: inst.name, d: ["imgs", missing], f: fix }, missing);
        for (const im of refs.images) await checkRef(im.src, "image", im.alt ?? "", where);
        for (const l of refs.links) await checkRef(l.href, "link", l.text, where);
      }

      // Image de couverture et adresse de l'entrée (une seule fois par entrée, dans la langue d'origine).
      const refLoc = ref?.locale ?? defaultLocale;
      const refWhere = { loc: refLoc, title: ref?.title.trim() ?? "", w: inst.name, fix: fixFor(refLoc), keyBase: `${e.id}:${refLoc}:meta` };
      if (e.cover) await checkRef(e.cover, "image", "", refWhere);
      if (e.url) await checkRef(e.url, "link", ref?.title ?? "", refWhere);
      let fields: Record<string, unknown> = {};
      try { const f = JSON.parse(e.fields); if (f && typeof f === "object" && !Array.isArray(f)) fields = f as Record<string, unknown>; } catch { /* champs illisibles : ignorés */ }
      for (const v of Object.values(fields).slice(0, LIMITS.fields)) if (typeof v === "string" && /^https?:\/\//i.test(v)) await checkRef(v, "link", ref?.title ?? "", refWhere);

      // Traductions : les langues réellement disponibles de CETTE entrée, comparées au texte d'origine.
      if (multi && ref && (ref.summary + ref.body).trim().length >= 20) {
        for (const loc of locales) {
          if (loc === ref.locale) continue;
          const tr = enabled.find((x) => x.locale === loc);
          const base = { w: inst.name, f: fixFor(tr ? loc : ref.locale) as Fix, t: ref.title.trim() };
          if (!tr) groups.add("translation_missing", loc, "advised", { k: `tm:${e.id}:${loc}`, ...base, d: [inst.fallbackToDefault ? "fallback" : "hidden", available.join(", ")] });
          else if (tr.title.trim() === ref.title.trim() && tr.summary.trim() === ref.summary.trim() && tr.body === ref.body) groups.add("translation_same", loc, "advised", { k: `ts:${e.id}:${loc}`, ...base, d: ["same", available.join(", ")] });
        }
      }
    }
    seen += rows.length;
    if (rows.length < LIMITS.batch) break;
    if (seen >= LIMITS.entries) { notes.capped = true; break; }
    after = rows[rows.length - 1]!.id;
  }
  for (const list of titles.values()) if (list.length > 1) for (const { loc, ...item } of list) groups.add("title_dup", loc, "advised", { ...item, d: ["dup", list.length] });
  stats.pages = pages.size;
  stats.instances = activeInstances.size;

  /* ── Menu ── */
  const navFix: Fix = ["n"];
  const pick = (label: Record<string, string>, fallback: string) => clip(label[defaultLocale] ?? Object.values(label)[0] ?? fallback, 80);
  const menuLeaves = (config.nav as NavItem[]).flatMap((n) => (n.children?.length ? n.children : n.href ? [n] : []));
  for (const leaf of menuLeaves.slice(0, 100)) {
    const label = pick(leaf.label ?? {}, leaf.href);
    const c = classifyHref(leaf.href, ownHost);
    if (!c) continue;
    if (c.kind === "external") { addCandidate(c.url, "link", label, { f: navFix, w: label }); continue; }
    if (resolveInternal(c.path) === "broken" && !/^\/uploads\//.test(c.path)) groups.add("menu_broken", null, "important", { k: `mn:${c.path}:${label}`.slice(0, 190), t: label, w: "menu", d: ["path", c.path], f: navFix });
  }
  for (const [name, link] of [["secondary", config.header.secondary], ["button", config.header.button]] as const) {
    if (!link) continue;
    const c = classifyHref(link.href, ownHost);
    if (!c) continue;
    const fix: Fix = ["s", "appearance"];
    if (c.kind === "external") addCandidate(c.url, "link", link.label, { f: fix, w: link.label });
    else if (resolveInternal(c.path) === "broken") groups.add("menu_broken", null, "important", { k: `hd:${name}:${c.path}`, t: clip(link.label, 80), w: "header", d: ["path", c.path], f: fix });
  }
  const navCount = instances.filter((i) => i.showInNav && i.basePath).length + menuLeaves.length;
  if (navCount === 0 && !instances.some((i) => i.navSlot)) groups.add("menu_empty", null, "advised", { k: "menu_empty", t: "", f: navFix });

  /* ── Textes du site, boutons des réseaux sociaux et raccourcis ── */
  for (const loc of locales) {
    const about = await getSetting<string>("site.about", loc).catch(() => undefined);
    if (typeof about === "string" && about) {
      const where = { loc, title: "", w: "about", fix: ["s", "site"] as Fix, keyBase: `about:${loc}` };
      const refs = extractRefs(about);
      stats.images += refs.images.length;
      for (const im of refs.images) await checkRef(im.src, "image", im.alt ?? "", where);
      for (const l of refs.links) await checkRef(l.href, "link", l.text, where);
    }
  }
  try {
    const socials = await Promise.race([loadSocialLinks(defaultLocale, 20), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("slow")), 5000).unref?.())]);
    const adminOf = new Map(instances.map((i) => [i.key, i.id]));
    for (const s of socials) {
      const c = classifyHref(s.href, ownHost);
      if (c?.kind !== "external") continue;
      const id = adminOf.get(s.instance);
      addCandidate(c.url, "link", s.label || hostKey(c.url), { f: id ? ["i", id] : ["x"], w: s.label || "" });
    }
  } catch { /* boutons illisibles ou trop lents : on ne les visite pas cette fois */ }
  for (const r of redirectRows) {
    if (!r.active || r.entryId) continue;
    const c = classifyHref(r.targetUrl, ownHost);
    if (c?.kind === "external") addCandidate(c.url, "link", `/${r.path.replace(/^\/+/, "")}`, { f: ["r"], w: `/${r.path.replace(/^\/+/, "")}` });
  }
  stats.links += linkCount;

  /* ── Le site lui-même ── */
  // Une langue sans accroche propre montre celle de la langue d'origine (comme sur le site) : on ne regarde donc que celle-là.
  if (!String((await getSetting<string>("site.tagline", defaultLocale).catch(() => undefined)) ?? "").trim()) groups.add("home", null, "advised", { k: "home", t: "", f: ["s", "site"] });
  if (!String(config.contactEmail ?? "").trim()) groups.add("contact", null, "info", { k: "contact", t: "", f: ["s", "site"] });
  if (stats.pages === 0) groups.add("empty", null, "info", { k: "empty", t: "", f: ["n"] });
  if (/^http:\/\//i.test(siteUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(siteUrl)) groups.add("site_http", null, "info", { k: "site_http", t: displayUrl(siteUrl, 80), f: null });

  /* ── Les liens à visiter : une fenêtre de `maxLinks` (on reprend où la fois précédente s'est arrêtée), au plus `perHost` par site, répartis pour ne jamais frapper deux fois de suite le même ── */
  const maxLinks = Math.min(LIMITS.links, Math.max(1, Math.trunc(options.maxLinks) || LIMITS.links));
  const everything = [...candidates.values()];
  const total = everything.length;
  const start = total > maxLinks ? Math.max(0, Math.trunc(options.cursor) || 0) % total : 0;
  const window: LinkTask[] = [];
  for (let i = 0; i < Math.min(total, maxLinks); i++) window.push(everything[(start + i) % total]!);
  const perHost = new Map<string, number>();
  const byHost = new Map<string, LinkTask[]>();
  const settled: LinkTask[] = [];
  for (const c of window) {
    const h = hostKey(c.u);
    if (options.skipHosts.has(h)) { notes.skipped.ignored++; settled.push({ ...c, r: { st: "skipped", why: "ignored" } }); continue; }
    const n = perHost.get(h) ?? 0;
    if (n >= LIMITS.perHost) { notes.skipped.host++; settled.push({ ...c, r: { st: "skipped", why: "perhost" } }); continue; }
    perHost.set(h, n + 1);
    (byHost.get(h) ?? byHost.set(h, []).get(h)!).push(c);
  }
  const queues = [...byHost.values()];
  const ordered: LinkTask[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) { const c = q.shift(); if (c) ordered.push(c); }
  return {
    groups: groups.list(),
    links: options.checkLinks ? [...ordered, ...settled] : [],
    linkTotals: { found: total, from: total ? start : 0, count: window.length, window: total > maxLinks },
    stats, notes, locales,
  };
}

