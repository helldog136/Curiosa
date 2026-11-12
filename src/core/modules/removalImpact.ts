import { prisma } from "../db";

/**
 * What removing a module (or one of its instances) takes away, as far as the CORE can know it: it never reads the content of a module's data, it only counts.
 * `items` = the entries of the instance(s) plus the records the module stored; `files` = the uploaded files claimed by the instance(s). Used by the
 * confirmation window of the danger zone (R24: say what will be lost).
 */
export type RemovalImpact = { instances: number; items: number; files: number };

async function countFor(instanceIds: string[], moduleId?: string): Promise<Omit<RemovalImpact, "instances">> {
  if (!instanceIds.length) return { items: 0, files: 0 };
  const [entries, records, files] = await Promise.all([
    prisma.entry.count({ where: { instanceId: { in: instanceIds } } }),
    prisma.moduleRecord.count({ where: { instanceId: { in: instanceIds } } }),
    prisma.uploadFile.count({ where: moduleId ? { OR: [{ ownerInstance: { in: instanceIds } }, { ownerModule: moduleId }] } : { ownerInstance: { in: instanceIds } } }),
  ]);
  return { items: entries + records, files };
}

/** Everything the module holds on this site (all its instances). */
export async function moduleRemovalImpact(moduleId: string): Promise<RemovalImpact> {
  const rows = await prisma.moduleInstance.findMany({ where: { moduleId }, select: { id: true } });
  return { instances: rows.length, ...(await countFor(rows.map((r) => r.id), moduleId)) };
}

/** What one instance holds. */
export async function instanceRemovalImpact(instanceId: string): Promise<RemovalImpact> {
  return { instances: 1, ...(await countFor([instanceId])) };
}
