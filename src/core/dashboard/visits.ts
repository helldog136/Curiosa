/**
 * TABLEAU DE BORD — « Visites » utiles : l'évolution par rapport à la période d'avant, les pages les plus lues avec leur TITRE (pas « /blog »), les liens courts les plus cliqués.
 *
 * AUCUNE donnée nouvelle : tout vient des compteurs anonymes déjà gardés (`VisitDaily`, `RedirectDay`). Lectures bornées : 60 jours de totaux (60 lignes), 8 pages, 50 liens.
 * La partie pure (`compare`, `splitLocale`, `titleOfSystemPath`) ne touche à rien et se teste seule.
 */
import { prisma } from "../db";
import { isKnownLocale } from "../i18n/locales";
import { pickName } from "../instances";
import type { Translator } from "../i18n/dictionary";
import { dayOf, statsSummary } from "../stats";
import { destinationSummary } from "../redirectGroups";
import { isMeasureEnabled } from "../redirectMeasure";

export type Period = { visitors: number; views: number };
export type Comparison = {
  current: Period;
  previous: Period;
  /** Évolution des visiteurs en pourcentage entier (null : rien à comparer, la période d'avant n'a eu aucune visite). */
  change: number | null;
  /** La période d'avant est complète (le site a des chiffres sur toute sa durée) : sinon l'écran ne la compare pas. */
  comparable: boolean;
};

/** Pur : la variation entre deux périodes. Pas de pourcentage quand il n'y avait rien avant. */
export function compare(current: Period, previous: Period, comparable = true): Comparison {
  const change = previous.visitors > 0 ? Math.round(((current.visitors - previous.visitors) / previous.visitors) * 100) : null;
  return { current, previous, change: comparable ? change : null, comparable };
}

export type VisitsOverview = {
  /** 30 derniers jours, le plus ancien d'abord (pour le petit graphique). */
  days: { day: string; visitors: number }[];
  today: Period;
  week: Comparison;
  month: Comparison;
  /** Aucune visite depuis toujours : l'écran dit comment en avoir plutôt que d'afficher des zéros. */
  empty: boolean;
};

/** Visites sur 7 et 30 jours contre les 7 et 30 jours d'avant. Lit 60 lignes au plus. */
export async function visitsOverview(now: Date = new Date()): Promise<VisitsOverview> {
  const span = 60;
  const list = Array.from({ length: span }, (_, i) => dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (span - 1 - i))));
  const rows = await prisma.visitDaily.findMany({ where: { kind: "site", day: { gte: list[0]!, lte: list[span - 1]! } }, take: span + 5 });
  const site = new Map(rows.map((r) => [r.day, r]));
  const days = list.map((day) => ({ day, visitors: site.get(day)?.visitors ?? 0, views: site.get(day)?.views ?? 0 }));
  const sum = (from: number, to: number): Period => days.slice(from, to).reduce((a, d) => ({ visitors: a.visitors + d.visitors, views: a.views + d.views }), { visitors: 0, views: 0 });
  const earliest = await prisma.visitDaily.findFirst({ where: { kind: "site" }, orderBy: { day: "asc" }, select: { day: true } });
  const first = earliest?.day ?? null;
  // « Comparable » : le site a des chiffres qui remontent au moins au début de la période d'avant (sinon une hausse de 300 % serait trompeuse).
  const comparableFrom = (n: number) => first !== null && first <= list[span - 2 * n]!;
  return {
    days: days.slice(30).map(({ day, visitors }) => ({ day, visitors })),
    today: sum(span - 1, span),
    week: compare(sum(span - 7, span), sum(span - 14, span - 7), comparableFrom(7)),
    month: compare(sum(span - 30, span), sum(span - 60, span - 30), comparableFrom(30)),
    empty: first === null,
  };
}

