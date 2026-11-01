import { prisma } from "../db";
import { hardNeeds, normalizeNeeds, offerIsEach, offerVersionOf, satisfiesVersion } from "./serviceVersions";
import { boxedInner, isStalled, ModuleStalled, STALLED } from "./budget";
import { buildContext, forViewer } from "./context";
import type { AdminUser } from "../auth/access";
import { pickName } from "../instances";
import { deleteSetting, getSetting, setSetting } from "../settings";
import { getActiveInstances, getModule, listModuleRows, type ActiveInstance } from "./registry";
import type { ParsedManifest } from "./manifest";

/**
 * DÉPENDANCES ENTRE MODULES — un module `offers` des services, un autre les `requires`. Ici : qui offre quoi, ce qui manque, qui dépend de
 * qui, et l'appel d'un service par un consommateur. Le cœur ne connaît aucun module : il ne manipule que des NOMS de services.
 */
export const offersOf = (m: Pick<ParsedManifest, "offers">) => (m.offers ?? []).map((o) => o.service);
export const requiresOf = (m: Pick<ParsedManifest, "requires">) => (m.requires ?? []).map((r) => r.service);

/**
 * Fournisseurs VIVANTS : instances actives d'un module actif et chargeable. Lu directement en base (pas de cache de requête) : une cascade
 * qui vient de créer une instance doit la voir tout de suite. Une instance dont les données sont à l'écart (migration échouée) ne compte pas.
 */
export async function liveProviders(except?: string): Promise<{ manifest: ParsedManifest; instanceKeys: string[] }[]> {
  const out: { manifest: ParsedManifest; instanceKeys: string[] }[] = [];
  for (const row of await listModuleRows()) {
    if (row.id === except) continue;
    const mod = await getModule(row.id);
    if (!mod) continue;
    const keys: string[] = [];
    for (const inst of await prisma.moduleInstance.findMany({ where: { moduleId: row.id }, orderBy: { key: "asc" } })) {
      if (!(await getSetting<{ status?: string }>(`instance.${inst.id}.__dataStatus`))?.status) keys.push(inst.key);
    }
    if (keys.length) out.push({ manifest: mod.manifest, instanceKeys: keys });
  }
  return out;
}

/** Meilleure version d'un service offerte par ces fournisseurs (null = aucun). */
const bestVersion = (providers: { manifest: ParsedManifest }[], service: string): number | null => {
  const versions = providers.map((p) => offerVersionOf(p.manifest.offers, service)).filter((v): v is number => v !== null);
  return versions.length ? Math.max(...versions) : null;
};

export type Gap = {
  service: string;
  /** Version minimale exigée (1 par défaut). */
  min: number;
  /** Meilleure version actuellement disponible (null = aucun fournisseur) : « Il faut la 2 (vous avez la 1) ». */
  have: number | null;
  reason: "none" | "old";
};

/**
 * Ce qui manque à un module pour fonctionner : pour chaque service exigé, une INSTANCE active d'un module actif qui l'offre, dans une version ≥ `min`.
 * Un module actif sans instance, ou en version trop ancienne, ne compte pas. Un besoin FACULTATIF (`optional`) ne manque jamais.
 */
export async function requirementGaps(manifest: ParsedManifest): Promise<Gap[]> {
  const needs = hardNeeds(manifest.requires);
  if (!needs.length) return [];
  const live = await liveProviders(manifest.id);
  const gaps: Gap[] = [];
  for (const n of needs) {
    const have = bestVersion(live, n.service);
    if (!satisfiesVersion(have, n.min)) gaps.push({ service: n.service, min: n.min, have, reason: have === null ? "none" : "old" });
  }
  return gaps;
}

/** Services dont ce module a besoin et qu'aucune instance active ne fournit (dans la version voulue). */
export async function unmetRequirements(manifest: ParsedManifest): Promise<string[]> {
  return (await requirementGaps(manifest)).map((g) => g.service);
}

/** Modules actifs qui cesseraient de fonctionner si `moduleId` s'arrêtait : ils exigent un service que lui seul fournit (version comprise). Un besoin facultatif ne retient pas le fournisseur. */
export async function dependentsOf(moduleId: string): Promise<string[]> {
  const mine = await getModule(moduleId);
  if (!mine) return [];
  const others = await liveProviders(moduleId);
  const mineOffers = new Set(offersOf(mine.manifest));
  const out: string[] = [];
  for (const row of await listModuleRows()) {
    if (row.id === moduleId) continue;
    const m = await getModule(row.id);
    if (!m) continue;
    const lost = hardNeeds(m.manifest.requires).filter((n) => mineOffers.has(n.service) && !satisfiesVersion(bestVersion(others.filter((o) => o.manifest.id !== row.id), n.service), n.min));
    if (lost.length) out.push(row.id);
  }
  return out;
}

