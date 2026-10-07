import { siteUrl } from "@/core/config";
import { entryPath, listEntries } from "@/core/content/entries";
import { getActiveInstances } from "@/core/modules/registry";
import type { TopicField } from "@/core/modules/types";
import { collectForCore } from "@/core/services/topics";
import { getSiteConfig } from "@/core/settings";
import { isSafeExternalUrl } from "@/core/url";

/**
 * FLUX RSS — une fonctionnalité du cœur, pas d'un module.
 *
 * Le cœur lit ses données là où les modules les exposent, sans rien connaître d'eux :
 *   - `core.entry`  les entrées publiées de toute instance à contenu (via le moteur de contenu) ;
 *   - `feed.item`   tout élément qu'un module choisit de proposer au flux (sujet `provides: feed.item`).
 * Le résultat est DÉTERMINISTE : mêmes données → même XML, octet pour octet (tri par date décroissante puis par
 * adresse, date de construction = date de l'élément le plus récent, jamais l'heure courante).
 */
export const FEED_ITEM_TOPIC = "feed.item";
export const FEED_ITEM_SCHEMA: TopicField[] = [
  { key: "id", type: "string" },
  { key: "title", type: "string", required: true },
  { key: "url", type: "url", required: true },
  { key: "summary", type: "string" },
  { key: "publishedAt", type: "string" },
  /** Rubriques partagées (« annonce », « concert »…) : plusieurs modules peuvent publier sur la même. */
  { key: "topics", type: "string[]" },
];

export type FeedItem = { id: string; title: string; link: string; summary: string; publishedAt: Date | null; topics: string[] };
/**
 * Une rubrique qu'on peut suivre. `annonce` : rubrique PARTAGÉE, alimentée par tous les modules qui la publient
 * (étiquettes d'entrées comprises) ; `@blog` : tout ce qu'une instance publie (le `@` est réservé au cœur).
 */
export type FeedTopic = { id: string; label: string; kind: "topic" | "instance"; count: number; instances: string[] };
export type Feed = { title: string; link: string; description: string; language: string; self: string; items: FeedItem[] };

const escapeXml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "") // caractères interdits en XML 1.0
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Écrit le flux. Pure : aucune horloge, aucun accès à la base. */
export function renderRss(feed: Feed): string {
  const newest = feed.items.reduce<Date | null>((m, i) => (i.publishedAt && (!m || i.publishedAt > m) ? i.publishedAt : m), null);
  const items = feed.items
    .map(
      (i) =>
        `<item><title>${escapeXml(i.title)}</title><link>${escapeXml(i.link)}</link><guid isPermaLink="false">${escapeXml(i.id)}</guid>` +
        (i.publishedAt ? `<pubDate>${i.publishedAt.toUTCString()}</pubDate>` : "") +
        `<description>${escapeXml(i.summary)}</description></item>`,
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>` +
    `<title>${escapeXml(feed.title)}</title><link>${escapeXml(feed.link)}</link><description>${escapeXml(feed.description || feed.title)}</description>` +
    `<language>${escapeXml(feed.language)}</language><atom:link href="${escapeXml(feed.self)}" rel="self" type="application/rss+xml"/>` +
    (newest ? `<lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : "") +
    `${items}</channel></rss>`
  );
}

/** Ordre stable : plus récent d'abord, puis adresse (jamais l'ordre d'arrivée). */
export function sortItems(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => (b.publishedAt?.getTime() ?? -Infinity) - (a.publishedAt?.getTime() ?? -Infinity) || a.link.localeCompare(b.link) || a.id.localeCompare(b.id));
}

const TOPIC_RE = /^@?[a-z0-9][a-z0-9_-]*$/;
const topicSlug = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
/** `@<instance>` (posé par le cœur seul : un module ne peut pas l'usurper) puis les rubriques partagées, normalisées. */
const topicsOf = (instanceKey: string, names: string[]) => [`@${instanceKey}`, ...new Set(names.map(topicSlug).filter(Boolean))];

