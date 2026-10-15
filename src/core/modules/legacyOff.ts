import { audit } from "../permissions";
import { prisma } from "../db";
import { forgetAuto } from "./autoInstalled";
import { purgeModule } from "./installer";
import { resetModuleRegistry } from "./registry";
import { retireInstance, retireModuleInstances } from "./retired";

/**
 * ⚠️ TEMPORAIRE — À SUPPRIMER APRÈS LA 0.2.x (retrait en 0.3.0). Avant la 0.1.20, un module ou une instance pouvait être « installé(e) mais éteint(e) ». Cet état
 * n'existe plus : il n'y a que « installé » et « pas installé ». Au premier démarrage qui suit la mise à jour (et après la restauration d'une sauvegarde plus ancienne),
 * tout ce qui était éteint devient « désinstallé, données gardées » — rien n'est perdu, la réinstallation du module le retrouve tel quel :
 *   - module éteint            → désinstallé ; toutes ses instances sont rangées avec leurs réglages et leurs contenus ;
 *   - instance éteinte (module allumé) → retirée, ses données rangées.
 * Un test (tests/core/temporary-code.test.mjs) échoue dès la 0.3.0 tant que ces fichiers existent :
 *   - src/core/modules/legacyOff.ts (ce fichier), son appel dans src/instrumentation.ts et dans src/core/backup/restore.ts (applyRestore) ;
 *   - les tests « migration des éteints » de tests/modules-mgmt/module-lifecycle.test.mjs ;
 *   - les colonnes `Module.enabled` et `ModuleInstance.enabled` de prisma/schema.prisma (nouvelle migration qui les retire) et le champ `enabled` de BackupModule (backup/format.ts).
 * Idempotent : sans module ni instance éteints, il ne fait rien.
 */
export type LegacyModule = { id: string; enabled: boolean };
export type LegacyInstance = { id: string; moduleId: string; enabled: boolean };

/** Que faut-il ranger ? Les modules éteints (avec toutes leurs instances) ; puis les instances éteintes des modules qui restent. Pur, trié, donc sans hasard. */
export function legacyOffPlan(modules: readonly LegacyModule[], instances: readonly LegacyInstance[]): { modules: string[]; instances: string[] } {
  const offModules = new Set(modules.filter((m) => !m.enabled).map((m) => m.id));
  return {
    modules: [...offModules].sort(),
    instances: instances.filter((i) => !i.enabled && !offModules.has(i.moduleId)).map((i) => i.id).sort(),
  };
}

export async function retireLegacyOff(): Promise<{ modules: string[]; instances: string[] }> {
  const plan = legacyOffPlan(await prisma.module.findMany({ select: { id: true, enabled: true } }), await prisma.moduleInstance.findMany({ select: { id: true, moduleId: true, enabled: true } }));
  if (!plan.modules.length && !plan.instances.length) return plan;
  for (const id of plan.modules) {
    await retireModuleInstances(id, "legacy");
    await purgeModule(id);
    await forgetAuto(id);
    await audit("system", "module.legacy.off", id);
  }
  for (const id of plan.instances) {
    const line = await retireInstance(id, "legacy");
    if (line) await audit("system", "instance.legacy.off", line.key);
  }
  resetModuleRegistry();
  return plan;
}
