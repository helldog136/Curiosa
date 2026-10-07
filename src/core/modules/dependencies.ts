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
 * QUEL fournisseur répond quand plusieurs modules (ou plusieurs instances) offrent le même service ? UN seul : celui que l'administrateur a
 * choisi pour cette instance consommatrice, à défaut le premier par clé d'instance. On n'envoie pas à tous : un service est une action
 * « range ceci quelque part », la répéter chez chacun créerait des doublons dont aucun n'est la référence. (Installer un deuxième
 * fournisseur reste possible, c'est le moyen de changer de carnet : on bascule le choix, puis on retire l'ancien.)
 */
const choiceKey = (instanceId: string, service: string) => `instance.${instanceId}.__service.${service}`;
export const getProviderChoice = async (instanceId: string, service: string): Promise<string | null> => (await getSetting<string>(choiceKey(instanceId, service))) ?? null;
export async function setProviderChoice(instanceId: string, service: string, providerKey: string | null): Promise<void> {
  if (providerKey) await setSetting(choiceKey(instanceId, service), providerKey);
  else await deleteSetting(choiceKey(instanceId, service));
}

/** Instances actives qui offrent ce service, par clé d'instance. */
export async function providerInstances(service: string, exceptModule?: string): Promise<ActiveInstance[]> {
  return (await getActiveInstances()).filter((a) => offersOf(a.mod.manifest).includes(service) && a.mod.manifest.id !== exceptModule).sort((a, b) => a.instance.key.localeCompare(b.instance.key));
}

type Outcome = { ok: true; value: unknown } | { ok: false; reason: "undeclared" | "unavailable" | "no_method" | "failed" };

/** Appel d'un service au nom d'une instance consommatrice. Ne lève jamais. */
export async function callService(consumer: Pick<ActiveInstance, "mod" | "instance">, service: string, method: string, args: unknown, locale?: string): Promise<Outcome> {
  if (!requiresOf(consumer.mod.manifest).includes(service)) return { ok: false, reason: "undeclared" };
  const providers = await providerInstances(service, consumer.mod.manifest.id);
  if (providers.length === 0) return { ok: false, reason: "unavailable" };
  // Le fournisseur choisi (s'il est toujours actif), sinon le premier.
  const chosen = await getProviderChoice(consumer.instance.id, service);
  const target = (providers.find((p) => p.instance.key === chosen) ?? providers[0])!;
  const fn = target.mod.def.services?.[service]?.[method];
  const handler = typeof fn === "function" ? { p: target, fn } : undefined;
  if (!handler) return { ok: false, reason: "no_method" };
  try {
    return { ok: true, value: await handler.fn!(await buildContext(handler.p.mod, handler.p.instance, locale), args) };
  } catch (error) {
    console.error(`[modules] service ${service}.${method} failed:`, (error as Error)?.message);
    return { ok: false, reason: "failed" };
  }
}

export async function serviceAvailable(service: string): Promise<boolean> {
  return (await getActiveInstances()).some((a) => offersOf(a.mod.manifest).includes(service));
}
