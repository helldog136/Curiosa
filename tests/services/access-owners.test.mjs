import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup, renderToReadableStream } from "react-dom/server";

/** Renders a tree that contains async server components (the real page parts). */
async function renderAsync(element) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
}
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

// EVERY AI ACCESS BELONGS TO A PERSON (core 0.47.0). Real database, real MCP server, real service functions.
//  - the start-up step for single-account sites (idempotent, additive) and the coarse ceiling that keeps every callable tool callable;
//  - the creation invariant on every path; assignment (who may own, who may assign); orphans (a restored site); the screens rendered with real rows.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const FP = await import("@/core/services/mcp/fullPowers");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const PA = await import("@/core/personalAi/service");
const POL = await import("@/core/personalAi/policy");
const OW = await import("@/core/personalAi/owners");
const LEG = await import("@/core/personalAi/legacyOwners");
const { createAccess, createProfileAccess } = await import("@/core/mcpAccess");
const { columnsOf } = await import("@/core/auth/rights");
const Roles = await import("@/core/auth/roles");
const { makeTranslator } = await import("@/core/i18n/dictionary");
const { createGate } = await import("@/components/admin/singleFlight");

const PASSWORD = "correct horse 12";
let U;
const mk = (name, level, extra = {}) => db.prisma.user.create({ data: { email: `${name}@example.org`, name, passwordHash: bcrypt.hashSync(PASSWORD, 4), ...columnsOf(level), ...extra } });
beforeEach(async () => {
  await db.reset();
  PA.resetPersonalPasswordLimits();
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), P.listMcpTools);
const names = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools.map((t) => t.name).sort();
const audits = (prefix) => db.prisma.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { createdAt: "asc" } });
const everything = async () => Object.fromEntries((await P.listMcpToolCatalogue()).map((t) => [t.name, true]));
/** A module tool that declares no `right` (most modules today) and one that declares one. */
function withModuleTools(fn) {
  const tool = (name, extra = {}) => ({ name, title: name, description: "A tool.", readOnly: true, default: true, destructive: false, input: { type: "object" }, source: "later_1", instanceId: "i1", moduleId: "later", call: async () => "done", ...extra });
  const provider = { id: "later", list: async () => [tool("later_1__plain"), tool("later_1__write", { readOnly: false, default: true }), tool("later_1__declared", { requires: { right: "core:entries.edit" } })] };
  P.mcpProviders.push(provider);
  return fn().finally(() => P.mcpProviders.splice(P.mcpProviders.indexOf(provider), 1));
}

test("single account: every access without an owner goes to it, with the coarse ceiling; idempotent; revoked and already-owned ones are untouched", async () => {
  const only = await mk("etoile_nord", "owner");
  const a = await T.createToken("Claude", "read", "o");
  const b = await T.createToken("Upkeep", "write", "o", { grants: { maintenance_status: true } });
  const gone = await T.createToken("Old", "read", "o");
  await T.revokeToken(await T.findTokenId(gone));
  const rows = () => db.prisma.apiToken.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 2, marked: 3 }, "the revoked one is marked too (it predates the owners) but not assigned");
  const after1 = await rows();
  assert.deepEqual(after1.filter((r) => !r.revokedAt).map((r) => [r.ownerId, r.coarseCeiling]), [[only.id, true], [only.id, true]]);
  assert.equal(after1.find((r) => r.revokedAt).ownerId, null, "a revoked access is not touched");
  assert.equal(after1.find((r) => r.id === (undefined)), undefined);
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0, marked: 0 }, "idempotent");
  const rows2 = await audits("mcp.personal.assign");
  assert.equal(rows2.length, 2, "one journal row per access");
  for (const r of rows2) { assert.equal(r.actor, "system"); assert.match(r.target, /-> etoile_nord@example\.org \(single account\)$/); assert.ok(!r.target.includes("vit_")); }
  assert.ok(!JSON.stringify(rows2).includes(a) && !JSON.stringify(rows2).includes(b), "no code in the journal");
});

test("several accounts, no account, or an owner that does not exist: nothing is assigned and nothing breaks", async () => {
  const token = await T.createToken("Claude", "read", "o");
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0, marked: 1, skipped: "accounts" }, "no account at all: marked, nothing to assign to");
  await mk("etoile_nord", "owner");
  await mk("lune_douce", "admin");
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0, marked: 0, skipped: "accounts" }, "an owner and a pending invitation are two accounts: the coordinator chooses");
  assert.equal((await db.prisma.apiToken.findFirst()).ownerId, null);
  assert.equal((await rpc(token, "tools/list")).status, 200, "an access without an owner keeps working as before");
  // an access whose owner row does not exist (a restored site) is not adopted by the migration either
  const orphan = await db.prisma.apiToken.create({ data: { name: "Orphan", hash: "horphan", prefix: "vit_", createdBy: "x", ownerId: "gone" } });
  await db.prisma.user.delete({ where: { email: "lune_douce@example.org" } });
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 1, marked: 0 }, "only the one with no ownerId");
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id: orphan.id } })).ownerId, "gone");
  assert.deepEqual((await OW.accessesWithoutOwner()).map((r) => r.name), ["Orphan"], "No owner on screen, not an error");
});