/** Ce que perdraient les dépendants : pour chaque module actif touché, les services qu'il ne trouverait plus. */
export async function lossesIfStopped(moduleId: string): Promise<{ module: string; services: string[] }[]> {
  const mine = await getModule(moduleId);
  if (!mine) return [];
  const others = await liveProviders(moduleId);
  const mineOffers = new Set(offersOf(mine.manifest));
  const out: { module: string; services: string[] }[] = [];
  for (const id of await dependentsOf(moduleId)) {
    const m = await getModule(id);
    const lost = hardNeeds(m?.manifest.requires).filter((n) => mineOffers.has(n.service) && !satisfiesVersion(bestVersion(others.filter((o) => o.manifest.id !== id), n.service), n.min)).map((n) => n.service);
    out.push({ module: id, services: lost });
  }
  return out;
}

/**
 * PLUSIEURS FOURNISSEURS DU MÊME SERVICE (un doublon, ou un changement de fournisseur en cours) : l'administrateur choisit un MAÎTRE, qui reçoit
 * les appels et dont la réponse est celle que voit l'appelant, et des RÉPLIQUES, qui reçoivent aussi les appels qui écrivent (au mieux : la panne
 * d'une réplique ne fait jamais échouer l'appel). Tant que rien n'est choisi, le premier fournisseur par clé d'instance est le maître, sans réplique.
 * Une réplique reçoit les appels FUTURS ; les données déjà reçues par l'ancien fournisseur ne sont pas copiées.
 */
export type Routing = { master: string; replicas: string[] };   // clés d'instance
const routingKey = (service: string) => `service.${service}`;
export const getRouting = async (service: string): Promise<Routing | null> => {
  const raw = await getSetting<Partial<Routing>>(routingKey(service));
  return raw && typeof raw.master === "string" ? { master: raw.master, replicas: Array.isArray(raw.replicas) ? raw.replicas.filter((k): k is string => typeof k === "string") : [] } : null;
};
export async function setRouting(service: string, routing: Routing | null): Promise<void> {
  if (routing) await setSetting(routingKey(service), routing);
  else await deleteSetting(routingKey(service));
}

/** Instances actives qui offrent ce service, par clé d'instance. */
export async function providerInstances(service: string, exceptModule?: string): Promise<ActiveInstance[]> {
  return (await getActiveInstances()).filter((a) => offersOf(a.mod.manifest).includes(service) && a.mod.manifest.id !== exceptModule).sort((a, b) => a.instance.key.localeCompare(b.instance.key));
}

/**
 * Service « chaque instance pour elle-même » (`each` dans `offers`) : chaque instance parle de SA propre chose (une chaîne, un compte…), il n'y a donc
 * ni maître ni réplique à choisir. Vrai quand TOUS les fournisseurs actifs le déclarent ; si un seul fournisseur ne le déclare pas, le service reste
 * un service classique (maître/réplique), le choix le plus prudent pour des données partagées.
 */
export const isEachService = (providers: ActiveInstance[], service: string): boolean => providers.length > 0 && providers.every((p) => offerIsEach(p.mod.manifest.offers, service));

/** Ordre de création des instances (clé en cas d'égalité) : la « première » instance d'un service each. */
async function byCreation(list: ActiveInstance[]): Promise<ActiveInstance[]> {
  const rows = await prisma.moduleInstance.findMany({ where: { id: { in: list.map((a) => a.instance.id) } }, select: { id: true, createdAt: true } });
  const at = new Map(rows.map((r) => [r.id, r.createdAt.getTime()]));
  return [...list].sort((a, b) => (at.get(a.instance.id) ?? 0) - (at.get(b.instance.id) ?? 0) || a.instance.key.localeCompare(b.instance.key));
}

/** Qui est maître et qui réplique, parmi les fournisseurs ACTIFS (un choix périmé retombe sur le premier). */
export function resolveRouting(providers: ActiveInstance[], routing: Routing | null): { master: ActiveInstance; replicas: ActiveInstance[]; resolved: boolean } {
  const master = providers.find((p) => p.instance.key === routing?.master);
  const m = master ?? providers[0]!;
  return { master: m, replicas: providers.filter((p) => p !== m && (routing?.replicas ?? []).includes(p.instance.key)), resolved: !!master };
}

