import { prisma } from "./db";
import { hasPublicPage } from "./modules/publicPage";
import { pickName } from "./instances";
import type { Translator } from "./i18n/dictionary";
import { SYSTEM_PAGES, alreadyInMenu, matchesQuery, refKey, scanMatches, type MenuNode } from "./menu";
import { getActiveInstances } from "./modules/registry";
import { menuEligible, suggestsMenu } from "./modules/menuEligibility";

// Le catalogue de TOUT ce qui peut entrer dans le menu, pour le sélecteur « Ajouter au menu » : pages du site, pages des extensions (une par instance), contenus
// publiés, raccourcis de liens. Chaque groupe se cherche et se pagine ; les contenus et les raccourcis sont lus par paquets (jamais tout en mémoire).

export const CATALOG_GROUPS = ["system", "instance", "entry", "redirect"] as const;
export type CatalogGroup = (typeof CATALOG_GROUPS)[number];
export const isCatalogGroup = (v: unknown): v is CatalogGroup => (CATALOG_GROUPS as readonly string[]).includes(String(v));

export type CatalogItem = {
  kind: CatalogGroup;
  ref: string;
  title: string;
  /** Précision sous le titre : adresse, rubrique d'un contenu, cible d'un raccourci. */
  sub: string;
  /** Adresse interne sans langue (`/blog`) : sert à reconnaître un lien libre déjà au menu qui mène au même endroit. */
  path: string;
  /** L'extension suggère d'être au menu (`suggestInMenu`) : simple mise en avant. */
  suggested?: boolean;
};
export type CatalogPage = { group: CatalogGroup; items: CatalogItem[]; next: string | null };

export const CATALOG_PAGE = 12;
const BATCH = 250;
const MAX_SCAN = 1500;
export const MAX_QUERY = 80;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const cleanCursor = (c: unknown): string | null => (typeof c === "string" && ID_RE.test(c) ? c : null);

type Ctx = { t: Translator; locale: string; defaultLocale: string };

/** Les instances qui ont une page propre au menu public (chemin non vide), dans l'ordre du site. */
async function pageInstances() {
  return (await getActiveInstances()).filter((a) => hasPublicPage(a) && !!a.instance.basePath && menuEligible(a.mod.manifest));
}

export async function searchCatalog(group: CatalogGroup, rawQuery: string, rawCursor: unknown, ctx: Ctx): Promise<CatalogPage> {
  const q = String(rawQuery ?? "").slice(0, MAX_QUERY);
  const cursor = cleanCursor(rawCursor);

  if (group === "system") {
    const items = SYSTEM_PAGES.map((p) => ({ kind: "system" as const, ref: p.key, title: ctx.t(p.label), sub: p.href, path: p.href })).filter((i) => matchesQuery(q, i.title, i.sub));
    return { group, items, next: null };
  }

  if (group === "instance") {
    const offset = cursor && /^\d{1,4}$/.test(cursor) ? Number(cursor) : 0;
    const all = (await pageInstances())
      .map((a) => ({ a, title: pickName(a.instance, ctx.locale, ctx.defaultLocale) }))
      .filter(({ a, title }) => matchesQuery(q, title, a.instance.basePath, a.instance.key));
    const slice = all.slice(offset, offset + CATALOG_PAGE);
    return {
      group,
      items: slice.map(({ a, title }) => ({ kind: "instance" as const, ref: a.instance.id, title, sub: `/${a.instance.basePath}`, path: `/${a.instance.basePath}`, ...(suggestsMenu(a.mod.manifest) ? { suggested: true } : {}) })),
      next: offset + CATALOG_PAGE < all.length ? String(offset + CATALOG_PAGE) : null,
    };
  }

  if (group === "entry") {
    const insts = await pageInstances();
    const byId = new Map(insts.map((a) => [a.instance.id, a.instance]));
    if (byId.size === 0) return { group, items: [], next: null };
    const { rows, next } = await scanMatches({
      cursor,
      limit: CATALOG_PAGE,
      maxScan: MAX_SCAN,
      fetch: (c) => prisma.entryTranslation.findMany({
        where: { instanceId: { in: [...byId.keys()] }, locale: ctx.defaultLocale, entry: { status: "published", publishedAt: { lte: new Date() } } },
        select: { id: true, entryId: true, instanceId: true, slug: true, title: true },
        orderBy: { id: "desc" },
        take: BATCH,
        ...(c ? { cursor: { id: c }, skip: 1 } : {}),
      }),
      cursorOf: (r) => r.id,
      match: (r) => matchesQuery(q, r.title, r.slug),
    });
    return {
      group,
      items: rows.map((r) => {
        const inst = byId.get(r.instanceId)!;
        const path = `${inst.basePath ? `/${inst.basePath}` : ""}/${r.slug}`;
        return { kind: "entry" as const, ref: r.entryId, title: r.title, sub: `${pickName(inst, ctx.locale, ctx.defaultLocale)} · ${path}`, path };
      }),
      next,
    };
  }

  const { rows, next } = await scanMatches({
    cursor,
    limit: CATALOG_PAGE,
    maxScan: MAX_SCAN,
    fetch: (c) => prisma.redirect.findMany({
      where: { active: true },
      select: { id: true, path: true, targetUrl: true },
      orderBy: { id: "desc" },
      take: BATCH,
      ...(c ? { cursor: { id: c }, skip: 1 } : {}),
    }),
    cursorOf: (r) => r.id,
    match: (r) => matchesQuery(q, r.path, r.targetUrl),
  });
  return { group, items: rows.map((r) => ({ kind: "redirect" as const, ref: r.id, title: `/${r.path}`, sub: r.targetUrl.slice(0, 120), path: `/${r.path}` })), next };
}