/** Rubriques demandées (`?topics=a,b`) : syntaxe vérifiée, doublons retirés, 20 au plus. */
export function parseTopics(raw: string | null | undefined): string[] {
  return [...new Set(String(raw ?? "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => TOPIC_RE.test(t)))].slice(0, 20);
}

const absolute = (href: string) => (href.startsWith("/") ? `${siteUrl}${href}` : href);

/** Rassemble les éléments du flux. `instance` limite à une instance (clé) ; absent = tout le site. */
export async function collectFeedItems(opts: { locale: string; instance?: string; topics?: string[]; limit?: number }): Promise<FeedItem[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const config = await getSiteConfig();
  const items: FeedItem[] = [];

  for (const { instance, mod } of await getActiveInstances()) {
    if (!mod.manifest.content || !instance.exposed || instance.basePath === null) continue;
    if (opts.instance && instance.key !== opts.instance) continue;
    for (const e of await listEntries({ instance, locale: opts.locale, limit })) {
      if (e.expired) continue;
      const external = instance.clickAction === "external" && isSafeExternalUrl(e.url);
      const link = external ? e.url! : `${siteUrl}${entryPath(e, config.defaultLocale)}`;
      items.push({ id: `entry:${e.id}`, title: e.title, link, summary: e.summary, publishedAt: e.publishedAt, topics: topicsOf(instance.key, e.tags) });
    }
  }

  for (const i of await collectForCore(FEED_ITEM_TOPIC, FEED_ITEM_SCHEMA, { locale: opts.locale, limit, instance: opts.instance })) {
    const url = String(i.url);
    if (!url.startsWith("/") && !isSafeExternalUrl(url)) continue;
    const date = typeof i.publishedAt === "string" ? new Date(i.publishedAt) : null;
    items.push({
      id: String(i.id ?? `${i.source.instance}:${url}`),
      title: String(i.title),
      link: absolute(url),
      summary: String(i.summary ?? ""),
      publishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
      topics: topicsOf(i.source.instance, Array.isArray(i.topics) ? i.topics.map(String) : []),
    });
  }
  // Filtre par rubriques (OU) : « annonce » rassemble tous les modules qui la publient, « @blog » tout ce que le blog publie.
  const wanted = new Set(opts.topics ?? []);
  const kept = wanted.size ? items.filter((i) => i.topics.some((t) => wanted.has(t))) : items;
  return sortItems(kept).slice(0, limit);
}

/** Catalogue des rubriques qu'on peut suivre, avec le nombre d'éléments actuels et les instances qui les alimentent. */
export async function listFeedTopics(locale?: string): Promise<FeedTopic[]> {
  const config = await getSiteConfig();
  const lang = locale && config.locales.includes(locale) ? locale : config.defaultLocale;
  const active = await getActiveInstances();
  const nameOf = (key: string) => {
    const a = active.find((x) => x.instance.key === key);
    return a ? (a.instance.names[lang] ?? a.instance.names[config.defaultLocale] ?? key) : key;
  };
  const found = new Map<string, { count: number; instances: Set<string> }>();
  for (const item of await collectFeedItems({ locale: lang, limit: 100 })) {
    const from = item.topics[0]!.slice(1); // « @instance » est toujours le premier
    for (const id of item.topics) {
      const entry = found.get(id) ?? { count: 0, instances: new Set<string>() };
      entry.count++;
      entry.instances.add(from);
      found.set(id, entry);
    }
  }
  return [...found.entries()]
    .map(([id, v]): FeedTopic => ({ id, kind: id.startsWith("@") ? "instance" : "topic", label: id.startsWith("@") ? nameOf(id.slice(1)) : id, count: v.count, instances: [...v.instances].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Flux complet, ou `null` si l'instance demandée n'existe pas / ne propose rien au flux. */
export async function buildFeed(opts: { locale?: string; instance?: string; topics?: string[]; limit?: number }): Promise<Feed | null> {
  const config = await getSiteConfig();
  const locale = opts.locale && config.locales.includes(opts.locale) ? opts.locale : config.defaultLocale;
  const localized = await getSiteConfig(locale);
  let title = localized.name;
  if (opts.instance) {
    const active = (await getActiveInstances()).find((a) => a.instance.key === opts.instance);
    const publishes = active && ((active.mod.manifest.content && active.instance.exposed && active.instance.basePath !== null) || active.mod.manifest.provides?.some((p) => p.topic === FEED_ITEM_TOPIC));
    if (!active || !publishes) return null;
    title = `${localized.name} — ${active.instance.names[locale] ?? active.instance.names[config.defaultLocale] ?? active.instance.key}`;
  }
  const topics = opts.topics ?? [];
  if (topics.length) {
    // Rubriques inconnues : refusées (une faute de frappe ne doit pas donner un flux vide en silence).
    const known = new Set((await listFeedTopics(locale)).map((t) => t.id));
    if (!topics.some((t) => known.has(t))) return null;
    title = `${title} — ${topics.join(", ")}`;
  }
  const lang = `lang=${locale}${topics.length ? `&topics=${topics.join(",")}` : ""}`;
  return {
    title,
    link: siteUrl,
    description: localized.tagline || localized.name,
    language: locale,
    self: opts.instance ? `${siteUrl}/feed/${opts.instance}.xml?${lang}` : `${siteUrl}/feed.xml?${lang}`,
    items: await collectFeedItems({ locale, instance: opts.instance, topics, limit: opts.limit }),
  };
}
