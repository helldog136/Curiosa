import { prisma } from "@/core/db";
import { hasRecentBulkCopy, safetyCopy } from "@/core/backup/files";
import { bumpGenerations, readGenerations } from "@/core/services/store";
import { getInstanceById } from "@/core/instances";
import { deleteSetting, setSetting, getSetting } from "@/core/settings";
import { buildContext } from "./context";
import { getModule, listModuleRows, type LoadedModule } from "./registry";
import { openSeedSession } from "./seeding";
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
 * Un module qui déclare `seeds` dispose en plus, pendant sa migration, de `ctx.seedInstance` (créer UNE instance d'un module dont il dépend, une seule fois)
 * et `ctx.clearSetting` (effacer l'un de ses propres réglages) : voir seeding.ts. Ce qu'il crée ailleurs est défait si la migration échoue, et n'est
 * confirmé (audit, crochets de création) qu'une fois la migration réussie.
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

/**
 * Statut d'une instance : « failed » / « newer » → elle est mise à l'écart ; null → saine. `error` vaut « floor » (données plus anciennes que le plancher
 * du module, `floor` et `from` disent lesquelles) ou « timeout » (conversion trop longue au démarrage, voir legacySweep.ts) ; sinon le message de l'échec.
 */
export async function dataStatusOf(instanceId: string): Promise<{ status: "failed" | "newer"; error?: string; floor?: number; from?: number } | null> {
  const raw = await getSetting<{ status?: string; error?: string; floor?: number; from?: number }>(statusKey(instanceId));
  if (raw?.status !== "failed" && raw?.status !== "newer") return null;
  return { status: raw.status, error: raw.error, ...(Number.isInteger(raw.floor) ? { floor: raw.floor } : {}), ...(Number.isInteger(raw.from) ? { from: raw.from } : {}) };
}

/** Plancher des données d'un module (`dataFloor`, 0.2.0) : en dessous, il ne sait plus convertir. Absent = 1 (tout est convertible). */
export const floorVersion = (mod: Pick<LoadedModule, "manifest">) => mod.manifest.dataFloor ?? 1;

/** Met une instance à l'écart parce que sa conversion a dépassé le temps du démarrage (elle peut encore se terminer seule : la migration efface alors ce statut). */
export async function markMigrationTimeout(instanceId: string): Promise<void> {
  await setSetting(statusKey(instanceId), { status: "failed", error: "timeout" });
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
  // Plancher (0.2.0) : des données plus anciennes que ce que le module sait encore convertir ne sont JAMAIS déclarées « à jour » en sautant les étapes
  // absentes (la boucle ci-dessous avance le numéro sans rien faire là où il n'y a pas de migration). L'instance est mise à l'écart, rien n'est touché.
  const floor = floorVersion(mod);
  if (from < floor) {
    await setSetting(statusKey(instance.id), { status: "failed", error: "floor", floor, from });
    return out("failed", `floor: data v${from} is older than the oldest version this module converts (v${floor})`);
  }

  // État d'avant, pour pouvoir tout remettre si une migration échoue.
  // Pas de copie « pre-migration » juste après la copie d'une mise à jour groupée : elle couvre déjà cet état.
  if (!hasRecentBulkCopy()) safetyCopy("pre-migration");
  const generationBefore = await readGenerations([instance.id]);
  const records = await prisma.moduleRecord.findMany({ where: { instanceId: instance.id } });
  const settings = await prisma.setting.findMany({ where: { key: { startsWith: `instance.${instance.id}.` } } });
  let reached = from;
  const seeds = openSeedSession(mod, instance);
  try {
    for (let v = from + 1; v <= to; v++) {
      const step = mod.def.migrations?.[v];
      if (step) await step(seeds.attach(await buildContext(mod, instance)));
      await setSetting(versionKey(instance.id), v);
      reached = v;
    }
    await deleteSetting(statusKey(instance.id));
    await seeds.commit();
    return out("ok", undefined, to);
  } catch (error) {
    await seeds.rollback();
    const message = String((error as Error)?.message ?? error).slice(0, 300);
    console.error(`[modules] migration of ${instance.key} failed at v${reached + 1}:`, message);
    await prisma.$transaction([
      prisma.moduleRecord.deleteMany({ where: { instanceId: instance.id } }),
      prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${instance.id}.` } } }),
      prisma.moduleRecord.createMany({ data: records }),
      prisma.setting.createMany({ data: settings }),
    ]);
    // Les données ont été remises d'un bloc : tout index gardé en mémoire par le module est périmé.
    await bumpGenerations([instance.id], generationBefore).catch(() => {});
    await setSetting(statusKey(instance.id), { status: "failed", error: message });
    return out("failed", message, from);
  }
}

/** Migre toutes les instances d'un module (après sa mise à jour). */
export async function migrateModuleInstances(moduleId: string, opts: { skipNewer?: boolean } = {}): Promise<MigrationOutcome[]> {
  const mod = await getModule(moduleId);
  if (!mod) return [];
  const rows = await prisma.moduleInstance.findMany({ where: { moduleId }, select: { id: true } });
  const results: MigrationOutcome[] = [];
  for (const { id } of rows) {
    const instance = await getInstanceById(id);
    if (!instance) continue;
    // Rejeu d'une version intermédiaire : une instance déjà plus avancée que cette version n'est pas « plus récente que le code », elle attend la suite.
    if (opts.skipNewer && (await dataVersionOf(instance.id)) > targetVersion(mod)) continue;
    results.push(await migrateInstance(mod, instance));
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