/** Services offerts par plusieurs instances actives : l'administrateur doit dire qui est maître. */
export async function duplicateServices(): Promise<{ service: string; providers: ActiveInstance[]; consumers: ActiveInstance[]; routing: Routing | null; resolved: boolean }[]> {
  const active = await getActiveInstances();
  const services = [...new Set(active.flatMap((a) => offersOf(a.mod.manifest)))].sort();
  const out = [];
  for (const service of services) {
    const providers = await providerInstances(service);
    if (providers.length < 2 || isEachService(providers, service)) continue;   // un service `each` n'a pas de maître à choisir
    const routing = await getRouting(service);
    out.push({ service, providers, consumers: active.filter((a) => requiresOf(a.mod.manifest).includes(service)).sort((a, b) => a.instance.key.localeCompare(b.instance.key)), routing, resolved: resolveRouting(providers, routing).resolved });
  }
  return out;
}

type Outcome = { ok: true; value: unknown } | { ok: false; reason: "undeclared" | "unavailable" | "no_method" | "failed" };

/** Fournisseurs que ce consommateur peut appeler : déclarés dans son `requires` (facultatif compris), dans une version suffisante (hors son propre module). */
async function providersFor(consumer: Pick<ActiveInstance, "mod">, service: string): Promise<ActiveInstance[] | null> {
  if (!requiresOf(consumer.mod.manifest).includes(service)) return null;
  const min = normalizeNeeds(consumer.mod.manifest.requires).find((n) => n.service === service)?.min ?? 1;
  return (await providerInstances(service, consumer.mod.manifest.id)).filter((p) => satisfiesVersion(offerVersionOf(p.mod.manifest.offers, service), min));
}

const hasMethod = (p: ActiveInstance, service: string, method: string) => typeof p.mod.def.services?.[service]?.[method] === "function";
/**
 * Exécute la méthode d'un service chez un fournisseur. Pour une page publique, le fournisseur a un temps imparti (voir budget.ts) : sans réponse, `ModuleStalled`
 * est levée (le journal a déjà nommé le fournisseur une fois ; les appelants la traitent comme un échec, sans rien écrire de plus).
 */
const runOn = async (p: ActiveInstance, service: string, method: string, args: unknown, locale?: string, viewer?: AdminUser | null) => {
  const fn = p.mod.def.services?.[service]?.[method];
  if (!fn) return undefined;
  // `viewer` : appel fait pour une personne de l'administration (création à la volée d'un `choice`) : `ctx.can` du fournisseur vérifie SES droits à elle.
  const base = await buildContext(p.mod, p.instance, locale);
  const ctx = viewer !== undefined ? forViewer(base, viewer) : base;
  const unit = { kind: "service" as const, moduleId: p.mod.manifest.id, instanceKey: p.instance.key, name: `${service}.${method}` };
  const value = await boxedInner(unit, () => fn(ctx, args));
  if (value === STALLED) throw new ModuleStalled(unit);
  return value;
};

/** Qui répond par défaut (sans `provider`) : service `each` → la première instance par ordre de création ; sinon le maître et ses répliques. */
async function defaultTarget(found: ActiveInstance[], service: string): Promise<{ master: ActiveInstance; replicas: ActiveInstance[] }> {
  if (isEachService(found, service)) return { master: (await byCreation(found))[0]!, replicas: [] };
  const { master, replicas } = resolveRouting(found, await getRouting(service));
  return { master, replicas };
}

/**
 * Appel d'un service au nom d'une instance consommatrice. Service classique : le maître répond, les répliques reçoivent aussi les écritures.
 * Service `each` : la PREMIÈRE instance active (par ordre de création) répond, sans réplique (pour `callAll`, voir plus bas). Ne lève jamais.
 * `provider` (identifiant d'INSTANCE, revalidé ici) : appel explicite. La cible doit être l'un des fournisseurs de `providersOf` (sinon « unavailable » :
 * instance supprimée, mise à l'écart, version trop ancienne, ou fournisseur étranger). Le maître visé garde ses répliques ; tout autre fournisseur répond SEUL.
 */
