import test, { after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb, settleBackground } from "../helpers/db.mjs";

// Full powers (core 0.34.0) never travel in a backup, and a restore switches them off everywhere, even if the file was crafted to carry them.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const B = await import("@/core/backup/export");
const Rs = await import("@/core/backup/restore");
const F = await import("@/core/backup/format");
const { readTarGz } = await import("@/core/backup/tar");
const { createToken, findTokenId } = await import("@/core/services/mcp/tokens");
const { setFullPowers, hasFullPowers, FULL_POWERS_KEY } = await import("@/core/services/mcp/fullPowers");
const { setSetting } = await import("@/core/settings");
after(() => db.close());

const PW = "a-solid-backup-password";
const FAST = 1000;

test("not written in a backup; a restore turns it off (and says so in the journal) even when the file carries it", async () => {
  await db.prisma.user.create({ data: { email: "owner@example.org", name: "Owner", role: "owner", passwordHash: "$2a$12$hash", locale: "en" } });
  await setSetting("setup.completed", true);
  const id = await findTokenId(await createToken("etoile_nord", "write", "owner@example.org"));
  assert.equal(await setFullPowers(id, true), true);
  const made = await B.createBackup(PW, { iterations: FAST });
  const files = Object.fromEntries(readTarGz(made.plain).map((f) => [f.path, f.content]));
  assert.ok(!JSON.parse(files[F.DATA_FILES.settings].toString("utf8")).some((s) => s.key === FULL_POWERS_KEY), "the setting is not in the file");
  const opened = Rs.openBackup(made.buffer, PW, FAST);
  assert.ok(opened.ok);
  opened.backup.data.settings.push({ key: FULL_POWERS_KEY, locale: "", value: [id] });
  assert.equal(await hasFullPowers(id), true);
  const report = await Rs.applyRestore(opened.backup, { confirmCustom: [], actor: "owner@example.org" });
  assert.equal(report.ok, true);
  await settleBackground();
  assert.equal(await hasFullPowers(id), false);
  assert.equal((await db.prisma.auditLog.findFirst({ where: { action: "mcp.fullpowers.cleared" } }))?.actor, "owner@example.org");
});
