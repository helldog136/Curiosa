import { createHash } from "node:crypto";
import { siteUrl } from "@/core/config";
import { entryPath, listEntries } from "@/core/content/entries";
import { pickName } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import type { TopicField } from "@/core/modules/types";
import { collectForCore } from "@/core/services/topics";
import { withLocale } from "@/core/links";
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

/** `image` : adresse ABSOLUE de l'image de l'élément (la couverture d'une entrée), le cas échéant. */
export type FeedItem = { id: string; title: string; link: string; summary: string; publishedAt: Date | null; topics: string[]; image?: string | null };
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

/** Type MIME d'une image d'après son extension (le flux ne donne que les formats courants). */
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml" };

/** Écrit le flux. Pure : aucune horloge, aucun accès à la base. */
export function renderRss(feed: Feed): string {
  const newest = newestDate(feed.items);
  const items = feed.items
    .map((i) => {
      const categories = i.topics?.filter((t) => !t.startsWith("@")).map((t) => `<category>${escapeXml(t)}</category>`).join("") ?? "";
      const type = i.image ? IMAGE_TYPES[(i.image.split(/[?#]/)[0]!.split(".").pop() ?? "").toLowerCase()] : undefined;
      return (
        `<item><title>${escapeXml(i.title)}</title><link>${escapeXml(i.link)}</link><guid isPermaLink="false">${escapeXml(i.id)}</guid>` +
        (i.publishedAt ? `<pubDate>${i.publishedAt.toUTCString()}</pubDate>` : "") +
        `<description>${escapeXml(i.summary)}</description>${categories}` +
        (i.image && type ? `<enclosure url="${escapeXml(i.image)}" length="0" type="${type}"/>` : "") +
        `</item>`
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>` +
    `<title>${escapeXml(feed.title)}</title><link>${escapeXml(feed.link)}</link><description>${escapeXml(feed.description || feed.title)}</description>` +
    `<language>${escapeXml(feed.language)}</language><atom:link href="${escapeXml(feed.self)}" rel="self" type="application/rss+xml"/>` +
    (newest ? `<lastBuildDate>${newest.toUTCString()}</lastBuildDate>` : "") +
    `${items}</channel></rss>`
  );
}

/** Date de l'élément le plus récent (null si aucun n'est daté). */
export function newestDate(items: Pick<FeedItem, "publishedAt">[]): Date | null {
  return items.reduce<Date | null>((m, i) => (i.publishedAt && (!m || i.publishedAt > m) ? i.publishedAt : m), null);
}

/**
 * Réponse HTTP d'un flux : type, ETag (empreinte du contenu), Last-Modified (élément le plus récent) et cache de 5 minutes.
 * Un lecteur qui renvoie `If-None-Match` ou `If-Modified-Since` reçoit un 304 vide tant que rien n'a changé : le flux coûte presque rien à interroger souvent.
 */
export function rssResponse(request: Request, feed: Feed): Response {
  const xml = renderRss(feed);
  const etag = `"${createHash("sha1").update(xml).digest("base64url")}"`;
  const newest = newestDate(feed.items);
  const headers = new Headers({ "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300", etag });
  if (newest) headers.set("last-modified", newest.toUTCString());
  const match = request.headers.get("if-none-match");
  const since = request.headers.get("if-modified-since");
  const sinceMs = since ? Date.parse(since) : NaN;
  const notModified = match ? match.split(",").some((v) => v.trim().replace(/^W\//, "") === etag) : newest !== null && !Number.isNaN(sinceMs) && newest.getTime() <= sinceMs;
  return notModified ? new Response(null, { status: 304, headers }) : new Response(xml, { headers });
}

/** Court extrait en texte brut d'un contenu Markdown (sans les symboles de mise en forme), coupé proprement. */
export function excerpt(markdown: string, max = 280): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6))}…`;
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

/** Nombre d'éléments qu'un flux ne dépasse jamais (et valeur par défaut : 30). */
export const FEED_MAX_ITEMS = 100;
export const FEED_DEFAULT_ITEMS = 30;

const absoluteImage = (src: string | null) => (src && (src.startsWith("/") && !src.startsWith("//") ? `${siteUrl}${src}` : /^https?:\/\//i.test(src) ? src : null)) || null;
const isHttp = (u: string) => /^https?:\/\//i.test(u) && isSafeExternalUrl(u);

/**
 * Rassemble les éléments du flux. `instance` limite à une instance (clé) ; absent = tout le site.
 * Seul ce qui est PUBLIC sort : entrées publiées dont la date est atteinte (ni brouillon, ni planifié, ni expiré), instances proposées au public,
 * éléments de modules dont la date n'est pas dans le futur. `now` n'existe que pour les tests.
 */
export async function collectFeedItems(opts: { locale: string; instance?: string; topics?: string[]; limit?: number; now?: Date }): Promise<FeedItem[]> {
  const limit = Math.min(FEED_MAX_ITEMS, Math.max(1, opts.limit ?? FEED_DEFAULT_ITEMS));
  const now = opts.now ?? new Date();
  const config = await getSiteConfig();
  const items: FeedItem[] = [];

  for (const { instance, mod } of await getActiveInstances()) {
    if (!mod.manifest.content || !instance.exposed || instance.basePath === null) continue;
    if (opts.instance && instance.key !== opts.instance) continue;
    // Pas de limite ici : le tri propre à l'instance (par titre, à la main…) n'est pas celui du flux (du plus récent au plus ancien), un « 30 premiers » coupé avant le tri écarterait des nouveautés.
    for (const e of await listEntries({ instance, locale: opts.locale })) {
      if (e.expired || (e.publishedAt && e.publishedAt > now)) continue;
      const external = instance.clickAction === "external" && isHttp(e.url ?? "");
      const link = external ? e.url! : `${siteUrl}${entryPath(e, config.defaultLocale)}`;
      items.push({ id: `entry:${e.id}`, title: e.title, link, summary: e.summary || excerpt(e.body), publishedAt: e.publishedAt, topics: topicsOf(instance.key, e.tags), image: absoluteImage(e.cover) });
    }
  }

  for (const i of await collectForCore(FEED_ITEM_TOPIC, FEED_ITEM_SCHEMA, { locale: opts.locale, limit, instance: opts.instance })) {
    const url = String(i.url);
    if (!(url.startsWith("/") && !url.startsWith("//")) && !isHttp(url)) continue;
    const date = typeof i.publishedAt === "string" ? new Date(i.publishedAt) : null;
    const publishedAt = date && !Number.isNaN(date.getTime()) ? date : null;
    if (publishedAt && publishedAt > now) continue; // annoncé pour plus tard : pas encore public
    items.push({
      id: String(i.id ?? `${i.source.instance}:${url}`),
      title: String(i.title),
      link: absolute(url),
      summary: String(i.summary ?? ""),
      publishedAt,
      topics: topicsOf(i.source.instance, Array.isArray(i.topics) ? i.topics.map(String) : []),
    });
  }
  // Un même identifiant ne sort qu'une fois (deux modules, ou un module qui se répète : le lecteur verrait un doublon).
  const seen = new Set<string>();
  const unique = items.filter((i) => !seen.has(i.id) && !!seen.add(i.id));
  // Filtre par rubriques (OU) : « annonce » rassemble tous les modules qui la publient, « @blog » tout ce que le blog publie.
  const wanted = new Set(opts.topics ?? []);
  const kept = wanted.size ? unique.filter((i) => i.topics.some((t) => wanted.has(t))) : unique;
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
    link: `${siteUrl}${withLocale("/", locale, config.defaultLocale).replace(/^\/$/, "")}`,
    description: localized.tagline || localized.name,
    language: locale,
    self: opts.instance ? `${siteUrl}/feed/${opts.instance}.xml?${lang}` : `${siteUrl}/feed.xml?${lang}`,
    items: await collectFeedItems({ locale, instance: opts.instance, topics, limit: opts.limit }),
  };
}

/**
 * Le site a-t-il, EN PRINCIPE, de quoi alimenter un flux ? Oui s'il a une instance à contenu proposée au public avec des pages,
 * ou un module qui fournit `feed.item`. Réponse rapide (aucune lecture des contenus), utilisée sur chaque page pour décider d'afficher l'icône du pied de page.
 * Un flux sans aucun élément reste possible (on vient d'installer le blog) : l'icône n'attend pas le premier article.
 */
export async function hasFeedSource(): Promise<boolean> {
  return (await getActiveInstances()).some(
    ({ instance, mod }) => (!!mod.manifest.content && instance.exposed && instance.basePath !== null) || !!mod.manifest.provides?.some((p) => p.topic === FEED_ITEM_TOPIC),
  );
}

/** Adresse du flux principal dans une langue (relative au domaine public : `/feed.xml?lang=fr`). */
export const feedPath = (locale: string) => `/feed.xml?lang=${encodeURIComponent(locale)}`;

export type FeedOverview = {
  /** Adresse absolue du flux principal, dans la langue demandée. */
  url: string;
  count: number;
  latest: FeedItem[];
  /** Une ligne par instance qui alimente le flux : d'où vient chaque contenu. */
  sources: { key: string; name: string; module: string; kind: "entries" | "items"; url: string; count: number }[];
  /** Rubriques partagées (hors `@instance`) avec leur adresse. */
  topics: (FeedTopic & { url: string; names: string[] })[];
};

/** Ce que le propriétaire voit dans l'admin : l'adresse, le nombre d'éléments, les 5 derniers, les sources et les rubriques. */
export async function feedOverview(locale: string): Promise<FeedOverview> {
  const config = await getSiteConfig();
  const lang = config.locales.includes(locale) ? locale : config.defaultLocale;
  const all = await collectFeedItems({ locale: lang, limit: FEED_MAX_ITEMS });
  const topics = await listFeedTopics(lang);
  const active = await getActiveInstances();
  const sources = active.flatMap(({ instance, mod }) => {
    const entries = !!mod.manifest.content && instance.exposed && instance.basePath !== null;
    const items = !!mod.manifest.provides?.some((p) => p.topic === FEED_ITEM_TOPIC);
    if (!entries && !items) return [];
    const count = all.filter((i) => i.topics[0] === `@${instance.key}`).length;
    return [{ key: instance.key, name: pickName(instance, lang, config.defaultLocale), module: mod.manifest.id, kind: entries ? ("entries" as const) : ("items" as const), url: `${siteUrl}/feed/${instance.key}.xml?lang=${lang}`, count }];
  });
  const names = (ids: string[]) => ids.map((k) => sources.find((s) => s.key === k)?.name ?? k);
  return {
    url: `${siteUrl}${feedPath(lang)}`,
    count: all.length,
    latest: all.slice(0, 5),
    sources: sources.sort((a, b) => a.key.localeCompare(b.key)),
    topics: topics.filter((t) => t.kind === "topic").map((t) => ({ ...t, url: `${siteUrl}/feed.xml?lang=${lang}&topics=${t.id}`, names: names(t.instances) })),
  };
}