/** Une première page de chaque groupe (recherche vide) : ce que montre le sélecteur à l'ouverture. */
export async function firstCatalog(ctx: Ctx): Promise<CatalogPage[]> {
  return Promise.all(CATALOG_GROUPS.map((g) => searchCatalog(g, "", null, ctx)));
}

export const MAX_NOT_IN_MENU = 60;

/** « Pages qui ne sont pas dans le menu » : pages du site et pages des extensions, celles que les extensions suggèrent d'abord. Borné. */
export async function pagesNotInMenu(items: readonly MenuNode[], ctx: Ctx): Promise<CatalogItem[]> {
  const system = (await searchCatalog("system", "", null, ctx)).items;
  const insts = await pageInstances();
  const instances: CatalogItem[] = insts.map((a) => ({
    kind: "instance",
    ref: a.instance.id,
    title: pickName(a.instance, ctx.locale, ctx.defaultLocale),
    sub: `/${a.instance.basePath}`,
    path: `/${a.instance.basePath}`,
    ...(suggestsMenu(a.mod.manifest) ? { suggested: true } : {}),
  }));
  const out = [...system, ...instances].filter((i) => !alreadyInMenu(i, items));
  return [...out.filter((i) => i.suggested), ...out.filter((i) => !i.suggested)].slice(0, MAX_NOT_IN_MENU);
}

export type NodeInfo = { title: string; sub: string; missing: boolean };

/** Ce que désignent les éléments actuels du menu (titre, adresse, ou « n'existe plus »), pour l'éditeur. Une requête par sorte de référence, au plus 40 références. */
export async function describeMenuRefs(items: readonly MenuNode[], ctx: Ctx): Promise<Record<string, NodeInfo>> {
  const flat = items.flatMap((n) => [n, ...(n.children ?? [])]).filter((n) => refKey(n));
  const ids = (kind: string) => [...new Set(flat.filter((n) => n.kind === kind).map((n) => n.ref!))];
  const out: Record<string, NodeInfo> = {};
  const gone = (n: MenuNode) => { out[refKey(n)!] = { title: "", sub: "", missing: true }; };

  const active = new Map((await getActiveInstances()).filter(hasPublicPage).map((a) => [a.instance.id, a.instance]));
  const entryIds = ids("entry");
  const entries = entryIds.length
    ? await prisma.entry.findMany({ where: { id: { in: entryIds }, status: "published" }, include: { translations: true }, take: entryIds.length })
    : [];
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const redirectIds = ids("redirect");
  const redirects = redirectIds.length ? await prisma.redirect.findMany({ where: { id: { in: redirectIds } }, select: { id: true, path: true, targetUrl: true, active: true }, take: redirectIds.length }) : [];
  const redirectById = new Map(redirects.map((r) => [r.id, r]));

  for (const n of flat) {
    const key = refKey(n)!;
    if (out[key]) continue;
    if (n.kind === "system") {
      const p = SYSTEM_PAGES.find((x) => x.key === n.ref);
      if (p) out[key] = { title: ctx.t(p.label), sub: p.href, missing: false }; else gone(n);
    } else if (n.kind === "instance") {
      const i = active.get(n.ref!);
      if (i?.basePath) out[key] = { title: pickName(i, ctx.locale, ctx.defaultLocale), sub: `/${i.basePath}`, missing: false }; else gone(n);
    } else if (n.kind === "entry") {
      const e = entryById.get(n.ref!);
      const inst = e ? active.get(e.instanceId) : undefined;
      const tr = e?.translations.find((x) => x.locale === ctx.defaultLocale) ?? e?.translations[0];
      if (e && inst && inst.basePath !== null && tr) out[key] = { title: tr.title, sub: `${inst.basePath ? `/${inst.basePath}` : ""}/${tr.slug}`, missing: false }; else gone(n);
    } else {
      const r = redirectById.get(n.ref!);
      if (r?.active) out[key] = { title: `/${r.path}`, sub: r.targetUrl.slice(0, 120), missing: false }; else gone(n);
    }
  }
  return out;
}