async function dispatch(consumer: Pick<ActiveInstance, "mod" | "instance">, service: string, method: string, args: unknown, locale?: string, provider?: string, viewer?: AdminUser | null, caller?: AdminUser | null): Promise<{ outcome: Outcome; master?: ActiveInstance }> {
  const found = await providersFor(consumer, service);
  if (found === null) return { outcome: { ok: false, reason: "undeclared" } };
  if (found.length === 0) return { outcome: { ok: false, reason: "unavailable" } };
  let { master, replicas } = await defaultTarget(found, service);
  if (provider !== undefined) {
    const target = typeof provider === "string" ? found.find((p) => p.instance.id === provider) : undefined;
    if (!target) {
      console.error(`[modules] service ${service}: the requested provider is gone or not allowed for ${consumer.instance.key}`);
      return { outcome: { ok: false, reason: "unavailable" } };
    }
    if (target !== master) { master = target; replicas = []; }
  }
  if (!hasMethod(master, service, method)) return { outcome: { ok: false, reason: "no_method" }, master };
  // Les droits de la personne qui a cliqué (`asCaller`) : seulement si le FOURNISSEUR a listé cette méthode dans `callerRights`, et pour une personne
  // (`caller` n'est rempli que par l'exécution d'une adminAction, voir context.ts). Le fournisseur vérifie ensuite SON droit avec `ctx.can`. Consigné.
  if (caller && viewer === undefined && callerMethodsOf(master, service).includes(method)) {
    viewer = caller;
    const { audit } = await import("../permissions");
    await audit(caller.email, `module.${consumer.instance.key}.asCaller`, `${service}.${method}`);
  }
  let value: unknown;
  try {
    value = await runOn(master, service, method, args, locale, viewer);
  } catch (error) {
    if (!isStalled(error)) console.error(`[modules] service ${service}.${method} failed:`, (error as Error)?.message);
    return { outcome: { ok: false, reason: "failed" }, master };
  }
  // Répliques : seulement pour les méthodes qui écrivent (celles que le fournisseur n'a pas déclarées en lecture seule), jamais bloquant.
  const readOnly = new Set((master.mod.manifest.offers ?? []).find((o) => o.service === service)?.readOnly ?? []);
  if (!readOnly.has(method)) {
    await Promise.allSettled(replicas.map(async (r) => {
      if (!hasMethod(r, service, method)) return;
      try { await runOn(r, service, method, args, locale, viewer); } catch (error) { if (!isStalled(error)) console.error(`[modules] replica ${r.instance.key} of ${service}.${method} failed:`, (error as Error)?.message); }
    }));
  }
  return { outcome: { ok: true, value }, master };
}

/** `opts.viewer` (cœur seulement, jamais exposé aux modules) : la personne de l'administration pour qui l'appel est fait ; le fournisseur reçoit alors `ctx.can` pour elle. */
export async function callService(consumer: Pick<ActiveInstance, "mod" | "instance">, service: string, method: string, args: unknown, locale?: string, opts: { provider?: string; viewer?: AdminUser | null; caller?: AdminUser | null } = {}): Promise<Outcome> {
  return (await dispatch(consumer, service, method, args, locale, opts.provider, opts.viewer, opts.caller)).outcome;
}

/**
 * CŒUR SEULEMENT (jamais exposé aux modules) : appelle une méthode d'un service chez son fournisseur actif, sans consommateur déclaré. Sert à la cale de compatibilité
 * `ctx.api.rawg` (services/rawgRelay.ts), qui relaie les anciens modules vers le service `game.cover`, et à la reprise finale RAWG (services/rawgHandover.ts). `moduleId` : n'accepter que ce module-là (la reprise de la clé n'est
 * confiée qu'à lui). Même règle que `callService` pour le choix du fournisseur (maître, ou première instance d'un service `each`) ; ne lève jamais.
 */
export async function callProvider(service: string, method: string, args: unknown, opts: { moduleId?: string; locale?: string } = {}): Promise<Outcome> {
  const found = (await providerInstances(service)).filter((p) => !opts.moduleId || p.mod.manifest.id === opts.moduleId);
  if (found.length === 0) return { ok: false, reason: "unavailable" };
  const { master } = await defaultTarget(found, service);
  if (!hasMethod(master, service, method)) return { ok: false, reason: "no_method" };
  try {
    return { ok: true, value: await runOn(master, service, method, args, opts.locale) };
  } catch (error) {
    if (!isStalled(error)) console.error(`[modules] service ${service}.${method} failed:`, (error as Error)?.message);
    return { ok: false, reason: "failed" };
  }
}

