import { prisma } from "./db";
import { pickName } from "./instances";
import { withLocale } from "./links";
import { getSetting } from "./settings";
import { getActiveInstances } from "./modules/registry";
import { instanceHasNews } from "./modules/runtime";
import { listInstances } from "./instances";
import { makeTranslator } from "./i18n/dictionary";
import { MENU_SETTING, isRefKind, parseStoredMenu, systemPage, type MenuLabel, type MenuNode } from "./menu";
import { legacyMenuFromDb } from "./menuStore";
import { isSafeExternalUrl, normalizeLinkInput, safeHref } from "./url";

// Du menu enregistré (références) au menu que voit le visiteur (libellés et adresses de sa langue). Les références sont relues À CHAQUE affichage :
// renommer une page ou changer son adresse met le menu à jour tout seul ; une page supprimée, dépubliée ou dont le module ne tourne plus disparaît du menu
// sans erreur (ses sous-éléments, s'il y en a, remontent au niveau du dessus).

export type PublicLink = { label: string; href: string; news: boolean };
export type PublicItem = PublicLink & { children?: PublicLink[] };

/** Ce qu'un élément désigne aujourd'hui, ou null s'il n'existe plus. `labels` : le nom d'origine dans chaque langue connue. */
export type Resolved = { labels: MenuLabel; href: string; news?: boolean };

export type Resolver = (node: MenuNode) => Resolved | null;

/** Libellé affiché : le nom choisi dans la langue du visiteur, sinon le nom d'origine dans sa langue, puis dans la langue du site, puis n'importe lequel. */
export function pickLabel(override: MenuLabel | undefined, source: MenuLabel, locale: string, defaultLocale: string): string {
  return override?.[locale] || source[locale] || override?.[defaultLocale] || source[defaultLocale] || Object.values(override ?? {})[0] || Object.values(source)[0] || "";
}

/** Pur : applique le résolveur à l'arbre. Un élément introuvable ou sans libellé est ignoré ; un sous-menu sans rien dedans aussi. */
export function buildPublicItems(nodes: readonly MenuNode[], resolve: Resolver, locale: string, defaultLocale: string): PublicItem[] {
  const one = (n: MenuNode): (PublicLink & { raw: MenuNode }) | null => {
    if (n.kind === "group") return { label: pickLabel(n.label, {}, locale, defaultLocale), href: "", news: false, raw: n };
    const r = resolve(n);
    if (!r) return null;
    const label = pickLabel(n.label, r.labels, locale, defaultLocale);
    return label && r.href ? { label, href: r.href, news: !!r.news, raw: n } : null;
  };
  const out: PublicItem[] = [];
  for (const n of nodes) {
    const kids = (n.children ?? []).map(one).filter((k): k is NonNullable<typeof k> => k !== null).map(({ raw: _raw, ...k }) => (void _raw, k));
    const self = one(n);
    if (n.kind === "group") {
      if (self && self.label && kids.length) out.push({ label: self.label, href: "", news: false, children: kids });
      continue;
    }
    if (!self) { out.push(...kids); continue; }
    const { raw: _raw, ...link } = self;
    void _raw;
    out.push(kids.length ? { ...link, children: kids } : link);
  }
  return out;
}

/** Le menu de l'en-tête dans la langue du visiteur. Lectures bornées : au plus 40 éléments, donc une requête par sorte de référence. */
export async function resolvePublicMenu(locale: string, defaultLocale: string): Promise<PublicItem[]> {
  const stored = parseStoredMenu(await getSetting(MENU_SETTING));
  // Pas encore migré (démarrage pas fini, ou sauvegarde d'un site plus ancien restaurée) : l'état d'avant, reconstruit, sans rien écrire.
  const nodes = stored ?? (await legacyMenuFromDb());
  const flat = nodes.flatMap((n) => [n, ...(n.children ?? [])]);
  const ids = (kind: string) => [...new Set(flat.filter((n) => n.kind === kind && n.ref).map((n) => n.ref!))];
  const t = makeTranslator(locale);

  const active = new Map((await getActiveInstances()).map((a) => [a.instance.id, a]));
  const news = new Map<string, boolean>();
  await Promise.all(ids("instance").map(async (id) => { const a = active.get(id); if (a?.instance.basePath) news.set(id, await instanceHasNews(a, locale)); }));

  const entryIds = ids("entry");
  const entries = entryIds.length
    ? await prisma.entry.findMany({ where: { id: { in: entryIds }, status: "published", publishedAt: { lte: new Date() } }, include: { translations: true }, take: entryIds.length })
    : [];
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const instanceById = new Map((await listInstances()).map((i) => [i.id, i]));

  const redirectIds = ids("redirect");
  const redirects = redirectIds.length ? await prisma.redirect.findMany({ where: { id: { in: redirectIds }, active: true }, select: { id: true, path: true }, take: redirectIds.length }) : [];
  const redirectById = new Map(redirects.map((r) => [r.id, r]));

  const local = (path: string) => withLocale(safeHref(path), locale, defaultLocale);

  const resolve: Resolver = (n) => {
    if (n.kind === "link") {
      const href = normalizeLinkInput(n.href ?? "");
      const internal = href.startsWith("/") && !href.startsWith("//");
      if (!internal && !isSafeExternalUrl(href)) return null;
      return { labels: {}, href: local(href) };
    }
    if (!isRefKind(n.kind) || !n.ref) return null;
    if (n.kind === "system") {
      const p = systemPage(n.ref);
      return p ? { labels: { [locale]: t(p.label) }, href: local(p.href) } : null;
    }
    if (n.kind === "instance") {
      const a = active.get(n.ref);
      if (!a || !a.instance.basePath) return null;
      return { labels: { [locale]: pickName(a.instance, locale, defaultLocale) }, href: withLocale(`/${a.instance.basePath}`, locale, defaultLocale), news: news.get(n.ref) === true };
    }
    if (n.kind === "entry") {
      const e = entryById.get(n.ref);
      const inst = e ? instanceById.get(e.instanceId) : undefined;
      if (!e || !inst || inst.basePath === null || !active.has(inst.id)) return null;
      const tr = e.translations.find((x) => x.locale === locale) ?? (inst.fallbackToDefault ? e.translations.find((x) => x.locale === defaultLocale) ?? e.translations[0] : undefined);
      if (!tr) return null;
      return { labels: { [locale]: tr.title }, href: withLocale(`${inst.basePath ? `/${inst.basePath}` : ""}/${tr.slug}`, locale, defaultLocale) };
    }
    const r = redirectById.get(n.ref);
    return r ? { labels: { [locale]: r.path }, href: withLocale(`/${r.path}`, locale, defaultLocale) } : null;
  };
  return buildPublicItems(nodes, resolve, locale, defaultLocale);
}
