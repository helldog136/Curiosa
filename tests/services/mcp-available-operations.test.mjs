import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { useTestDb } from "../helpers/db.mjs";

// maintenance_available_operations (core 0.48.0): every operation of the site with its state for THIS access. The real MCP server, the real tools, the real database.
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const P = await import("@/core/platform");
const M = await import("@/core/maintenance/actions");
const PA = await import("@/core/personalAi/service");
const POL = await import("@/core/personalAi/policy");
const { setApprovalMode } = await import("@/core/maintenance/settings");
const { columnsOf } = await import("@/core/auth/rights");
const Roles = await import("@/core/auth/roles");
const { createInstance } = await import("@/core/instanceService");
const { setSetting } = await import("@/core/settings");
const { FIXTURE_MODULES } = await import("../helpers/fixtureModules.mjs");

const blog = FIXTURE_MODULES.find((b) => b.manifest.id === "blog").manifest;
const PASSWORD = "correct horse 12";
let U;

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
  U = { owner: await mk("etoile_nord", "owner"), admin: await mk("camille", "admin"), editor: await mk("nuage_clair", "editor") };
  await Roles.syncSystemAssignments();
});
after(() => db.close());

const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), P.listMcpTools);
const names = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools.map((t) => t.name);
async function call(token, name, args = {}) {
  const body = await (await rpc(token, "tools/call", { name, arguments: args })).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
const OPS = "maintenance_available_operations";
const flat = (r) => Object.fromEntries(r.modules.flatMap((m) => m.operations.map((o) => [o.tool, o])));
const personal = async (user, profile = "read") => { await POL.setPersonOverride(user.id, "allow"); const made = await PA.createPersonalAccess(user.id, { password: PASSWORD, profile }); assert.equal(made.ok, true, JSON.stringify(made)); return { token: made.code, id: made.id }; };

/** A module tool that declares no `right` and one that declares one (a module not yet updated for owners). */
function withModuleTools(fn) {
  const tool = (name, extra = {}) => ({ name, title: name, description: "A tool.", readOnly: true, default: true, destructive: false, input: { type: "object" }, source: "later_1", instanceId: "i1", moduleId: "later", call: async () => "done", ...extra });
  const provider = { id: "later", list: async () => [tool("later_1__plain"), tool("later_1__write", { readOnly: false, default: false }), tool("later_1__declared", { requires: { right: "core:entries.edit" } })] };
  P.mcpProviders.push(provider);
  return fn().finally(() => P.mcpProviders.splice(P.mcpProviders.indexOf(provider), 1));
}

test("always listed and callable with the smallest access: nothing granted, read only, even when its box was switched off by hand", async () => {
  const token = await T.createToken("lune_douce", "read", "o", { grants: { site_info: false, [OPS]: false, maintenance_my_access: false } });
  const seen = await names(token);
  assert.ok(seen.includes(OPS) && seen.includes("maintenance_my_access"), "always shown");
  const r = (await call(token, OPS)).value;
  assert.ok(r.modules.length > 0 && r.counts.total > 20);
  assert.equal(flat(r).maintenance_my_access.status, "allowed");
  assert.equal(flat(r).maintenance_available_operations.status, "allowed");
  assert.equal(flat(r).maintenance_status.status, "not_granted");
  const tools = (await P.listMcpTools()).find((t) => t.name === OPS);
  assert.deepEqual([tools.readOnly, tools.destructive, tools.request ?? false, tools.default], [true, false, false, true], "read only, never a request, so no approval");
});

test("statuses: allowed, needs approval (a request while the owner asks first), not granted (box not ticked / read only access), above the owner's ceiling", async () => {
  const ed = await personal(U.editor, "read");
  const r = (await call(ed.token, OPS)).value;
  const ops = flat(r);
  assert.equal(ops.news__list_entries.status, "allowed");
  assert.equal(ops.news__create_draft.status, "not_granted", "an editor may edit, but a look-only access has not ticked it");
  assert.equal(ops.news__create_draft.why, "access_is_read_only");
  assert.equal(ops.maintenance_core_update.status, "above_owner_ceiling", "an editor cannot update the core: nobody can grant it to this access");
  assert.equal(ops.maintenance_core_update.why, undefined);
  assert.equal(ops.maintenance_core_update.needs, "core:updates");
  assert.equal(ops.maintenance_status.status, "above_owner_ceiling");
  assert.equal(ops.maintenance_status.needs, "admin");
  assert.equal(ops.maintenance_my_access.needs, "none");
  assert.match(r.modules.find((m) => m.module === "core").howToGrant, /above the owner's ceiling/);
  // an administrator's AI at the "assistant" level
  const ad = await personal(U.admin, "assistant");
  const a = flat((await call(ad.token, OPS)).value);
  assert.equal(a.maintenance_status.status, "allowed");
  assert.equal(a.news__create_draft.status, "allowed");
  assert.equal(a.news__publish.status, "not_granted", "the assistant level does not tick publishing");
  assert.equal(a.maintenance_module_install.status, "above_owner_ceiling", "the reserved right is not an administrator's");
  assert.equal(a.news__publish.kind, "publish");
  assert.equal(a.news__create_draft.kind, "draft");
  assert.equal(a.news__list_entries.kind, "read");
  // needs approval: a granted request, owner asks first (the default); acts without asking when the site policy and the access allow
  const full = await personal(U.owner, "full");
  const o = (await call(full.token, OPS)).value;
  const f = flat(o);
  assert.equal(f.news__publish.status, "needs_approval");
  assert.equal(f.navigation_set.status, "needs_approval");
  assert.equal(f.maintenance_module_install.status, "needs_approval");
  assert.equal(f.news__create_draft.status, "allowed");
  assert.equal(o.access.approvalSetting, "ask_first");
  await setApprovalMode(full.id, "direct");
  assert.equal((await call(full.token, OPS)).value.access.approvalSetting, "ask_first", "a personal access acts without asking only when the site policy allows it");
  await db.prisma.setting.upsert({ where: { key_locale: { key: POL.PERSONAL_POLICY_KEY, locale: "" } }, create: { key: POL.PERSONAL_POLICY_KEY, locale: "", value: JSON.stringify({ enabled: true, allowDirect: true }) }, update: { value: JSON.stringify({ enabled: true, allowDirect: true }) } });
  const d = flat((await call(full.token, OPS)).value);
  assert.equal(d.news__publish.status, "allowed");
  assert.equal(d.maintenance_module_install.status, "needs_approval", "installing code always waits for the owner");
});

test("an independent access (no owner): not granted vs allowed by its boxes, read only ceiling, no ceiling statuses, and the owner is told where to tick", async () => {
  const token = await T.createToken("etoile_nord", "read", "o", { grants: { news__create_draft: true, maintenance_status: true } });
  const r = (await call(token, OPS)).value;
  const ops = flat(r);
  assert.equal(ops.maintenance_status.status, "allowed");
  assert.equal(ops.news__create_draft.status, "not_granted");
  assert.equal(ops.news__create_draft.why, "access_is_read_only");
  assert.equal(ops.maintenance_health.status, "not_granted");
  assert.equal(ops.maintenance_health.why, "box_not_ticked");
  assert.equal(r.counts.above_owner_ceiling, 0, "no owner: no ceiling");
  assert.equal(r.access.personal, undefined);
  const group = r.modules.find((m) => m.module === "core");
  assert.match(group.howToGrant, /Admin > AI assistants/);
  const write = await T.createToken("lune_douce", "write", "o", { grants: {} });
  const w = flat((await call(write, OPS)).value);
  assert.equal(w.news__publish.status, "not_granted");
  assert.equal(w.news__publish.why, "box_not_ticked");
});

test("legacy access with an owner (coarse): undeclared module tools use the admin fallback and are marked as assumed; a new access never gets them (above ceiling, module declares no right)", async () => {
  await withModuleTools(async () => {
    const grants = Object.fromEntries((await P.listMcpToolCatalogue()).map((t) => [t.name, true]));
    const legacy = await T.createToken("Camille", "write", "o", { grants });
    // an access made before owners existed, then given to an administrator by the start-up step: owned, with the coarse ceiling
    await db.prisma.apiToken.updateMany({ data: { ownerId: U.admin.id, coarseCeiling: true } });
    const l = flat((await call(legacy, OPS)).value);
    assert.equal(l.later_1__plain.needs, "admin");
    assert.equal(l.later_1__plain.needsAssumed, true, "marked as the coarse fallback");
    assert.equal(l.later_1__plain.status, "allowed");
    assert.equal(l.later_1__declared.needs, "core:entries.edit");
    assert.equal(l.later_1__declared.needsAssumed, undefined);
    const fresh = await personal(U.owner, "assistant");
    const f = flat((await call(fresh.token, OPS)).value);
    assert.equal(f.later_1__plain.status, "above_owner_ceiling");
    assert.equal(f.later_1__plain.why, "module_declares_no_right");
    assert.equal(f.later_1__plain.needsAssumed, true);
  });
});

test("it follows the live state: a module that is not installed or an instance withdrawn from MCP is not listed", async () => {
  const token = await T.createToken("lune_douce", "write", "o", { grants: {} });
  let r = (await call(token, OPS)).value;
  const group = r.modules.find((m) => m.module === "blog");
  assert.ok(group && group.name && group.name !== "blog", "friendly name of the module");
  assert.ok(group.operations.every((o) => o.tool.startsWith("news__")));
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key: "news" } });
  await setSetting(`instance.${inst.id}.__mcp`, false);
  r = (await call(token, OPS)).value;
  assert.equal(r.modules.find((m) => m.module === "blog"), undefined, "withdrawn from MCP");
  await db.prisma.moduleInstance.delete({ where: { id: inst.id } }).catch(() => {});
  assert.equal(JSON.stringify((await call(token, OPS)).value).includes("news__"), false);
});

