// One SQLite connection used fairly (src/core/dbFair.ts): with Prisma 7 and better-sqlite3, queries run synchronously on one connection.
//  - a query of another visitor never runs inside someone else's open transaction (it would be undone with it);
//  - the event loop breathes between queries (timers keep running during a long series of writes).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const { fairAdapter, turnLock } = await import("@/core/dbFair");
after(() => db.close());

const tick = () => new Promise((r) => setImmediate(r));

test("turnLock: first come, first served; each holder releases once", async () => {
  const lock = turnLock();
  const order = [];
  const a = await lock.acquire();
  const b = lock.acquire().then((release) => { order.push("b"); return release; });
  const c = lock.acquire().then((release) => { order.push("c"); release(); });
  await tick(); assert.deepEqual(order, [], "nobody passes while the first holds the lock");
  a(); a();   // a second release changes nothing
  (await b)(); await c;
  assert.deepEqual(order, ["b", "c"]);
});

test("fairAdapter (a fake driver): a query waits for the open transaction to end; the queries of the transaction do not wait", async () => {
  const log = [];
  const tx = { queryRaw: async (q) => { log.push(`tx:${q}`); return q; }, executeRaw: async (q) => { log.push(`tx:${q}`); return 1; }, commit: async () => { log.push("commit"); }, rollback: async () => { log.push("rollback"); } };
  const raw = { provider: "sqlite", adapterName: "fake", queryRaw: async (q) => { log.push(`q:${q}`); return q; }, executeRaw: async (q) => { log.push(`q:${q}`); return 1; }, executeScript: async () => {}, startTransaction: async () => { log.push("begin"); return tx; } };
  const a = fairAdapter(raw);
  const t = await a.startTransaction();
  const outside = a.queryRaw("other visitor");
  await t.executeRaw("insert 1");
  await new Promise((r) => setTimeout(r, 20));   // the transaction awaits something else (a file, a network call)
  await t.executeRaw("insert 2");
  assert.ok(!log.includes("q:other visitor"), "never inside the open transaction");
  await t.commit();
  await outside;
  assert.deepEqual(log, ["begin", "tx:insert 1", "tx:insert 2", "commit", "q:other visitor"]);
  // a failed start releases the connection
  const broken = fairAdapter({ ...raw, startTransaction: async () => { throw new Error("busy"); } });
  await assert.rejects(() => broken.startTransaction(), /busy/);
  assert.equal(await broken.queryRaw("after"), "after");
});

test("real database: a write made during someone else's transaction is NOT undone when that transaction fails", async () => {
  await db.reset();
  await db.prisma.setting.create({ data: { key: "site.name", locale: "", value: JSON.stringify("Camille") } });
  let other;
  const failing = db.prisma.$transaction(async (tx) => {
    await tx.user.create({ data: { email: "etoile_nord@example.org", name: "etoile_nord", passwordHash: "x" } });
    // another visitor writes while this transaction is open and waits for something else (a file, a network call)
    // (a single statement: Prisma sends it without a transaction of its own, straight to the connection)
    other = db.prisma.$executeRawUnsafe(`UPDATE "Setting" SET "value" = ? WHERE "key" = ?`, JSON.stringify("lune_douce"), "site.name").then((n) => n);   // started now (Prisma queries are lazy)
    await new Promise((r) => setTimeout(r, 30));
    throw new Error("the transaction fails");
  });
  await assert.rejects(failing, /fails/);
  await other;
  assert.equal(await db.prisma.user.count(), 0, "the failed transaction is undone");
  assert.equal((await db.prisma.setting.findFirst({ where: { key: "site.name" } })).value, JSON.stringify("lune_douce"), "the other visitor's write stays");
});

test("real database: timers keep running during a long series of queries", async () => {
  await db.reset();
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 1);
  try {
    for (let i = 0; i < 300; i++) await db.prisma.setting.upsert({ where: { key_locale: { key: `k${i}`, locale: "" } }, create: { key: `k${i}`, locale: "", value: "1" }, update: { value: "2" } });
  } finally { clearInterval(timer); }
  assert.ok(ticks > 5, `the timer ran ${ticks} times during 300 queries`);
});
