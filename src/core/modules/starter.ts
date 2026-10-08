import { prisma } from "../db";
import { listBundled, readBundledManifest } from "./catalogue";
import { copyBundled } from "./installer";
import type { ParsedManifest } from "./manifest";

/**
 * Modules proposés par l'assistant de première installation : ceux que le Catalogue SUGGÈRE (liste du dépôt de modules, pas un drapeau du module lui-même),
 * sauf ceux qui exigent d'abord un autre module (ils s'ajoutent ensuite depuis le Catalogue, qui sait résoudre ces dépendances).
 * Cette étape est facultative : sans instantané ni liste, elle est vide et le site se crée quand même. Le cœur ne dépend d'aucun module.
 */
export function setupModules(): ParsedManifest[] {
  return listBundled().flatMap((e) => {
    const m = e.dir && e.suggested && e.kind !== "example" ? readBundledManifest(e.dir) : null;
    return m && e.compatible && (m.requires ?? []).length === 0 ? [m] : [];
  });
}

/** Tous les manifestes des modules livrés (pour les outils d'import, qui créent des instances de modules de contenu). */
export function bundledManifests(): ParsedManifest[] {
  return listBundled().flatMap((e) => { const m = e.dir ? readBundledManifest(e.dir) : null; return m ? [m] : []; });
}

/** Installe (copie les fichiers) et active un module livré, hors réseau : l'assistant doit marcher sans connexion. */
export async function provisionBundled(id: string): Promise<boolean> {
  if (await prisma.module.findUnique({ where: { id } })) return true;
  const entry = listBundled().find((e) => e.id === id);
  if (!entry?.dir) return false;
  const copied = copyBundled(entry.dir, id);
  if (!copied.ok) return false;
  await prisma.module.create({ data: { id, source: "bundled", version: copied.version, enabled: true } });
  return true;
}
