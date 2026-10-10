import { listInstances } from "../instances";
import { getSettingByLocale } from "../settings";
import { taskStateOf } from "../services/scheduler";
import { instanceSettingKey } from "./context";
import { dataStatusOf } from "./dataMigrations";
import { integrationState, settingsToFill, type IntegrationState } from "./menuPlacement";
import { listModuleRows, loadModule } from "./registry";

/** Ce que l'admin montre de chaque instance : son état (active, désactivée, à configurer, erreur). Pour la page Intégrations et la liste des modules installés. */
export type InstanceStatus = { state: IntegrationState; enabled: boolean; moduleEnabled: boolean; toFill: boolean; error: boolean };

/**
 * État de toutes les instances (clé : identifiant d'instance).
 * - erreur : la migration des données du module a échoué, ou l'une de ses tâches planifiées a échoué à son dernier passage ;
 * - à configurer : un réglage à remplir (voir `settingsToFill`) est encore vide.
 */
export async function loadInstanceStatuses(): Promise<Map<string, InstanceStatus>> {
  const rows = new Map((await listModuleRows()).map((r) => [r.id, r]));
  const out = new Map<string, InstanceStatus>();
  const mods = new Map<string, Awaited<ReturnType<typeof loadModule>>>();
  for (const instance of await listInstances()) {
    const row = rows.get(instance.moduleId);
    if (!mods.has(instance.moduleId)) mods.set(instance.moduleId, row ? await loadModule(row) : null);
    const mod = mods.get(instance.moduleId) ?? null;
    let error = !mod || !!(await dataStatusOf(instance.id));
    let toFill = false;
    if (mod) {
      for (const name of Object.keys(mod.def.tasks ?? {})) if ((await taskStateOf(instance.id, name).catch(() => null))?.status === "failed") error = true;
      const fields = mod.manifest.settings.filter((f) => !f.advanced);
      const stored: Record<string, Record<string, unknown>> = {};
      for (const f of fields) stored[f.key] = await getSettingByLocale(instanceSettingKey(instance.id, f.key));
      toFill = settingsToFill(fields, new Set((mod.manifest.optionalGroups ?? []).flatMap((g) => g.fields)), stored);
    }
    const moduleEnabled = !!row?.enabled;
    out.set(instance.id, { state: integrationState({ enabled: instance.enabled, moduleEnabled, error, toFill }), enabled: instance.enabled, moduleEnabled, toFill, error });
  }
  return out;
}
