import { coreEntryAdapter } from "@/core/content/topics";
import { pickName } from "@/core/instances";
import { getSetting, getSiteConfig, setSetting } from "@/core/settings";
import { boxedInner, STALLED } from "@/core/modules/budget";
import { buildContext } from "@/core/modules/context";
import { getActiveInstances, type ActiveInstance } from "@/core/modules/registry";
import type { ConsumeDecl, TopicField, TopicItem } from "@/core/modules/types";
import { isIsoDatetime, parseTopicWindow, type TopicWindow, type TopicWindowInput } from "./topicWindow";

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
  fetch(provider: ActiveInstance, query: { locale: string; limit: number; tags: string[]; from?: Date; to?: Date }): Promise<Record<string, unknown>[]>;
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
    case "datetime": return isIsoDatetime(value);
  }
}

/** Ne garde que les champs du schéma ; rejette l'élément si un champ requis manque ou est mal typé. */
export function conform(item: Record<string, unknown>, schema: TopicField[]): Record<string, unknown> | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;   // un fournisseur peut renvoyer n'importe quoi : cet élément-là est écarté, pas la collecte
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

/**
 * Les éléments d'UN fournisseur. Un fournisseur de module a un temps imparti (voir budget.ts) quand la collecte sert une page publique : sans réponse il est
 * ignoré (liste vide) et le journal le nomme une fois. `always` : l'appelant est lui-même la page publique (en-tête, flux), pas une section de module.
 */
async function fromProvider(provider: ActiveInstance, topic: string, locale: string, limit: number, tags: string[], window: TopicWindow = {}, always = false): Promise<Record<string, unknown>[]> {
  const query = { locale, limit, tags, ...window };   // `from` / `to` n'existent que si le consommateur les a demandés
  const adapter = adapterOf(topic);
  if (adapter) return adapter.fetch(provider, query);
  const { instance, mod } = provider;
  const ctx = await buildContext(mod, instance, locale);
  const exported = mod.def.exports![topic]!;
  const items = await boxedInner({ kind: "topic", moduleId: mod.manifest.id, instanceKey: instance.key, name: topic }, () => exported(ctx, query), { always });
  return items !== STALLED && Array.isArray(items) ? items : [];
}

/** Collecte, pour une instance consommatrice, les éléments de ses sources, validés selon son format. */
export async function collect(
  consumer: ActiveInstance,
  topic: string,
  opts: { limit?: number; locale: string } & TopicWindowInput,
): Promise<TopicItem[]> {
  const decl: ConsumeDecl | undefined = consumer.mod.manifest.consumes?.find((c) => c.topic === topic);
  if (!decl) throw new Error(`module "${consumer.mod.manifest.id}" does not declare consuming "${topic}"`);
  const schema = adapterOf(topic)?.schema ?? decl.schema ?? [];
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  // Plage facultative, validée une fois pour toutes les sources (une plage invalide est une erreur du consommateur : elle lève, rien n'est collecté).
  const window = parseTopicWindow(opts);
  const sources = await getSources(consumer.instance.id, topic);
  const config = await getSiteConfig();

  // Tous les fournisseurs en même temps (l'ordre des éléments reste celui des fournisseurs) : un fournisseur lent ne retarde pas les suivants, et
  // chacun a son propre temps imparti (voir fromProvider) au lieu de se partager celui de la page.
  const providers = (await providersOf(topic)).filter((p) => !sources.instances || sources.instances.includes(p.instance.key));
  const lists = await Promise.all(providers.map((provider) => itemsOf(provider, topic, schema, opts.locale, limit, sources.tags, config.defaultLocale, window, false)));
  return lists.flat().slice(0, limit);
}

/** Les éléments valides d'UN fournisseur, déjà étiquetés de leur source. Une erreur du fournisseur est journalisée et donne une liste vide : elle n'empêche pas la collecte. */
async function itemsOf(provider: ActiveInstance, topic: string, schema: TopicField[], locale: string, limit: number, tags: string[], defaultLocale: string, window: TopicWindow, always: boolean): Promise<TopicItem[]> {
  const out: TopicItem[] = [];
  try {
    for (const raw of await fromProvider(provider, topic, locale, limit, tags, window, always)) {
      const item = conform(raw, schema);
      if (!item) continue;
      out.push({ ...item, source: { instance: provider.instance.key, module: provider.mod.manifest.id, name: pickName(provider.instance, locale, defaultLocale) } });
    }
  } catch (error) {
    console.error(`[modules] provider ${provider.instance.key} failed for topic ${topic}:`, error);
  }
  return out;
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
  const lists = await Promise.all(providers.map((provider) => itemsOf(provider, topic, schema, opts.locale, limit, [], config.defaultLocale, {}, true)));
  return lists.flat();
}