test("the coarse ceiling: a migrated access keeps EXACTLY the tools list it had (owner level), and for an administrator only the reserved-right core tools leave", async () => {
  await withModuleTools(async () => {
    const only = await mk("etoile_nord", "owner");
    const grants = await everything();
    const token = await T.createToken("Claude", "write", "o", { grants });
    const before = await names(token);
    assert.ok(before.includes("later_1__plain") && before.includes("later_1__write") && before.includes("maintenance_core_update"), "an access without an owner sees it all it was granted");
    await LEG.assignLegacyOwners();
    assert.deepEqual(await names(token), before, "owner-level owner: the list is identical");
    // the same access given to an administrator: undeclared module tools stay, the documented core table applies
    await db.prisma.user.update({ where: { id: only.id }, data: columnsOf("admin") });
    await POL.setPersonOverride(only.id, "allow");
    const asAdmin = await names(token);
    const left = before.filter((n) => !asAdmin.includes(n));
    assert.deepEqual(left.sort(), ["maintenance_backup_run", "maintenance_catalog_get", "maintenance_catalog_list", "maintenance_catalog_plan", "maintenance_check_updates", "maintenance_core_update", "maintenance_instance_add", "maintenance_module_install", "maintenance_module_reinstall", "maintenance_module_restart", "maintenance_module_uninstall", "maintenance_module_update", "maintenance_modules_update_all", "maintenance_skin_activate", "maintenance_skin_install", "maintenance_skin_remove"], "only the tools that need a reserved right");
    assert.ok(asAdmin.includes("later_1__plain") && asAdmin.includes("later_1__write") && asAdmin.includes("later_1__declared"), "module tools with no declared right stay for an administrator");
    // an editor would lose the admin-tier fallback (it is the documented ceiling), never more than that
    await db.prisma.user.update({ where: { id: only.id }, data: columnsOf("editor") });
    const asEditor = await names(token);
    assert.ok(!asEditor.includes("later_1__plain") && asEditor.includes("later_1__declared"));
  });
});

test("a NEW access never gets the fallback: an undeclared module tool stays hidden from it (fail closed)", async () => {
  await withModuleTools(async () => {
    const u = await mk("etoile_nord", "owner");
    const made = await PA.createPersonalAccess(u.id, { password: PASSWORD, level: "assistant" });
    assert.equal(made.ok, true);
    const seen = await names(made.code);
    assert.ok(!seen.includes("later_1__plain"));
    assert.equal((await db.prisma.apiToken.findFirst()).coarseCeiling, false);
  });
});

test("full powers granted before the change keep working for the migrated access (the ceiling still comes first); a new access never gets them", async () => {
  const only = await mk("etoile_nord", "owner");
  const token = await T.createToken("Claude", "write", "o");
  const id = await T.findTokenId(token);
  assert.equal(await FP.setFullPowers(id, true), true);
  const before = await names(token);
  await LEG.assignLegacyOwners();
  assert.equal((await T.authenticate(`Bearer ${token}`)).fullPowers, true);
  assert.deepEqual(await names(token), before);
  await db.prisma.user.update({ where: { id: only.id }, data: columnsOf("editor") });
  await POL.setPersonOverride(only.id, "allow");
  assert.ok(!(await names(token)).includes("maintenance_status"), "full powers never exceed the owner");
  const fresh = await T.createToken("New", "write", "o", { ownerId: only.id });
  assert.equal(await FP.setFullPowers(await T.findTokenId(fresh), true), false);
});

test("a secret address keeps working for a migrated access and is never given to a new one", async () => {
  const only = await mk("etoile_nord", "owner");
  const token = await T.createToken("Claude", "read", "o", { byUrl: true });
  assert.ok(await T.authenticateByUrl(token));
  await LEG.assignLegacyOwners();
  assert.ok(await T.authenticateByUrl(token), "no outage for a connector that uses the address");
  await assert.rejects(() => T.createToken("x", "read", "o", { ownerId: only.id, byUrl: true }));
  const fresh = await PA.createPersonalAccess(only.id, { password: PASSWORD });
  assert.equal(await T.authenticateByUrl(fresh.code), null);
});

test("creation invariant: no code path creates an access without an owner who may own one", async () => {
  const owner = await mk("etoile_nord", "owner");
  const editor = await mk("nuage_clair", "editor");
  await assert.rejects(() => createAccess({ name: "x", scope: "read", actorEmail: owner.email }), /must belong to a person/);
  await assert.rejects(() => createAccess({ name: "x", scope: "read", actorEmail: owner.email, ownerId: "" }), /must belong to a person/);
  await assert.rejects(() => createAccess({ name: "x", scope: "read", actorEmail: owner.email, ownerId: "nobody" }), /may not own/);
  await assert.rejects(() => createAccess({ name: "x", scope: "read", actorEmail: owner.email, ownerId: editor.id }), /may not own/, "an editor holds no right and no override");
  await assert.rejects(() => createProfileAccess({ name: "x", profile: "read", actorEmail: owner.email, catalogue: [] }), /must belong to a person/);
  assert.equal(await db.prisma.apiToken.count(), 0);
  const ok = await createAccess({ name: "Claude", scope: "read", actorEmail: owner.email, ownerId: owner.id });
  assert.equal((await db.prisma.apiToken.findFirst()).ownerId, owner.id);
  assert.ok(ok.token.startsWith("vit_"));
  assert.equal((await audits("mcp.personal.assign")).length, 1);
  assert.ok(!JSON.stringify(await db.prisma.auditLog.findMany()).includes(ok.token));
  const viaProfile = await createProfileAccess({ name: "Upkeep", profile: "assistant", actorEmail: owner.email, ownerId: owner.id, catalogue: await P.listMcpToolCatalogue() });
  assert.equal((await db.prisma.apiToken.findFirst({ where: { name: "Upkeep" } })).ownerId, owner.id);
  assert.ok(viaProfile.token);
});

