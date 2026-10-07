import { entryPath, listEntries } from "@/core/content/entries";
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
      .map((e) => ({
        title: e.title,
        summary: e.summary || undefined,
        path: entryPath(e, config.defaultLocale),
        url: e.url ?? undefined,
        cover: e.cover ?? undefined,
        icon: e.icon ?? undefined,
        code: e.code ?? undefined,
        tags: e.tags,
        publishedAt: e.publishedAt?.toISOString(),
      }));
  },
};
