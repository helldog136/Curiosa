import { prisma } from "@/core/db";
import { safetyCopy } from "@/core/backup/files";
import { getInstanceById } from "@/core/instances";
import { deleteSetting, setSetting, getSetting } from "@/core/settings";
import { buildContext } from "./context";
import { getModule, listModuleRows, type LoadedModule } from "./registry";
import type { InstanceView } from "@/core/instances";

/**
 * MIGRATIONS DE DONNÉES DES MODULES.
 *
 * Le stockage d'un module (`ctx.api.store`) est du JSON libre : quand une nouvelle version d'un module change la forme de ses données,
 * c'est LE MODULE qui sait comment les convertir. Il déclare `dataVersion` (manifeste) et `migrations` (code) ; le cœur :
 *   - retient, pour chaque instance, la version de ses données (`instance.<id>.__dataVersion` ; absent = 1) ;
 *   - exécute les migrations manquantes, dans l'ordre, après une mise à jour du module et après une restauration de sauvegarde ;
 *   - garde une copie de la base avant, et si une migration échoue, REMET l'instance dans son état d'avant (stockage et réglages),
 *     la met à l'écart (elle ne tourne pas sur des données à moitié converties) et signale l'erreur dans l'admin, avec « Réessayer ».
 * Les données plus récentes que le code du module (restauration dans un module plus ancien) sont aussi mises à l'écart : mieux vaut ne rien
 * faire tourner que lire des données qu'on ne comprend pas.
 */
const versionKey = (id: string) => `instance.${id}.__dataVersion`;
const statusKey = (id: string) => `instance.${id}.__dataStatus`;

export type MigrationOutcome = { key: string; from: number; to: number; status: "none" | "ok" | "failed" | "newer"; error?: string };

export const targetVersion = (mod: Pick<LoadedModule, "manifest">) => mod.manifest.dataVersion ?? 1;
export async function dataVersionOf(instanceId: string): Promise<number> {
  const v = Number(await getSetting<number>(versionKey(instanceId)));
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

/** Statut d'une instance : « failed » / « newer » → elle est mise à l'écart ; null → saine. */
export async function dataStatusOf(instanceId: string): Promise<{ status: "failed" | "newer"; error?: string } | null> {
  const raw = await getSetting<{ status?: string; error?: string }>(statusKey(instanceId));
  return raw?.status === "failed" || raw?.status === "newer" ? { status: raw.status, error: raw.error } : null;
}

/** Une instance neuve naît à la version courante des données de son module (aucune migration à lui appliquer). */
export async function stampNewInstance(instanceId: string, mod: Pick<LoadedModule, "manifest">): Promise<void> {
  if (targetVersion(mod) > 1) await setSetting(versionKey(instanceId), targetVersion(mod));
}

/** Migre les données d'une instance jusqu'à la version du module. Ne lève jamais. */
export async function migrateInstance(mod: LoadedModule, instance: InstanceView): Promise<MigrationOutcome> {
  const from = await dataVersionOf(instance.id);
  const to = targetVersion(mod);
  const out = (status: MigrationOutcome["status"], error?: string, reached = from): MigrationOutcome => ({ key: instance.key, from, to: reached, status, ...(error ? { error } : {}) });

  if (from > to) {
    await setSetting(statusKey(instance.id), { status: "newer", error: `data v${from} > module v${to}` });
    return out("newer", `data v${from} is newer than this module (v${to})`);
  }
  if (from === to) {
    await deleteSetting(statusKey(instance.id));
    return out("none");
  }

  // État d'avant, pour pouvoir tout remettre si une migration échoue.
  safetyCopy("pre-migration");
  const records = await prisma.moduleRecord.findMany({ where: { instanceId: instance.id } });
  const settings = await prisma.setting.findMany({ where: { key: { startsWith: `instance.${instance.id}.` } } });
  let reached = from;
  try {
    for (let v = from + 1; v <= to; v++) {
      const step = mod.def.migrations?.[v];
      if (step) await step(await buildContext(mod, instance));
      await setSetting(versionKey(instance.id), v);
      reached = v;
    }
    await deleteSetting(statusKey(instance.id));
    return out("ok", undefined, to);
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 300);
    console.error(`[modules] migration of ${instance.key} failed at v${reached + 1}:`, message);
    await prisma.$transaction([
      prisma.moduleRecord.deleteMany({ where: { instanceId: instance.id } }),
      prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${instance.id}.` } } }),
      prisma.moduleRecord.createMany({ data: records }),
      prisma.setting.createMany({ data: settings }),
    ]);
    await setSetting(statusKey(instance.id), { status: "failed", error: message });
    return out("failed", message, from);
  }
}

/** Migre toutes les instances d'un module (après sa mise à jour). */
export async function migrateModuleInstances(moduleId: string): Promise<MigrationOutcome[]> {
  const mod = await getModule(moduleId);
  if (!mod) return [];
  const rows = await prisma.moduleInstance.findMany({ where: { moduleId }, select: { id: true } });
  const results: MigrationOutcome[] = [];
  for (const { id } of rows) {
    const instance = await getInstanceById(id);
    if (instance) results.push(await migrateInstance(mod, instance));
  }
  return results;
}

/** Migre toutes les instances de tous les modules installés (après une restauration de sauvegarde). */
export async function migrateAllInstances(): Promise<MigrationOutcome[]> {
  const out: MigrationOutcome[] = [];
  for (const row of await listModuleRows()) out.push(...(await migrateModuleInstances(row.id)));
  return out;
}

/** « Réessayer » dans l'admin, pour une instance mise à l'écart. */
export async function retryInstanceMigration(instanceId: string): Promise<MigrationOutcome | null> {
  const instance = await getInstanceById(instanceId);
  const mod = instance ? await getModule(instance.moduleId) : null;
  return instance && mod ? migrateInstance(mod, instance) : null;
}
