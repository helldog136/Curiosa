import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToReadableStream } from "react-dom/server";
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

// THE OWNER OF AN AI ACCESS IS A PERMANENT FACT (core 0.47.1). Real database, real MCP server, real service functions.
//  - assigning an owner works only for an access that NEVER had one, once, and is refused in the core (not only on screen);
//  - an owner that disappears takes the access with them: revoked, journalled, pending requests expired; a restore and a sweep do the same;
//  - the accesses that never had an owner are untouched; the screens no longer offer to choose another owner.
async function renderAsync(element) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
}
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const PA = await import("@/core/personalAi/service");
const OW = await import("@/core/personalAi/owners");
const MIG = await import("@/core/personalAi/ownerMigration");
const LIFE = await import("@/core/personalAi/lifecycle");
const RQ = await import("@/core/maintenance/requests");
const { createAccess } = await import("@/core/mcpAccess");
const { deleteMember } = await import("@/core/auth/members");
const { columnsOf } = await import("@/core/auth/rights");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const PASSWORD = "correct horse 12";
const mk = (name, level, extra = {}) => db.prisma.user.create({ data: { email: `${name}@example.org`, name, passwordHash: bcrypt.hashSync(PASSWORD, 4), ...columnsOf(level), ...extra } });
beforeEach(async () => {
  await db.reset();
  PA.resetPersonalPasswordLimits();
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), P.listMcpTools);
const audits = (prefix) => db.prisma.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { createdAt: "asc" } });
const row = (id) => db.prisma.apiToken.findUnique({ where: { id } });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test("core: an access that has an owner is never given to anyone, the same person included, whether the owner still exists or not", async () => {
  const boss = await mk("etoile_nord", "owner");
  const camille = await mk("camille", "admin");
  const other = await mk("lune_douce", "admin");
  const made = await PA.createPersonalAccess(camille.id, { password: PASSWORD, name: "Claude" });
  assert.deepEqual(await OW.assignOwner(made.id, other.id, boss.email, boss.id), { ok: false, reason: "already_owned" });
  assert.deepEqual(await OW.assignOwner(made.id, camille.id, boss.email, boss.id), { ok: false, reason: "already_owned" }, "the same person too: nothing to do, nothing to say yes to");
  assert.deepEqual(await OW.assignOwner(made.id, "nobody", boss.email, boss.id), { ok: false, reason: "already_owned" }, "the owned check comes first");
  assert.equal((await row(made.id)).ownerId, camille.id);
  // an access whose owner row does not exist (a restore, a manual delete): refused too, BEFORE any sweep
  const orphan = await db.prisma.apiToken.create({ data: { name: "Orphan", hash: "horphan", prefix: "vit_", createdBy: "x", ownerId: "gone" } });
  assert.deepEqual(await OW.assignOwner(orphan.id, other.id, boss.email, boss.id), { ok: false, reason: "already_owned" });
  assert.equal((await row(orphan.id)).ownerId, "gone");
  // an owner given to a revoked access: not found
  await PA.revokePersonalAccessById(made.id, boss.email);
  assert.deepEqual(await OW.assignOwner(made.id, other.id, boss.email, boss.id), { ok: false, reason: "access_missing" });
  assert.equal((await audits("mcp.personal.assign")).length, 0, "nothing was journalled as an assignment");
});

test("core: an access that never had an owner is given one ONCE; the write is conditional, so two simultaneous calls cannot both win", async () => {
  const boss = await mk("etoile_nord", "owner");
  const camille = await mk("camille", "admin");
  const other = await mk("lune_douce", "admin");
  const id = await T.findTokenId(await T.createToken("Legacy", "read", "o"));
  const results = await Promise.all([OW.assignOwner(id, camille.id, boss.email, boss.id), OW.assignOwner(id, other.id, boss.email, boss.id)]);
  assert.equal(results.filter((r) => r.ok).length, 1, "exactly one wins");
  assert.deepEqual(results.find((r) => !r.ok), { ok: false, reason: "already_owned" });
  const winner = (await row(id)).ownerId;
  assert.ok([camille.id, other.id].includes(winner));
  assert.equal((await audits("mcp.personal.assign")).length, 1);
  assert.deepEqual(await OW.assignOwner(id, winner === camille.id ? other.id : camille.id, boss.email, boss.id), { ok: false, reason: "already_owned" }, "and never again");
});

