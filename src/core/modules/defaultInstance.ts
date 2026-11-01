import { prisma } from "../db";
import { getSiteConfig } from "../settings";
import { createInstance, defaultNames, runInstanceCreateHook } from "../instanceService";
import { getModule } from "./registry";
import { restoreModuleInstances, retireInstance } from "./retired";

/**
 * INSTANCE PAR DÉFAUT d'un fournisseur apporté par la cascade : un module sans instance ne fournit rien. On fait en sorte qu'il y en ait une qui tourne.
 *   - déjà une instance : rien à faire ;
 *   - des données gardées d'une désinstallation précédente : elles reviennent telles quelles (rien n'est créé) ;
 *   - sinon on en crée une, avec les réglages par défaut du module (single comme multiple ; la première n'a pas besoin de surnom).
 * Renvoie ce qui a été fait, pour pouvoir le défaire si la cascade échoue.
 */
export type EnsureOutcome = { kind: "present" } | { kind: "created"; instanceId: string } | { kind: "restored"; instanceIds: string[] };

/** Une seule demande à la fois par module : « compter puis créer » ne supporte pas deux appels simultanés (installation en arrière-plan de la reprise RAWG + cascade de dépendance, par exemple) : le second verrait « aucune instance » et échouerait sur la clé déjà prise. */
const inFlight = new Map<string, Promise<unknown>>();

export function ensureDefaultInstance(moduleId: string): Promise<EnsureOutcome | null> {
  const previous = inFlight.get(moduleId) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(() => ensureOnce(moduleId));
  const tail = run.catch(() => {});
  inFlight.set(moduleId, tail);
  void tail.then(() => { if (inFlight.get(moduleId) === tail) inFlight.delete(moduleId); });
  return run;
}

async function ensureOnce(moduleId: string): Promise<EnsureOutcome | null> {
  const mod = await getModule(moduleId);
  if (!mod) return null;
  if ((await prisma.moduleInstance.count({ where: { moduleId } })) > 0) return { kind: "present" };
  const kept = await restoreModuleInstances(moduleId);
  if (kept.restored.length) return { kind: "restored", instanceIds: kept.restored.map((r) => r.id) };
  const { locales } = await getSiteConfig();
  const created = await createInstance(prisma, { manifest: mod.manifest, names: defaultNames(mod.manifest, locales) });
  await runInstanceCreateHook(created.id);
  return { kind: "created", instanceId: created.id };
}

/** Défait `ensureDefaultInstance` (échec de la cascade) : l'instance créée est supprimée avec ses réglages, celles retrouvées sont rangées de nouveau (leurs données ne sont JAMAIS effacées). */
export async function undoDefaultInstance(outcome: EnsureOutcome): Promise<void> {
  if (outcome.kind === "restored") { for (const id of outcome.instanceIds) await retireInstance(id, "uninstall").catch(() => {}); return; }
  if (outcome.kind !== "created") return;
  const id = outcome.instanceId;
  await prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${id}.` } } });
  await prisma.moduleRecord.deleteMany({ where: { instanceId: id } });
  await prisma.moduleInstance.delete({ where: { id } }).catch(() => {});
}
