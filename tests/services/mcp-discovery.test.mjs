import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// What an assistant can discover: the tools a module ADDS (maintenance_catalog_get / catalog_plan), the texts in the site language (EN/FR), and
// "has my tool list changed since it was sent?" (reconnectNeeded in maintenance_my_access and maintenance_status).
// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const cat = createCatalogue();
const T = await import("@/core/services/mcp/tokens");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const { listMcpTools } = await import("@/core/platform");
const D = await import("@/core/maintenance/deps");
const M = await import("@/core/maintenance/actions");
const C = await import("@/core/modules/compat");
const { clearRecognizedCache } = await import("@/core/modules/recognized");
const { clearPreviewCache } = await import("@/core/modules/readme");
const { setSetting } = await import("@/core/settings");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const label = (fr, en) => ({ fr, en });
const rpc = (token, method, params = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), listMcpTools);
const listed = async (token) => (await (await rpc(token, "tools/list")).json()).result.tools;
async function call(token, name, args = {}) {
  const body = await (await rpc(token, "tools/call", { name, arguments: args })).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value, text };
}
async function access(grant = [], scope = "write") {
  const token = await T.createToken("Camille", scope, "owner@example.org", { grants: { [A.MAINTENANCE_PROFILE]: true, ...Object.fromEntries(grant.map((g) => [`maintenance_${g}`, true])) } });
  return { token, id: await T.findTokenId(token) };
}
const lang = async (l) => { await setSetting("i18n.default", l); await setSetting("i18n.enabled", ["en", "fr"]); await setSetting("i18n.adminDefault", l); };

beforeEach(async () => {
  await db.reset();
  await cat.clear();
  D.resetMaintenanceDeps();
  M.resetMaintenanceState();
  C.setCoreVersionForTests("0.7.0");
  clearRecognizedCache(); clearPreviewCache();
  await lang("en");
  await cat.add("atelier", {
    manifest: {
      name: label("Atelier", "Workshop"), description: label("Commandes.", "Orders."), instances: "multiple", page: true, permissions: ["storage", "mcp"],
      mcp: [
        { name: "orders_list", description: "List the orders. Read only.", readOnly: true },
        { name: "order_note", description: "Add a note to an order. Nothing else changes.", readOnly: false },
        { name: "order_delete", description: "Delete an order for good.", destructive: true },
        { name: "order_count", description: "Count the orders by state.", readOnly: true },
      ],
      i18n: { fr: { "mcp.orders_list": "Liste les commandes. Lecture seule.", "mcp.order_note": "Ajoute une note à une commande. Rien d'autre ne change.", "mcp.order_delete": "Supprime définitivement une commande." } },
    },
    files: { "index.mjs": "export default { mcp: { orders_list: async () => [], order_note: async () => ({}), order_delete: async () => ({}), order_count: async () => 0 } };\n" },
    entry: { name: "Workshop", description: "Orders." },
  });
});
after(() => { C.setCoreVersionForTests(null); cat.close(); return db.close(); });

test("catalog_get: the tools a module adds (kind, plain sentence, default, right to tick for THIS access) and a sentence ready to tell the owner", async () => {
  const { token } = await access();
  const sheet = (await call(token, "maintenance_catalog_get", { module: "atelier" })).value;
  const byName = Object.fromEntries(sheet.toolsForYourAssistant.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(byName), ["orders_list", "order_note", "order_delete", "order_count"]);
  assert.deepEqual([byName.orders_list.kind, byName.order_note.kind, byName.order_delete.kind], ["read", "write", "destructive"]);
  assert.equal(byName.orders_list.summary, "List the orders.");
  assert.equal(byName.orders_list.grantedByDefault, true);
  assert.equal(byName.order_note.grantedByDefault, false);
  // A maintenance access never has module tools on by default: the owner ticks them, and the right is said in the same words as the rights page.
  assert.equal(byName.orders_list.forYourAccess, "owner_must_tick");
  assert.equal(byName.order_note.rightToTick, "Add a note to an order.");
  assert.match(sheet.toolsForYourAssistantInfo.sayToTheOwner, /You would have to tick/);
  assert.ok(!JSON.stringify(sheet.toolsForYourAssistant).includes("secret"));
});