test("creation invariant, by source: every place that inserts an access passes an owner", () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) files.push(p); } };
  walk("src"); walk("scripts");
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/(createToken\(|apiToken\.create\(|createAccess\(|createProfileAccess\()/g)) {
      const line = src.slice(0, m.index).split("\n").length;
      const call = src.slice(m.index, m.index + 400);
      hits.push({ f: f.replaceAll("\\", "/"), line, call, def: /export async function (createToken|createAccess|createProfileAccess)/.test(src.slice(Math.max(0, m.index - 30), m.index + 40)) });
    }
  }
  const ALLOWED_DEFINITIONS = new Set(["src/core/services/mcp/tokens.ts", "src/core/mcpAccess.ts"]);
  for (const h of hits) {
    if (h.def) { assert.ok(ALLOWED_DEFINITIONS.has(h.f), `${h.f}:${h.line} defines an access creator outside the allowed files`); continue; }
    assert.match(h.call, /ownerId/, `${h.f}:${h.line} creates an access without an owner`);
  }
  assert.ok(hits.length >= 4, "the scan sees the real call sites");
  // the creation form of the team page and the signed-in person's page both read the owner on the server, never trust a name
  const action = fs.readFileSync("src/app/admin/(panel)/assistants/actions.ts", "utf8");
  assert.match(action, /const ownerId = askedOwner \|\| user\.id;[^]*mayOwnAccess\(ownerId\)/);
  const mine = fs.readFileSync("src/app/admin/(panel)/account/actions.ts", "utf8");
  assert.match(mine, /createPersonalAccess\(user\.id,/, "the account page owns to the signed-in person only");
  assert.ok(!/formData\.get\("owner/.test(mine), "never an owner read from the account form");
});

test("assigning an owner: only a person who may own one; an unowned access becomes owned with the coarse ceiling; the journal names the access and the person, never a code", async () => {
  const owner = await mk("etoile_nord", "owner");
  const editor = await mk("nuage_clair", "editor");
  const admin = await mk("camille", "admin");
  const code = await T.createToken("Claude", "read", "o");
  const id = await T.findTokenId(code);
  await LEG.assignLegacyOwners(); // start-up: an access with no owner predates the owners and is marked (several accounts: nothing is assigned)
  assert.deepEqual(await OW.assignOwner(id, editor.id, owner.email, owner.id), { ok: false, reason: "owner_not_allowed" });
  assert.deepEqual(await OW.assignOwner(id, "nobody", owner.email, owner.id), { ok: false, reason: "owner_missing" });
  assert.deepEqual(await OW.assignOwner("nothing", admin.id, owner.email, owner.id), { ok: false, reason: "access_missing" });
  assert.deepEqual((await OW.eligibleOwners()).map((o) => o.email), ["etoile_nord@example.org", "camille@example.org"]);
  await POL.setPersonOverride(editor.id, "allow");
  assert.equal((await OW.eligibleOwners()).length, 3);
  await POL.setPersonOverride(editor.id, "deny");
  assert.deepEqual(await OW.assignOwner(id, admin.id, owner.email, owner.id), { ok: true, changed: true });
  const row = await db.prisma.apiToken.findUnique({ where: { id } });
  assert.deepEqual([row.ownerId, row.coarseCeiling], [admin.id, true]);
  assert.deepEqual(await OW.assignOwner(id, admin.id, owner.email, owner.id), { ok: true, changed: false });
  // reassigning never changes the kind of ceiling
  assert.deepEqual(await OW.assignOwner(id, owner.id, owner.email, owner.id), { ok: true, changed: true });
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id } })).coarseCeiling, true);
  const rows = await audits("mcp.personal.assign");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].actor, owner.email);
  assert.equal(rows[0].target, "Claude -> camille@example.org");
  assert.ok(!JSON.stringify(rows).includes(code));
  assert.equal((await OW.accessesWithoutOwner()).length, 0);
  // in bulk: refused for a person who may not own, otherwise every unowned access
  await T.createToken("A", "read", "o"); await T.createToken("B", "read", "o");
  assert.deepEqual(await OW.assignAllWithoutOwner(editor.id, owner.email, owner.id), { ok: false, changed: 0, reason: "owner_not_allowed" });
  assert.deepEqual(await OW.assignAllWithoutOwner(admin.id, owner.email, owner.id), { ok: true, changed: 2 });
  assert.equal(await OW.countOwned(admin.id), 2);
});

test("authorisation of the actions: assigning, pausing and removing are for core:mcp.tokens; the account actions read the person from the session", () => {
  const admin = fs.readFileSync("src/app/admin/(panel)/assistants/actions.ts", "utf8");
  for (const name of ["assignOwnerAction", "pauseAccessAction", "revokePersonalAccessAction", "setPersonAiOverrideAction"]) {
    const body = admin.slice(admin.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 300), /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/, name);
  }
  const bulk = fs.readFileSync("src/app/admin/(panel)/assistants/assign-owners/actions.ts", "utf8");
  assert.match(bulk, /adminCtx\(\{ right: "core:mcp\.tokens" \}\)/);
  const mine = fs.readFileSync("src/app/admin/(panel)/account/actions.ts", "utf8");
  for (const name of ["createMyAccessAction", "pauseMyAccessAction", "resumeMyAccessAction", "removeMyAccessAction", "renameMyAccessAction", "setMyAccessLevelAction"]) {
    const body = mine.slice(mine.indexOf(`export async function ${name}`));
    assert.match(body.slice(0, 250), /adminCtx\("member"\)/, name);
    assert.match(body.slice(0, 700), /user\.id/, `${name} acts on the signed-in person`);
  }
  // an access without an owner can only lose rights
  assert.match(admin, /enabled && !token\.ownerId/);
  assert.match(admin, /v === false/);
});

