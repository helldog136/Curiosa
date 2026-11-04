import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// maintenance_my_access, maintenance_catalog_plan, installing several modules in ONE request, maintenance_instance_add, maintenance_skin_set_options,
// and the description fixes. The catalogue is a real local git repository (tests/helpers/catalogue.mjs).
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const cat = createCatalogue();
const T = await import("@/core/services/mcp/tokens");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools } = await import("@/core/platform");
const D = await import("@/core/maintenance/deps");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const S = await import("@/core/maintenance/settings");
const { RECONNECT_NOTICE } = await import("@/core/maintenance/myAccess");
const C = await import("@/core/modules/compat");
const { clearRecognizedCache } = await import("@/core/modules/recognized");
const { clearPreviewCache } = await import("@/core/modules/readme");
const { setSetting, getSetting } = await import("@/core/settings");
const { describeRequest } = await import("../../src/app/admin/(panel)/assistants/requestsShared.ts");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const label = (fr, en) => ({ fr, en });
const owner = { email: "owner@example.org", owner: true };
const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), listMcpTools);
const listed = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools;
async function call(token, name, args = {}) {
  const body = await (await rpc(token, "tools/call", { name, arguments: args })).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value, text };
}
async function access(grant = [], scope = "write", name = "Camille") {
  const token = await T.createToken(name, scope, "owner@example.org", { grants: { [A.MAINTENANCE_PROFILE]: true, ...Object.fromEntries(grant.map((g) => [`maintenance_${g}`, true])) } });
  return { token, id: await T.findTokenId(token) };
}

beforeEach(async () => {
  await db.reset();
  await cat.clear();
  D.resetMaintenanceDeps();
  M.resetMaintenanceState();
  C.setCoreVersionForTests("0.6.7");
  clearRecognizedCache(); clearPreviewCache();
  await setSetting("i18n.default", "en"); await setSetting("i18n.enabled", ["en", "fr"]);
  await cat.add("carnet", { manifest: { name: label("Carnet", "Address book"), description: label("Votre carnet.", "Your address book."), instances: "single", offers: [{ service: "contact.store" }], privacy: label("Garde les noms.", "Keeps names.") }, entry: { name: "Address book", description: "Your address book.", offers: [{ service: "contact.store" }] } });
  await cat.add("atelier", { manifest: { name: label("Atelier", "Workshop"), description: label("Commandes.", "Orders."), instances: "multiple", page: true, permissions: ["storage", "admin"], requires: [{ service: "contact.store", label: label("Carnet", "Address book") }], settings: [{ key: "title", type: "text", label: label("Titre", "Title"), default: "Orders" }, { key: "apiKey", type: "secret", label: label("Clé", "Key") }] }, entry: { name: "Workshop", description: "Orders.", needs: [{ service: "contact.store" }] } });
  await cat.add("journal", { manifest: { name: label("Journal", "Journal"), description: label("Un journal.", "A journal."), instances: "multiple", page: true, permissions: ["storage"] }, entry: { name: "Journal", description: "A journal." } });
  await cat.add("solo", { manifest: { name: "Solo", description: "One copy only.", instances: "single", page: true } });
  await cat.add("ancien", { manifest: { name: "Ancien", description: "Needs a very recent Curiosa.", minCore: "9.9.9" }, entry: { requires: { core: "9.9.9" } } });
});
after(() => { C.setCoreVersionForTests(null); cat.close(); return db.close(); });

const install = async (modules) => {
  const { token } = await access(["module_install"]);
  const r = await call(token, "maintenance_module_install", { modules });
  assert.equal(r.value?.status, "pending_approval", r.error);
  const done = await M.approveRequest(r.value.requestId, owner);
  assert.equal(done.ok, true, done.message);
};

