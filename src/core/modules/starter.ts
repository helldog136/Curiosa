import { prisma } from "../db";
import { findCatalogueEntry, listBundled, readBundledManifest } from "./catalogue";
import { copyBundled, installFromCatalogue } from "./installer";
import type { ParsedManifest } from "./manifest";

/**
 * Modules proposés par l'assistant de première installation : une liste à cocher venue du catalogue (liste du dépôt de modules, pas un drapeau du module lui-même),
 * sauf ceux qui exigent d'abord un autre module (ils s'ajoutent ensuite depuis le Catalogue, qui sait résoudre ces dépendances).
 * Cette étape est facultative : sans instantané ni liste, elle est vide et le site se crée quand même. Le cœur ne dépend d'aucun module.
 */
export function setupModules(): ParsedManifest[] {
  return listBundled().flatMap((e) => {
    const m = e.dir && e.suggested && e.kind !== "example" ? readBundledManifest(e.dir) : null;
    return m && e.compatible && (m.requires ?? []).length === 0 ? [m] : [];
  });
}

/** Tous les manifestes de l'instantané hors ligne (pour les outils d'import, qui créent des instances de modules de contenu). */
export function bundledManifests(): ParsedManifest[] {
  return listBundled().flatMap((e) => { const m = e.dir ? readBundledManifest(e.dir) : null; return m ? [m] : []; });
}

/**
 * Installe et active un module choisi dans l'assistant. Le catalogue (dépôt, version épinglée) est la source ; la copie hors ligne embarquée dans l'archive
 * ne sert que si le catalogue est injoignable (première installation sans réseau). Renvoie d'où vient le module, `false` si rien n'a pu être installé.
 */
export async function provisionModule(id: string): Promise<"catalogue" | "offline-copy" | false> {
  if (await prisma.module.findUnique({ where: { id } })) return "catalogue";
  const entry = await findCatalogueEntry(id).catch(() => undefined);
  if (entry?.source === "recognized") {
    const r = await installFromCatalogue(id, { dependencies: false });
    if (r.ok) { await prisma.module.update({ where: { id }, data: { enabled: true } }); return "catalogue"; }
    console.warn(`[setup] catalogue install of ${id} failed (${r.error}); using the offline copy`);
  }
  if (!(await provisionBundled(id))) return false;
  return "offline-copy";
}

/** Installe et active un module depuis la copie hors ligne embarquée dans l'archive, sans réseau (outils d'import, repli de l'assistant). */
export async function provisionBundled(id: string): Promise<boolean> {
  if (await prisma.module.findUnique({ where: { id } })) return true;
  const entry = listBundled().find((e) => e.id === id);
  if (!entry?.dir) return false;
  const copied = copyBundled(entry.dir, id);
  if (!copied.ok) return false;
  await prisma.module.create({ data: { id, source: "bundled", version: copied.version, enabled: true } });
  return true;
}