test("the owner of a deleted account no longer exists: the access says 'No owner' and can be given to someone; it is not adopted silently", async () => {
  const owner = await mk("etoile_nord", "owner");
  const admin = await mk("camille", "admin");
  const made = await PA.createPersonalAccess(admin.id, { password: PASSWORD, name: "Claude" });
  await db.prisma.$executeRawUnsafe(`DELETE FROM "UserRole" WHERE "userId" = '${admin.id}'`);
  await db.prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${admin.id}'`);
  assert.equal((await rpc(made.code, "tools/list")).status, 401);
  assert.deepEqual((await OW.accessesWithoutOwner()).map((r) => r.name), ["Claude"]);
  assert.equal((await OW.assignOwner(made.id, owner.id, owner.email, owner.id)).ok, true);
  assert.equal((await rpc(made.code, "tools/list")).status, 200);
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id: made.id } })).coarseCeiling, false, "a newer access that lost its owner stays fail-closed (B1)");
  assert.equal(await FP.setFullPowers(made.id, true), false, "and never holds full powers");
});

test("the single-account step and its page are temporary: SUNSET 0.49.0, the permanent code stays", () => {
  assert.equal(LEG.LEGACY_OWNERS_SUNSET, "0.49.0");
  const [maj, min] = JSON.parse(fs.readFileSync("package.json", "utf8")).version.split(".").map(Number);
  const due = maj > 0 || min >= 49;
  const temporary = ["src/core/personalAi/legacyOwners.ts", "src/app/admin/(panel)/assistants/assign-owners"];
  for (const f of temporary) if (due) assert.ok(!fs.existsSync(f), `${f} must be deleted: it was due in 0.49.0 (docs/PERSONAL-AI.md, "Choosing owners")`);
  if (due) assert.ok(!fs.readFileSync("src/instrumentation.ts", "utf8").includes("legacyOwners"));
  const sourceOfPermanent = fs.readFileSync("src/app/admin/(panel)/assistants/OwnersTab.tsx", "utf8");
  assert.match(sourceOfPermanent, /<OwnerSelect compact/, "the row menu 'Choose an owner' is permanent");
  // everything temporary lives in one folder and one locale prefix
  const folder = fs.readdirSync("src/app/admin/(panel)/assistants/assign-owners");
  assert.deepEqual(folder.sort(), ["AssignOwners.tsx", "BulkAssign.tsx", "actions.ts"]);
  assert.match(fs.readFileSync("src/instrumentation.ts", "utf8"), /sunset 0\.49\.0/);
});

test("the screens, rendered with real rows: nothing about owners when nothing waits; the assign panel only while an access has no owner", async () => {
  const t = makeTranslator("en", "en");
  const { OwnersTab } = await import("../../src/app/admin/(panel)/assistants/OwnersTab.tsx");
  const owner = await mk("etoile_nord", "owner");
  const admin = await mk("camille", "admin");
  const html = async () => renderAsync(React.createElement(OwnersTab, { t }));
  assert.match(await html(), /No AI access/, "empty state says what to do");
  await PA.createPersonalAccess(admin.id, { password: PASSWORD, name: "Claude" });
  let page = await html();
  assert.ok(!page.includes("assign-owners") && !page.includes("Choose who owns each access"), "no assign panel when every access has an owner (R33)");
  assert.ok(page.includes('data-testid="live-search"') || page.includes("Search an access or a person"), "search is always there");
  assert.match(page, /Look only/);
  assert.match(page, /camille@example\.org/);
  assert.match(page, /Active/);
  await T.createToken("Upkeep", "write", "o");
  page = await html();
  assert.ok(page.includes("assign-owners"), "the assign panel shows while one access has no owner");
  assert.match(page, /No owner/);
  assert.match(page, /Give all to this person/);
  assert.match(page, /Choose an owner/);
  await PA.pauseOwnPersonalAccess(admin.id, (await db.prisma.apiToken.findFirst({ where: { name: "Claude" } })).id);
  page = await html();
  assert.match(page, /Paused/);
  // the pause button of an active row is gone for a paused one: at most two visible actions per row (a button and the menu)
  const rows = page.split('data-testid="owners-row"').slice(1);
  for (const r of rows) assert.ok((r.match(/<button/g) ?? []).length <= 3, "the pause button, the menu button and nothing else visible");
  void owner;
});

test("my accesses on the account page: name, password and level, then one click; several rows with a level, a state and a switch; the code appears once", async () => {
  const { MyAccesses } = await import("../../src/components/admin/MyAccesses.tsx");
  const t = makeTranslator("en", "en");
  const keys = ["name", "example", "password", "level", "submit", "new", "levelReplaces", "pending", "createdTitle", "secret", "createdOnce", "copy", "copied", "connect", "active", "paused", "switchLabel", "resumeNeed", "resume", "resumeWith", "menu", "changeLevel", "saveLevel", "remove", "removeConfirm", "removeAction", "ceiling"];
  const labels = Object.fromEntries(keys.map((k) => [k, t(`myai.${k}`)]));
  const levels = ["read", "assistant", "maintenance"].map((l) => ({ value: l, label: t(`myai.level.${l}`) }));
  const noop = async () => ({});
  const rows = [
    { id: "a", name: "Claude", level: "read", levelLabel: "Look only", state: "active", stateLabel: "Active" },
    { id: "b", name: "Upkeep", level: "maintenance", levelLabel: "Site upkeep", state: "paused", stateLabel: "Paused" },
    { id: "c", name: "Old", level: "assistant", levelLabel: "Look and prepare", state: "inert", stateLabel: "Stopped", stateWhy: "why" },
  ];
  const html = renderToStaticMarkup(React.createElement(MyAccesses, { rows, levels, canCreate: true, create: noop, pause: noop, resume: noop, remove: noop, setLevel: noop, labels }));
  assert.equal((html.match(/data-testid="my-access-row"/g) ?? []).length, 3);
  assert.equal((html.match(/role="switch"/g) ?? []).length, 2, "an inert access has no switch: nothing to switch");
  assert.match(html, /aria-checked="true"[^]*aria-checked="false"/);
  const form = html.slice(html.indexOf('data-testid="my-access-form"'));
  const fields = (form.match(/<input(?![^>]*type="radio")[^>]*>/g) ?? []);
  assert.equal(fields.length, 2, "name and password; the level is one segmented control");
  assert.equal((form.match(/type="radio"/g) ?? []).length, 3);
  assert.match(form, /name="accessLabel"[^>]*data-1p-ignore|data-1p-ignore[^>]*name="accessLabel"/, "plain input hints");
  assert.match(form, /autoComplete="current-password"|autocomplete="current-password"/);
  assert.match(html, /Create the access/);
  assert.ok(!/secret address|byUrl/i.test(html), "no secret address for a new access");
  // nobody may create: the list alone
  const listOnly = renderToStaticMarkup(React.createElement(MyAccesses, { rows, levels, canCreate: false, create: noop, pause: noop, resume: noop, remove: noop, setLevel: noop, labels }));
  assert.ok(!listOnly.includes("my-access-form"));
  assert.equal(typeof createGate, "function", "the single-flight guard is the shared one");
  assert.match(fs.readFileSync("src/components/admin/MyAccesses.tsx", "utf8"), /createGate/);
});

