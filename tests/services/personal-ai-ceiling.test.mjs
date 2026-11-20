import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

// PERSONAL AI ASSISTANTS (core 0.46.0): the ceiling. The real MCP server, the real tools, the real database, nothing mocked.
// A personal AI can do a tool only if its OWNER can do what the tool does right now; independent accesses behave as before.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const FP = await import("@/core/services/mcp/fullPowers");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const PA = await import("@/core/personalAi/service");
const POL = await import("@/core/personalAi/policy");
const { columnsOf } = await import("@/core/auth/rights");
const Roles = await import("@/core/auth/roles");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

const blog = FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest;
const PASSWORD = "correct horse 12";
let U; // the people of the test

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  PA.resetPersonalPasswordLimits();
  await setSetting("i18n.default", "en");
  await setSetting("i18n.enabled", ["en", "fr"]);
  await db.fixture("blog");
  await createInstance(db.prisma, { manifest: blog, nickname: "News", names: { en: "News" } });
  const hash = bcrypt.hashSync(PASSWORD, 4);
  const mk = (name, level) => db.prisma.user.create({ data: { email: `${name}@example.org`, name, passwordHash: hash, ...columnsOf(level) } });
  U = { owner: await mk("etoile_nord", "owner"), coord: await mk("lune_douce", "coordinator"), admin: await mk("camille", "admin"), editor: await mk("nuage_clair", "editor") };
  await Roles.syncSystemAssignments();
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), P.listMcpTools);
const names = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools.map((t) => t.name);
async function call(token, name, args = {}) {
  const res = await rpc(token, "tools/call", { name, arguments: args });
  const body = await res.json();
  if (body.error) return { error: body.error.message, status: res.status };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
const switchOn = () => POL.setPersonalPolicy({ enabled: true });
/** The personal AI of a person, started from a profile. */
async function personal(user, profile = "full") {
  const made = await PA.createPersonalAccess(user.id, { password: PASSWORD, profile });
  assert.equal(made.ok, true, JSON.stringify(made));
  return { token: made.code, id: made.id };
}
/** Ticks tools on the personal AI of a person (clipped to what the person can do). */
async function tick(user, tools) {
  const row = await db.prisma.apiToken.findFirst({ where: { ownerId: user.id, revokedAt: null } });
  return PA.setOwnPersonalGrants(user.id, { ...JSON.parse(row.grants), ...Object.fromEntries(tools.map((t) => [t, true])) });
}

test("off by default: nobody can create one, the setting is safe, and an independent access sees what it saw before", async () => {
  assert.deepEqual(await POL.getPersonalPolicy(), { enabled: false, allowDirect: false });
  assert.deepEqual(await PA.createPersonalAccess(U.admin.id, { password: PASSWORD }), { ok: false, reason: "not_allowed" });
  const plain = await T.createToken("Independent", "write", "o", { grants: { site_info: true, redirects_list: true, maintenance_status: true } });
  const before = await names(plain);
  await switchOn();
  await personal(U.admin);
  assert.deepEqual(await names(plain), before, "an independent access is not touched by personal assistants");
  assert.ok(before.includes("maintenance_status"), "no owner ceiling for it: the admin tier is not required of an independent access");
  // a garbled setting is the safe default
  await db.prisma.setting.update({ where: { key_locale: { key: POL.PERSONAL_POLICY_KEY, locale: "" } }, data: { value: "{not json" } });
  assert.deepEqual(await POL.getPersonalPolicy(), { enabled: false, allowDirect: false });
  await db.prisma.setting.update({ where: { key_locale: { key: POL.PERSONAL_POLICY_KEY, locale: "" } }, data: { value: JSON.stringify({ enabled: "true", allowDirect: 1 }) } });
  assert.deepEqual(await POL.getPersonalPolicy(), { enabled: false, allowDirect: false }, "only the literal true switches a flag on");
});

test("the right: administrators, the coordinator and the owner hold core:ai.personal, editors do not; a custom role can carry it", async () => {
  const A = await import("@/core/auth/access");
  const load = async (u) => (await A.loadAdminUserById(u.id)).user;
  assert.equal(A.can(await load(U.owner), "core:ai.personal"), true);
  assert.equal(A.can(await load(U.coord), "core:ai.personal"), true);
  assert.equal(A.can(await load(U.admin), "core:ai.personal"), true);
  assert.equal(A.can(await load(U.editor), "core:ai.personal"), false);
  const role = await Roles.createRole(U.owner.id, { name: "Assistants", description: "", rights: ["core:ai.personal", "core:entries.edit"] });
  assert.equal(role.ok, true, JSON.stringify(role));
  const ids = [(await db.prisma.role.findUnique({ where: { key: "editor" } })).id, role.id];
  assert.equal((await Roles.setUserRoles(U.owner.id, U.editor.id, ids)).ok, true);
  assert.equal(A.can(await load(U.editor), "core:ai.personal"), true);
  // the pure rule: master switch x override x right
  for (const enabled of [false, true]) for (const override of ["inherit", "allow", "deny"]) for (const holds of [false, true]) {
    const expected = enabled && override !== "deny" && (override === "allow" || holds);
    assert.equal(POL.personalAiAllowed({ enabled, allowDirect: false }, override, holds), expected, `${enabled}/${override}/${holds}`);
  }
});

test("matrix: an editor's AI never sees the site tools; an administrator's AI never sees updates, backup or installs; the coordinator's AI sees them once granted", async () => {
  await switchOn();
  await POL.setPersonOverride(U.editor.id, "allow"); // allowed to have one, but still an editor
  const ed = await personal(U.editor);
  const ad = await personal(U.admin);
  const co = await personal(U.coord);
  const ow = await personal(U.owner);
  const upkeep = ["maintenance_core_update", "maintenance_backup_run", "maintenance_module_install"];
  for (const p of [co, ow]) assert.equal((await tick(p === co ? U.coord : U.owner, upkeep)).ok, true);
  assert.equal((await tick(U.admin, upkeep)).ok, true);
  assert.equal((await tick(U.editor, [...upkeep, "maintenance_status", "navigation_set"])).ok, true);

  const editorSees = await names(ed.token);
  const adminSees = await names(ad.token);
  const coordSees = await names(co.token);
  const ownerSees = await names(ow.token);

  // editor: content and short links only
  for (const n of ["maintenance_status", "navigation_set", "navigation_get", "site_settings_set", "maintenance_module_update", ...upkeep, "maintenance_module_configure", "log_list"]) assert.ok(!editorSees.includes(n), `editor must not see ${n}`);
  for (const n of ["site_info", "maintenance_my_access", "news__list_entries", "news__create_draft", "news__update_draft", "news__publish", "redirects_list", "media_list"]) assert.ok(editorSees.includes(n), `editor should see ${n}`);
  assert.match((await call(ed.token, "maintenance_status")).error, /Unknown tool/);
  assert.match((await call(ed.token, "navigation_set", { entries: [] })).error, /Unknown tool/);

  // administrator: the site, not the reserved upkeep
  for (const n of ["maintenance_status", "navigation_get", "navigation_set", "site_settings_get", "site_settings_set", "home_sections_set", "news__publish"]) assert.ok(adminSees.includes(n), `admin should see ${n}`);
  for (const n of upkeep) assert.ok(!adminSees.includes(n), `admin must not see ${n}`);
  assert.match((await call(ad.token, "maintenance_core_update")).error, /Unknown tool/);

  // coordinator and owner: the upkeep too, because they hold the reserved rights
  for (const sees of [coordSees, ownerSees]) for (const n of upkeep) assert.ok(sees.includes(n), `${n} for the technical levels`);
});

test("no privilege escalation: a grant above the owner's rights (even written by hand in the database) is ignored", async () => {
  await switchOn();
  const ad = await personal(U.admin);
  await db.prisma.apiToken.update({ where: { id: ad.id }, data: { grants: JSON.stringify({ maintenance_core_update: true, maintenance_module_install: true, maintenance_backup_run: true }), scope: "write" } });
  const seen = await names(ad.token);
  for (const n of ["maintenance_core_update", "maintenance_module_install", "maintenance_backup_run"]) assert.ok(!seen.includes(n), n);
  assert.match((await call(ad.token, "maintenance_backup_run")).error, /Unknown tool/);
  // ... and the service clips it as well
  const clipped = await PA.setOwnPersonalGrants(U.admin.id, { maintenance_core_update: true, maintenance_status: true });
  assert.deepEqual(clipped, { ok: true, on: 1 });
  assert.deepEqual(JSON.parse((await db.prisma.apiToken.findUnique({ where: { id: ad.id } })).grants), { maintenance_status: true });
});

test("demotion applies at once: the next list loses the tools, my_access says why, reconnectNeeded is true; promotion brings them back", async () => {
  await switchOn();
  const ad = await personal(U.admin);
  assert.ok((await names(ad.token)).includes("navigation_set")); // records the baseline list
  await db.prisma.user.update({ where: { id: U.admin.id }, data: columnsOf("editor") });
  await POL.setPersonOverride(U.admin.id, "allow"); // still allowed to have one, but now an editor
  const mine = (await call(ad.token, "maintenance_my_access")).value; // before listing again: a list sent to the client moves the baseline

  assert.equal(mine.reconnectNeeded, true, "the owner's rights are part of the access revision");
  assert.ok(mine.toolsChangedSince.removed.includes("navigation_set"));
  const above = mine.notGranted.find((n) => n.tool === "navigation_set");
  assert.equal(above.why, "above_owner_rights");
  assert.match(above.rightToTick, /administrator/i);
  const seen = await names(ad.token);
  assert.ok(!seen.includes("navigation_set") && !seen.includes("maintenance_status"));
  assert.ok(seen.includes("news__create_draft"));
  assert.match(mine.personalAssistant.meaning, /only what its owner can do/);
  await db.prisma.user.update({ where: { id: U.admin.id }, data: columnsOf("admin") });
  assert.ok((await names(ad.token)).includes("navigation_set"), "restorable: nothing was deleted");
});

test("policy off, deny, withdrawn right, paused: an explicit refusal on the next request, and everything comes back when restored", async () => {
  await switchOn();
  const ad = await personal(U.admin);
  const status = async () => { const r = await rpc(ad.token, "tools/list"); return [r.status, (await r.json()).error?.message]; };
  assert.equal((await status())[0], 200);
  await POL.setPersonalPolicy({ enabled: false });
  const off = await status();
  assert.equal(off[0], 403);
  assert.match(off[1], /switched off by an administrator/);
  await POL.setPersonalPolicy({ enabled: true });
  assert.equal((await status())[0], 200, "restored with no setup");
  await POL.setPersonOverride(U.admin.id, "deny");
  assert.equal((await status())[0], 403);
  await POL.setPersonOverride(U.admin.id, "inherit");
  assert.equal((await status())[0], 200);
  // the role right withdrawn: an editor with a custom role carrying it, then the role loses it
  await POL.setPersonOverride(U.editor.id, "inherit");
  const role = await Roles.createRole(U.owner.id, { name: "Assistants", description: "", rights: ["core:ai.personal", "core:entries.edit"] });
  await Roles.setUserRoles(U.owner.id, U.editor.id, [(await db.prisma.role.findUnique({ where: { key: "editor" } })).id, role.id]);
  const ed = await personal(U.editor, "assistant");
  assert.ok((await names(ed.token)).includes("news__create_draft"));
  await Roles.updateRole(U.owner.id, role.id, { name: "Assistants", description: "", rights: ["core:entries.edit"] });
  const gone = await rpc(ed.token, "tools/list");
  assert.equal(gone.status, 403);
  // paused
  await PA.pauseOwnPersonalAccess(U.admin.id);
  const paused = await rpc(ad.token, "tools/list");
  assert.equal(paused.status, 403);
  assert.match((await paused.json()).error.message, /paused/);
});

test("fail closed: an owner who does not exist, a locked account, or no resolver at all never leaves a working access", async () => {
  await switchOn();
  const ad = await personal(U.admin);
  const ed = await personal(U.coord);
  await db.prisma.user.update({ where: { id: U.admin.id }, data: { mustChangePassword: true } });
  assert.equal((await rpc(ad.token, "tools/list")).status, 403, "a temporary password to replace: inert");
  await db.prisma.user.update({ where: { id: U.admin.id }, data: { mustChangePassword: false } });
  assert.equal((await rpc(ad.token, "tools/list")).status, 200);
  // two-factor required and missing
  await setSetting("security.require2fa", true);
  assert.equal((await rpc(ad.token, "tools/list")).status, 403);
  await setSetting("security.require2fa", false);
  // the owner row vanished without the hook (a raw delete): refused like an unknown access, never treated as independent
  await db.prisma.$executeRawUnsafe(`DELETE FROM "UserRole" WHERE "userId" = '${U.coord.id}'`);
  await db.prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${U.coord.id}'`);
  const dead = await rpc(ed.token, "tools/list");
  assert.equal(dead.status, 401);
  assert.match((await dead.json()).error.message, /Missing or invalid token/);
  // nobody registered the resolver: inert, not independent
  const saved = globalThis.curiosaOwnerResolver;
  globalThis.curiosaOwnerResolver = undefined;
  try {
    assert.equal((await rpc(ad.token, "tools/list")).status, 401);
    assert.equal((await T.authenticate(`Bearer ${ad.token}`)).personal.active, false);
  } finally { globalThis.curiosaOwnerResolver = saved; }
  // a resolver that throws
  globalThis.curiosaOwnerResolver = async () => { throw new Error("boom"); };
  try { assert.equal((await rpc(ad.token, "tools/list")).status, 401); } finally { globalThis.curiosaOwnerResolver = saved; }
  assert.equal((await rpc(ad.token, "tools/list")).status, 200);
});

test("never full powers, never a secret address", async () => {
  await switchOn();
  const ad = await personal(U.admin);
  assert.equal(await FP.setFullPowers(ad.id, true), false);
  await db.prisma.setting.upsert({ where: { key_locale: { key: FP.FULL_POWERS_KEY, locale: "" } }, create: { key: FP.FULL_POWERS_KEY, locale: "", value: JSON.stringify([ad.id]) }, update: { value: JSON.stringify([ad.id]) } });
  (await import("@/core/settings")).resetSettingsCache();
  const authed = await T.authenticate(`Bearer ${ad.token}`);
  assert.equal(authed.fullPowers, false);
  assert.ok(!(await names(ad.token)).includes("maintenance_core_update"));
  assert.deepEqual(await FP.accessesWithFullPowers(), []);
  await assert.rejects(() => T.createToken("x", "read", "o", { ownerId: U.admin.id, byUrl: true }));
  await T.setUrlAccess(ad.id, true);
  assert.equal(await T.isUrlAccessEnabled(ad.id), false);
  await setSetting("mcp.urlTokens", [ad.id]);
  assert.equal(await T.authenticateByUrl(ad.token), null, "a personal access is refused on the secret address even if listed");
});

test("tools of modules: without a declared requirement they are hidden from personal AIs; with one they follow the owner's rights; independent accesses see them", async () => {
  await switchOn();
  const tool = (name, extra = {}) => ({ name, title: name, description: "A tool.", readOnly: true, default: true, destructive: false, input: { type: "object" }, source: "later_1", instanceId: "i1", moduleId: "later", call: async () => "done", ...extra });
  const provider = { id: "later", list: async () => [tool("later_1__plain"), tool("later_1__with_edit", { requires: { right: "core:entries.edit" } }), tool("later_1__with_bad", { requires: { right: "" } }), tool("later_1__owner_only", { requires: { tier: "owner" } })] };
  P.mcpProviders.push(provider);
  try {
    const ow = await personal(U.owner, "read");
    await POL.setPersonOverride(U.editor.id, "allow");
    const ed = await personal(U.editor, "read");
    const plain = await T.createToken("Independent", "read", "o");
    const ownerSees = await names(ow.token);
    const editorSees = await names(ed.token);
    assert.ok(!ownerSees.includes("later_1__plain"), "no requirement: hidden even from the owner's AI");
    assert.ok(!ownerSees.includes("later_1__with_bad"), "an invalid declaration is a requirement nobody meets");
    assert.ok(ownerSees.includes("later_1__with_edit") && ownerSees.includes("later_1__owner_only"));
    assert.ok(editorSees.includes("later_1__with_edit"), "the editor holds the right");
    assert.ok(!editorSees.includes("later_1__owner_only"));
    assert.match((await call(ed.token, "later_1__owner_only")).error, /Unknown tool/);
    assert.equal((await call(ed.token, "later_1__with_edit")).value, "done");
    const independent = await names(plain);
    assert.ok(independent.includes("later_1__plain") && independent.includes("later_1__with_bad"), "independent accesses are unchanged");
  } finally { P.mcpProviders.splice(P.mcpProviders.indexOf(provider), 1); }
});

test("the catalogue test: every core tool has a requirement, no requirement names a tool that does not exist, content tools declare theirs", async () => {
  const C = await import("@/core/services/mcp/ownerCeiling");
  await (await import("@/core/overlays/store")).createPage({ name: "Overlay", width: 1920, height: 1080 });
  const catalogue = await P.listMcpToolCatalogue();
  const core = catalogue.filter((t) => !t.instanceId && !t.moduleId && !t.name.includes("__"));
  assert.ok(core.length > 40, "a real catalogue");
  assert.deepEqual(core.filter((t) => C.requirementOf(t) === undefined).map((t) => t.name), [], "a new core tool must be classified in src/core/services/mcp/ownerCeiling.ts (CORE_REQUIREMENTS)");
  const real = new Set(catalogue.map((t) => t.name));
  for (const name of Object.keys(C.CORE_REQUIREMENTS)) assert.ok(real.has(name), `${name} is in the table but is not a tool`);
  const content = catalogue.filter((t) => /^news__/.test(t.name));
  assert.ok(content.length >= 7);
  assert.deepEqual(content.filter((t) => C.requirementOf(t) === undefined).map((t) => t.name), []);
  for (const t of content) assert.equal(C.requirementOf(t).right, /__(publish|unpublish|update_published_meta)$/.test(t.name) ? "core:entries.publish" : "core:entries.edit", t.name);
  // an instance tool named like a core one is NOT looked up in the core table
  assert.equal(C.requirementOf({ name: "site_info", instanceId: "x" }), undefined);
  assert.equal(C.requirementOf({ name: "x__site_info" }), undefined);
  // every level 3 action maps to a requirement
  const { LEVEL3_ACTIONS } = await import("@/core/maintenance/requests");
  for (const action of LEVEL3_ACTIONS) assert.ok(C.requirementOfAction(action), action);
});

test("manifest: mcp[].right is a local right of the module (its own, open or history); another module's right or an unknown id is refused", async () => {
  const { parseManifest } = await import("@/core/modules/manifest");
  const base = { ...JSON.parse(JSON.stringify(blog)), rights: [{ id: "phone.edit", label: { en: "Edit phone numbers" } }] };
  const ok = (right) => parseManifest({ ...base, mcp: [{ name: "phone_set", description: "Sets a number.", right }] });
  for (const right of ["phone.edit", `${base.id}:phone.edit`, "open", "history"]) { const r = ok(right); assert.ok(r.ok, `${right}: ${r.error}`); }
  for (const right of ["other:phone.edit", "unknown.right", "Bad Id", "core:entries.edit"]) assert.equal(ok(right).ok, false, right);
  const none = parseManifest({ ...base, mcp: [{ name: "phone_set", description: "Sets a number." }] });
  assert.ok(none.ok, "right is optional");
});
