// Les polices pour une IA (docs/POLICES.md, docs/MAINTENANCE-IA.md) : lecture dans skin_status (choix, conseils, ce qui peut être choisi) et DEMANDE font_set que la
// propriétaire approuve ; mêmes écritures que la page Apparence ; les conseils ne bloquent rien ; jamais d'envoi de fichier par une IA.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const T = await import("@/core/services/mcp/tokens");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const { maintenanceToolProvider } = await import("@/core/maintenance/tools");
const U = await import("@/core/fonts/uploads");
const { setSetting, getSetting } = await import("@/core/settings");

beforeEach(async () => { await db.reset(); M.resetMaintenanceState(); });
after(() => db.close());

const rpc = (token, name, args = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), LIST);
async function call(token, name, args) {
  const body = await (await rpc(token, name, args)).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value };
}
async function maintenanceToken(grant = []) {
  const token = await T.createToken("Ma maintenance", "write", "owner@example.org", { grants: { [A.MAINTENANCE_PROFILE]: true, ...Object.fromEntries(grant.map((g) => [`maintenance_${g}`, true])) } });
  return { token, id: await T.findTokenId(token) };
}
const LIST = () => maintenanceToolProvider.list();
const owner = { email: "owner@example.org", owner: true };

test("outil : font_set est une demande (niveau 3), jamais active d'office ; il n'existe aucun outil pour envoyer ou supprimer un fichier de police", async () => {
  const tools = await maintenanceToolProvider.list();
  const t = tools.find((x) => x.name === "maintenance_font_set");
  assert.deepEqual([t.readOnly, t.default, t.profileDefault, t.destructive], [false, false, false, true]);
  assert.deepEqual(tools.map((x) => x.name).filter((n) => /font/.test(n)), ["maintenance_font_set"]);
  assert.match(t.description, /cannot upload a font file/);
  const { token } = await maintenanceToken();
  const listed = async (tk) => (await (await handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), LIST)).json()).result.tools.map((x) => x.name);
  assert.ok(!(await listed(token)).includes("maintenance_font_set"));
  assert.ok((await listed((await maintenanceToken(["font_set"])).token)).includes("maintenance_font_set"));
});

test("lecture : skin_status dit les polices choisies, les conseils et ce qui peut être choisi (bibliothèque par groupe, système, polices envoyées) ; rien n'est écrit", async () => {
  const { token } = await maintenanceToken();
  let s = (await call(token, "maintenance_skin_status")).value;
  assert.deepEqual([s.fonts.titles.choice, s.fonts.text.choice, s.fonts.titles.tips, s.fonts.text.tips], ["skin", "skin", [], []]);
  assert.equal(s.fonts.available.skin.startsWith("skin"), true);
  const names = (g) => s.fonts.available[g].map((f) => f.value);
  assert.deepEqual(names("system"), ["sys:sans", "sys:serif", "sys:mono"]);
  assert.ok(names("sans").includes("lib:inter") && names("serif").includes("lib:bitter") && names("display").includes("lib:bebas-neue") && names("mono").includes("lib:jetbrains-mono") && names("readable").includes("lib:lexend") && names("handwriting").includes("lib:kalam"));
  assert.match(JSON.stringify(s.fonts.available), /Inter/);
  assert.match(s.fonts.howTo, /maintenance_font_set/);
  const f = await U.addUpload({ bytes: fs.readFileSync("fonts/files/kalam-400-latin.woff2"), name: "Ma Police", accepted: true, actor: "o" });
  await setSetting("theme.fontBody", "lib:bebas-neue");
  await setSetting("theme.fontHeading", "up:ma-police");
  s = (await call(token, "maintenance_skin_status")).value;
  assert.deepEqual([s.fonts.text.choice, s.fonts.text.name, s.fonts.titles.choice, s.fonts.titles.name], ["lib:bebas-neue", "Bebas Neue", "up:ma-police", "Ma Police"]);
  assert.equal(s.fonts.text.tips.length, 2, "pas de gras, et faite pour des titres");
  assert.ok(s.fonts.available["uploaded by the owner"].some((x) => x.value === "up:ma-police"));
  assert.equal(f.ok, true);
  assert.doesNotMatch(JSON.stringify(s), /u-[0-9a-f]{16}/, "jamais le nom d'un fichier");
});

