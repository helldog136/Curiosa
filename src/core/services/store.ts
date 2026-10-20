import crypto from "node:crypto";
import { prisma } from "@/core/db";

export type StoreRecord = { id: string; createdAt: Date; data: Record<string, unknown>; key: string | null };
export type StorePage = { items: StoreRecord[]; next: string | null };

export type Store = {
  add(collection: string, data: Record<string, unknown>, opts?: { key?: string | null }): Promise<string>;
  get(id: string): Promise<StoreRecord | null>;
  /** `key` absent = inchangée ; `key: null` l'efface. */
  update(id: string, data: Record<string, unknown>, opts?: { key?: string | null }): Promise<boolean>;
  list(collection: string, opts?: { limit?: number }): Promise<StoreRecord[]>;
  page(collection: string, opts?: { limit?: number; cursor?: string | null; order?: "desc" | "asc"; key?: string }): Promise<StorePage>;
  getByKey(collection: string, key: string): Promise<StoreRecord | null>;
  listByKey(collection: string, key: string, opts?: { limit?: number; cursor?: string | null }): Promise<StorePage>;
  addMany(collection: string, rows: { data: Record<string, unknown>; key?: string | null }[]): Promise<string[]>;
  generation(): Promise<number>;
  remove(id: string): Promise<void>;
  count(collection: string): Promise<number>;
};

/** Plafonds durs (documentés dans docs/PLATFORM.md). */
export const STORE_LIST_DEFAULT = 100;
export const STORE_LIST_MAX = 10_000;
export const STORE_PAGE_DEFAULT = 100;
export const STORE_PAGE_MAX = 1_000;
export const STORE_KEY_MAX = 200;
export const STORE_ADD_MANY_MAX = 5_000;
const ADD_MANY_CHUNK = 500;

/** Réglage (par instance) qui porte le compteur de génération. */
export const generationKey = (instanceId: string) => `instance.${instanceId}.__storeGeneration`;

/**
 * Lit les compteurs de génération (lecture directe en base, sans le cache des réglages) de ces instances ; absent = 0.
 */
