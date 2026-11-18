import { moduleTopics, parseTopic, topicGroupTitle, topicTitle, type PlacesManifest, type Vocabulary } from "./places";

/**
 * CATALOGUE FACETS (core 0.34.0): what a module adds settings to, as a facet of the extension catalogue (« Ajoute des réglages à : Alertes, Récompenses ») and as a query
 * for an AI assistant. Pure logic. The topics of an entry come from the index (`places`) and, for a module that is installed, from its manifest (which wins).
 */
export type TopicEntry = { id: string; topics?: string[] };

/** The topics of one entry: the manifest's when the module is installed, else the index's. Page ids, no duplicate. */
export function entryTopics(entry: TopicEntry, installed: PlacesManifest | undefined, aliases: Record<string, string> = {}): string[] {
  if (installed) { const own = moduleTopics(installed, aliases); if (own.length) return own; }
  return [...new Set((entry.topics ?? []).map((t) => parseTopic(t)).filter((x): x is string => x !== null))];
}

export type Facet = { id: string; title: string; group: string; count: number };

/** The facets present in the catalogue (a topic with no module is not offered), grouped as the sidebar is (vocabulary order, then alphabetical). */
export function facetList(topicsByEntry: ReadonlyMap<string, string[]>, vocab: Vocabulary, locale: string): Facet[] {
  const counts = new Map<string, number>();
  for (const list of topicsByEntry.values()) for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
  const groupOrder = (id: string) => { const i = vocab.groups.findIndex((g) => g.id === id.split(".")[0]); return i === -1 ? 1e6 : i; };
  const pageOrder = (id: string) => { const i = vocab.pages.findIndex((p) => p.id === id); return i === -1 ? 1e6 : i; };
  return [...counts]
    .map(([id, count]) => ({ id, count, title: topicTitle(id, vocab, locale), group: topicGroupTitle(id, vocab, locale) }))
    .sort((a, b) => groupOrder(a.id) - groupOrder(b.id) || pageOrder(a.id) - pageOrder(b.id) || a.title.localeCompare(b.title, locale));
}

/** Keeps the entries that add settings to the topic. A topic given as a place id (`live.alerts.look`) means its page. No topic: everything. An unknown topic: nothing. */
export function filterByTopic<T extends TopicEntry>(entries: readonly T[], topic: string | null | undefined, topicsByEntry: ReadonlyMap<string, string[]>): T[] {
  if (!topic) return [...entries];
  const wanted = parseTopic(topic);
  if (!wanted) return [];
  return entries.filter((e) => (topicsByEntry.get(e.id) ?? []).includes(wanted));
}