// ── my_access ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("my_access: granted tools, tools NOT granted with the right to tick, ceiling, approval setting, reconnect notice; no secret", async () => {
  const { token, id } = await access(["module_install", "backup_run"]);
  const r = (await call(token, "maintenance_my_access")).value;
  assert.deepEqual([r.access.name, r.access.ceiling], ["Camille", "write"]);
  assert.equal(r.approvalSetting.value, "ask_first");
  assert.deepEqual(r.approvalSetting.alwaysAskedWhateverTheSetting, ["maintenance_module_install", "maintenance_skin_install", "maintenance_instance_add"]);
  const granted = r.granted.map((g) => g.tool);
  assert.ok(["maintenance_my_access", "maintenance_status", "maintenance_module_install", "maintenance_backup_run"].every((n) => granted.includes(n)));
  assert.ok(!granted.includes("maintenance_font_set") && !granted.includes("maintenance_module_uninstall"));
  const missing = Object.fromEntries(r.notGranted.map((n) => [n.tool, n]));
  assert.equal(missing.maintenance_font_set.why, "box_not_ticked");
  const en = makeTranslator("en");
  assert.equal(missing.maintenance_font_set.rightToTick, en("aim.tool.font_set"), "the same sentence as the rights page");
  assert.equal(missing.maintenance_skin_set_options.kind, "request");
  assert.equal(missing.maintenance_module_uninstall.kind, "destructive");
  assert.ok(!r.notGranted.some((n) => granted.includes(n.tool)));
  assert.equal(r.reconnect, RECONNECT_NOTICE);
  assert.match(r.reconnect, /only appear in your tool list after you reconnect/);
  assert.ok(!JSON.stringify(r).includes(token), "never the access code");
  await S.setApprovalMode(id, "direct");
  assert.equal((await call(token, "maintenance_my_access")).value.approvalSetting.value, "act_without_asking");
});

test("my_access: a read-only access learns that writes are blocked by its ceiling, whatever is ticked; an ordinary access can call it too", async () => {
  const { token } = await access(["backup_run", "module_install"], "read");
  const r = (await call(token, "maintenance_my_access")).value;
  assert.equal(r.access.ceiling, "read");
  const missing = Object.fromEntries(r.notGranted.map((n) => [n.tool, n]));
  assert.equal(missing.maintenance_backup_run.why, "access_is_read_only");
  assert.match(r.access.ceilingMeaning, /Read only/);
  const plain = await T.createToken("Drafts only", "write", "o");
  assert.ok((await listed(plain)).some((t) => t.name === "maintenance_my_access"), "granted by default: an assistant can always find out what it lacks");
  assert.ok((await call(plain, "maintenance_my_access")).value.granted.some((g) => g.tool === "maintenance_my_access"));
});

test("descriptions: catalog_get and skin_list do not promise absent tools and point to my_access; the server says publishing is a separate right", async () => {
  const { token } = await access();
  const tools = await listed(token);
  for (const n of ["maintenance_catalog_get", "maintenance_skin_list", "maintenance_catalog_plan"]) assert.match(tools.find((t) => t.name === n).description, /maintenance_my_access/, n);
  assert.doesNotMatch(tools.find((t) => t.name === "maintenance_skin_list").description, /use maintenance_skin_install or maintenance_skin_activate \(both/);
  const init = await (await rpc(token, "initialize", { protocolVersion: "2025-06-18" })).json();
  assert.match(init.result.instructions, /publishing is a separate right/);
  assert.match(init.result.instructions, /maintenance_my_access/);
  assert.equal(init.result.capabilities.tools.listChanged, false, "the server cannot notify a connected client: the notice says so");
});

// ── catalog_plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("catalog_plan: one answer for several modules: sheets, dependencies that come along, permissions with who asks, personal data, what to configure; the real verdict", async () => {
  const { token } = await access();
  const r = (await call(token, "maintenance_catalog_plan", { modules: ["atelier", "journal", "ancien", "nope-nope"] })).value;
  const by = Object.fromEntries(r.modules.map((m) => [m.id, m]));
  assert.equal(by.atelier.installable, true);
  assert.deepEqual(by.atelier.needs.alsoInstalledWithIt.map((d) => d.id), ["carnet"]);
  assert.deepEqual(by.atelier.toConfigureAfter.secretsTheOwnerTypes.map((s) => s.key), ["apiKey"]);
  assert.equal(by.ancien.installable, false);
  assert.match(by.ancien.reason, /9\.9\.9/);
  assert.equal(by["nope-nope"].known, false);
  assert.equal(r.plan.readyToRequest, true, "the modules that can be installed form a valid request");
  assert.deepEqual(r.plan.alsoInstalledWithThem, [{ id: "carnet", name: "Address book" }]);
  assert.deepEqual(r.plan.permissionsAsked.find((p) => p.permission === "storage").askedBy.sort(), ["atelier", "journal"]);
  assert.match(r.next, /maintenance_module_install \{"modules"/);
  // a plan that cannot be asked says why instead of failing later
  const none = (await call(token, "maintenance_catalog_plan", { modules: ["ancien"] })).value;
  assert.equal(none.plan.readyToRequest, false);
  assert.match((await call(token, "maintenance_catalog_plan", { modules: [] })).error, /missing required argument|at least one/);
  assert.match((await call(token, "maintenance_catalog_plan", { modules: Array.from({ length: 13 }, (_, i) => `m-${i}x`) })).error, /At most 12/);
  assert.equal((await Q.listRequests()).length, 0, "a plan creates nothing");
});

