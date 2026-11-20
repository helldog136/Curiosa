import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

// PERSONAL AI ASSISTANTS (core 0.46.0): creation, one per person, the code shown once, lifecycle (deletion, sign-out, password reset),
// approvals (the owner of the AI decides), "act without asking" policy, the shared hourly budget, the journal, and the migration.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const SL = await import("@/core/maintenance/slots");
const PA = await import("@/core/personalAi/service");
const POL = await import("@/core/personalAi/policy");
const Members = await import("@/core/auth/members");
const Sessions = await import("@/core/auth/sessions");
const Pw = await import("@/core/auth/teamPassword");
const { columnsOf } = await import("@/core/auth/rights");
const Roles = await import("@/core/auth/roles");
const { setSetting } = await import("@/core/settings");

const PASSWORD = "correct horse 12";
let U;

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  PA.resetPersonalPasswordLimits();
  const hash = bcrypt.hashSync(PASSWORD, 4);
  const mk = (name, level) => db.prisma.user.create({ data: { email: `${name}@example.org`, name, passwordHash: hash, ...columnsOf(level) } });
  U = { owner: await mk("etoile_nord", "owner"), admin: await mk("camille", "admin"), admin2: await mk("lune_douce", "admin"), editor: await mk("nuage_clair", "editor") };
  await Roles.syncSystemAssignments();
  await POL.setPersonalPolicy({ enabled: true });
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), P.listMcpTools);
async function call(token, name, args = {}) {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  const body = await res.json();
  if (body.error) return { error: body.error.message, status: res.status };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
const make = async (user, profile = "read") => { const r = await PA.createPersonalAccess(user.id, { password: PASSWORD, profile }); assert.equal(r.ok, true, JSON.stringify(r)); return r; };
const audits = (prefix) => db.prisma.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { createdAt: "asc" } });

test("creation: the password is asked again, one per person, the code is shown once and only its hash is kept", async () => {
  assert.deepEqual(await PA.createPersonalAccess(U.admin.id, { password: "wrong" }), { ok: false, reason: "password" });
  assert.deepEqual(await PA.createPersonalAccess(U.admin.id, { password: "" }), { ok: false, reason: "password" });
  assert.deepEqual(await PA.createPersonalAccess("no-such-user", { password: PASSWORD }), { ok: false, reason: "missing" });
  assert.deepEqual(await PA.createPersonalAccess(U.editor.id, { password: PASSWORD }), { ok: false, reason: "not_allowed" }, "an editor does not hold the right");
  const made = await make(U.admin);
  assert.match(made.code, /^vit_[A-Za-z0-9_-]{20,}$/);
  const row = await db.prisma.apiToken.findUnique({ where: { id: made.id } });
  assert.equal(row.ownerId, U.admin.id);
  assert.equal(row.createdBy, U.admin.email);
  assert.ok(!JSON.stringify(row).includes(made.code), "the code is not stored anywhere in the row");
  assert.ok(!JSON.stringify(await db.prisma.setting.findMany()).includes(made.code));
  assert.ok(!JSON.stringify(await db.prisma.auditLog.findMany()).includes(made.code), "nor in the journal");
  assert.equal((await PA.ownPersonalState(U.admin.id)).name, row.name);
  assert.deepEqual(await PA.createPersonalAccess(U.admin.id, { password: PASSWORD }), { ok: false, reason: "exists" });
  // someone else can have theirs, with a different name
  const other = await make(U.admin2);
  assert.notEqual(other.name, made.name);
  // after removal a new one may be made
  assert.deepEqual(await PA.revokeOwnPersonalAccess(U.admin.id), { ok: true });
  assert.equal((await rpc(made.code, "tools/list")).status, 401, "revoked for good");
  assert.equal((await make(U.admin)).ok, true);
});

test("the password re-entry is limited: five wrong answers, then refused even with the right one", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await PA.createPersonalAccess(U.admin.id, { password: "nope" })).reason, "password");
  assert.equal((await PA.createPersonalAccess(U.admin.id, { password: PASSWORD })).reason, "limited");
});