test("the 0.49 migration: only the never-owned ones change; owned ones keep their owner; a second run has nothing left to give", async () => {
  const boss = await mk("etoile_nord", "owner");
  const other = await mk("lune_douce", "admin");
  const owned = await PA.createPersonalAccess(other.id, { password: PASSWORD, name: "Owned" });
  const a = await T.findTokenId(await T.createToken("A", "read", "o"));
  const b = await T.findTokenId(await T.createToken("B", "read", "o"));
  assert.deepEqual(await MIG.attributeOwnerlessAccesses(), { attributed: 2 });
  assert.equal((await row(owned.id)).ownerId, other.id);
  assert.deepEqual([(await row(a)).ownerId, (await row(b)).ownerId], [boss.id, boss.id]);
  assert.deepEqual(await MIG.attributeOwnerlessAccesses(), { attributed: 0 });
});

test("every caller goes through the core: the actions hold no write of their own, and every writer of ApiToken.ownerId is listed", () => {
  const act = fs.readFileSync("src/app/admin/(panel)/assistants/actions.ts", "utf8");
  assert.ok(!/assignOwner/.test(act), "no screen action gives an owner: only the 0.49 migration does");
  // Every `data: {...}` of a write to the access table that mentions `ownerId`: only creation, the one-time legacy step and the assignment.
  const ALLOWED = new Set(["src/core/services/mcp/tokens.ts", "src/core/personalAi/owners.ts"]);
  const offenders = [];
  for (const file of walk("src").filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/apiToken\.(create|createMany|update|updateMany|upsert)\(/g)) {
      const data = /data:\s*\{[^}]*\}/.exec(src.slice(m.index, m.index + 600))?.[0] ?? "";
      if (/ownerId/.test(data) && !ALLOWED.has(file)) offenders.push(file);
    }
    if (/\$execute(Raw|RawUnsafe)\([^)]*ApiToken/.test(src)) offenders.push(`${file} (raw SQL)`);
  }
  assert.deepEqual(offenders, [], "no other code path writes ApiToken.ownerId");
  // The allowed ones: creation, null-only legacy update, null-only assignment.
  const owners = fs.readFileSync("src/core/personalAi/owners.ts", "utf8");
  assert.match(owners, /updateMany\(\{ where: \{ id: row\.id, ownerId: null, revokedAt: null \}, data: \{ ownerId: target\.id \} \}\)/);
  assert.match(owners, /if \(row\.ownerId\) return \{ ok: false, reason: "already_owned" \}/);
  // no other module exports a way to change the owner (no `setOwner`, `transfer`, `reassign`)
  for (const file of walk("src")) assert.ok(!/(setOwnerOf|transferAccess|reassignOwner|changeOwner)\b/.test(fs.readFileSync(file, "utf8")), file);
});

test("owner deleted: every access is revoked, its pending requests expire, the journal names it (no code); an invited person who never signed in works the same", async () => {
  const boss = await mk("etoile_nord", "owner");
  const camille = await mk("camille", "admin");
  const invited = await mk("nuage_clair", "admin");
  const plan = { module: "m1", from: "1.0.0", to: "1.0.1" };
  const a = await PA.createPersonalAccess(camille.id, { password: PASSWORD, name: "A", level: "maintenance" });
  const b = await PA.createPersonalAccess(camille.id, { password: PASSWORD, name: "B" });
  const c = await PA.createPersonalAccess(boss.id, { password: PASSWORD, name: "C", level: "maintenance" });
  const { token: tokenOfInvited } = await createAccess({ name: "Invited AI", scope: "read", actorEmail: boss.email, ownerId: invited.id });
  const invitedId = await T.findTokenId(tokenOfInvited);
  await db.prisma.user.update({ where: { id: invited.id }, data: { mustChangePassword: true } }); // a person who has not signed in yet (temporary password): a user row all the same
  for (const [x, who] of [[a, camille], [c, boss]]) await RQ.createRequest({ action: "module_update", plan, tokenId: x.id, tokenName: x.name, ownerId: who.id });
  assert.deepEqual(await deleteMember(boss.id, camille.id), { ok: true });
  assert.deepEqual(await deleteMember(boss.id, invited.id), { ok: true });
  for (const id of [a.id, b.id, invitedId]) assert.ok((await row(id)).revokedAt, "revoked");
  assert.equal((await row(c.id)).revokedAt, null, "someone else's access is untouched");
  assert.deepEqual((await RQ.listRequests()).filter((r) => r.status === "pending").map((r) => r.tokenName), ["C"]);
  assert.equal((await rpc(a.code, "tools/list")).status, 401);
  const lines = await audits("mcp.personal.revoke");
  assert.deepEqual(lines.map((l) => l.target).sort(), ["A: owner deleted", "B: owner deleted", "Invited AI: owner deleted"]);
  assert.ok(lines.every((l) => l.actor === boss.email));
  assert.ok(!JSON.stringify(lines).includes(a.code) && !JSON.stringify(lines).includes(tokenOfInvited));
  // nothing is left for the sweep to do
  assert.deepEqual(await LIFE.sweepOrphanedAccesses(), []);
  assert.equal((await audits("mcp.personal.revoke")).length, 3);
});

