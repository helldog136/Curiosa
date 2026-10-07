import { entryPath, listEntries } from "../entries";
import { pickName, type InstanceView } from "../instances";
import { getSetting, getSiteConfig, setSetting } from "../settings";
import { buildContext } from "./context";
import { getActiveInstances, type ActiveInstance } from "./registry";
import type { ConsumeDecl, TopicField, TopicItem } from "./types";

/**
 * Sujets : la façon dont les modules s'échangent des informations.
 *
 * Le *consommateur* (un overlay, par exemple) déclare ce qu'il sait digérer
 * (`consumes` : sujet + format). Les *fournisseurs* exposent des informations
 * dans ce format (`provides` + `exports.<sujet>`). Le cœur fait l'entremetteur :
 * l'admin choisit, pour chaque instance consommatrice, quelles instances
 * fournisseuses l'alimentent ; le cœur valide les éléments reçus selon le format
 * déclaré. Un module consommateur ne connaît jamais les fournisseurs, et un
 * fournisseur ne sait pas qui le lit.
 */

/** Sujet fourni d'office par toute instance à contenu : ses entrées publiées. */
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

export type Sources = { instances: string[] | null; tags: string[] };

const sourcesKey = (instanceId: string, topic: string) => `instance.${instanceId}.__sources.${topic}`;

/** Sources choisies pour une instance consommatrice. Par défaut : tous les fournisseurs compatibles. */
export async function getSources(instanceId: string, topic: string): Promise<Sources> {
  const raw = await getSetting<Partial<Sources>>(sourcesKey(instanceId, topic));
  return { instances: Array.isArray(raw?.instances) ? raw.instances : null, tags: Array.isArray(raw?.tags) ? raw.tags : [] };
}

export async function setSources(instanceId: string, topic: string, sources: Sources): Promise<void> {
  await setSetting(sourcesKey(instanceId, topic), sources);
}

/** Instances qui peuvent alimenter un sujet. */
export async function providersOf(topic: string): Promise<ActiveInstance[]> {
  return (await getActiveInstances()).filter(({ instance, mod }) =>
    topic === CORE_ENTRY
      ? !!mod.manifest.content && instance.exposed
      : mod.manifest.provides?.some((p) => p.topic === topic) && !!mod.def.exports?.[topic],
  );
}

function valid(value: unknown, type: TopicField["type"]): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "url": return typeof value === "string" && /^(https?:\/\/|\/)/.test(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "string[]": return Array.isArray(value) && value.every((v) => typeof v === "string");
  }
}

/** Ne garde que les champs du schéma ; rejette l'élément si un champ requis manque ou est mal typé. */
export function conform(item: Record<string, unknown>, schema: TopicField[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const f of schema) {
    const v = item[f.key];
    if (v === undefined || v === null) {
      if (f.required) return null;
      continue;
    }
    if (!valid(v, f.type)) return null;
    out[f.key] = v;
  }
  return out;
}

async function fromProvider(provider: ActiveInstance, topic: string, locale: string, limit: number, tags: string[]): Promise<Record<string, unknown>[]> {
  const { instance, mod } = provider;
  if (topic === CORE_ENTRY) {
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
  }
  return (await mod.def.exports![topic]!(await buildContext(mod, instance, locale), { locale, limit, tags })) ?? [];
}

/** Collecte, pour une instance consommatrice, les éléments de ses sources, validés selon son format. */
export async function collect(
  consumer: ActiveInstance,
  topic: string,
  opts: { limit?: number; locale: string },
): Promise<TopicItem[]> {
  const decl: ConsumeDecl | undefined = consumer.mod.manifest.consumes?.find((c) => c.topic === topic);
  if (!decl) throw new Error(`module "${consumer.mod.manifest.id}" does not declare consuming "${topic}"`);
  const schema = topic === CORE_ENTRY ? CORE_ENTRY_SCHEMA : (decl.schema ?? []);
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const sources = await getSources(consumer.instance.id, topic);
  const config = await getSiteConfig();

  const out: TopicItem[] = [];
  for (const provider of await providersOf(topic)) {
    if (sources.instances && !sources.instances.includes(provider.instance.key)) continue;
    try {
      for (const raw of await fromProvider(provider, topic, opts.locale, limit, sources.tags)) {
        const item = conform(raw, schema);
        if (!item) continue;
        out.push({ ...item, source: { instance: provider.instance.key, module: provider.mod.manifest.id, name: pickName(provider.instance, opts.locale, config.defaultLocale) } });
      }
    } catch (error) {
      console.error(`[modules] provider ${provider.instance.key} failed for topic ${topic}:`, error);
    }
  }
  return out.slice(0, limit);
}

export type SourceChoice = { instance: InstanceView; moduleId: string };