/** L'instance qui répondrait à un appel de `callProvider` (pour trouver son écran d'administration), ou null. */
export async function providerInstance(service: string, moduleId?: string): Promise<ActiveInstance | null> {
  const found = (await providerInstances(service)).filter((p) => !moduleId || p.mod.manifest.id === moduleId);
  return found.length ? (await defaultTarget(found, service)).master : null;
}

/** Les méthodes que ce fournisseur accepte d'appeler avec les droits de la personne connectée (`offers[].callerRights`). */
const callerMethodsOf = (p: ActiveInstance, service: string): string[] => (p.mod.manifest.offers ?? []).find((o) => o.service === service)?.callerRights ?? [];

/** Une entrée de `ctx.api.services.providers` : `id` = identifiant STABLE de l'instance (à passer à `call(…, { provider })`), `name` = libellé lisible. */
export type ProviderView = { id: string; key: string; name: string; module: string; version: number; each: boolean; master: boolean };
export const MAX_PROVIDERS = 50;

/**
 * Les fournisseurs que CE consommateur peut appeler (déclarés dans son `requires`, version ≥ `min`), par ordre de création, 50 au plus.
 * `master` : celui que `call` viserait sans `provider`. Service non déclaré ou sans fournisseur : `[]`. Lecture seule, ne lève jamais.
 */
export async function providersOf(consumer: Pick<ActiveInstance, "mod" | "instance">, service: string, locale?: string): Promise<ProviderView[]> {
  try {
    const found = await providersFor(consumer, service);
    if (!found?.length) return [];
    const { master } = await defaultTarget(found, service);
    return (await byCreation(found)).slice(0, MAX_PROVIDERS).map((p) => ({
      id: p.instance.id, key: p.instance.key, name: p.instance.nickname || pickName(p.instance, locale ?? "", locale ?? ""),
      module: p.mod.manifest.id, version: offerVersionOf(p.mod.manifest.offers, service) ?? 1, each: offerIsEach(p.mod.manifest.offers, service), master: p === master,
    }));
  } catch (error) {
    console.error(`[modules] providers of ${service} failed:`, (error as Error)?.message);
    return [];
  }
}

/** Réponse d'UNE instance à `callAll`. `error` est un code court (« failed », « no_method »), jamais le message du fournisseur (il pourrait contenir un secret ; il est seulement journalisé). */
export type FanoutResult = { instance: string; name?: string } & ({ ok: true; value: unknown } | { ok: false; error: string });

/**
 * Appel d'un service `each` sur TOUTES ses instances actives, par ordre de création : chacune répond pour elle-même, et un fournisseur qui lève
 * ou n'a pas la méthode ne gêne pas les autres. Mêmes règles que `callService` (service déclaré dans `requires`, version suffisante, contexte
 * de l'instance fournisseuse). Service non-each : UNE entrée, la réponse du maître. Service non déclaré ou sans fournisseur : tableau vide. Ne lève jamais.
 */
export async function callServiceAll(consumer: Pick<ActiveInstance, "mod" | "instance">, service: string, method: string, args: unknown, locale?: string): Promise<FanoutResult[]> {
  const found = await providersFor(consumer, service);
  if (!found || found.length === 0) return [];
  const label = (p: ActiveInstance) => ({ instance: p.instance.key, name: p.instance.nickname || pickName(p.instance, locale ?? "", locale ?? "") });
  if (!isEachService(found, service)) {
    const { outcome, master } = await dispatch(consumer, service, method, args, locale);
    if (!master) return [];
    return [outcome.ok ? { ...label(master), ok: true, value: outcome.value } : { ...label(master), ok: false, error: outcome.reason }];
  }
  return Promise.all((await byCreation(found)).map(async (p): Promise<FanoutResult> => {
    if (!hasMethod(p, service, method)) return { ...label(p), ok: false, error: "no_method" };
    try {
      return { ...label(p), ok: true, value: await runOn(p, service, method, args, locale) };
    } catch (error) {
      if (!isStalled(error)) console.error(`[modules] service ${service}.${method} failed on ${p.instance.key}:`, (error as Error)?.message);
      return { ...label(p), ok: false, error: "failed" };
    }
  }));
}

export async function serviceAvailable(service: string): Promise<boolean> {
  return (await getActiveInstances()).some((a) => offersOf(a.mod.manifest).includes(service));
}
