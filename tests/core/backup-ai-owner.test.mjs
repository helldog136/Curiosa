import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb, settleBackground } from "../helpers/db.mjs";

// The owner of an AI access is permanent (core 0.47.1). Accesses are not part of a backup but the PEOPLE are: a restore that leaves an access whose owner is not in the backup revokes it
// (pending requests expire, one journal line, the report says how many). An access that never had an owner is untouched.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const { createToken, findTokenId } = await import("@/core/services/mcp/tokens");
const { createAccess } = await import("@/core/mcpAccess");
const RQ = await import("@/core/maintenance/requests");
const { setSetting } = await import("@/core/settings");
after(() => db.close());

const PW = "a-solid-backup-password";
const FAST = 1000;

test("a restore revokes the accesses whose owner is not in the backup, with a journal line and a line in the report; the others stay", async () => {
  const boss = await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash", locale: "en" } });
  await setSetting("setup.completed", true);
  const made = await B.createBackup(PW, { iterations: FAST }); // the backup knows only the owner
  const camille = await db.prisma.user.create({ data: { email: "camille@example.org", name: "Camille", role: "admin", passwordHash: "$2a$12$hash", locale: "en" } });
  const mine = await createAccess({ name: "Mine", scope: "read", actorEmail: boss.email, ownerId: boss.id });
  const hers = await createAccess({ name: "Hers", scope: "read", actorEmail: boss.email, ownerId: camille.id });
  const legacy = await createToken("Legacy", "read", "o"); // never had an owner
  const [mineId, hersId, legacyId] = await Promise.all([findTokenId(mine.token), findTokenId(hers.token), findTokenId(legacy)]);
  await RQ.createRequest({ action: "module_update", plan: { module: "m1", from: "1.0.0", to: "1.0.1" }, tokenId: hersId, tokenName: "Hers", ownerId: camille.id });
  const opened = Rs.openBackup(made.buffer, PW, FAST);
  assert.ok(opened.ok);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true);
  await settleBackground();
  assert.equal(await db.prisma.user.count({ where: { email: "camille@example.org" } }), 0, "Camille is not in the restored data");
  const row = (id) => db.prisma.apiToken.findUnique({ where: { id } });
  assert.ok((await row(hersId)).revokedAt, "her access is revoked");
  assert.equal((await row(mineId)).revokedAt, null, "the owner's access stays");
  const legacyRow = await row(legacyId);
  assert.deepEqual([legacyRow.revokedAt, legacyRow.ownerId], [null, null], "an access that never had an owner is untouched");
  assert.equal((await RQ.listRequests()).filter((r) => r.status === "pending").length, 0, "its pending requests expired");
  const lines = await db.prisma.auditLog.findMany({ where: { action: "mcp.personal.revoke" } });
  assert.deepEqual(lines.map((l) => [l.actor, l.target]), [["owner@example.org", "Hers: owner removed"]]);
  assert.ok(!JSON.stringify(lines).includes(hers.token));
  assert.deepEqual(report.report.converted.filter((i) => i.id === "core.aiAccessesRevoked"), [{ id: "core.aiAccessesRevoked", note: "aiAccessesRevoked", params: { count: 1 } }]);
  // the report item is a key under backup.report.* that the restore page loads
  assert.match(fs.readFileSync("src/components/admin/restoreKeys.ts", "utf8"), /"report\.aiAccessesRevoked"/);
});