test("a bulk or cascade removal of people behind the code's back (rows gone, no hook): the sweep revokes every orphan, expires requests, and is idempotent", async () => {
  const boss = await mk("etoile_nord", "owner");
  const p1 = await mk("camille", "admin");
  const p2 = await mk("lune_douce", "admin");
  const plan = { module: "m1", from: "1.0.0", to: "1.0.1" };
  const a = await PA.createPersonalAccess(p1.id, { password: PASSWORD, name: "A", level: "maintenance" });
  const b = await PA.createPersonalAccess(p2.id, { password: PASSWORD, name: "B", level: "maintenance" });
  const keep = await PA.createPersonalAccess(boss.id, { password: PASSWORD, name: "Keep" });
  await RQ.createRequest({ action: "module_update", plan, tokenId: a.id, tokenName: "A", ownerId: p1.id });
  await RQ.createRequest({ action: "module_update", plan, tokenId: b.id, tokenName: "B", ownerId: p2.id });
  await db.prisma.user.deleteMany({ where: { id: { in: [p1.id, p2.id] } } });
  assert.deepEqual((await LIFE.sweepOrphanedAccesses()).sort(), ["A", "B"]);
  assert.deepEqual(await LIFE.sweepOrphanedAccesses(), [], "second run: nothing");
  assert.ok((await row(a.id)).revokedAt && (await row(b.id)).revokedAt);
  assert.equal((await row(keep.id)).revokedAt, null);
  assert.equal((await RQ.listRequests()).filter((r) => r.status === "pending").length, 0, "pending requests expired");
  const lines = await audits("mcp.personal.revoke");
  assert.deepEqual(lines.map((l) => [l.actor, l.actorKind, l.target]).sort(), [["system", "system", "A: owner removed"], ["system", "system", "B: owner removed"]]);
  // two sweeps at the same moment: one pass, one line each
  const c = await PA.createPersonalAccess(boss.id, { password: PASSWORD, name: "C" });
  await db.prisma.apiToken.update({ where: { id: c.id }, data: { ownerId: "vanished" } }); // test setup only: simulates a restore that left a dangling owner
  const [x, y] = await Promise.all([LIFE.sweepOrphanedAccesses(), LIFE.sweepOrphanedAccesses()]);
  assert.deepEqual([x, y], [["C"], ["C"]], "both callers get the same single pass");
  assert.equal((await audits("mcp.personal.revoke")).length, 3);
});

test("reading the accesses list sweeps first: no 'Owner removed' state can be shown; the legacy never-owned ones are untouched and keep working", async () => {
  const boss = await mk("etoile_nord", "owner");
  const camille = await mk("camille", "admin");
  const legacy = await T.createToken("Legacy", "write", "o", { grants: {} });
  const legacyId = await T.findTokenId(legacy);
  await db.prisma.apiToken.updateMany({ where: { ownerId: null, coarseCeiling: false }, data: { coarseCeiling: true } }); // test setup: what the 0.47.0 start-up step marked (gone in 0.49.0)
  assert.equal((await row(legacyId)).coarseCeiling, true);
  const made = await PA.createPersonalAccess(camille.id, { password: PASSWORD, name: "Gone" });
  await db.prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${camille.id}'`); // test setup: raw delete, no hook
  const t = makeTranslator("en", "en");
  const { OwnersTab } = await import("../../src/app/admin/(panel)/assistants/OwnersTab.tsx");
  const page = await renderAsync(React.createElement(OwnersTab, { t, viewerId: boss.id }));
  assert.ok((await row(made.id)).revokedAt, "the By person tab swept");
  assert.ok(!page.includes(">Gone<") && !/Owner removed/.test(page));
  assert.match(page, /No owner/);
  // the legacy one: not revoked, still answers, same tools, same grants, still ownerless
  const after = await row(legacyId);
  assert.deepEqual([after.revokedAt, after.ownerId, after.coarseCeiling], [null, null, true]);
  assert.equal((await rpc(legacy, "tools/list")).status, 200);
  const live = await T.authenticate(`Bearer ${legacy}`);
  assert.ok(live && !live.personal && !live.ownerId, "still an access without a personal state: no inert answer, no hourly pool of the newer ones");
  assert.deepEqual((await OW.accessesWithoutOwner()).map((r) => [r.name, r.ownerGone]), [["Legacy", false]]);
  assert.deepEqual((await OW.neverOwnedAccesses()).map((r) => r.name), ["Legacy"], "the pure read (health report) agrees");
  assert.equal((await audits("mcp.personal.revoke")).length, 1);
});