// ── Titres des pages les plus lues ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sépare le préfixe de langue d'une adresse comptée (« /en/blog/x » → « en », « /blog/x »). Un premier segment qui n'est pas une langue reste dans le chemin. */
export function splitLocale(path: string): { locale: string | null; path: string } {
  const m = /^\/([a-z]{2}(?:-[A-Za-z]{2,4})?)(\/.*)?$/.exec(path);
  if (m && isKnownLocale(m[1]!)) return { locale: m[1]!, path: m[2] ?? "/" };
  return { locale: null, path };
}

/** Pages du cœur que l'on reconnaît sans rien lire (clé de traduction). */
const SYSTEM_TITLES: Record<string, string> = { "/": "dash.page.home", "/search": "dash.page.search", "/privacy": "dash.page.privacy", "/confidentialite": "dash.page.privacy" };
export const titleOfSystemPath = (path: string, t: Translator): string | null => (SYSTEM_TITLES[path] ? t(SYSTEM_TITLES[path]!) : null);

export type TopPage = { path: string; views: number; title: string; /** L'adresse a pu être reliée à un contenu ou une page du site (sinon le titre est l'adresse elle-même). */ known: boolean };

/** Les pages les plus lues sur 30 jours, avec le titre du contenu ou de la page (huit requêtes simples au plus). */
export async function topPagesTitled(opts: { t: Translator; locale: string; defaultLocale: string; limit?: number }): Promise<TopPage[]> {
  const stats = await statsSummary();
  const top = stats.topPages.slice(0, opts.limit ?? 5);
  if (top.length === 0) return [];
  const { listInstances } = await import("../instances");
  const instances = await listInstances();
  const out: TopPage[] = [];
  for (const p of top) {
    const { path } = splitLocale(p.path);
    const system = titleOfSystemPath(path, opts.t);
    if (system) { out.push({ path: p.path, views: p.views, title: system, known: true }); continue; }
    const parts = path.split("/").filter(Boolean);
    // Une extension a sa page à son chemin (« /blog ») ; un contenu est « /blog/mon-article », ou « /mon-article » pour une extension sans chemin.
    const home = instances.find((i) => i.basePath && i.basePath === parts[0] && parts.length === 1);
    if (home) { out.push({ path: p.path, views: p.views, title: pickName(home, opts.locale, opts.defaultLocale), known: true }); continue; }
    const scoped = instances.find((i) => i.basePath && i.basePath === parts[0] && parts.length === 2);
    const bare = !scoped && parts.length === 1 ? instances.filter((i) => !i.basePath) : [];
    const candidates = scoped ? [scoped] : bare;
    const slug = scoped ? parts[1] : parts[0];
    let title: string | null = null;
    if (slug && candidates.length) {
      const hit = await prisma.entryTranslation.findFirst({ where: { instanceId: { in: candidates.map((c) => c.id) }, slug }, select: { title: true, locale: true }, orderBy: { updatedAt: "desc" } }).catch(() => null);
      title = hit?.title?.trim() || null;
    }
    out.push({ path: p.path, views: p.views, title: title ?? p.path, known: title !== null });
  }
  return out;
}

// ── Liens courts les plus cliqués ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type TopLink = { destination: string; month: number; /** Les adresses courtes qui mènent là (« /insta », « /ig »), les plus cliquées d'abord. */ shortLinks: string[] };

/** Les destinations les plus cliquées sur 30 jours, tous liens courts confondus. Vide tant que « Compter les clics » est éteint. */
export async function topLinks(limit = 5): Promise<{ enabled: boolean; links: TopLink[] }> {
  if (!(await isMeasureEnabled().catch(() => false))) return { enabled: false, links: [] };
  const summary = await destinationSummary().catch(() => null);
  const links = (summary?.groups ?? [])
    .filter((g) => g.month > 0)
    .sort((a, b) => b.month - a.month || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((g) => ({ destination: g.destination, month: g.month, shortLinks: g.links.filter((l) => l.month > 0).map((l) => (l.path.startsWith("/") ? l.path : `/${l.path}`)) }));
  return { enabled: true, links };
}