test("filters: by module (identifier, instance key, core), by status, limit and offset; a wrong value is refused; counts stay the whole picture", async () => {
  const token = await T.createToken("lune_douce", "write", "o", { grants: { news__create_draft: true } });
  const all = (await call(token, OPS)).value;
  const byModule = (await call(token, OPS, { module: "blog" })).value;
  assert.deepEqual(byModule.modules.map((m) => m.module), ["blog"]);
  assert.equal(JSON.stringify((await call(token, OPS, { module: "news" })).value.modules.map((m) => m.module)), JSON.stringify(["blog"]), "by instance key too");
  const core = (await call(token, OPS, { module: "core" })).value;
  assert.deepEqual(core.modules.map((m) => m.module), ["core"]);
  const granted = (await call(token, OPS, { status: "allowed" })).value;
  assert.ok(Object.values(flat(granted)).every((o) => o.status === "allowed"));
  assert.ok(flat(granted).news__create_draft);
  assert.equal(granted.counts.total, all.counts.total, "counts are not narrowed by the status filter");
  const none = (await call(token, OPS, { module: "ghost" })).value;
  assert.deepEqual(none.modules, []);
  assert.match(none.note, /ghost/);
  const page1 = (await call(token, OPS, { limit: 5 })).value;
  assert.equal(Object.keys(flat(page1)).length, 5);
  assert.equal(page1.truncated.nextOffset, 5);
  const page2 = (await call(token, OPS, { limit: 5, offset: 5 })).value;
  assert.equal(Object.keys(flat(page2)).length, 5);
  assert.deepEqual(Object.keys(flat(page1)).filter((n) => n in flat(page2)), []);
  assert.match((await call(token, OPS, { status: "maybe" })).error, /one of/);
  assert.match((await call(token, OPS, { limit: 1000 })).error, /at most/);
  assert.match((await call(token, OPS, { other: 1 })).error, /unexpected argument/);
});