test("the By person table offers Pause and Remove, never a control that changes the owner; there is no assignment panel", async () => {
  const boss = await mk("etoile_nord", "owner");
  const camille = await mk("camille", "admin");
  const made = await PA.createPersonalAccess(camille.id, { password: PASSWORD, name: "Claude" });
  await T.createToken("Legacy", "read", "o");
  const t = makeTranslator("en", "en");
  const { OwnersTab } = await import("../../src/app/admin/(panel)/assistants/OwnersTab.tsx");
  const page = await renderAsync(React.createElement(OwnersTab, { t, viewerId: boss.id }));
  const [panel, table] = page.split('data-testid="owners-table"');
  assert.ok(table, "the table is rendered after the panel");
  assert.ok(!/<select/.test(table), "no select in the table");
  assert.ok(!table.includes(`id="owner-${made.id}"`) && !/Choose an owner|Change the owner|Another owner/.test(table));
  assert.match(table, /data-testid="owners-pause"/);
  assert.match(table, /Remove the access/);
  assert.ok(!panel.includes('data-testid="assign-row"') && !panel.includes("assign-owners"), "no assignment panel: the 0.49 migration gives the owner");
  // the person menu of the team page and the sheet carry no owner picker either
  for (const f of walk("src/app/admin").filter((x) => /\.tsx$/.test(x))) assert.ok(!/OwnerSelect/.test(fs.readFileSync(f, "utf8")), `${f} does not use the owner picker`);
  assert.ok(!fs.existsSync("src/app/admin/(panel)/assistants/OwnerSelect.tsx") && !fs.existsSync("src/app/admin/(panel)/assistants/assign-owners"));
});