/* ───────────── Review fixes ───────────── */

test("B1: an access created after the feature that lost its owner stays fail-closed through a reassignment; only start-up marks a legacy access", async () => {
  const owner = await mk("etoile_nord", "owner");
  const admin = await mk("camille", "admin");
  // low-level creation without an owner after the feature (never done by a screen): it is NOT marked by an assignment
  const fresh = await T.createToken("Fresh", "write", "o");
  const freshId = await T.findTokenId(fresh);
  assert.equal((await OW.assignOwner(freshId, admin.id, owner.email, owner.id)).ok, true);
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id: freshId } })).coarseCeiling, false);
  assert.equal(await FP.setFullPowers(freshId, true), false, "no full powers for a fail-closed access");
  // a legacy access (no owner at start-up) is marked by start-up and keeps the mark through every reassignment
  const old = await T.createToken("Old", "write", "o");
  const oldId = await T.findTokenId(old);
  assert.equal((await LEG.assignLegacyOwners()).marked, 1);
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id: oldId } })).coarseCeiling, true);
  await OW.assignOwner(oldId, admin.id, owner.email, owner.id);
  await OW.assignOwner(oldId, owner.id, owner.email, owner.id);
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id: oldId } })).coarseCeiling, true);
  assert.ok(!/coarseCeiling/.test(fs.readFileSync("src/core/personalAi/owners.ts", "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "assignOwner never writes the marker");
});

test("B3: a different level turns full powers off and replaces the rights; the same level changes nothing (hand-picked rights are kept)", async () => {
  const only = await mk("etoile_nord", "owner");
  const code = await T.createToken("Claude", "write", "o", { grants: { maintenance_status: true, later_custom: false } });
  const id = await T.findTokenId(code);
  await LEG.assignLegacyOwners();
  assert.equal(await FP.setFullPowers(id, true), true);
  const rows = await PA.ownAccessStates(only.id);
  assert.equal(rows[0].level, "assistant");
  const before = await db.prisma.apiToken.findUnique({ where: { id } });
  assert.deepEqual(await PA.setOwnAccessLevel(only.id, id, "assistant"), { ok: true, level: "assistant" });
  const same = await db.prisma.apiToken.findUnique({ where: { id } });
  assert.equal(same.grants, before.grants, "same level: no write");
  assert.equal(await FP.hasFullPowers(id), true, "same level: nothing changes, not even full powers");
  assert.deepEqual(await PA.setOwnAccessLevel(only.id, id, "read"), { ok: true, level: "read" });
  assert.equal(await FP.hasFullPowers(id), false, "any level change turns full powers off");
  assert.equal((await T.authenticate(`Bearer ${code}`)).fullPowers, false);
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id } })).scope, "read");
});

test("B4 and I7: removing an access expires the pending requests of THAT access only, from every screen", async () => {
  const RQ = await import("@/core/maintenance/requests");
  const owner = await mk("etoile_nord", "owner");
  const a = await PA.createPersonalAccess(owner.id, { password: PASSWORD, name: "A", level: "maintenance" });
  const b = await PA.createPersonalAccess(owner.id, { password: PASSWORD, name: "B", level: "maintenance" });
  const plan = { module: "m1", from: "1.0.0", to: "1.0.1" };
  await RQ.createRequest({ action: "module_update", plan, tokenId: a.id, tokenName: "A", ownerId: owner.id });
  await RQ.createRequest({ action: "module_update", plan, tokenId: b.id, tokenName: "B", ownerId: owner.id });
  const pending = async () => (await RQ.listRequests()).filter((r) => r.status === "pending").map((r) => r.tokenName).sort();
  assert.deepEqual(await pending(), ["A", "B"]);
  assert.equal(await (await import("@/core/personalAi/service")).revokePersonalAccessById(a.id, owner.email), true);
  assert.deepEqual(await pending(), ["B"], "the other access of the same person keeps its requests");
  // the By-person "Remove" and the sheet use revokeTokenAction: it expires them too
  // every revoke path goes through revokeToken, which expires them (the sheet, the By-person table, a deleted user)
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const callers = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /\brevokeToken\(/.test(fs.readFileSync(f, "utf8"))).map((f) => f.split(path.sep).join("/")).sort();
  assert.deepEqual(callers, ["src/core/personalAi/revoke.ts", "src/core/services/mcp/tokens.ts"], "only revokeAccess calls revokeToken");
  assert.equal(await RQ.expirePendingOfToken(b.id), 1);
  assert.deepEqual(await pending(), []);
  assert.deepEqual(await PA.revokeOwnPersonalAccess(owner.id, b.id), { ok: true });
});