test("font_set : une demande (rien ne change) ; approuvée, mêmes écritures que la page ; les conseils reviennent dans la réponse sans rien bloquer ; l'ancien theme.font est retiré", async () => {
  await setSetting("theme.font", "serif");
  const { token } = await maintenanceToken(["font_set"]);
  const r = (await call(token, "maintenance_font_set", { titles: "lib:oswald", text: "lib:pacifico" })).value;
  assert.equal(r.status, "pending_approval");
  assert.deepEqual(r.plan, { fonts: { titles: "lib:oswald", text: "lib:pacifico", names: "titles: Oswald, text: Pacifico" } });
  assert.deepEqual([await getSetting("theme.fontHeading"), await getSetting("theme.fontBody"), await getSetting("theme.font")], [undefined, undefined, "serif"], "rien n'a changé");
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.match(done.message, /Fonts changed \(titles: Oswald, text: Pacifico\)/);
  assert.match(done.message, /Back to the skin/);
  assert.match(done.message, /text: Made for short titles/, "conseil : police d'affiche ou manuscrite pour un long texte");
  assert.match(done.message, /advice only, the fonts are applied/);
  assert.deepEqual([await getSetting("theme.fontHeading"), await getSetting("theme.fontBody"), await getSetting("theme.font")], ["lib:oswald", "lib:pacifico", undefined]);
  assert.equal((await db.prisma.auditLog.findMany({ where: { action: "appearance.update" } })).length, 1);
  // un seul des deux ; « skin » rend la police du skin
  const again = (await call(token, "maintenance_font_set", { text: "skin" })).value;
  assert.equal((await M.approveRequest(again.requestId, owner)).ok, true);
  assert.deepEqual([await getSetting("theme.fontHeading"), await getSetting("theme.fontBody")], ["lib:oswald", undefined]);
  assert.equal((await Q.listRequests()).filter((x) => x.status === "done").length, 2);
});

test("font_set : valeurs refusées SANS demande (rien, inconnue, adresse, injection, déjà en place) ; l'envoi d'un fichier n'est pas possible", async () => {
  const { token } = await maintenanceToken(["font_set"]);
  assert.match((await call(token, "maintenance_font_set", {})).error, /at least one of/);
  for (const bad of ["lib:comic-sans", "up:fantome", "Comic Sans", "https://fonts.googleapis.com/css?family=Lora", "lib:../x", "<script>", "sys:fantasy", 5]) {
    const r = await call(token, "maintenance_font_set", { text: bad });
    assert.ok(r.error, `refusé : ${String(bad)}`);
  }
  assert.ok((await call(token, "maintenance_font_set", { fontFile: "AAAA", text: "lib:inter" })).error, "pas d'autre argument");
  await setSetting("theme.fontBody", "lib:inter");
  assert.match((await call(token, "maintenance_font_set", { text: "lib:inter" })).error, /already in place/);
  assert.match((await call(token, "maintenance_font_set", { titles: "skin" })).error, /already in place/);
  assert.deepEqual((await Q.listRequests()).filter((x) => x.status === "pending"), [], "aucune demande pour un refus");
});

test("font_set : une police retirée entre la demande et l'accord n'est pas appliquée ; en exécution directe l'action est immédiate", async () => {
  const f = await U.addUpload({ bytes: fs.readFileSync("fonts/files/kalam-400-latin.woff2"), accepted: true, actor: "o" });
  const { token } = await maintenanceToken(["font_set"]);
  const r = (await call(token, "maintenance_font_set", { text: "up:kalam" })).value;
  await U.removeUpload(f.font.id, { actor: "o" });
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, false);
  assert.match(done.message, /Not done/);
  assert.equal(await getSetting("theme.fontBody"), undefined);
  const direct = await maintenanceToken(["font_set"]);
  await (await import("@/core/maintenance/settings")).setApprovalMode(direct.id, "direct");
  const now = (await call(direct.token, "maintenance_font_set", { text: "lib:lexend" })).value;
  assert.equal(now.status, "done");
  assert.equal(await getSetting("theme.fontBody"), "lib:lexend");
});
