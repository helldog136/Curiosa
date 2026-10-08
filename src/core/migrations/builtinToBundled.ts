import { prisma } from "@/core/db";
import { listBundled } from "@/core/modules/catalogue";
import { copyBundled } from "@/core/modules/installer";

/**
 * ⚠️ TEMPORAIRE — À SUPPRIMER APRÈS LA 0.1.3. Cette migration n'a d'utilité que pour les sites passés par la 0.1.2 ou une 0.1.3 release candidate, où
 * dix modules (blog, réseaux sociaux, codes promo, pages, collection, bandeau, formulaire de contact, statut live, bandeau défilant, dossier de presse)
 * étaient « intégrés » au cœur. Dès qu'une version supérieure à la 0.1.3 est préparée, un test (tests/core/temporary-code.test.mjs) échoue tant que ces fichiers existent :
 *   - src/core/migrations/builtinToBundled.ts (ce fichier) et son appel dans src/core/modules/registry.ts (syncLegacy) ;
 *   - tests/core/builtin-migration.test.mjs.
 *
 * MIGRATION AUTOMATIQUE : le cœur ne contient plus aucun module, ils vivent dans le dépôt `curiosa-extras`. Au premier démarrage qui suit la mise à jour,
 * chaque module « intégré » devient un module ordinaire (source « bundled »), copié depuis l'instantané `extras/` livré avec cette version dans le dossier
 * des modules installés. Ses instances, ses entrées et ses réglages ne changent pas : le site s'affiche à l'identique, et le module se met à jour
 * ensuite comme tous les autres. Idempotente : sans ligne « intégrée », elle ne fait rien. Si l'instantané ne contient pas un module, la ligne est
 * quand même convertie (les données sont gardées) et le module apparaît comme à réinstaller dans le Catalogue.
 */
export async function migrateBuiltinModules(): Promise<void> {
  const rows = await prisma.module.findMany({ where: { source: "builtin" } });
  if (rows.length === 0) return;
  const shipped = new Map(listBundled().map((e) => [e.id, e]));
  for (const row of rows) {
    const entry = shipped.get(row.id);
    const copied = entry?.dir ? copyBundled(entry.dir, row.id) : null;
    await prisma.module.update({ where: { id: row.id }, data: { source: "bundled", version: copied?.ok ? copied.version : row.version } });
  }
}
