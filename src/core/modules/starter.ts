import { prisma } from "../db";
import { listBundled, readBundledManifest } from "./catalogue";
import { copyBundled } from "./installer";
import type { ParsedManifest } from "./manifest";

/**
 * Modules de départ de l'assistant de première installation. Le cœur n'en connaît aucun : il lit les manifestes des modules livrés avec cette
 * version (instantané de `curiosa-extras` dans `extras/`) et ne retient que ceux qui se déclarent « de départ ». Sans instantané, la liste est vide
 * et l'assistant crée simplement un site sans contenu : le cœur ne dépend d'aucun module.
 */
export function starterManifests(): ParsedManifest[] {
  return listBundled().flatMap((e) => {
    const m = e.dir ? readBundledManifest(e.dir) : null;
    return m && (m.starter || m.onboarding?.always) ? [m] : [];
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