test("I1: nobody gives an access to a person above their own level, on creation and on every reassignment", async () => {
  const owner = await mk("etoile_nord", "owner");
  const coord = await mk("lune_douce", "coordinator");
  const admin = await mk("camille", "admin");
  assert.equal(await OW.actorMayGiveTo(coord.id, owner.id), false);
  assert.equal(await OW.actorMayGiveTo(coord.id, admin.id), true);
  assert.equal(await OW.actorMayGiveTo(admin.id, coord.id), false);
  assert.equal(await OW.actorMayGiveTo(admin.id, admin.id), true);
  assert.deepEqual((await OW.eligibleOwners(coord.id)).map((o) => o.email).sort(), ["camille@example.org", "lune_douce@example.org"]);
  const code = await T.createToken("Claude", "read", "o");
  const id = await T.findTokenId(code);
  assert.deepEqual(await OW.assignOwner(id, owner.id, coord.email, coord.id), { ok: false, reason: "owner_not_allowed" });
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id } })).ownerId, null);
  assert.deepEqual(await OW.assignOwner(id, owner.id, owner.email, owner.id), { ok: true, changed: true });
  assert.deepEqual(await OW.assignAllWithoutOwner(owner.id, coord.email, coord.id), { ok: false, changed: 0, reason: "owner_not_allowed" });
  const action = fs.readFileSync("src/app/admin/(panel)/assistants/actions.ts", "utf8");
  assert.match(action, /actorMayGiveTo\(user\.id, ownerId\)/, "the creation form checks it too");
});

test("I3: the single account is given the accesses only if it may own one and is not locked; otherwise they stay without an owner and keep working", async () => {
  const only = await mk("etoile_nord", "owner");
  const code = await T.createToken("Claude", "read", "o");
  const unowned = async () => (await db.prisma.apiToken.findFirst()).ownerId;
  await db.prisma.user.update({ where: { id: only.id }, data: { mustChangePassword: true } });
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0, marked: 1, skipped: "owner_not_allowed" });
  assert.equal(await unowned(), null);
  assert.equal((await rpc(code, "tools/list")).status, 200, "still working");
  await db.prisma.user.update({ where: { id: only.id }, data: { mustChangePassword: false } });
  await POL.setPersonOverride(only.id, "deny");
  assert.equal((await LEG.assignLegacyOwners()).skipped, "owner_not_allowed");
  assert.equal(await unowned(), null);
  assert.equal((await rpc(code, "tools/list")).status, 200);
  await POL.setPersonOverride(only.id, "inherit");
  assert.equal((await LEG.assignLegacyOwners()).assigned, 1, "assigned at the next start once the account may own one");
  assert.equal(await unowned(), only.id);
});

test("I3: a sole editor account that may own an access: the coarse fallback never exceeds that editor", async () => {
  await withModuleTools(async () => {
    const only = await mk("etoile_nord", "editor");
    await POL.setPersonOverride(only.id, "allow");
    const code = await T.createToken("Claude", "write", "o", { grants: await everything() });
    assert.ok((await names(code)).includes("later_1__plain"), "before: it sees the undeclared tool");
    assert.equal((await LEG.assignLegacyOwners()).assigned, 1);
    const seen = await names(code);
    assert.ok(!seen.includes("later_1__plain") && !seen.includes("maintenance_core_update"), "an editor's access does not go above an editor");
    assert.ok(seen.includes("later_1__declared"));
  });
});

test("I5: a legacy access keeps its stored 'act without asking' choice and its own limits; a newer one follows the site policy", async () => {
  const only = await mk("etoile_nord", "owner");
  const legacy = await T.createToken("Old", "write", "o");
  const legacyId = await T.findTokenId(legacy);
  await LEG.assignLegacyOwners();
  const fresh = await PA.createPersonalAccess(only.id, { password: PASSWORD, name: "New", level: "maintenance" });
  assert.equal(await T.isStrictPersonalToken(legacyId), false);
  assert.equal(await T.isStrictPersonalToken(fresh.id), true);
  const src = fs.readFileSync("src/core/maintenance/actions.ts", "utf8");
  assert.match(src, /isStrictPersonalToken\(actor\.tokenId\)/);
  assert.match(fs.readFileSync("src/core/maintenance/slots.ts", "utf8"), /isStrictPersonalToken\(tokenId\)/);
  const sheet = fs.readFileSync("src/app/admin/(panel)/assistants/requestsActions.ts", "utf8");
  assert.ok(!/row\.revokedAt \|\| row\.ownerId\)/.test(sheet), "an owned access is no longer refused by the approval action (B2)");
  assert.match(sheet, /isStrictPersonalToken\(row\.id\)/);
});

test("B2: the sheet of an owned access: no secret-address switch that does nothing, no full-powers window for a newer access", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/assistants/[id]/page.tsx", "utf8");
  assert.match(page, /\(urlOn \|\| !ownedNow\)/);
  assert.match(page, /row\.ownerId && row\.coarseCeiling/);
  const action = fs.readFileSync("src/app/admin/(panel)/assistants/fullPowersActions.ts", "utf8");
  assert.match(action, /!row\.ownerId \|\| !row\.coarseCeiling/);
});

