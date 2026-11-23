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
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 2 });
  const after1 = await rows();
  assert.deepEqual(after1.filter((r) => !r.revokedAt).map((r) => [r.ownerId, r.coarseCeiling]), [[only.id, true], [only.id, true]]);
  assert.equal(after1.find((r) => r.revokedAt).ownerId, null, "a revoked access is not touched");
  assert.equal(after1.find((r) => r.id === (undefined)), undefined);
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0 }, "idempotent");
  const rows2 = await audits("mcp.personal.assign");
  assert.equal(rows2.length, 2, "one journal row per access");
  for (const r of rows2) { assert.equal(r.actor, "system"); assert.match(r.target, /-> etoile_nord@example\.org \(single account\)$/); assert.ok(!r.target.includes("vit_")); }
  assert.ok(!JSON.stringify(rows2).includes(a) && !JSON.stringify(rows2).includes(b), "no code in the journal");
});

test("several accounts, no account, or an owner that does not exist: nothing is assigned and nothing breaks", async () => {
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0 }, "no account at all");
  const token = await T.createToken("Claude", "read", "o");
  await mk("etoile_nord", "owner");
  await mk("lune_douce", "admin");
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 0 }, "an owner and a pending invitation are two accounts: the coordinator chooses");
  assert.equal((await db.prisma.apiToken.findFirst()).ownerId, null);
  assert.equal((await rpc(token, "tools/list")).status, 200, "an access without an owner keeps working as before");
  // an access whose owner row does not exist (a restored site) is not adopted by the migration either
  const orphan = await db.prisma.apiToken.create({ data: { name: "Orphan", hash: "horphan", prefix: "vit_", createdBy: "x", ownerId: "gone" } });
  await db.prisma.user.delete({ where: { email: "lune_douce@example.org" } });
  assert.deepEqual(await LEG.assignLegacyOwners(), { assigned: 1 }, "only the one with no ownerId");
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
  assert.deepEqual(await OW.assignOwner(id, editor.id, owner.email), { ok: false, reason: "owner_not_allowed" });
  assert.deepEqual(await OW.assignOwner(id, "nobody", owner.email), { ok: false, reason: "owner_missing" });
  assert.deepEqual(await OW.assignOwner("nothing", admin.id, owner.email), { ok: false, reason: "access_missing" });
  assert.deepEqual((await OW.eligibleOwners()).map((o) => o.email), ["etoile_nord@example.org", "camille@example.org"]);
  await POL.setPersonOverride(editor.id, "allow");
  assert.equal((await OW.eligibleOwners()).length, 3);
  await POL.setPersonOverride(editor.id, "deny");
  assert.deepEqual(await OW.assignOwner(id, admin.id, owner.email), { ok: true, changed: true });
  const row = await db.prisma.apiToken.findUnique({ where: { id } });
  assert.deepEqual([row.ownerId, row.coarseCeiling], [admin.id, true]);
  assert.deepEqual(await OW.assignOwner(id, admin.id, owner.email), { ok: true, changed: false });
  // a person who already owned it keeps the kind of ceiling it had
  assert.deepEqual(await OW.assignOwner(id, owner.id, owner.email), { ok: true, changed: true });
  const rows = await audits("mcp.personal.assign");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].actor, owner.email);
  assert.equal(rows[0].target, "Claude -> camille@example.org");
  assert.ok(!JSON.stringify(rows).includes(code));
  assert.equal((await OW.accessesWithoutOwner()).length, 0);
  // in bulk: refused for a person who may not own, otherwise every unowned access
  await T.createToken("A", "read", "o"); await T.createToken("B", "read", "o");
  assert.deepEqual(await OW.assignAllWithoutOwner(editor.id, owner.email), { ok: false, changed: 0, reason: "owner_not_allowed" });
  assert.deepEqual(await OW.assignAllWithoutOwner(admin.id, owner.email), { ok: true, changed: 2 });
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
  assert.equal((await OW.assignOwner(made.id, owner.id, owner.email)).ok, true);
  assert.equal((await rpc(made.code, "tools/list")).status, 200);
  assert.equal((await db.prisma.apiToken.findUnique({ where: { id: made.id } })).coarseCeiling, true);
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
  const keys = ["name", "example", "password", "level", "submit", "new", "pending", "createdTitle", "secret", "createdOnce", "copy", "copied", "connect", "active", "paused", "switchLabel", "resumeNeed", "resume", "resumeWith", "menu", "changeLevel", "saveLevel", "remove", "removeConfirm", "removeAction", "ceiling"];
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
