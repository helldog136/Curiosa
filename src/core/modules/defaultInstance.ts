import { prisma } from "../db";
import { getSiteConfig } from "../settings";
import { createInstance, defaultNames, runInstanceCreateHook } from "../instanceService";
import { getModule } from "./registry";

/**
 * INSTANCE PAR DÉFAUT d'un fournisseur apporté par la cascade : un module sans instance ne fournit rien. On fait en sorte qu'il y en ait une qui tourne.
 *   - déjà une instance active : rien à faire ;
 *   - des instances mais toutes désactivées : on réactive la première (par clé), sans rien créer ;
 *   - aucune : on en crée une, avec les réglages par défaut du module (single comme multiple ; la première n'a pas besoin de surnom).
 * Renvoie ce qui a été fait, pour pouvoir le défaire si la cascade échoue.
 */
export type EnsureOutcome = { kind: "present" } | { kind: "created"; instanceId: string } | { kind: "reenabled"; instanceId: string };

export async function ensureDefaultInstance(moduleId: string): Promise<EnsureOutcome | null> {
  const mod = await getModule(moduleId);
  if (!mod) return null;
  const existing = await prisma.moduleInstance.findMany({ where: { moduleId }, orderBy: { key: "asc" } });
  if (existing.some((i) => i.enabled)) return { kind: "present" };
  if (existing.length) {
    await prisma.moduleInstance.update({ where: { id: existing[0]!.id }, data: { enabled: true } });
    return { kind: "reenabled", instanceId: existing[0]!.id };
  }
  const { locales } = await getSiteConfig();
  const created = await createInstance(prisma, { manifest: mod.manifest, names: defaultNames(mod.manifest, locales) });
  await runInstanceCreateHook(created.id);
  return { kind: "created", instanceId: created.id };
}

/** Défait `ensureDefaultInstance` (échec de la cascade) : l'instance créée est supprimée avec ses réglages, celle réactivée est remise à l'arrêt. */
export async function undoDefaultInstance(outcome: EnsureOutcome): Promise<void> {
  if (outcome.kind === "reenabled") { await prisma.moduleInstance.update({ where: { id: outcome.instanceId }, data: { enabled: false } }).catch(() => {}); return; }
  if (outcome.kind !== "created") return;
  const id = outcome.instanceId;
  await prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${id}.` } } });
  await prisma.moduleRecord.deleteMany({ where: { instanceId: id } });
  await prisma.moduleInstance.delete({ where: { id } }).catch(() => {});
}
