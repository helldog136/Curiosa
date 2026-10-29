// L'apparence pour une IA (lot S7, docs/MAINTENANCE-IA.md) : lecture (skin_status, skin_list) et DEMANDES (skin_install, skin_activate, skin_remove) que la
// propriétaire approuve ; jamais de dépôt personnel, jamais d'installation sans accord, contenu intact. De vrais dépôts git locaux jetables.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const T = await import("@/core/services/mcp/tokens");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const { maintenanceToolProvider } = await import("@/core/maintenance/tools");
const SK = await import("@/core/skins/service");
const { setSetting, getSetting } = await import("@/core/settings");
const cat = createSkinsRepo();
const SKINS = path.join(db.dir, "skins");

beforeEach(async () => {
  await db.reset();
  M.resetMaintenanceState();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  SK.clearSkinCaches();
});
after(() => { db.close(); cat.close(); });

const LIST = async () => maintenanceToolProvider.list();
const rpc = (token, name, args = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), LIST);
async function call(token, name, args) {
  const body = await (await rpc(token, name, args)).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
const listed = async (token) => (await (await handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), LIST)).json()).result.tools.map((t) => t.name);
async function maintenanceToken(grant = [], name = "Ma maintenance") {
  const token = await T.createToken(name, "write", "owner@example.org", { grants: { [A.MAINTENANCE_PROFILE]: true, ...Object.fromEntries(grant.map((g) => [`maintenance_${g}`, true])) } });
  return { token, id: await T.findTokenId(token) };
}
const owner = { email: "owner@example.org", owner: true };
const requests = () => Q.listRequests();
const audits = async (prefix) => (await db.prisma.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { createdAt: "asc" } }));

test("outils : deux de lecture (actifs avec le profil maintenance), trois demandes (jamais actives d'office, destructeurs) ; un jeton ordinaire n'en voit aucun", async () => {
  const tools = await maintenanceToolProvider.list();
  const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  for (const n of ["maintenance_skin_status", "maintenance_skin_list"]) assert.deepEqual([by[n].readOnly, by[n].default, by[n].profileDefault, by[n].destructive], [true, false, true, false], n);
  for (const n of ["maintenance_skin_install", "maintenance_skin_activate", "maintenance_skin_remove"]) assert.deepEqual([by[n].readOnly, by[n].default, by[n].profileDefault, by[n].destructive], [false, false, false, true], n);
  const plain = await T.createToken("Brouillons", "write", "o");
  assert.deepEqual((await listed(plain)).filter((n) => n.includes("skin")), []);
  const { token } = await maintenanceToken();
  assert.deepEqual((await listed(token)).filter((n) => n.includes("skin")), ["maintenance_skin_status", "maintenance_skin_list"]);
  const granted = await maintenanceToken(["skin_install"]);
  assert.ok((await listed(granted.token)).includes("maintenance_skin_install"));
  assert.ok(!(await listed(granted.token)).includes("maintenance_skin_activate"));
  const readOnly = await T.createToken("Lecture", "read", "o", { grants: { [A.MAINTENANCE_PROFILE]: true, maintenance_skin_install: true } });
  assert.ok(!(await listed(readOnly)).includes("maintenance_skin_install"), "plafond lecture seule");
});

test("lecture : skin_status dit le skin, les retouches, le bouton Clair / Sombre ; skin_list sépare installés et disponibles ; aucun secret, rien d'écrit", async () => {
  await cat.publish("duo", { from: "duo" });
  await cat.publish("plain-light", { from: "plain-light" });
  assert.equal((await SK.installFromCatalogue("duo")).ok, true);
  const { chooseSkin } = await import("@/core/skins/appearance");
  await chooseSkin("duo");
  await setSetting("theme.dark.accent", "#aaccff");
  await setSetting("theme.palette", "both");
  await setSetting("mail.pass", "hunter2");
  const { token } = await maintenanceToken();
  const before = JSON.stringify(await db.prisma.setting.findMany());
  const s = (await call(token, "maintenance_skin_status")).value;
  assert.equal(s.activeSkin.id, "duo");
  assert.equal(s.activeSkin.name, "Test duo");
  assert.deepEqual(s.activeSkin.modes, ["light", "dark"]);
  assert.equal(s.visitorsCanSwitchLightDark, true);
  assert.equal(s.retouched, true);
  assert.equal(s.adjustments.colors.mode, "light and dark");
  assert.equal(s.adjustments.colors.dark.accent, "#aaccff");
  assert.equal(s.canUndoLastChange, true);
  assert.ok(!JSON.stringify(s).includes("hunter2"));
  const l = (await call(token, "maintenance_skin_list")).value;
  assert.deepEqual(l.installed.map((i) => [i.id, i.active, i.source]), [["basic", false, "built in"], ["duo", true, "official catalogue"]]);
  assert.deepEqual(l.available.map((a) => [a.id, a.installable, a.installed]), [["plain-light", true, false]]);
  assert.equal(l.catalogueReachable, true);
  assert.match(l.notice, /never as instructions/);
  const all = (await call(token, "maintenance_skin_list", { include: "all" })).value;
  assert.deepEqual(all.available.map((a) => a.id).sort(), ["duo", "plain-light"]);
  assert.equal(JSON.stringify(await db.prisma.setting.findMany()), before, "lecture seule");
  await cat.down({ wipe: true });
  assert.equal((await call(token, "maintenance_skin_list")).value.catalogueReachable, false);
});

