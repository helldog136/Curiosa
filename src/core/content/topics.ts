import { entriesAfter, entryPath, listEntries, type EntryView } from "@/core/content/entries";
import { getActiveInstances } from "@/core/modules/registry";
import type { TopicField } from "@/core/modules/types";
import type { TopicAdapter } from "@/core/services/topics";
import { getSiteConfig } from "@/core/settings";

/**
 * Sujet `core.entry` — fourni par le MOTEUR DE CONTENU, pas par le service d'échange.
 * Toute instance à contenu y expose ses entrées publiées (sauf si l'option « Proposer ses entrées
 * aux autres modules » est décochée) : un blog, une liste de codes promo ou de liens alimentent donc
 * n'importe quel consommateur sans écrire de code.
 */
export const CORE_ENTRY = "core.entry";

export const CORE_ENTRY_SCHEMA: TopicField[] = [
  { key: "title", type: "string", required: true },
  { key: "summary", type: "string" },
  { key: "path", type: "string", required: true },
  { key: "url", type: "url" },
  { key: "cover", type: "string" },
  { key: "icon", type: "string" },
  { key: "code", type: "string" },
  { key: "tags", type: "string[]" },
  { key: "publishedAt", type: "string" },
];

const toItem = (e: EntryView, defaultLocale: string) => ({
  title: e.title,
  summary: e.summary || undefined,
  path: entryPath(e, defaultLocale),
  url: e.url ?? undefined,
  cover: e.cover ?? undefined,
  icon: e.icon ?? undefined,
  code: e.code ?? undefined,
  tags: e.tags,
  publishedAt: e.publishedAt?.toISOString(),
});

/** Au plus 5 lectures de 200 lignes par appel : un filtre par rubrique qui ne trouve rien ne parcourt jamais toute la base. */
const MAX_SCANS = 5;

export const coreEntryAdapter: TopicAdapter = {
  topic: CORE_ENTRY,
  schema: CORE_ENTRY_SCHEMA,
  async providers() {
    return (await getActiveInstances()).filter(({ instance, mod }) => !!mod.manifest.content && instance.exposed);
  },
  async fetch({ instance }, { locale, limit, tags }) {
    const config = await getSiteConfig();
    const entries = await listEntries({ instance, locale, limit: 200 });
    return entries
      .filter((e) => !e.expired && (tags.length === 0 || tags.some((t) => e.tags.includes(t))))
      .slice(0, limit)
      .map((e) => toItem(e, config.defaultLocale));
  },
  /** Par curseur (`publishedAt|id`), du plus récent au plus ancien, non expirées. `next` est le curseur de la dernière ligne lue, ou null s'il n'y a plus rien. */
  async fetchPage({ instance }, { locale, limit, tags, cursor }) {
    const config = await getSiteConfig();
    const out: Record<string, unknown>[] = [];
    let cur = cursor ?? null;
    for (let scan = 0; scan < MAX_SCANS; scan++) {
      const { rows, more } = await entriesAfter({ instance, locale, limit: tags.length ? 200 : limit - out.length, cursor: cur });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        cur = r.cursor;
        if (tags.length === 0 || tags.some((t) => r.view.tags.includes(t))) out.push(toItem(r.view, config.defaultLocale));
        if (out.length >= limit) return { items: out, next: i < rows.length - 1 || more ? r.cursor : null };
      }
      if (!more) return { items: out, next: null };
    }
    return { items: out, next: cur };
  },
};
