import { getInstanceLabeler } from "../modules/labels";
import { getActiveInstances } from "../modules/registry";
import { localized } from "../modules/types";
import { catalogKey, type Catalog } from "./model";

/**
 * Les éléments DISPONIBLES : ceux que déclarent (manifeste `overlayElements`) ET que savent servir (`overlayElements` de la définition) les instances de modules actives.
 * Un module retiré, une instance retirée ou un élément qui n'existe plus n'y figurent pas : la page garde alors son cadre, vide (voir pageInput.ts et resolve.ts).
 */
export async function buildCatalog(locale: string, defaultLocale: string): Promise<Catalog> {
  const catalog: Catalog = new Map();
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  for (const a of await getActiveInstances()) {
    const decls = a.mod.manifest.overlayElements;
    if (!decls?.length) continue;
    const serve = a.mod.def.overlayElements;
    for (const decl of decls) {
      if (typeof serve?.[decl.id] !== "function") continue;
      catalog.set(catalogKey(a.instance.key, decl.id), { instance: a.instance.key, moduleId: a.mod.manifest.id, moduleName: labeler.moduleName(a.mod.manifest.id), instanceLabel: labeler.label(a.instance), decl });
    }
  }
  return catalog;
}

/** Libellé d'un élément pour les listes et les cadres : « Compte à rebours · Événement à la une ». */
export const elementTitle = (entry: { instanceLabel: string; decl: { label: string | Record<string, string> } }, locale: string, defaultLocale: string): string =>
  `${entry.instanceLabel} · ${localized(entry.decl.label, locale, defaultLocale)}`;