test("bounded: the default answer is capped, descriptions are one line of 120 characters at most, no schema, no secret", async () => {
  const token = await T.createToken("lune_douce", "write", "o", { grants: {} });
  const raw = (await (await rpc(token, "tools/call", { name: OPS, arguments: {} })).json()).result.content[0].text;
  const r = JSON.parse(raw);
  assert.ok(raw.length < 60_000, `answer is ${raw.length} bytes`);
  const ops = Object.values(flat(r));
  assert.ok(ops.length <= 150);
  for (const o of ops) assert.ok(o.what.length > 0 && o.what.length <= 120 && !o.what.includes("\n"), `${o.tool}: ${o.what}`);
  assert.ok(!/inputSchema|"properties"|vit_|passwordHash/.test(raw));
  assert.equal(Object.keys(flat((await call(token, OPS, { limit: 1 })).value)).length, 1);
});

test("owner ceiling is honoured and follows the owner: a demotion turns an allowed tool into above_owner_ceiling at once", async () => {
  const ad = await personal(U.admin, "assistant");
  assert.equal(flat((await call(ad.token, OPS)).value).maintenance_status.status, "allowed");
  await db.prisma.user.update({ where: { id: U.admin.id }, data: columnsOf("editor") });
  const r = (await call(ad.token, OPS)).value;
  assert.equal(flat(r).maintenance_status.status, "above_owner_ceiling");
  assert.equal(flat(r).maintenance_my_access.status, "allowed");
});

test("sentences: the owner is told where to grant, in the site language (EN and FR in step), and the instructions point to the tool", async () => {
  const ed = await personal(U.editor, "read");
  const en = (await call(ed.token, OPS)).value;
  assert.match(en.modules.find((m) => m.module === "blog").howToGrant, /Admin > Account > My AI accesses/);
  await setSetting("i18n.default", "fr");
  const fr = (await call(ed.token, OPS)).value;
  assert.match(fr.modules.find((m) => m.module === "blog").howToGrant, /Mes accès IA/);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  const init = await (await rpc(ed.token, "initialize", { protocolVersion: "2025-11-25" })).json();
  assert.match(init.result.instructions, /maintenance_available_operations/);
});
