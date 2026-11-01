import { cache } from "react";
import { instanceLabel } from "@/core/instanceLabel";
import { listInstances, pickName, type InstanceView } from "@/core/instances";
import { getModule } from "./registry";
import { localized } from "./types";

/**
 * Libellés d'ADMIN des instances (surnom si plusieurs instances du même module, sinon nom du module).
 * Le site public, lui, utilise les noms publics traduits (pickName) : ceci ne concerne que l'admin, les
 * outils MCP et leur documentation.
 */
export const getInstanceLabeler = cache(async (locale: string, defaultLocale: string) => {
  const instances = await listInstances();
  const moduleNames = new Map<string, string>();
  for (const id of new Set(instances.map((i) => i.moduleId))) {
    const mod = await getModule(id);
    moduleNames.set(id, mod ? localized(mod.manifest.name, locale, defaultLocale) : id);
  }
  const count = (moduleId: string) => instances.filter((i) => i.moduleId === moduleId).length;
  return {
    label: (i: InstanceView) => instanceLabel({ nickname: i.nickname, publicName: pickName(i, locale, defaultLocale), key: i.key }, moduleNames.get(i.moduleId) ?? i.moduleId, count(i.moduleId)),
    moduleName: (moduleId: string) => moduleNames.get(moduleId) ?? moduleId,
    /** Y a-t-il plusieurs instances de ce module (donc un surnom à gérer) ? */
    hasSiblings: (moduleId: string) => count(moduleId) > 1,
    siblingsOf: (i: InstanceView) => instances.filter((o) => o.moduleId === i.moduleId && o.id !== i.id),
  };
});
