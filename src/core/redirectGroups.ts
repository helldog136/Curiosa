import { prisma } from "./db";
import { dayKey, lastDays, siteTimezone } from "./siteTime";
import { flushRedirectHits } from "./redirectStats";
import { redirectState } from "./redirects";
import { destinationKey } from "./redirectDestination";

export { destinationKey };

/**
 * TOTAL PAR DESTINATION : plusieurs liens courts (/instagram, /ig, /insta) peuvent mener à la même adresse ; ce fichier les regroupe et additionne leurs passages.
 * Rien de nouveau n'est stocké : on relit `Redirect` (destination, total) et `RedirectDay` (un nombre par lien et par jour, 30 jours lus). Donc aucune donnée
 * personnelle (ni adresse IP, ni cookie, ni provenance), aucune migration, aucun minuteur.
 *
 * Bornes dures : 200 liens lus au plus (les plus visités d'abord), 30 jours, lectures de 50 liens à la fois, 50 destinations rendues.
 * Comparaison « normalisée » : voir `destinationKey`.
 */
export const GROUP_MAX_LINKS = 200;
export const GROUP_MAX_DESTINATIONS = 50;
export const GROUP_READ_CHUNK = 50;
export const GROUP_DAYS = 30;

export type GroupLink = {
  id: string; path: string; state: "active" | "ended" | "off"; today: number; week: number; month: number; total: number;
};
export type DestinationGroup = {
  /** Clé de comparaison (voir `destinationKey`). */
  key: string;
  /** L'adresse à montrer : celle du lien le plus visité du groupe, telle que saisie. */
  destination: string;
  today: number; week: number; month: number; total: number;
  /** Les 30 derniers jours, le plus ancien d'abord (somme des liens du groupe). */
  series: { day: string; hits: number }[];
  /** Les liens (alias) du groupe, du plus visité au moins visité. */
  links: GroupLink[];
};
export type DestinationSummary = {
  groups: DestinationGroup[];
  /** Nombre de liens lus (au plus GROUP_MAX_LINKS) et nombre de liens du site : l'écran dit quand tout n'est pas compté. */
  linksRead: number; linksTotal: number;
  /** Destinations non montrées (au-delà de GROUP_MAX_DESTINATIONS). */
  hidden: number;
};

type LinkInput = { id: string; path: string; destination: string; state: GroupLink["state"]; hits: number; days: Map<string, number> };

/** Pur : regroupe des liens par destination normalisée et additionne leurs chiffres. `days` : les 30 jours (le plus ancien d'abord). */
export function groupLinks(links: LinkInput[], days: string[]): DestinationGroup[] {
  const by = new Map<string, { link: GroupLink; input: LinkInput }[]>();
  for (const input of links) {
    const key = destinationKey(input.destination);
    if (!key) continue;
    const at = (n: number) => days.slice(n).reduce((a, d) => a + (input.days.get(d) ?? 0), 0);
    const month = at(0);
    const link: GroupLink = { id: input.id, path: input.path, state: input.state, today: at(days.length - 1), week: at(days.length - 7), month, total: Math.max(input.hits, month) };
    (by.get(key) ?? by.set(key, []).get(key)!).push({ link, input });
  }
  const out: DestinationGroup[] = [];
  for (const [key, rows] of by) {
    rows.sort((a, b) => b.link.total - a.link.total || a.link.path.localeCompare(b.link.path));
    const series = days.map((day) => ({ day, hits: rows.reduce((a, r) => a + (r.input.days.get(day) ?? 0), 0) }));
    const sum = (f: (l: GroupLink) => number) => rows.reduce((a, r) => a + f(r.link), 0);
    out.push({ key, destination: rows[0]!.input.destination, today: sum((l) => l.today), week: sum((l) => l.week), month: sum((l) => l.month), total: sum((l) => l.total), series, links: rows.map((r) => r.link) });
  }
  // Classement : le plus de passages au total d'abord, puis sur 30 jours, puis l'adresse (ordre stable).
  return out.sort((a, b) => b.total - a.total || b.month - a.month || a.key.localeCompare(b.key));
}

/** Lit les liens (200 au plus, les plus visités d'abord) et leurs 30 derniers jours, par tranches de 50, et rend les destinations classées. */
export async function destinationSummary(now = Date.now()): Promise<DestinationSummary> {
  await flushRedirectHits(now);
  const days = lastDays(dayKey(new Date(now), await siteTimezone()), GROUP_DAYS);
  const [linksTotal, rows] = await Promise.all([
    prisma.redirect.count(),
    prisma.redirect.findMany({ orderBy: [{ hits: "desc" }, { path: "asc" }], take: GROUP_MAX_LINKS, select: { id: true, path: true, targetUrl: true, entryId: true, active: true, expiresAt: true, hits: true } }),
  ]);
  const entryIds = [...new Set(rows.map((r) => r.entryId).filter((x): x is string => !!x))];
  const entryUrl = new Map<string, string>();
  for (let i = 0; i < entryIds.length; i += GROUP_READ_CHUNK) {
    for (const e of await prisma.entry.findMany({ where: { id: { in: entryIds.slice(i, i + GROUP_READ_CHUNK) } }, select: { id: true, url: true }, take: GROUP_READ_CHUNK })) if (e.url) entryUrl.set(e.id, e.url);
  }
  const perDay = new Map<string, Map<string, number>>();
  for (let i = 0; i < rows.length; i += GROUP_READ_CHUNK) {
    const ids = rows.slice(i, i + GROUP_READ_CHUNK).map((r) => r.id);
    const found = await prisma.redirectDay.findMany({ where: { redirectId: { in: ids }, day: { gte: days[0]!, lte: days[days.length - 1]! } }, select: { redirectId: true, day: true, hits: true }, take: GROUP_READ_CHUNK * GROUP_DAYS });
    for (const d of found) (perDay.get(d.redirectId) ?? perDay.set(d.redirectId, new Map()).get(d.redirectId)!).set(d.day, d.hits);
  }
  const all = groupLinks(rows.map((r) => ({
    id: r.id, path: r.path, destination: (r.entryId && entryUrl.get(r.entryId)) || r.targetUrl, state: redirectState(r, now), hits: r.hits, days: perDay.get(r.id) ?? new Map(),
  })), days);
  return { groups: all.slice(0, GROUP_MAX_DESTINATIONS), linksRead: rows.length, linksTotal, hidden: Math.max(0, all.length - GROUP_MAX_DESTINATIONS) };
}