export async function readGenerations(instanceIds?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.setting.findMany({
    where: instanceIds ? { key: { in: instanceIds.map(generationKey) }, locale: "" } : { key: { startsWith: "instance.", endsWith: ".__storeGeneration" }, locale: "" },
    select: { key: true, value: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = /^instance\.(.+)\.__storeGeneration$/.exec(r.key)?.[1];
    let n = 0;
    try { n = Number(JSON.parse(r.value)); } catch { /* valeur illisible : 0 */ }
    if (id) out.set(id, Number.isSafeInteger(n) && n > 0 ? n : 0);
  }
  return out;
}

/**
 * Fait passer le compteur de génération de ces instances à `max(avant, actuel) + 1` : il ne recule jamais, même si une restauration
 * a remis une valeur plus ancienne. `before` = valeurs lues avant l'opération (qui a pu les effacer ou les remplacer).
 */
export async function bumpGenerations(instanceIds: string[], before: Map<string, number> = new Map()): Promise<void> {
  if (!instanceIds.length) return;
  const now = await readGenerations(instanceIds);
  for (const id of instanceIds) {
    const next = Math.max(before.get(id) ?? 0, now.get(id) ?? 0) + 1;
    const value = JSON.stringify(next);
    await prisma.setting.upsert({ where: { key_locale: { key: generationKey(id), locale: "" } }, create: { key: generationKey(id), locale: "", value }, update: { value } });
  }
}

/* ── curseur ─────────────────────────────────────────────────────────────── */

/** Curseur = base64url de « <createdAt ISO>|<id> » : stable même si des lignes sont ajoutées ou retirées entre deux pages. */
export const encodeCursor = (r: { createdAt: Date; id: string }) => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`, "utf8").toString("base64url");

export function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (typeof cursor !== "string" || !cursor || cursor.length > 400) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const i = raw.indexOf("|");
    if (i < 1) return null;
    const createdAt = new Date(raw.slice(0, i));
    const id = raw.slice(i + 1);
    return Number.isNaN(createdAt.getTime()) || !id ? null : { createdAt, id };
  } catch { return null; }
}

const clampLimit = (limit: unknown, def: number, max: number) => {
  const n = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : def;
  return Math.min(Math.max(n, 1), max);
};

function cleanKey(key: unknown): string | null {
  if (key === undefined || key === null || key === "") return null;
  if (typeof key !== "string" || key.length > STORE_KEY_MAX) throw new Error(`store: key must be a string of at most ${STORE_KEY_MAX} characters`);
  return key;
}

/** Identifiants croissants au sein d'un appel (l'ordre des ids = l'ordre des lignes), uniques entre appels. */
function idMaker() {
  const stamp = Date.now().toString(36);
  const salt = crypto.randomBytes(6).toString("hex");
  let n = 0;
  return () => `c${stamp}${(n++).toString(36).padStart(5, "0")}${salt}`;
}

const warned = new Set<string>();

const KEY_INDEX = "ModuleRecord_instanceId_collection_key_idx";

/**
 * Lecture par clé. SQLite sans statistiques (jamais d'ANALYZE ici) préfère l'index (instanceId, collection, createdAt) pour éviter un tri, et PARCOURT alors toute
 * la collection pour une clé donnée (mesuré : 20 ms par appel à 50 000 lignes, contre moins de 1 ms par l'index de clé). On impose donc l'index de clé (INDEXED BY) ;
 * si l'index manquait, on retombe sur la requête Prisma ordinaire (correcte, plus lente).
 */
async function readByKey(instanceId: string, collection: string, key: string, order: "asc" | "desc", cursor: { createdAt: Date; id: string } | null, take: number) {
  const op = order === "desc" ? "<" : ">";
  const dir = order === "desc" ? "DESC" : "ASC";
  type Raw = { id: string; createdAt: bigint | number | Date; data: string; key: string | null };
  try {
    const args: unknown[] = [instanceId, collection, key];
    let cond = "";
    if (cursor) { const ms = cursor.createdAt.getTime(); cond = ` AND (createdAt ${op} ? OR (createdAt = ? AND id ${op} ?))`; args.push(ms, ms, cursor.id); }
    args.push(take);
    const rows = await prisma.$queryRawUnsafe<Raw[]>(`SELECT id, createdAt, data, key FROM "ModuleRecord" INDEXED BY "${KEY_INDEX}" WHERE instanceId = ? AND collection = ? AND key = ?${cond} ORDER BY createdAt ${dir}, id ${dir} LIMIT ?`, ...args);
    return rows.map((r) => ({ id: r.id, data: r.data, key: r.key, createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(Number(r.createdAt)) }));
  } catch {
    const where: Record<string, unknown> = { instanceId, collection, key };
    if (cursor) where.OR = [{ createdAt: { [order === "desc" ? "lt" : "gt"]: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { [order === "desc" ? "lt" : "gt"]: cursor.id } }];
    return prisma.moduleRecord.findMany({ where: where as never, orderBy: [{ createdAt: order }, { id: order }], take });
  }
}

/**
 * SERVICE « stockage privé » — offert aux modules par le cœur (`ctx.api.store`).
 * Chaque instance de module a son propre espace (collections libres de documents JSON) : une
 * instance ne peut ni lire ni écrire celui d'une autre. Aucune connaissance du contenu stocké.
 */
export function createStore(instanceId: string): Store {
  type Row = { id: string; createdAt: Date; data: string; key: string | null };
  const parse = (r: Row): StoreRecord => ({ id: r.id, createdAt: r.createdAt, data: JSON.parse(r.data), key: r.key ?? null });

  async function page(collection: string, opts: { limit?: number; cursor?: string | null; order?: "desc" | "asc"; key?: string } = {}): Promise<StorePage> {
    const limit = clampLimit(opts.limit, STORE_PAGE_DEFAULT, STORE_PAGE_MAX);
    const order = opts.order === "asc" ? "asc" : "desc";
    const c = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !c) return { items: [], next: null };
    let rows: Row[];
    if (opts.key !== undefined) rows = await readByKey(instanceId, collection, opts.key, order, c, limit + 1);
    else {
      const where: Record<string, unknown> = { instanceId, collection };
      if (c) { const op = order === "desc" ? "lt" : "gt"; where.OR = [{ createdAt: { [op]: c.createdAt } }, { createdAt: c.createdAt, id: { [op]: c.id } }]; }
      rows = await prisma.moduleRecord.findMany({ where: where as never, orderBy: [{ createdAt: order }, { id: order }], take: limit + 1 });
    }
    const more = rows.length > limit;
    const kept = more ? rows.slice(0, limit) : rows;
    return { items: kept.map(parse), next: more && kept.length ? encodeCursor(kept[kept.length - 1]!) : null };
  }

  return {
    async add(collection, data, opts) {
      return (await prisma.moduleRecord.create({ data: { instanceId, collection, data: JSON.stringify(data), key: cleanKey(opts?.key) } })).id;
    },
    async get(id) {
      const r = await prisma.moduleRecord.findFirst({ where: { id, instanceId } });
      return r ? parse(r) : null;
    },
    async update(id, data, opts) {
      const patch: { data: string; key?: string | null } = { data: JSON.stringify(data) };
      if (opts && "key" in opts && opts.key !== undefined) patch.key = cleanKey(opts.key);
      return (await prisma.moduleRecord.updateMany({ where: { id, instanceId }, data: patch })).count > 0;
    },
    async list(collection, opts) {
      let limit = clampLimit(opts?.limit, STORE_LIST_DEFAULT, Number.MAX_SAFE_INTEGER);
      if (limit > STORE_LIST_MAX) {
        if (!warned.has(instanceId)) { warned.add(instanceId); console.warn(`[store] list(${collection}) asked for ${limit} rows: capped at ${STORE_LIST_MAX}. Use store.page() to read more.`); }
        limit = STORE_LIST_MAX;
      }
      const rows = await prisma.moduleRecord.findMany({ where: { instanceId, collection }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit });
      return rows.map(parse);
    },
    page,
    async getByKey(collection, key) {
      const r = (await readByKey(instanceId, collection, key, "asc", null, 1))[0];
      return r ? parse(r) : null;
    },
    listByKey(collection, key, opts) {
      return page(collection, { ...opts, key });
    },
    async addMany(collection, rows) {
      if (!Array.isArray(rows)) throw new Error("store: addMany expects an array");
      if (rows.length > STORE_ADD_MANY_MAX) throw new Error(`store: addMany accepts at most ${STORE_ADD_MANY_MAX} rows per call`);
      if (!rows.length) return [];
      // Tout est préparé (et validé) AVANT d'écrire : une ligne illisible ne laisse rien derrière elle.
      const next = idMaker();
      const createdAt = new Date();
      const prepared = rows.map((r) => ({ id: next(), instanceId, collection, data: JSON.stringify(r.data), key: cleanKey(r.key), createdAt }));
      const ops = [];
      for (let i = 0; i < prepared.length; i += ADD_MANY_CHUNK) ops.push(prisma.moduleRecord.createMany({ data: prepared.slice(i, i + ADD_MANY_CHUNK) }));
      await prisma.$transaction(ops);
      return prepared.map((r) => r.id);
    },
    async generation() {
      return (await readGenerations([instanceId])).get(instanceId) ?? 0;
    },
    async remove(id) {
      await prisma.moduleRecord.deleteMany({ where: { id, instanceId } });
    },
    count(collection) {
      return prisma.moduleRecord.count({ where: { instanceId, collection } });
    },
  };
}