test("I6: 'never had an owner' (works) and 'owner no longer exists' (stopped) are two states, counted and worded apart", async () => {
  const owner = await mk("etoile_nord", "owner");
  const admin = await mk("camille", "admin");
  const never = await T.createToken("Never", "read", "o");
  const made = await PA.createPersonalAccess(admin.id, { password: PASSWORD, name: "Gone" });
  await db.prisma.$executeRawUnsafe(`DELETE FROM "UserRole" WHERE "userId" = '${admin.id}'`);
  await db.prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${admin.id}'`);
  assert.deepEqual((await OW.accessesWithoutOwner()).map((r) => [r.name, r.ownerGone]), [["Never", false], ["Gone", true]]);
  assert.equal((await rpc(never, "tools/list")).status, 200);
  assert.equal((await rpc(made.code, "tools/list")).status, 401);
  const src = fs.readFileSync("src/core/maintenance/inspect.ts", "utf8");
  assert.match(src, /accessesOwnerRemoved/);
  const t = makeTranslator("en", "en");
  const { OwnersTab } = await import("../../src/app/admin/(panel)/assistants/OwnersTab.tsx");
  const page = await renderAsync(React.createElement(OwnersTab, { t, viewerId: owner.id }));
  assert.match(page, /No owner/);
  assert.match(page, /Owner removed/);
  const { AssignOwners } = await import("../../src/app/admin/(panel)/assistants/assign-owners/AssignOwners.tsx");
  const panel = await renderAsync(React.createElement(AssignOwners, { t, viewerId: owner.id }));
  assert.match(panel, /Owner removed/);
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  for (const k of ["owners.state.gone", "owners.state.goneWhy", "owners.pendingGone"]) assert.ok(fr[k] && en[k], k);
  assert.ok(!/works as before/.test(en["owners.state.goneWhy"]), "a stopped access is never said to work");
});

test("I8: the visible word is 'access code', not 'connection key'; no description paragraph duplicating the tip", () => {
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8")), fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  for (const k of Object.keys(en).filter((k) => k.startsWith("myai."))) {
    assert.ok(!/connection key/i.test(en[k]) && !/cl[ée] de connexion/i.test(fr[k]), k);
  }
  assert.equal(en["myai.secret"], "Access code");
  assert.equal(fr["myai.secret"], "Code d'accès");
  assert.equal(en["myai.intro"], undefined);
  assert.ok(!/myai\.intro/.test(fs.readFileSync("src/app/admin/(panel)/account/MyAccessesCard.tsx", "utf8")));
});

test("N1, N5, N6, N7: unique field ids per person; the owner is journalled by e-mail; a name is never reused; no level select without a level", async () => {
  const { PersonAiOverride } = await import("../../src/components/admin/PersonAiOverride.tsx");
  const labels = { title: "t", inherit: "i", allow: "a", deny: "d", save: "s", may: "m", mayNot: "n", owned: "o", done: "ok", failed: "no" };
  const one = (id) => renderToStaticMarkup(React.createElement(PersonAiOverride, { id, value: "inherit", effective: true, owned: 0, save: async () => true, labels }));
  assert.ok(one("u1").includes('id="person-ai-select-u1"') && one("u1").includes('for="person-ai-select-u1"'));
  assert.ok(!one("u2").includes("person-ai-select-u1"));
  // N5
  const u = await mk("etoile_nord", "owner");
  const { createAccess } = await import("@/core/mcpAccess");
  await createAccess({ name: "Journal", scope: "read", actorEmail: u.email, ownerId: u.id });
  assert.equal((await audits("mcp.personal.assign"))[0].target, "Journal -> etoile_nord@example.org");
  // N6: a name used by a removed access, or by an access before a rename, is not given again
  const first = await PA.createPersonalAccess(u.id, { password: PASSWORD, name: "Claude" });
  await PA.revokeOwnPersonalAccess(u.id, first.id);
  const again = await PA.createPersonalAccess(u.id, { password: PASSWORD, name: "Claude" });
  assert.equal(again.name, "Claude (2)");
  const renamed = await PA.renameOwnPersonalAccess(u.id, again.id, "Autre");
  assert.equal(renamed.name, "Autre");
  const third = await PA.createPersonalAccess(u.id, { password: PASSWORD, name: "Claude (2)" });
  assert.equal(third.name, "Claude (2) (2)", "the earlier name of a renamed access is not reused either");
  // N7
  const { MyAccesses } = await import("../../src/components/admin/MyAccesses.tsx");
  const t = makeTranslator("en", "en");
  const keys = ["name", "example", "password", "level", "submit", "new", "levelReplaces", "pending", "createdTitle", "secret", "createdOnce", "copy", "copied", "connect", "active", "paused", "switchLabel", "resumeNeed", "resume", "resumeWith", "menu", "changeLevel", "saveLevel", "remove", "removeConfirm", "removeAction", "ceiling"];
  const lab = Object.fromEntries(keys.map((k) => [k, t(`myai.${k}`)]));
  const noop = async () => ({});
  const rows = [{ id: "a", name: "Claude", level: "read", levelLabel: "Look only", state: "inert", stateLabel: "Stopped" }];
  const html = renderToStaticMarkup(React.createElement(MyAccesses, { rows, levels: [], canCreate: false, create: noop, pause: noop, resume: noop, remove: noop, setLevel: noop, labels: lab }));
  assert.ok(!html.includes('<select') && html.includes("Look only"), "the current level is shown read-only");
  const withLevels = renderToStaticMarkup(React.createElement(MyAccesses, { rows, levels: [{ value: "read", label: "Look only" }], canCreate: false, create: noop, pause: noop, resume: noop, remove: noop, setLevel: noop, labels: lab }));
  assert.ok(withLevels.includes("A different level replaces"), "the tip says a level replaces custom rights");
});

/* ───────────── Second review ───────────── */

