import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
const db = await useTestDb();
const { listAudit, AUDIT_PAGE_SIZE } = await import("@/core/audit");
beforeEach(() => db.reset());
after(() => db.close());
const add = (n, over = {}) => db.prisma.auditLog.createMany({ data: Array.from({ length: n }, (_, i) => ({ actor: "owner@example.org", action: `settings.update`, target: `t${i}`, createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, i)), ...over })) });

test("journal : plus récent d'abord, paginé, borné", async () => {
  await add(AUDIT_PAGE_SIZE + 5);
  const p1 = await listAudit();
  assert.equal(p1.rows.length, AUDIT_PAGE_SIZE);
  assert.deepEqual([p1.total, p1.page, p1.pages], [AUDIT_PAGE_SIZE + 5, 1, 2]);
  assert.equal(p1.rows[0].target, `t${AUDIT_PAGE_SIZE + 4}`);
  const p2 = await listAudit({ page: 2 });
  assert.equal(p2.rows.length, 5);
  assert.equal((await listAudit({ page: 99 })).page, 2, "page hors limites ramenée à la dernière");
  assert.equal((await listAudit({ page: -3 })).page, 1);
});

test("recherche texte sur qui, action et cible ; journal vide", async () => {
  assert.deepEqual((await listAudit()).rows, []);
  await db.prisma.auditLog.create({ data: { actor: "alice@example.org", action: "module.install", target: "blog" } });
  await db.prisma.auditLog.create({ data: { actor: "bob@example.org", action: "backup.create", target: "" } });
  assert.deepEqual((await listAudit({ q: "alice" })).rows.map((r) => r.action), ["module.install"]);
  assert.deepEqual((await listAudit({ q: "backup" })).rows.map((r) => r.actor), ["bob@example.org"]);
  assert.deepEqual((await listAudit({ q: "blog" })).rows.length, 1);
  assert.equal((await listAudit({ q: "zzz" })).total, 0);
});
