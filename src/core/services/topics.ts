import { coreEntryAdapter } from "@/core/content/topics";
import { pickName } from "@/core/instances";
import { getSetting, getSiteConfig, setSetting } from "@/core/settings";
import { buildContext } from "@/core/modules/context";
import { getActiveInstances, type ActiveInstance } from "@/core/modules/registry";
import type { ConsumeDecl, TopicField, TopicItem } from "@/core/modules/types";

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

/**
 * Un sujet « du cœur » : fourni par le cœur lui-même plutôt que par un module (aujourd'hui, seul
 * `core.entry` existe, implémenté par le moteur de contenu : src/core/content/topics.ts). Le mécanisme
 * ci-dessous reste identique pour tous les sujets ; seule la façon de trouver et lire les fournisseurs change.
 */
export type TopicAdapter = {
  topic: string;
  schema: TopicField[];
  providers(): Promise<ActiveInstance[]>;
  fetch(provider: ActiveInstance, query: { locale: string; limit: number; tags: string[] }): Promise<Record<string, unknown>[]>;
};

/** Liste explicite des sujets du cœur. */
const ADAPTERS: TopicAdapter[] = [coreEntryAdapter];
const adapterOf = (topic: string) => ADAPTERS.find((a) => a.topic === topic);

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
  const adapter = adapterOf(topic);
  if (adapter) return adapter.providers();
  return (await getActiveInstances()).filter(({ mod }) => mod.manifest.provides?.some((p) => p.topic === topic) && !!mod.def.exports?.[topic]);
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
  const adapter = adapterOf(topic);
  if (adapter) return adapter.fetch(provider, { locale, limit, tags });
  const { instance, mod } = provider;
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
  const schema = adapterOf(topic)?.schema ?? decl.schema ?? [];
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


/**
 * Options d'un champ « référence » (liste déroulante de l'éditeur d'entrée) : les éléments
 * du sujet, tels que les fournisseurs les exposent. Chaque élément doit avoir `id` et `title`.
 */
export async function getRefOptions(instanceId: string, topic: string, locale: string): Promise<{ value: string; label: string }[]> {
  const consumer = (await getActiveInstances()).find((a) => a.instance.id === instanceId);
  if (!consumer || !consumer.mod.manifest.consumes?.some((c) => c.topic === topic)) return [];
  const items = await collect(consumer, topic, { limit: 200, locale });
  return items.flatMap((i) => (typeof i.id === "string" && typeof i.title === "string" ? [{ value: i.id, label: i.title }] : []));
}

/**
 * Collecte « côté cœur » : le cœur lui-même consomme un sujet (flux RSS, plan du site…), sans instance
 * consommatrice ni choix de sources — toutes les instances fournisseuses actives contribuent, validées selon
 * le format donné. L'ordre est celui des fournisseurs (clé d'instance) : déterministe.
 */
export async function collectForCore(
  topic: string,
  schema: TopicField[],
  opts: { locale: string; limit?: number; instance?: string },
): Promise<TopicItem[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const config = await getSiteConfig();
  const providers = (await providersOf(topic)).filter((p) => !opts.instance || p.instance.key === opts.instance).sort((a, b) => a.instance.key.localeCompare(b.instance.key));
  const out: TopicItem[] = [];
  for (const provider of providers) {
    try {
      for (const raw of await fromProvider(provider, topic, opts.locale, limit, [])) {
        const item = conform(raw, schema);
        if (!item) continue;
        out.push({ ...item, source: { instance: provider.instance.key, module: provider.mod.manifest.id, name: pickName(provider.instance, opts.locale, config.defaultLocale) } });
      }
    } catch (error) {
      console.error(`[modules] provider ${provider.instance.key} failed for topic ${topic}:`, error);
    }
  }
  return out;
}