test("one person cannot touch another person's AI: every function acts on the id it is given and nothing else", async () => {
  const mine = await make(U.admin);
  const theirs = await make(U.admin2);
  assert.equal((await PA.pauseOwnPersonalAccess(U.owner.id)).reason, "missing", "a person without an AI has nothing to pause");
  await PA.pauseOwnPersonalAccess(U.admin.id);
  assert.equal((await rpc(mine.code, "tools/list")).status, 403);
  assert.equal((await rpc(theirs.code, "tools/list")).status, 200);
  assert.equal((await PA.resumeOwnPersonalAccess(U.admin.id, "wrong")).reason, "password");
  assert.equal((await rpc(mine.code, "tools/list")).status, 403);
  assert.equal((await PA.resumeOwnPersonalAccess(U.admin.id, PASSWORD)).ok, true);
  assert.equal((await rpc(mine.code, "tools/list")).status, 200);
});

test("deleting a user revokes their AI first (never turned into an independent one); sign-out everywhere and a password reset pause it", async () => {
  const ad = await make(U.admin);
  const ad2 = await make(U.admin2);
  const ed = await db.prisma.user.update({ where: { id: U.editor.id }, data: { personalAi: "allow" } });
  const edAi = await make(ed);
  assert.equal((await Members.deleteMember(U.owner.id, U.editor.id)).ok, true);
  const row = await db.prisma.apiToken.findUnique({ where: { id: edAi.id } });
  assert.ok(row.revokedAt, "revoked");
  assert.equal(row.ownerId, U.editor.id, "ownerId is never rewritten to null");
  assert.equal((await rpc(edAi.code, "tools/list")).status, 401);
  assert.equal((await audits("mcp.personal.revoke")).length, 1);
  // sign out everywhere (also what an administrator's "cut sessions" and a password change call)
  await Sessions.revokeSessions(U.admin.id);
  assert.ok((await db.prisma.apiToken.findUnique({ where: { id: ad.id } })).pausedAt);
  assert.equal((await rpc(ad.code, "tools/list")).status, 403);
  assert.equal((await rpc(ad2.code, "tools/list")).status, 200, "somebody else's AI is not paused");
  // an administrator resets the password of someone else
  const reset = await Pw.resetMemberPassword({ actorId: U.owner.id, targetId: U.admin2.id, mode: "generate" });
  assert.equal(reset.ok, true, JSON.stringify(reset));
  assert.ok((await db.prisma.apiToken.findUnique({ where: { id: ad2.id } })).pausedAt);
  assert.equal((await rpc(ad2.code, "tools/list")).status, 403);
  // schema: no SetNull on the owner
  assert.ok(!/ownerId[^\n]*(@relation|onDelete)/.test(fs.readFileSync("prisma/schema.prisma", "utf8")));
});

test("approvals: the person who owns the AI decides its requests, a holder of core:mcp.tokens too, nobody else; an approval after a demotion never runs", async () => {
  const ad = await make(U.admin, "full");
  await PA.setOwnPersonalGrants(U.admin.id, { site_settings_set: true, maintenance_request_status: true });
  const ask = async (name = "etoile") => { const r = await call(ad.code, "site_settings_set", { name: { en: name } }); assert.equal(r.value?.status, "pending_approval", JSON.stringify(r)); return r.value.requestId; };
  const id1 = await ask("Aurore");
  const stored = (await Q.listRequests()).find((r) => r.id === id1);
  assert.equal(stored.ownerId, U.admin.id, "the owner is read from the access row");
  // another administrator who does not own it and does not hold core:mcp.tokens: refused
  assert.equal((await M.approveRequest(id1, { email: U.admin2.email, owner: false, userId: U.admin2.id })).reason, "forbidden");
  assert.equal((await M.denyRequestBy(id1, { email: U.admin2.email, owner: false, userId: U.admin2.id })).reason, "forbidden");
  // a forged userId without the right row does not help either
  assert.equal((await M.approveRequest(id1, { email: "x@example.org", owner: false })).reason, "forbidden");
  // the owner of the AI refuses, the request never runs
  assert.equal((await M.denyRequestBy(id1, { email: U.admin.email, owner: false, userId: U.admin.id })).ok, true);
  assert.equal((await M.approveRequest(id1, { email: U.owner.email, owner: true })).ok, false);
  // approval by the person
  const id2 = await ask("Aube");
  const done = await M.approveRequest(id2, { email: U.admin.email, owner: false, userId: U.admin.id });
  assert.equal(done.ok, true, JSON.stringify(done));
  // approval by a holder of core:mcp.tokens
  const id3 = await ask("Brume");
  assert.equal((await M.approveRequest(id3, { email: U.owner.email, owner: true })).ok, true);
  // after a demotion the ceiling is checked again at execution
  const id4 = await ask("Cime");
  await db.prisma.user.update({ where: { id: U.admin.id }, data: columnsOf("editor") });
  await POL.setPersonOverride(U.admin.id, "allow");
  const late = await M.approveRequest(id4, { email: U.owner.email, owner: true });
  assert.equal(late.ok, false);
  assert.equal(late.reason, "forbidden");
  assert.match(late.message, /above what its owner may do/);
  assert.equal((await Q.listRequests()).find((r) => r.id === id4).status, "denied");
  assert.ok((await audits("mcp.personal.inert")).length >= 1);
});