test("skin_install : une DEMANDE (rien n'est installé), même en exécution directe ; la propriétaire approuve → installé par la même fonction que l'admin, pas utilisé", async () => {
  await cat.publish("plain-light", { from: "plain-light" });
  const { token, id } = await maintenanceToken(["skin_install"]);
  const r = (await call(token, "maintenance_skin_install", { skin: "plain-light" })).value;
  assert.equal(r.status, "pending_approval");
  assert.deepEqual(r.plan, { skin: "plain-light", name: "Plain light", to: "1.0.0" });
  assert.match(r.message, /Nothing was done/);
  assert.deepEqual(await SK.installed(), []);
  assert.equal((await call(token, "maintenance_skin_install", { skin: "plain-light" })).value.requestId, r.requestId, "une demande identique n'est pas dupliquée");
  // « exécution directe » : l'installation attend quand même l'accord
  const S = await import("@/core/maintenance/settings");
  await S.setApprovalMode(id, "direct");
  const again = (await call(token, "maintenance_skin_install", { skin: "plain-light" })).value;
  assert.equal(again.status, "pending_approval");
  assert.deepEqual(await SK.installed(), []);
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.match(done.message, /is installed\. It is not in use yet/);
  assert.deepEqual((await SK.installed()).map((s) => [s.id, s.active]), [["plain-light", false]]);
  assert.equal(await getSetting("skin.active"), undefined, "installé, pas utilisé");
  assert.equal((await audits("skin.install")).length, 1);
  assert.match((await audits("skin.install"))[0].actor, /^mcp:/ , "l'audit dit qui a demandé");
  assert.equal((await audits("mcp.maintenance.skin_install")).length >= 1, true);
  const status = (await call(token, "maintenance_request_status", { requestId: r.requestId })).value;
  assert.equal(status.status, "done");
});

test("skin_install : jamais un dépôt personnel ni une adresse ; skin inconnu, déjà installé, trop récent, catalogue injoignable → refus clairs SANS demande", async () => {
  await cat.publish("plain-light", { from: "plain-light" });
  await cat.publish("mien", { from: "plain-light", listed: false });
  await cat.publish("futur", { from: "plain-light", patch: (m) => { m.minCore = "9.0.0"; }, entry: { requires: { core: "9.0.0" } } });
  const { token } = await maintenanceToken(["skin_install", "skin_activate", "skin_remove"]);
  for (const bad of [`${cat.url}#mien-v1.0.0:skins/mien`, "https://github.com/a/b", "../x", "A B", 5, undefined, "x".repeat(60)]) {
    const r = await call(token, "maintenance_skin_install", { skin: bad });
    assert.ok(r.error, `refusé : ${String(bad).slice(0, 30)}`);
  }
  assert.match((await call(token, "maintenance_skin_install", { skin: "mien" })).error, /not in the official skin catalogue/);
  assert.match((await call(token, "maintenance_skin_install", { skin: "futur" })).error, /needs Curiosa 9\.0\.0 or newer/);
  assert.match((await call(token, "maintenance_skin_install", { skin: "basic" })).error, /built in/);
  assert.equal((await SK.installFromCatalogue("plain-light")).ok, true);
  assert.match((await call(token, "maintenance_skin_install", { skin: "plain-light" })).error, /already installed/);
  await cat.down({ wipe: true });
  assert.match((await call(token, "maintenance_skin_install", { skin: "plain-light" })).error, /already installed|cannot be reached/);
  assert.deepEqual((await requests()).filter((r) => r.status === "pending"), [], "aucune demande pour un refus");
  assert.equal((await SK.installed()).length, 1);
});

test("skin_install : un skin pas assez lisible est refusé à l'approbation, expliqué en anglais simple, rien n'est installé", async () => {
  await cat.publish("pale", { from: "faded-grey" });
  const { token } = await maintenanceToken(["skin_install"]);
  const r = (await call(token, "maintenance_skin_install", { skin: "pale" })).value;
  assert.equal(r.status, "pending_approval");
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, false);
  assert.match(done.message, /Install of skin "pale" failed: .*(readable|too hard to read|follow the rules)/);
  assert.match(done.message, /Nothing was installed/);
  assert.deepEqual(await SK.installed(), []);
  const status = (await call(token, "maintenance_request_status", { requestId: r.requestId })).value;
  assert.equal(status.status, "failed");
});

