import { listInstances } from "../instances";
import { getSettingByLocale } from "../settings";
import { taskStateOf } from "../services/scheduler";
import { instanceSettingKey } from "./context";
import { dataStatusOf } from "./dataMigrations";
import { integrationState, type IntegrationState } from "./menuPlacement";
import { missingSettings } from "./missingSettings";
import { resolveChoiceFor } from "./choice";
import { fillStored } from "./choiceValues";
import { listModuleRows, loadModule } from "./registry";
import { localized } from "./types";

const CHOICE_STATUS_BUDGET_MS = 1500;
const CHOICE_STATUS_FIELD_MS = 800;

/** Ce que l'admin montre de chaque instance : son état (en place, à configurer, erreur). Pour la page Intégrations et la liste des modules installés. */
export type InstanceStatus = {
  state: IntegrationState; toFill: boolean; error: boolean;
  /** Libellés (dans la langue de l'admin) des réglages à remplir qui manquent, dans l'ordre du manifeste. Vide si rien ne manque. */
  missing: string[];
};

/**
 * État de toutes les instances (clé : identifiant d'instance).
 * - erreur : la migration des données du module a échoué, ou l'une de ses tâches planifiées a échoué à son dernier passage ;
 * - à configurer : un réglage à remplir (voir `missingSettings`) est encore vide ; `missing` dit lesquels.
 */
export async function loadInstanceStatuses(locale: string, defaultLocale: string): Promise<Map<string, InstanceStatus>> {
  const rows = new Map((await listModuleRows()).map((r) => [r.id, r]));
  const out = new Map<string, InstanceStatus>();
  const mods = new Map<string, Awaited<ReturnType<typeof loadModule>>>();
  // Réglages « choix parmi » : résolus (cache daté) dans un budget court pour toute la liste ; au-delà, « non vérifié » (rempli s'il y a une valeur).
  const choiceBudgetEnd = Date.now() + CHOICE_STATUS_BUDGET_MS;
  for (const instance of await listInstances()) {
    const row = rows.get(instance.moduleId);
    if (!mods.has(instance.moduleId)) mods.set(instance.moduleId, row ? await loadModule(row) : null);
    const mod = mods.get(instance.moduleId) ?? null;
    let error = !mod || !!(await dataStatusOf(instance.id));
    let missing: string[] = [];
    if (mod) {
      for (const name of Object.keys(mod.def.tasks ?? {})) if ((await taskStateOf(instance.id, name).catch(() => null))?.status === "failed") error = true;
      const fields = mod.manifest.settings.filter((f) => !f.advanced);
      const stored: Record<string, Record<string, unknown>> = {};
      for (const f of fields) stored[f.key] = await getSettingByLocale(instanceSettingKey(instance.id, f.key));
      for (const f of fields) {
        if (f.type !== "choice") continue;
        const raw = typeof stored[f.key]?.[""] === "string" ? String(stored[f.key]![""]).trim() : "";
        const ms = Math.min(CHOICE_STATUS_FIELD_MS, choiceBudgetEnd - Date.now());
        const r = ms > 50 ? await resolveChoiceFor({ mod, instance }, f, raw, { locale, timeoutMs: ms }) : { status: "unverified" as const };
        stored[f.key] = fillStored(r, raw);
      }
      missing = missingSettings(fields, new Set((mod.manifest.optionalGroups ?? []).flatMap((g) => g.fields)), stored).map((f) => localized(f.label, locale, defaultLocale));
    }
    const toFill = missing.length > 0;
    out.set(instance.id, { state: integrationState({ error, toFill }), toFill, error, missing });
  }
  return out;
}