test("NEW-1: the marking is ONE-TIME and only for rows that existed at the first start-up; the flag is set only after a successful run", async () => {
  const owner = await mk("etoile_nord", "owner");
  await mk("lune_douce", "admin"); // two accounts: nothing is assigned, only marked
  const old = await T.createToken("Old", "write", "o");
  const oldId = await T.findTokenId(old);
  const flag = (k) => db.prisma.setting.findUnique({ where: { key_locale: { key: k, locale: "" } } });
  // (3) a run that throws leaves the flag unset, and the retry keeps the same cut-off
  const real = db.prisma.apiToken.updateMany;
  db.prisma.apiToken.updateMany = async () => { throw new Error("boom"); };
  await assert.rejects(LEG.assignLegacyOwners(), /boom/);
  db.prisma.apiToken.updateMany = real;
  assert.equal(await flag(LEG.LEGACY_MARKED_KEY), null, "no flag after a failed run");
  const cutoff = JSON.parse((await flag(LEG.LEGACY_CUTOFF_KEY)).value);
  // a row created between the crash and the retry is not marked (it is after the cut-off)
  await new Promise((r) => setTimeout(r, 15));
  const between = await T.createToken("Between", "write", "o");
  const betweenId = await T.findTokenId(between);
  // (1) the first successful start-up marks the pre-existing ownerless row
  assert.equal((await LEG.assignLegacyOwners()).marked, 1);
  assert.equal(JSON.parse((await flag(LEG.LEGACY_CUTOFF_KEY)).value), cutoff);
  const marked = async (id) => (await db.prisma.apiToken.findUnique({ where: { id } })).coarseCeiling;
  assert.equal(await marked(oldId), true);
  assert.equal(await marked(betweenId), false);
  assert.ok(await flag(LEG.LEGACY_MARKED_KEY));
  // (2) an ownerless access created after the first run is NOT marked at the next start-up, and keeps failing closed once owned
  const later = await T.createToken("Later", "write", "o");
  const laterId = await T.findTokenId(later);
  // (4) idempotent
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0, marked: 0, skipped: "accounts" });
  assert.equal(await marked(laterId), false);
  await OW.assignOwner(laterId, owner.id, owner.email, owner.id);
  assert.equal(await marked(laterId), false);
  assert.equal(await FP.setFullPowers(laterId, true), false, "no full powers, no fallback");
});

test("NEW-1: the single-account step only gives MARKED accesses; an unmarked ownerless one stays ownerless", async () => {
  const only = await mk("etoile_nord", "owner");
  await T.createToken("Old", "read", "o");
  assert.equal((await LEG.assignLegacyOwners()).assigned, 1);
  const stray = await T.createToken("Stray", "read", "o");
  assert.equal((await LEG.assignLegacyOwners()).assigned, 0);
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id: await T.findTokenId(stray) } })).ownerId, null);
  assert.equal((await db.prisma.apiToken.findMany({ where: { ownerId: only.id } })).length, 1);
});

test("NEW-1: the rollback recipe of the docs touches only marked rows, and the docs say what stays at the sunset", async () => {
  const only = await mk("etoile_nord", "owner");
  await T.createToken("Old", "read", "o");
  await LEG.assignLegacyOwners();
  const fresh = await PA.createPersonalAccess(only.id, { password: PASSWORD, name: "New" });
  await db.prisma.$executeRawUnsafe(`UPDATE "ApiToken" SET "ownerId" = NULL, "pausedAt" = NULL WHERE "coarseCeiling" = 1`);
  const rows = await db.prisma.apiToken.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((r) => [r.name, r.ownerId === null]), [["Old", true], ["New", false]], "only the migrated row goes back");
  const doc = fs.readFileSync("docs/PERSONAL-AI.md", "utf8");
  assert.ok(doc.includes('UPDATE ApiToken SET ownerId = NULL, pausedAt = NULL WHERE coarseCeiling = 1;'));
  assert.match(doc, /coarseCeiling` column stays/i);
  void fresh;
});

test("NEW-2: deleting a user expires the pending requests of each of their accesses, and only theirs", async () => {
  const RQ = await import("@/core/maintenance/requests");
  const { deleteMember } = await import("@/core/auth/members");
  const boss = await mk("etoile_nord", "owner");
  const gone = await mk("camille", "admin");
  const plan = { module: "m1", from: "1.0.0", to: "1.0.1" };
  const a = await PA.createPersonalAccess(gone.id, { password: PASSWORD, name: "A", level: "maintenance" });
  const b = await PA.createPersonalAccess(gone.id, { password: PASSWORD, name: "B", level: "maintenance" });
  const c = await PA.createPersonalAccess(boss.id, { password: PASSWORD, name: "C", level: "maintenance" });
  for (const [x, who] of [[a, gone], [b, gone], [c, boss]]) await RQ.createRequest({ action: "module_update", plan, tokenId: x.id, tokenName: x.name, ownerId: who.id });
  const pending = async () => (await RQ.listRequests()).filter((r) => r.status === "pending").map((r) => r.tokenName).sort();
  assert.deepEqual(await pending(), ["A", "B", "C"]);
  assert.deepEqual(await deleteMember(boss.id, gone.id), { ok: true });
  assert.deepEqual(await pending(), ["C"]);
});

test("NIT-1 and NIT-2: the actor is required to assign; a new maintenance access does not store 'direct' unless the site allows it", () => {
  const owners = fs.readFileSync("src/core/personalAi/owners.ts", "utf8");
  assert.match(owners, /actorEmail: string, actorId: string\): Promise<AssignResult>/);
  assert.match(owners, /actorEmail: string, actorId: string\): Promise<\{ ok: boolean; changed: number/);
  const action = fs.readFileSync("src/app/admin/(panel)/assistants/actions.ts", "utf8");
  assert.match(action, /formData\.get\("approval"\) === "direct" && \(await getPersonalPolicy\(\)\)\.allowDirect/);
});