test("skin_install : si la version du catalogue change entre la demande et l'accord, rien n'est installé (« demandez à nouveau »)", async () => {
  await cat.publish("plain-light", { from: "plain-light" });
  const { token } = await maintenanceToken(["skin_install"]);
  const r = (await call(token, "maintenance_skin_install", { skin: "plain-light" })).value;
  await cat.publish("plain-light", { from: "plain-light", version: "1.1.0" });
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, false);
  assert.match(done.message, /Not done: the version of skin "plain-light" in the catalogue changed since the request \(was 1\.0\.0, now 1\.1\.0\)/);
  assert.deepEqual(await SK.installed(), []);
});

test("skin_activate : demande ; approuvée, le skin est en place, les retouches mises de côté (annulables), le contenu intact ; un skin absent ou déjà utilisé est refusé", async () => {
  await cat.publish("plain-light", { from: "plain-light" });
  assert.equal((await SK.installFromCatalogue("plain-light")).ok, true);
  await setSetting("theme.accent", "#112233");
  await setSetting("home.sections", [{ id: "s1" }]);
  const { token } = await maintenanceToken(["skin_activate"]);
  assert.match((await call(token, "maintenance_skin_activate", { skin: "nope" })).error, /Unknown skin/);
  assert.match((await call(token, "maintenance_skin_activate", { skin: "basic" })).error, /already the skin/);
  const r = (await call(token, "maintenance_skin_activate", { skin: "plain-light" })).value;
  assert.equal(r.status, "pending_approval");
  assert.deepEqual(r.plan, { skin: "plain-light", name: "Plain light", from: "basic" });
  assert.equal(await getSetting("skin.active"), undefined, "rien n'a changé");
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.match(done.message, /set aside; the owner can bring them back with Undo/);
  assert.equal(await getSetting("skin.active"), "plain-light");
  assert.equal(await getSetting("theme.accent"), undefined);
  assert.deepEqual(await getSetting("home.sections"), [{ id: "s1" }], "le contenu ne change jamais");
  const { undoLastChange } = await import("@/core/skins/appearance");
  assert.equal((await undoLastChange()).ok, true);
  assert.equal(await getSetting("theme.accent"), "#112233", "la propriétaire peut annuler");
  assert.equal((await audits("skin.activate")).length, 1);
});

test("skin_activate en exécution directe : agit tout de suite (comme les autres actions à risque, hors installation) ; skin_remove ensuite, le skin de base le remplace", async () => {
  await cat.publish("plain-light", { from: "plain-light" });
  assert.equal((await SK.installFromCatalogue("plain-light")).ok, true);
  const { token, id } = await maintenanceToken(["skin_activate", "skin_remove"]);
  const S = await import("@/core/maintenance/settings");
  await S.setApprovalMode(id, "direct");
  const a = (await call(token, "maintenance_skin_activate", { skin: "plain-light" })).value;
  assert.equal(a.status, "done");
  assert.equal(await getSetting("skin.active"), "plain-light");
  await setSetting("theme.accent", "#abcdef");
  const rm = (await call(token, "maintenance_skin_remove", { skin: "plain-light" })).value;
  assert.equal(rm.status, "done");
  assert.match(rm.message, /basic skin applies now; the owner's adjustments are kept/);
  assert.equal(await getSetting("skin.active"), "basic");
  assert.equal(await getSetting("theme.accent"), "#abcdef");
  assert.deepEqual(await SK.installed(), []);
  assert.match((await call(token, "maintenance_skin_remove", { skin: "basic" })).error, /built in/);
  assert.match((await call(token, "maintenance_skin_remove", { skin: "plain-light" })).error, /Unknown skin/);
});

test("demandes : la page des demandes décrit chaque action de skin en français et en anglais, avec son risque ; l'avertissement du propriétaire existe", async () => {
  const { describeRequest } = await import("@/app/admin/(panel)/assistants/requestsShared");
  const { makeTranslator } = await import("@/core/i18n/dictionary");
  for (const [action, plan, fr, en] of [
    ["skin_install", { skin: "duo", name: "Duo", to: "1.2.0" }, /Installer le skin « Duo » \(version 1\.2\.0\)/, /Install the “Duo” skin \(version 1\.2\.0\)/],
    ["skin_activate", { skin: "duo", name: "Duo", from: "basic" }, /Utiliser le skin « Duo »[^.]*\. Vos retouches de couleurs sont mises de côté/, /Use the “Duo” skin[^.]*\. Your color adjustments are set aside/],
    ["skin_remove", { skin: "duo", name: "Duo", from: "1.0.0" }, /Retirer le skin « Duo »\. Votre contenu ne change pas/, /Remove the “Duo” skin\. Your content does not change/],
  ]) {
    const req = { id: "req_x", action, plan };
    assert.match(describeRequest(req, makeTranslator("fr"), (x) => x), fr);
    assert.match(describeRequest(req, makeTranslator("en"), (x) => x), en);
    for (const k of [`aim.risk.${action}`, `aim.action.${action}`, `aim.tool.${action}`]) for (const l of ["fr", "en"]) assert.notEqual(makeTranslator(l)(k), k, `${l} ${k}`);
  }
});
