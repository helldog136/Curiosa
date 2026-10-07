import { buildContext } from "./context";
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

type Outcome = { ok: true; value: unknown } | { ok: false; reason: "undeclared" | "unavailable" | "no_method" | "failed" };

/** Appel d'un service au nom d'une instance consommatrice. Ne lève jamais. */
export async function callService(consumer: Pick<ActiveInstance, "mod">, service: string, method: string, args: unknown, locale?: string): Promise<Outcome> {
  if (!requiresOf(consumer.mod.manifest).includes(service)) return { ok: false, reason: "undeclared" };
  const providers = (await getActiveInstances()).filter((a) => offersOf(a.mod.manifest).includes(service) && a.mod.manifest.id !== consumer.mod.manifest.id).sort((a, b) => a.instance.key.localeCompare(b.instance.key));
  if (providers.length === 0) return { ok: false, reason: "unavailable" };
  const handler = providers.map((p) => ({ p, fn: p.mod.def.services?.[service]?.[method] })).find((x) => typeof x.fn === "function");
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