test("catalog_get: an ordinary access gets the read-only tools at once; a read-only access cannot have the writers", async () => {
  const plain = await T.createToken("Reader", "read", "o");
  const sheet = (await call(plain, "maintenance_catalog_get", { module: "atelier" }).catch(() => ({}))).value;
  // A plain access has no catalogue tool (maintenance tools are off for it): grant it the sheet only.
  assert.equal(sheet, undefined);
  const id = await T.findTokenId(plain);
  await T.saveTokenGrants(id, { maintenance_catalog_get: true });
  const s = (await call(plain, "maintenance_catalog_get", { module: "atelier" })).value;
  const by = Object.fromEntries(s.toolsForYourAssistant.map((x) => [x.name, x]));
  assert.equal(by.orders_list.forYourAccess, "granted_once_installed");
  assert.equal(by.order_note.forYourAccess, "access_is_read_only");
  assert.match(s.toolsForYourAssistantInfo.sayToTheOwner, /Installing "Workshop" would let me: List the orders; Count the orders by state\./);
});

test("French site: the summaries come from the module's French texts; a tool without one is shown in English and reported", async () => {
  await lang("fr");
  const { token } = await access();
  const s = (await call(token, "maintenance_catalog_get", { module: "atelier" })).value;
  const by = Object.fromEntries(s.toolsForYourAssistant.map((x) => [x.name, x]));
  assert.equal(by.orders_list.summary, "Liste les commandes.");
  assert.equal(by.orders_list.textLanguage, undefined);
  assert.equal(by.order_count.summary, "Count the orders by state.");
  assert.equal(by.order_count.textLanguage, "en", "no French text: English, flagged");
  assert.match(s.toolsForYourAssistantInfo.languageGap, /1 de ces outils n'ont pas de texte dans votre langue \(fr\)/);
  assert.match(s.toolsForYourAssistantInfo.note, /Outils que cette extension/);
  assert.match(s.toolsForYourAssistantInfo.sayToTheOwner, /Vous devriez cocher/);
});

test("catalog_plan: each module lists what it adds, and rightsToTick says what the owner would have to tick", async () => {
  const { token } = await access();
  const r = (await call(token, "maintenance_catalog_plan", { modules: ["atelier"] })).value;
  const m = r.modules[0];
  assert.deepEqual(m.addsTools.map((x) => x.name), ["orders_list", "order_note", "order_delete", "order_count"]);
  assert.ok(m.sayToTheOwner);
  assert.deepEqual(r.plan.rightsToTick.map((x) => x.tool), ["orders_list", "order_note", "order_delete", "order_count"]);
});

test("my_access: every sentence follows the site language, EN and FR say the same things, and the English text is the documented one", async () => {
  const { token } = await access(["backup_run"]);
  const en = (await call(token, "maintenance_my_access")).value;
  const tEn = makeTranslator("en");
  assert.equal(en.reconnect, tEn("aim.my.reconnect"));
  assert.equal(en.howToGetMore, tEn("aim.my.howToGetMore"));
  await lang("fr");
  const fr = (await call(token, "maintenance_my_access")).value;
  const tFr = makeTranslator("fr");
  assert.equal(fr.reconnect, tFr("aim.my.reconnect"));
  assert.equal(fr.howToGetMore, tFr("aim.my.howToGetMore"));
  assert.equal(fr.access.ceilingMeaning, tFr("aim.my.ceiling.write"));
  assert.equal(fr.approvalSetting.meaning, tFr("aim.my.approval.ask"));
  assert.equal(fr.hourlyLimits.risky.covers, tFr("aim.my.limits.risky"));
  assert.notEqual(fr.reconnect, en.reconnect);
  // The plain sentence of a tool to tick is the one of the French rights page.
  assert.equal(fr.notGranted.find((n) => n.tool === "maintenance_font_set").rightToTick, tFr("aim.tool.font_set"));
  assert.match(fr.discover, /maintenance_catalog_get/);
});

test("reconnectNeeded: false after the list was sent; true when the owner ticks a right or a module is installed afterwards, with the names and a sentence to tell; false again after a new list", async () => {
  const { token, id } = await access(["backup_run"]);
  // No list sent yet: nothing to compare.
  let r = (await call(token, "maintenance_my_access")).value;
  assert.equal(r.reconnectNeeded, false);
  assert.equal(r.toolsChangedSince, null);
  assert.equal(Object.keys(r)[0], "reconnectNeeded", "the first thing the assistant reads");

  await listed(token); // the client connects
  r = (await call(token, "maintenance_my_access")).value;
  assert.equal(r.reconnectNeeded, false);
  assert.equal(typeof r.toolsChangedSince.listSentAt, "string");
  assert.equal(r.sayToTheUser, undefined);
  assert.equal((await call(token, "maintenance_status")).value.reconnectNeeded, false);

  // The owner ticks a box after the connection.
  const before = await T.getTokenGrants(id);
  await T.saveTokenGrants(id, { ...before.grants, maintenance_font_set: true });
  r = (await call(token, "maintenance_my_access")).value;
  assert.equal(r.reconnectNeeded, true);
  assert.deepEqual(r.toolsChangedSince.added, ["maintenance_font_set"]);
  assert.deepEqual(r.toolsChangedSince.removed, []);
  assert.match(r.sayToTheUser, /My list of tools is out of date.*1 tool added.*reconnect/s);
  const status = (await call(token, "maintenance_status")).value;
  assert.equal(status.reconnectNeeded, true);
  assert.match(status.sayToTheUser, /out of date/, "status stays cheap: the same sentence without the detail");
  assert.equal(status.checkWith, "maintenance_my_access");

  // The same message in French on a French site.
  await lang("fr");
  assert.match((await call(token, "maintenance_my_access")).value.sayToTheUser, /Ma liste d'outils n'est plus à jour.*1 outil ajouté/s);

  // The client fetches its list again: up to date.
  await listed(token);
  r = (await call(token, "maintenance_my_access")).value;
  assert.equal(r.reconnectNeeded, false);

  // Taking a right away is a change too.
  await T.saveTokenGrants(id, { ...before.grants });
  r = (await call(token, "maintenance_my_access")).value;
  assert.deepEqual([r.reconnectNeeded, r.toolsChangedSince.removed], [true, ["maintenance_font_set"]]);
});

test("reconnectNeeded: a right switched on that the ceiling blocks changes no tool: no reconnection asked by my_access", async () => {
  const { token, id } = await access(["backup_run"], "read");
  await listed(token);
  const before = await T.getTokenGrants(id);
  await T.saveTokenGrants(id, { ...before.grants, maintenance_font_set: true });
  assert.equal((await call(token, "maintenance_my_access")).value.reconnectNeeded, false);
});

test("the baseline holds names only and goes with the access when it is revoked", async () => {
  const { token, id } = await access();
  await listed(token);
  const { getSetting } = await import("@/core/settings");
  const seen = await getSetting(`mcp.listSeen.${id}`);
  assert.ok(Array.isArray(seen.names) && seen.names.includes("maintenance_my_access"));
  assert.ok(!JSON.stringify(seen).includes(token));
  await T.revokeToken(id);
  assert.equal(await getSetting(`mcp.listSeen.${id}`), undefined);
});

test("reconnectNeeded: installing a module that adds tools after the list was sent: a default-granted tool is a change, a tool to tick is not (but is listed)", async () => {
  // An ordinary access (not the maintenance profile): the module's read-only tools are on by default.
  const token = await T.createToken("Camille", "write", "owner@example.org", { grants: { maintenance_module_install: true, maintenance_status: true } });
  await listed(token);
  const asked = (await call(token, "maintenance_module_install", { module: "atelier" })).value;
  assert.equal(asked.status, "pending_approval");
  const done = await M.approveRequest(asked.requestId, { email: "owner@example.org", owner: true });
  assert.equal(done.ok, true, done.message);
  const r = (await call(token, "maintenance_my_access")).value;
  assert.equal(r.reconnectNeeded, true);
  assert.deepEqual(r.toolsChangedSince.added.map((n) => n.split("__")[1]), ["order_count", "orders_list"]);
  assert.match(r.sayToTheUser, /2 tools added/);
  assert.ok(r.notGranted.some((n) => n.tool.endsWith("__order_note")), "the writer is listed as not granted, with its right to tick");
  assert.equal((await call(token, "maintenance_status")).value.reconnectNeeded, true);
});

test("reconnectNeeded: the same installation changes nothing for a maintenance access (module tools are off for it) but the new tools are listed to tick", async () => {
  const { token } = await access(["module_install"]);
  await listed(token);
  const asked = (await call(token, "maintenance_module_install", { module: "atelier" })).value;
  assert.equal((await M.approveRequest(asked.requestId, { email: "owner@example.org", owner: true })).ok, true);
  const r = (await call(token, "maintenance_my_access")).value;
  assert.equal(r.reconnectNeeded, false);
  assert.equal(r.notGranted.filter((n) => n.tool.endsWith("__orders_list")).length, 1);
});