test("independent requests keep the old rule: only a holder of core:mcp.tokens decides", async () => {
  const token = await T.createToken("Independent", "write", "o", { grants: { site_settings_set: true } });
  const r = await call(token, "site_settings_set", { name: { en: "Aurore" } });
  assert.equal(r.value?.status, "pending_approval", JSON.stringify(r));
  assert.equal((await M.approveRequest(r.value.requestId, { email: U.admin.email, owner: false, userId: U.admin.id })).reason, "forbidden");
  const stored = (await Q.listRequests()).find((x) => x.id === r.value.requestId);
  assert.equal(stored.ownerId, undefined);
  assert.equal((await M.approveRequest(r.value.requestId, { email: U.owner.email, owner: true })).ok, true);
});

test("act without asking only when the policy allows it (off by default); installs and new instances always wait", async () => {
  const ad = await make(U.admin, "full");
  await PA.setOwnPersonalGrants(U.admin.id, { site_settings_set: true });
  assert.deepEqual(await PA.setOwnPersonalApproval(U.admin.id, "direct"), { ok: false, reason: "direct_off" });
  // even if the setting was written by hand, the runtime refuses to act at once
  const S = await import("@/core/maintenance/settings");
  await S.setApprovalMode(ad.id, "direct");
  assert.equal((await call(ad.code, "site_settings_set", { name: { en: "Aurore" } })).value.status, "pending_approval");
  await POL.setPersonalPolicy({ allowDirect: true });
  assert.deepEqual(await PA.setOwnPersonalApproval(U.admin.id, "direct"), { ok: true });
  const direct = await call(ad.code, "site_settings_set", { name: { en: "Aube" } });
  assert.notEqual(direct.value?.status, "pending_approval", JSON.stringify(direct));
  await POL.setPersonalPolicy({ allowDirect: false });
  assert.equal((await call(ad.code, "site_settings_set", { name: { en: "Brume" } })).value.status, "pending_approval", "switching the policy off applies at once");
});

test("one shared hourly budget for all personal AIs, on top of the per-access limits; independent accesses are not counted in it", async () => {
  SL.resetAllSlots();
  const ids = [];
  for (const n of ["a", "b", "c"]) ids.push((await db.prisma.apiToken.create({ data: { name: n, hash: `h${n}`, prefix: "vit_", createdBy: "x", ownerId: U.admin.id } })).id);
  const free = (await db.prisma.apiToken.create({ data: { name: "free", hash: "hfree", prefix: "vit_", createdBy: "x" } })).id;
  for (const id of ids.slice(0, 2)) for (let i = 0; i < 12; i++) await SL.takeSlot(id, "risky");
  for (let i = 0; i < 6; i++) await SL.takeSlot(ids[2], "risky"); // 30 in all
  await assert.rejects(() => SL.takeSlot(ids[2], "risky"), /personal assistants share 30 risky actions per hour/);
  for (let i = 0; i < 12; i++) await SL.takeSlot(free, "risky");
  await assert.rejects(() => SL.takeSlot(free, "risky"), /12 risky actions per hour for this access/);
  assert.equal((await SL.remainingSlots(ids[2])).risky.limit, 12, "the per-access limit is unchanged");
});