// ── several modules in ONE request ───────────────────────────────────────────────────────────────────────────────────────────

test("module_install {modules}: ONE request the owner approves as a whole; the owner sees every module; it counts as ONE pending request", async () => {
  const { token, id } = await access(["module_install"]);
  await S.setApprovalMode(id, "direct");
  const r = (await call(token, "maintenance_module_install", { modules: ["atelier", "journal"] })).value;
  assert.equal(r.status, "pending_approval", "never installs by itself, even in \"act without asking\"");
  assert.deepEqual(r.plan.bundle.map((b) => b.module), ["atelier", "journal"]);
  assert.equal(await db.prisma.module.count(), 0);
  assert.equal((await Q.listRequests()).filter((x) => x.status === "pending").length, 1, "a bundle counts as one request");
  const text = describeRequest(await Q.getRequest(r.requestId), makeTranslator("en"), (x) => x);
  assert.match(text, /Install 2 features in one go/);
  assert.ok(text.includes("Workshop") && text.includes("Journal") && text.includes("Address book"), "every module and what comes along are written out");
  // the same call returns the waiting request
  assert.equal((await call(token, "maintenance_module_install", { modules: ["atelier", "journal"] })).value.requestId, r.requestId);
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, true, done.message);
  assert.deepEqual((await db.prisma.module.findMany()).map((m) => m.id).sort(), ["atelier", "carnet", "journal"]);
  assert.deepEqual((await db.prisma.moduleInstance.findMany()).map((i) => i.moduleId).sort(), ["atelier", "carnet", "journal"]);
  assert.equal((await Q.getRequest(r.requestId)).status, "done");
});

test("module_install {modules}: one refusal refuses the whole request; module and modules cannot be mixed; 12 at most; a module another one needs goes first", async () => {
  const { token } = await access(["module_install"]);
  const bad = await call(token, "maintenance_module_install", { modules: ["atelier", "ancien"] });
  assert.match(bad.error, /Nothing was asked.*"ancien".*9\.9\.9/);
  assert.equal((await Q.listRequests()).length, 0);
  assert.match((await call(token, "maintenance_module_install", { module: "journal", modules: ["atelier"] })).error, /either "module"/);
  assert.match((await call(token, "maintenance_module_install", { modules: Array.from({ length: 13 }, (_, i) => `mod-${i}x`) })).error, /At most 12/);
  const r = (await call(token, "maintenance_module_install", { modules: ["atelier", "carnet"] })).value;
  assert.deepEqual(r.plan.bundle.map((b) => b.module), ["carnet", "atelier"], "the dependency comes first");
  assert.deepEqual(r.plan.bundle[1].adds, [], "and is no longer listed as coming along with the second");
  assert.equal((await M.approveRequest(r.requestId, owner)).ok, true);
});

test("module_install {modules}: a failure stops the bundle and says what was installed and what was not", async () => {
  const { token } = await access(["module_install"]);
  const r = (await call(token, "maintenance_module_install", { modules: ["journal", "solo"] })).value;
  let n = 0;
  D.setMaintenanceDeps({ installFromCatalogue: async (id) => (++n === 2 ? { ok: false, error: "modules.error.clone" } : (await import("@/core/modules/installer")).installFromCatalogue(id)) });
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, false);
  assert.match(done.message, /Already installed before: journal/);
});

