import { prisma } from "@/core/db";
import { readGitManifest } from "./registry";

/**
 * SUPPRIMER UNE COPIE DE SÉCURITÉ INERTE (page Entretien, mode avancé, droit `core:updates`).
 * Le cœur ne supprime QUE ce que le module a promis inerte dans son manifeste (`inertLegacyCollections`, toujours aussi dans `legacyCollections`), relu sur le disque au moment de
 * l'action (jamais le manifeste d'une page déjà affichée : une mise à jour du module qui reprendrait la collection la rend aussitôt non supprimable). Une seule instance et une
 * seule collection à la fois ; jamais une collection non déclarée, jamais les données d'une instance retirée « en gardant mes données » (autre table), jamais autre chose
 * que les lignes de stockage (`ModuleRecord`). Borné : 40 tranches de 500 lignes (20 000 lignes) par clic, sans minuteur ; s'il en reste, on le dit et un nouveau clic continue.
 */
export const DELETE_BATCH = 500;
export const MAX_DELETE_BATCHES = 40;

export type Refusal = "unknown-instance" | "not-declared" | "not-inert" | "not-converted";
export type InertDeletion =
  | { ok: true; deleted: number; remaining: number }
  | { ok: false; reason: Refusal };

/** La collection `collection` de l'instance `instanceKey` est-elle déclarée inerte par son module ? (lecture seule) */
export async function inertDeclared(instanceKey: string, collection: string): Promise<{ ok: true; instanceId: string; moduleId: string } | { ok: false; reason: Refusal }> {
  const inst = await prisma.moduleInstance.findUnique({ where: { key: instanceKey }, select: { id: true, moduleId: true } });
  if (!inst) return { ok: false, reason: "unknown-instance" };
  const manifest = readGitManifest(inst.moduleId);
  if (!manifest || !(manifest.legacyCollections ?? []).includes(collection)) return { ok: false, reason: "not-declared" };
  if (!(manifest.inertLegacyCollections ?? []).includes(collection)) return { ok: false, reason: "not-inert" };
  // La reprise doit être FINIE : tant que les données de l'instance sont en retard ou mises à l'écart, ou qu'une reprise (`seeds`) n'est pas faite, la copie peut encore servir de source.
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: `instance.${inst.id}.__` } }, select: { key: true, value: true } });
  const own = new Map(rows.map((r) => [r.key.slice(`instance.${inst.id}.`.length), r.value]));
  let version = 1;
  try { const v = Number(JSON.parse(own.get("__dataVersion") ?? "1")); if (Number.isInteger(v) && v >= 1) version = v; } catch { /* illisible : version 1 */ }
  let status: { status?: string } | null = null;
  try { status = own.has("__dataStatus") ? JSON.parse(own.get("__dataStatus")!) : null; } catch { status = null; }
  const behind = version < (manifest.dataVersion ?? 1) || status?.status === "failed";
  const seedsPending = Boolean(manifest.seeds?.length) && ![...own.keys()].some((k) => k.startsWith("__seeds."));
  if (behind || seedsPending) return { ok: false, reason: "not-converted" };
  return { ok: true, instanceId: inst.id, moduleId: inst.moduleId };
}

/** Supprime la copie. Refusée (rien n'est touché) si la collection n'est pas déclarée inerte. Ne lève pas pour un refus ; ne contient jamais de contenu de ligne. */
export async function deleteInertCollection(instanceKey: string, collection: string): Promise<InertDeletion & { moduleId?: string; instanceId?: string }> {
  const check = await inertDeclared(instanceKey, collection);
  if (!check.ok) return check;
  const { instanceId, moduleId } = check;
  let deleted = 0;
  for (let i = 0; i < MAX_DELETE_BATCHES; i++) {
    const rows = await prisma.moduleRecord.findMany({ where: { instanceId, collection }, select: { id: true }, take: DELETE_BATCH });
    if (rows.length === 0) break;
    const res = await prisma.moduleRecord.deleteMany({ where: { instanceId, collection, id: { in: rows.map((r) => r.id) } } });
    deleted += res.count;
  }
  const remaining = await prisma.moduleRecord.count({ where: { instanceId, collection } });
  return { ok: true, deleted, remaining, moduleId, instanceId };
}