test("texts: EN and FR say the owner is permanent; the removed states are gone from both files", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  for (const k of ["aim.my.noOwner"]) assert.ok(en[k] && fr[k], k);
  assert.deepEqual(Object.keys(en).filter((k) => k.startsWith("owners.assign.")), [], "the assignment screen is gone");
  assert.deepEqual(Object.keys(en).filter((k) => !(k in fr)), []);
  assert.deepEqual(Object.keys(fr).filter((k) => !(k in en)), []);
  assert.equal(Object.keys(en).at(-1), "settings.contrast.accent2");
  const log = fs.readFileSync("CHANGELOG.md", "utf8");
  const next = log.slice(log.search(/^## (?:Prochaine version|0\.48\.0)/m), log.indexOf("## 0.47.0")); // the unreleased notes, then the 0.48.0 section once the release is prepared
  assert.match(next, /ne change plus jamais/);
  assert.match(next, /never changes/);
  for (const f of ["docs/PERSONAL-AI.md", "docs/MAINTENANCE-IA.md"]) {
    const doc = fs.readFileSync(f, "utf8");
    assert.match(doc, /permanent/i, f);
    assert.ok(!/Owner removed|accessesOwnerRemoved|\*\*Choose an owner\*\*/.test(doc), f);
  }
});

test("sweep safety: a person created between the two reads is never revoked; an empty user table does nothing", async () => {
  const boss = await mk("etoile_nord", "owner");
  const made = await PA.createPersonalAccess(boss.id, { password: PASSWORD, name: "Late" });
  await db.prisma.apiToken.update({ where: { id: made.id }, data: { ownerId: "late-person" } }); // test setup: the owner row does not exist yet
  const original = db.prisma.user.findMany;
  let created = false;
  db.prisma.user.findMany = async (...args) => {
    const out = await original.apply(db.prisma.user, args);
    if (!created) { created = true; await db.prisma.user.create({ data: { id: "late-person", email: "late@example.org", name: "Late", passwordHash: "x", ...columnsOf("admin") } }); }
    return out; // stale: does not contain the new person
  };
  try { assert.deepEqual(await LIFE.sweepOrphanedAccesses(), [], "re-checked right before the revoke"); } finally { db.prisma.user.findMany = original; }
  assert.equal(created, true);
  assert.equal((await row(made.id)).revokedAt, null);
  // empty user table: nothing is touched
  await db.prisma.user.deleteMany({});
  assert.deepEqual(await LIFE.sweepOrphanedAccesses(), []);
  assert.equal((await row(made.id)).revokedAt, null);
  assert.equal((await audits("mcp.personal.revoke")).length, 0);
});

test("sweep safety: one failing revoke does not stop the others, stays retryable, and pending requests of an already revoked orphan are expired", async () => {
  const boss = await mk("etoile_nord", "owner");
  const plan = { module: "m1", from: "1.0.0", to: "1.0.1" };
  const mkOrphan = async (name) => {
    const a = await PA.createPersonalAccess(boss.id, { password: PASSWORD, name, level: "maintenance" });
    await db.prisma.apiToken.update({ where: { id: a.id }, data: { ownerId: `gone-${name}` } });
    await RQ.createRequest({ action: "module_update", plan, tokenId: a.id, tokenName: name, ownerId: `gone-${name}` });
    return a;
  };
  const a = await mkOrphan("A"); const b = await mkOrphan("B");
  const original = db.prisma.apiToken.updateMany;
  let failed = false;
  db.prisma.apiToken.updateMany = async (arg) => { if (!failed && arg?.data?.revokedAt) { failed = true; throw new Error("disk hiccup"); } return original.call(db.prisma.apiToken, arg); };
  let first;
  try { first = await LIFE.sweepOrphanedAccesses(); } finally { db.prisma.apiToken.updateMany = original; }
  assert.equal(first.length, 1, "the other access was still handled");
  const failedRow = (await row(a.id)).revokedAt ? b : a;
  assert.equal((await row(failedRow.id)).revokedAt, null, "the failed one is still live: retryable");
  assert.deepEqual(await LIFE.sweepOrphanedAccesses(), [failedRow.name], "the next pass finishes it");
  assert.equal((await RQ.listRequests()).filter((r) => r.status === "pending").length, 0);
  // revoked orphan that still has a pending request (a failure after revokedAt): the sweep expires it
  await RQ.createRequest({ action: "module_update", plan, tokenId: a.id, tokenName: "A", ownerId: "gone-A" });
  assert.equal((await RQ.listRequests()).filter((r) => r.status === "pending").length, 1);
  assert.deepEqual(await LIFE.sweepOrphanedAccesses(), []);
  assert.equal((await RQ.listRequests()).filter((r) => r.status === "pending").length, 0);
});

test("the start-up sweep is wired in instrumentation.ts, before the 0.49 migration", () => {
  const src = fs.readFileSync("src/instrumentation.ts", "utf8");
  const sweep = src.indexOf("sweepOrphanedAccesses()");
  assert.ok(sweep > 0, "sweepOrphanedAccesses is called at start-up");
  assert.ok(src.indexOf("personalAi/lifecycle") > 0 && sweep < src.indexOf("attributeOwnerlessAccesses()"));
});

test("source scan, strict: no apiToken write takes `data` from a variable or spread; no raw tagged template touches the table (src and scripts)", () => {
  const files = [...walk("src"), ...(fs.existsSync("scripts") ? walk("scripts") : [])].filter((f) => /\.(ts|tsx|mjs|js)$/.test(f));
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/apiToken\.(create|createMany|update|updateMany|upsert)\(/g)) {
      const call = src.slice(m.index, m.index + 700);
      if (!/data:\s*\{/.test(call.split(/\n\s*\n/)[0]) ) bad.push(`${f}: data is not a literal`);
      if (/\(\s*\w+\s*\)/.test(call.slice(0, 40)) || /\(\s*\.\.\./.test(call.slice(0, 40))) bad.push(`${f}: argument is a variable`);
    }
    if (/\$(execute|query)Raw`[^`]*ApiToken/.test(src) || /\$(execute|query)Raw(Unsafe)?\([^)]*ApiToken/.test(src)) bad.push(`${f}: raw SQL on ApiToken`);
  }
  assert.deepEqual(bad, []);
});