// ── instance_add ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("instance_add: another instance of a module that allows several; ALWAYS waits for the owner; single modules, unknown and taken names are refused", async () => {
  await install(["journal", "solo"]);
  const { token, id } = await access(["instance_add"]);
  await S.setApprovalMode(id, "direct");
  const r = (await call(token, "maintenance_instance_add", { module: "journal", nickname: "News" })).value;
  assert.equal(r.status, "pending_approval", "even in \"act without asking\": a new instance may get a public page");
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "journal" } }), 1);
  assert.match(describeRequest(await Q.getRequest(r.requestId), makeTranslator("en"), (x) => x), /Add another one of the feature "journal", named "News"/);
  assert.equal((await M.approveRequest(r.requestId, owner)).ok, true);
  const rows = await db.prisma.moduleInstance.findMany({ where: { moduleId: "journal" } });
  assert.equal(rows.length, 2);
  assert.ok(rows.some((i) => i.nickname === "News"));
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "instance.create" } })).length >= 2, true);
  assert.match((await call(token, "maintenance_instance_add", { module: "journal", nickname: "news" })).error, /already used/);
  assert.match((await call(token, "maintenance_instance_add", { module: "solo", nickname: "Two" })).error, /allows only one instance/);
  assert.match((await call(token, "maintenance_instance_add", { module: "atelier", nickname: "Two" })).error, /not installed/);
  assert.match((await call(token, "maintenance_instance_add", { module: "journal" })).error, /missing required argument "nickname"/);
});

// ── skin_set_options ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test("skin_set_options: colours within the skin; follows the approval setting; the same keys as the Appearance page; undo stays possible; no secret, no content", async () => {
  const { token, id } = await access(["skin_set_options"]);
  const ask = (await call(token, "maintenance_skin_set_options", { accent: "#2244aa", background: "#101820" })).value;
  assert.equal(ask.status, "pending_approval");
  assert.equal(await getSetting("theme.accent"), undefined, "nothing changes before the approval");
  assert.match(describeRequest(await Q.getRequest(ask.requestId), makeTranslator("en"), (x) => x), /Change the colors and fonts of your site: background #101820, main color #2244aa/);
  const done = await M.approveRequest(ask.requestId, owner);
  assert.equal(done.ok, true, done.message);
  assert.equal(await getSetting("theme.accent"), "#2244aa");
  assert.equal(await getSetting("theme.background"), "#101820");
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "appearance.update" } })).length >= 1, true);
  // direct mode: at once, with readability tips for a text that is hard to read
  await S.setApprovalMode(id, "direct");
  const direct = (await call(token, "maintenance_skin_set_options", { textColor: "#1a2630" })).value;
  assert.equal(direct.status, "done");
  assert.equal(await getSetting("theme.text"), "#1a2630", "saved anyway");
  assert.match(direct.message, /Readability tips/);
  // back to the skin's own value
  assert.equal((await call(token, "maintenance_skin_set_options", { textColor: "" })).value.status, "done");
  assert.equal(await getSetting("theme.text"), undefined);
  // refusals
  assert.match((await call(token, "maintenance_skin_set_options", { accent: "red" })).error, /not a valid colour/);
  assert.match((await call(token, "maintenance_skin_set_options", {})).error, /at least one colour/);
  assert.match((await call(token, "maintenance_skin_set_options", { fontTitles: "lib:does-not-exist" })).error, /not a font of this site/);
  assert.match((await call(token, "maintenance_skin_set_options", { accent: "#2244aa", mode: "light" })).error, /only its dark mode/);
  // a read-only ceiling blocks it
  const ro = await access(["skin_set_options"], "read");
  assert.match((await call(ro.token, "maintenance_skin_set_options", { accent: "#2244aa" })).error, /Unknown tool/);
});

test("skin_set_options: fonts follow the rules of font_set (same values, same advice)", async () => {
  const { token, id } = await access(["skin_set_options"]);
  await S.setApprovalMode(id, "direct");
  const r = (await call(token, "maintenance_skin_set_options", { fontTitles: "sys:serif", accent: "#aa5500" })).value;
  assert.equal(r.status, "done", r.message);
  assert.equal(await getSetting("theme.fontHeading"), "sys:serif");
  assert.equal(await getSetting("theme.accent"), "#aa5500");
});
