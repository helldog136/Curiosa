import { prisma } from "@/core/db";

export type StoreRecord = { id: string; createdAt: Date; data: Record<string, unknown> };

export type Store = {
  add(collection: string, data: Record<string, unknown>): Promise<string>;
  get(id: string): Promise<StoreRecord | null>;
  update(id: string, data: Record<string, unknown>): Promise<boolean>;
  list(collection: string, opts?: { limit?: number }): Promise<StoreRecord[]>;
  remove(id: string): Promise<void>;
  count(collection: string): Promise<number>;
};

/**
 * SERVICE « stockage privé » — offert aux modules par le cœur (`ctx.api.store`).
 * Chaque instance de module a son propre espace (collections libres de documents JSON) : une
 * instance ne peut ni lire ni écrire celui d'une autre. Aucune connaissance du contenu stocké.
 */
export function createStore(instanceId: string): Store {
  const parse = (r: { id: string; createdAt: Date; data: string }): StoreRecord => ({ id: r.id, createdAt: r.createdAt, data: JSON.parse(r.data) });
  return {
    async add(collection, data) {
      return (await prisma.moduleRecord.create({ data: { instanceId, collection, data: JSON.stringify(data) } })).id;
    },
    async get(id) {
      const r = await prisma.moduleRecord.findFirst({ where: { id, instanceId } });
      return r ? parse(r) : null;
    },
    async update(id, data) {
      return (await prisma.moduleRecord.updateMany({ where: { id, instanceId }, data: { data: JSON.stringify(data) } })).count > 0;
    },
    async list(collection, opts) {
      const rows = await prisma.moduleRecord.findMany({ where: { instanceId, collection }, orderBy: { createdAt: "desc" }, take: opts?.limit ?? 100 });
      return rows.map(parse);
    },
    async remove(id) {
      await prisma.moduleRecord.deleteMany({ where: { id, instanceId } });
    },
    count(collection) {
      return prisma.moduleRecord.count({ where: { instanceId, collection } });
    },
  };
}