test("journal: creation, pause and resume, rights and the first refusal are written with names and counts, the actor format is kept", async () => {
  const ad = await make(U.admin);
  await PA.setOwnPersonalGrants(U.admin.id, { maintenance_status: true });
  await PA.pauseOwnPersonalAccess(U.admin.id);
  await rpc(ad.code, "tools/list");
  await rpc(ad.code, "tools/list");
  await PA.resumeOwnPersonalAccess(U.admin.id, PASSWORD);
  const names = (await db.prisma.auditLog.findMany({ where: { action: { startsWith: "mcp.personal." } }, orderBy: { createdAt: "asc" } })).map((r) => r.action);
  assert.deepEqual(names, ["mcp.personal.create", "mcp.personal.rights", "mcp.personal.pause", "mcp.personal.inert", "mcp.personal.resume"], "the refusal is written once per transition, not per call");
  const inert = (await audits("mcp.personal.inert"))[0];
  assert.equal(inert.actor, `mcp:${ad.name}`);
  assert.equal(inert.actorKind, "assistant");
  // a tool call keeps the old actor format; the owner is resolved from the access row
  await PA.setOwnPersonalGrants(U.admin.id, { maintenance_my_access: true });
  assert.ok((await call(ad.code, "maintenance_my_access")).value);
  assert.deepEqual([...(await PA.ownersOfAssistantNames([ad.name, "unknown"])).entries()], [[ad.name, U.admin.id]]);
  const { auditLabelKey } = await import("@/core/auditLabels");
  for (const a of ["create", "revoke", "pause", "resume", "rights", "inert", "policy"]) assert.equal(auditLabelKey(`mcp.personal.${a}`), `audit.action.mcp.personal.${a}`);
});

test("migration: three additive columns, existing accesses stay independent, the migration comes after every earlier one", async () => {
  const sql = fs.readFileSync("prisma/migrations/20261121090000_personal_ai/migration.sql", "utf8").replace(/--.*$/gm, "");
  assert.ok(!/\bDROP\b|\bRENAME\b|DELETE\s+FROM|UPDATE\s+"/i.test(sql));
  assert.match(sql, /ALTER TABLE "ApiToken" ADD COLUMN "ownerId" TEXT;/);
  assert.match(sql, /ALTER TABLE "ApiToken" ADD COLUMN "pausedAt" DATETIME;/);
  assert.match(sql, /CREATE INDEX "ApiToken_ownerId_idx"/);
  assert.match(sql, /ALTER TABLE "User" ADD COLUMN "personalAi" TEXT NOT NULL DEFAULT 'inherit';/);
  const all = fs.readdirSync("prisma/migrations").filter((d) => /^\d{8,}_/.test(d)).sort();
  assert.equal(all.at(-1), "20261121090000_personal_ai");
  const frozen = Object.keys(JSON.parse(fs.readFileSync("prisma/migrations/frozen.json", "utf8")));
  assert.ok(frozen.every((f) => f < "20261121090000_personal_ai"));
  const token = await T.createToken("Independent", "read", "o");
  const row = await db.prisma.apiToken.findUnique({ where: { id: await T.findTokenId(token) } });
  assert.equal(row.ownerId, null);
  assert.equal(row.pausedAt, null);
  assert.equal((await db.prisma.user.findUnique({ where: { id: U.admin.id } })).personalAi, "inherit");
});

test("the master switch and the override: only the policy functions write them, the setting is safe when absent, a setting restored from a backup cannot make the policy more open than its file", async () => {
  await db.prisma.setting.deleteMany({ where: { key: POL.PERSONAL_POLICY_KEY } });
  (await import("@/core/settings")).resetSettingsCache();
  assert.deepEqual(await POL.getPersonalPolicy(), { enabled: false, allowDirect: false });
  assert.deepEqual(await POL.setPersonalPolicy({ enabled: true }), { enabled: true, allowDirect: false });
  assert.equal(await POL.setPersonOverride(U.editor.id, "bogus"), false);
  assert.equal(await POL.setPersonOverride("nobody", "allow"), false);
  // the setting readable through the ordinary core settings API
  const { getSetting } = await import("@/core/settings");
  assert.deepEqual(await getSetting(POL.PERSONAL_POLICY_KEY), { enabled: true, allowDirect: false });
  await setSetting(POL.PERSONAL_POLICY_KEY, { enabled: false, allowDirect: false });
  assert.equal((await POL.getPersonalPolicy()).enabled, false);
});
