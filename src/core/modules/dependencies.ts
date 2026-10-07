import { buildContext } from "./context";
import { deleteSetting, getSetting, setSetting } from "../settings";
import { getActiveInstances, getModule, listModuleRows, type ActiveInstance } from "./registry";
import type { ParsedManifest } from "./manifest";

/**
 * DÉPENDANCES ENTRE MODULES — un module `offers` des services, un autre les `requires`. Ici : qui offre quoi, ce qui manque, qui dépend de
 * qui, et l'appel d'un service par un consommateur. Le cœur ne connaît aucun module : il ne manipule que des NOMS de services.
 */
export const offersOf = (m: Pick<ParsedManifest, "offers">) => (m.offers ?? []).map((o) => o.service);
export const requiresOf = (m: Pick<ParsedManifest, "requires">) => (m.requires ?? []).map((r) => r.service);

/** Manifestes des modules ACTIFS (activés et chargeables), éventuellement sans l'un d'eux. */
async function enabledManifests(except?: string): Promise<ParsedManifest[]> {
  const out: ParsedManifest[] = [];
  for (const row of await listModuleRows()) {
    if (!row.enabled || row.id === except) continue;
    const mod = await getModule(row.id);
    if (mod) out.push(mod.manifest);
  }
  return out;
}

/** Services dont ce module a besoin et qu'aucun module actif n'offre. */
export async function unmetRequirements(manifest: ParsedManifest): Promise<string[]> {
  const offered = new Set((await enabledManifests(manifest.id)).flatMap(offersOf));
  return requiresOf(manifest).filter((s) => !offered.has(s));
}

/** Modules actifs qui cesseraient de fonctionner si `moduleId` s'arrêtait : ils requièrent un service que lui seul offre. */
export async function dependentsOf(moduleId: string): Promise<string[]> {
  const mine = await getModule(moduleId);
  if (!mine) return [];
  const others = await enabledManifests(moduleId);
  const stillOffered = new Set(others.flatMap(offersOf));
  const lost = new Set(offersOf(mine.manifest).filter((s) => !stillOffered.has(s)));
  return others.filter((m) => requiresOf(m).some((s) => lost.has(s))).map((m) => m.id);
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
    if (providers.length < 2) continue;
    const routing = await getRouting(service);
    out.push({ service, providers, consumers: active.filter((a) => requiresOf(a.mod.manifest).includes(service)).sort((a, b) => a.instance.key.localeCompare(b.instance.key)), routing, resolved: resolveRouting(providers, routing).resolved });
  }
  return out;
}

type Outcome = { ok: true; value: unknown } | { ok: false; reason: "undeclared" | "unavailable" | "no_method" | "failed" };

/** Appel d'un service au nom d'une instance consommatrice : le maître répond, les répliques reçoivent aussi les écritures. Ne lève jamais. */
export async function callService(consumer: Pick<ActiveInstance, "mod" | "instance">, service: string, method: string, args: unknown, locale?: string): Promise<Outcome> {
  if (!requiresOf(consumer.mod.manifest).includes(service)) return { ok: false, reason: "undeclared" };
  const providers = await providerInstances(service, consumer.mod.manifest.id);
  if (providers.length === 0) return { ok: false, reason: "unavailable" };
  const { master, replicas } = resolveRouting(providers, await getRouting(service));
  const run = async (p: ActiveInstance) => p.mod.def.services?.[service]?.[method]?.(await buildContext(p.mod, p.instance, locale), args);
  if (typeof master.mod.def.services?.[service]?.[method] !== "function") return { ok: false, reason: "no_method" };
  let value: unknown;
  try {
    value = await run(master);
  } catch (error) {
    console.error(`[modules] service ${service}.${method} failed:`, (error as Error)?.message);
    return { ok: false, reason: "failed" };
  }
  // Répliques : seulement pour les méthodes qui écrivent (celles que le fournisseur n'a pas déclarées en lecture seule), jamais bloquant.
  const readOnly = new Set((master.mod.manifest.offers ?? []).find((o) => o.service === service)?.readOnly ?? []);
  if (!readOnly.has(method)) {
    await Promise.allSettled(replicas.map(async (r) => {
      if (typeof r.mod.def.services?.[service]?.[method] !== "function") return;
      try { await run(r); } catch (error) { console.error(`[modules] replica ${r.instance.key} of ${service}.${method} failed:`, (error as Error)?.message); }
    }));
  }
  return { ok: true, value };
}

export async function serviceAvailable(service: string): Promise<boolean> {
  return (await getActiveInstances()).some((a) => offersOf(a.mod.manifest).includes(service));
}
