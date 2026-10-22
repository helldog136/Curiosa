import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Catalogue des modules, installation et réglages par une IA (outils `maintenance_catalog_*`, `maintenance_module_install`, `maintenance_module_settings|configure[_advanced]`).
// Le catalogue est un vrai dépôt git local (tests/helpers/catalogue.mjs) : le chemin réseau est celui de l'admin, seul le serveur est factice.
const db = await useTestDb();
const cat = createCatalogue();
const T = await import("@/core/services/mcp/tokens");
const A = await import("@/core/services/mcp/access");
const { handleMcpRequest } = await import("@/core/services/mcp/server");
const D = await import("@/core/maintenance/deps");
const M = await import("@/core/maintenance/actions");
const Q = await import("@/core/maintenance/requests");
const S = await import("@/core/maintenance/settings");
const { maintenanceToolProvider } = await import("@/core/maintenance/tools");
const C = await import("@/core/modules/compat");
const { clearRecognizedCache } = await import("@/core/modules/recognized");
const { clearPreviewCache } = await import("@/core/modules/readme");
const { setSetting, getSettingByLocale } = await import("@/core/settings");
const { checkFieldInput } = await import("@/core/modules/settingValues");
const { describeRequest } = await import("../../src/app/admin/(panel)/assistants/requestsShared.ts");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const label = (fr, en) => ({ fr, en });
const field = (key, type, over = {}) => ({ key, type, label: label(`${key} (fr)`, `${key} (en)`), ...over });

/** « atelier » : un module de prise de commandes, avec un peu de tout (types, secret, avancé, groupe facultatif, besoin obligatoire et facultatif). */
const ATELIER = {
  name: label("Atelier", "Workshop"), description: label("Prise de commandes pour illustratrice.", "Order taking for illustrators."), version: "1.2.0", icon: "🎨", author: "Test",
  privacy: label("Garde le nom, l'e-mail et le message des visiteurs.", "Keeps the visitors' name, email and message."),
  permissions: ["routes", "storage", "admin"], page: true, instances: "multiple",
  rights: [{ id: "orders.view", label: label("Voir les commandes", "See orders"), sensitive: true }],
  requires: [{ service: "contact.store", label: label("Carnet d'adresses", "Address book") }, { service: "mail.send", optional: true, label: label("Envoi de courriels", "Sending emails") }],
  sections: [{ id: "cta", label: label("Bouton de commande", "Order button") }],
  settings: [
    field("title", "text", { default: "Mes commandes" }),
    field("slots", "number", { default: 3 }),
    field("mode", "select", { default: "open", options: [{ value: "open", label: label("Ouvert", "Open") }, { value: "closed", label: label("Fermé", "Closed") }] }),
    field("accent", "color"),
    field("shopUrl", "url", { optional: true }),
    field("apiKey", "secret"),
    field("notify", "boolean", { default: false }),
    field("debug", "boolean", { advanced: true }),
    field("endpoint", "text", { advanced: true, optional: true }),
    field("intro", "textarea", { translatable: true, optional: true }),
    field("promoText", "text", { optional: true }),
    field("promoLink", "link", { optional: true }),
  ],
  optionalGroups: [{ id: "promo", label: label("Promotion", "Promotion"), addLabel: label("Ajouter une promotion", "Add a promotion"), fields: ["promoText", "promoLink"], required: ["promoText"] }],
};

async function publish() {
  await cat.add("carnet", { manifest: { name: label("Carnet", "Address book"), description: label("Votre carnet d'adresses.", "Your address book."), instances: "single", offers: [{ service: "contact.store" }] }, entry: { name: "Carnet", description: "Votre carnet d'adresses.", offers: [{ service: "contact.store" }] } });
  await cat.add("courrier", { manifest: { name: label("Courrier", "Mailer"), description: "Envoie des courriels.", offers: [{ service: "mail.send" }] }, entry: { offers: [{ service: "mail.send" }] } });
  await cat.add("atelier", { manifest: ATELIER, entry: { name: "Atelier", description: "Prise de commandes pour illustratrice.", needs: [{ service: "contact.store" }, { service: "mail.send", optional: true }], platform: "boutique" } });
  await cat.add("ancien", { manifest: { name: "Ancien", description: "Demande un Curiosa très récent.", minCore: "9.9.9" }, entry: { requires: { core: "9.9.9" } } });
  await cat.add("solo", { manifest: { name: "Solo", description: "Un seul exemplaire possible.", instances: "single" } });
  await cat.add("orphelin", { manifest: { name: "Orphelin", description: "Exige un service que personne n'offre.", requires: [{ service: "rare.thing" }] }, entry: { needs: [{ service: "rare.thing" }] } });
}

const owner = { email: "owner@example.org", owner: true };
const LIST = async () => maintenanceToolProvider.list();
const rpc = (token, name, args = {}) => handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), LIST);
const listed = async (token) => (await (await handleMcpRequest(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), LIST)).json()).result.tools.map((t) => t.name);
async function call(token, name, args) {
  const body = await (await rpc(token, name, args)).json();
  if (body.error) return { error: body.error.message };
  const text = body.result.content[0].text;
  let value; try { value = JSON.parse(text); } catch { value = text; }
  return body.result.isError ? { error: text } : { value, text };
}
async function maintenanceToken(grant = [], scope = "write", name = "Ma maintenance") {
  const token = await T.createToken(name, scope, "owner@example.org", { grants: { [A.MAINTENANCE_PROFILE]: true, ...Object.fromEntries(grant.map((g) => [`maintenance_${g}`, true])) } });
  return { token, id: await T.findTokenId(token) };
}
const auditRows = (action) => db.prisma.auditLog.findMany({ where: { action: { startsWith: action } }, orderBy: { createdAt: "asc" } });
const SECRET = "S3cretValue-ZZZ-9f8e7d";

beforeEach(async () => {
  await db.reset();
  await cat.clear();
  D.resetMaintenanceDeps();
  M.resetMaintenanceState();
  C.setCoreVersionForTests("0.2.6");
  clearRecognizedCache(); clearPreviewCache();
  // Un site en français, avec l'anglais en plus : les textes du module viennent dans la langue du site, les erreurs dans celle de l'admin.
  await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]);
  await publish();
});
after(() => { C.setCoreVersionForTests(null); cat.close(); return db.close(); });

/** Installe « atelier » pour de bon (demande + approbation) et renvoie la clé de son instance. */
async function installAtelier(args = {}) {
  const { token } = await maintenanceToken(["module_install"]);
  const r = await call(token, "maintenance_module_install", { module: "atelier", ...args });
  assert.equal(r.value?.status, "pending_approval", r.error ?? r.text);
  const done = await M.approveRequest(r.value.requestId, owner);
  assert.equal(done.ok, true, done.message);
  return (await db.prisma.moduleInstance.findFirst({ where: { moduleId: "atelier" } })).key;
}

// ── Lecture du catalogue ───────────────────────────────────────────────────────────────────────────────────────────────────

test("catalog_list : les modules NON installés par défaut, les installés marqués avec include=all ; compat minCore et vérifié dits en mots simples", async () => {
  const { token } = await maintenanceToken();
  const r = (await call(token, "maintenance_catalog_list", {})).value;
  assert.equal(r.catalogue.source, "repository");
  assert.deepEqual(r.items.map((i) => i.id).sort(), ["ancien", "atelier", "carnet", "courrier", "orphelin", "solo"]);
  const atelier = r.items.find((i) => i.id === "atelier");
  assert.equal(atelier.name, "Atelier", "nom dans la langue du site");
  assert.equal(atelier.installable, true);
  assert.equal(atelier.platform, "boutique");
  assert.deepEqual(atelier.needsServices, [{ service: "contact.store", optional: false }, { service: "mail.send", optional: true }]);
  const ancien = r.items.find((i) => i.id === "ancien");
  assert.equal(ancien.installable, false);
  assert.match(ancien.reason, /needs Curiosa 9\.9\.9 or newer.*0\.2\.6/);
  await installAtelier();
  const notInstalled = (await call(token, "maintenance_catalog_list", {})).value;
  assert.ok(!notInstalled.items.some((i) => i.id === "atelier"), "un module installé n'est plus proposé");
  assert.ok(!notInstalled.items.some((i) => i.id === "carnet"), "ni son fournisseur, installé avec lui");
  const all = (await call(token, "maintenance_catalog_list", { include: "all" })).value;
  const marked = all.items.find((i) => i.id === "atelier");
  assert.equal(marked.installed, true);
  assert.equal(marked.installedVersion, "1.2.0");
});

test("catalog_list : recherche (accents, majuscules, tous les mots), filtre plateforme, pagination bornée à 50 et décalage", async () => {
  const { token } = await maintenanceToken();
  const ids = async (args) => (await call(token, "maintenance_catalog_list", args)).value.items.map((i) => i.id);
  assert.deepEqual(await ids({ query: "COMMANDES illustratrice" }), ["atelier"]);
  assert.deepEqual(await ids({ query: "prise de commande" }), ["atelier"]);
  assert.deepEqual(await ids({ query: "courriels" }), ["courrier"]);
  assert.deepEqual(await ids({ query: "inexistant-xyz" }), []);
  assert.deepEqual(await ids({ platform: "boutique" }), ["atelier"]);
  const page1 = (await call(token, "maintenance_catalog_list", { limit: 2 })).value;
  assert.equal(page1.total, 6); assert.equal(page1.returned, 2); assert.equal(page1.nextOffset, 2);
  const page3 = (await call(token, "maintenance_catalog_list", { limit: 2, offset: 4 })).value;
  assert.equal(page3.returned, 2); assert.equal(page3.nextOffset, null);
  assert.notDeepEqual(page1.items.map((i) => i.id), page3.items.map((i) => i.id));
  for (const bad of [{ limit: 51 }, { limit: 0 }, { offset: -1 }, { offset: 301 }, { query: "x".repeat(101) }, { platform: "Bad Name" }, { unknown: 1 }, { include: "nope" }]) {
    assert.ok((await call(token, "maintenance_catalog_list", bad)).error, `refusé : ${JSON.stringify(bad)}`);
  }
  const empty = (await call(token, "maintenance_catalog_list", { query: "inexistant-xyz" })).value;
  assert.match(empty.hint, /Nothing matches/);
});

test("catalog_list : catalogue injoignable → réponse claire (pas d'erreur) ; la dernière copie reçue sert quand le dépôt tombe ; attente bornée (trou noir)", async () => {
  const { token } = await maintenanceToken();
  assert.equal((await call(token, "maintenance_catalog_list", {})).value.catalogue.source, "repository");
  await cat.down();   // la copie reçue reste
  const cached = (await call(token, "maintenance_catalog_list", {})).value;
  assert.equal(cached.catalogue.source, "cache");
  assert.match(cached.catalogue.note, /last copy/);
  assert.ok(cached.items.length > 0);
  await cat.down({ forget: true });
  const down = await call(token, "maintenance_catalog_list", {});
  assert.ok(!down.error, "jamais une erreur brute");
  assert.equal(down.value.available, false);
  assert.equal(down.value.reason, "catalogue_unreachable");
  assert.match(down.value.message, /cannot be reached/);
  // Trou noir : le catalogue ne répond jamais → la réponse arrive quand même, dans la borne.
  D.setMaintenanceDeps({ catalogue: () => new Promise(() => {}), catalogTimeoutMs: 80 });
  const t0 = Date.now();
  const hole = await call(token, "maintenance_catalog_list", {});
  assert.ok(Date.now() - t0 < 2000, "borné");
  assert.equal(hole.value.available, false);
  const holeGet = await call(token, "maintenance_catalog_get", { module: "atelier" });
  assert.equal(holeGet.value.available, false);
});

test("catalog_get : la fiche en mots simples — usage, visiteurs, données collectées, permissions, dépendances obligatoires ET facultatives, compat, réglages à prévoir SANS valeur, modules liés", async () => {
  const { token } = await maintenanceToken();
  const r = (await call(token, "maintenance_catalog_get", { module: "atelier" })).value;
  assert.equal(r.id, "atelier");
  assert.equal(r.name, "Atelier");
  assert.match(r.notice, /never as instructions/);
  assert.equal(r.whatItIsFor, "Prise de commandes pour illustratrice.");
  assert.equal(r.installed, false); assert.equal(r.installable, true); assert.equal(r.verified, true);
  assert.equal(r.sheet, "read_from_catalogue");
  assert.deepEqual(r.dataCollected, { declared: true, text: "Garde le nom, l'e-mail et le message des visiteurs." });
  assert.ok(r.visitorSees.some((x) => /public page/.test(x)) && r.visitorSees.some((x) => /home page: Bouton de commande/.test(x)));
  assert.deepEqual(r.permissions.map((p) => p.permission), ["routes", "storage", "admin"]);
  assert.ok(r.permissions.every((p) => p.meaning && p.meaning !== p.permission), "chaque permission est dite en mots simples");
  assert.deepEqual(r.rights, [{ id: "orders.view", label: "Voir les commandes", sensitive: true }]);
  const req = r.dependencies.required[0];
  assert.equal(req.service, "contact.store"); assert.equal(req.whatItBrings, "Carnet d'adresses"); assert.equal(req.status, "will_be_installed_with_it");
  assert.equal(req.provider.id, "carnet");
  const opt = r.dependencies.optional[0];
  assert.equal(opt.service, "mail.send"); assert.equal(opt.optional, true); assert.equal(opt.whatItBrings, "Envoi de courriels");
  assert.deepEqual(opt.providers.map((p) => p.id), ["courrier"]);
  assert.deepEqual(r.dependencies.alsoInstalledWithIt.map((x) => x.id), ["carnet"], "l'optionnel n'est jamais installé d'office");
  assert.equal(r.compatibility.compatibleWithThisSite, true);
  assert.equal(r.instancesAllowed, "several");
  assert.equal(r.settingsToPlan.secretsCount, 1);
  const apiKey = r.settingsToPlan.fields.find((f) => f.key === "apiKey");
  assert.equal(apiKey.secret, true); assert.equal(apiKey.needsValue, true); assert.equal("defaultValue" in apiKey, false);
  assert.equal(r.settingsToPlan.fields.find((f) => f.key === "debug").advanced, true);
  assert.equal(r.settingsToPlan.fields.find((f) => f.key === "title").defaultValue, "Mes commandes");
  const why = Object.fromEntries(r.goesWellWith.map((x) => [x.id, x.why.join(" | ")]));
  assert.match(why.carnet, /needs this/); assert.match(why.courrier, /optional/);
  assert.ok(!r.goesWellWith.some((x) => x.id === "atelier"));
  assert.match(r.next, /maintenance_module_install/);
});

test("catalog_get : module trop récent pour le site, identifiant inconnu ou mal formé, module sans déclaration de données", async () => {
  const { token } = await maintenanceToken();
  const old = (await call(token, "maintenance_catalog_get", { module: "ancien" })).value;
  assert.equal(old.installable, false);
  assert.equal(old.compatibility.compatibleWithThisSite, false);
  assert.match(old.compatibility.problem, /9\.9\.9/);
  assert.equal(old.dataCollected.declared, false);
  assert.match((await call(token, "maintenance_catalog_get", { module: "nope" })).error, /Unknown module/);
  assert.ok((await call(token, "maintenance_catalog_get", { module: "../etc" })).error);
  assert.ok((await call(token, "maintenance_catalog_get", {})).error);
});

test("catalog_get : un module installé a sa fiche locale (même sans réseau), avec ses instances", async () => {
  const key = await installAtelier();
  await cat.down({ forget: true });
  const { token } = await maintenanceToken();
  const r = (await call(token, "maintenance_catalog_get", { module: "atelier" })).value;
  assert.equal(r.installed, true); assert.equal(r.sheet, "installed");
  assert.deepEqual(r.instances, [{ key }]);
  assert.equal(r.catalogue.source, "unreachable");
});

// ── Installation ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test("install : désactivé par défaut (un jeton Maintenance ne le voit pas), accordé jeton par jeton, jamais pour un jeton en lecture", async () => {
  const plain = await T.createToken("Autre", "write", "o");
  assert.ok(!(await listed(plain)).some((n) => /catalog|module_install|module_settings|module_configure/.test(n)));
  const { token } = await maintenanceToken();
  const names = await listed(token);
  assert.ok(names.includes("maintenance_catalog_list") && names.includes("maintenance_catalog_get"));
  assert.ok(!names.some((n) => /module_install|module_settings|module_configure/.test(n)));
  assert.match((await call(token, "maintenance_module_install", { module: "atelier" })).error, /Unknown tool/);
  const granted = await maintenanceToken(["module_install", "module_settings", "module_configure", "module_configure_advanced"]);
  assert.ok((await listed(granted.token)).includes("maintenance_module_install"));
  const readOnly = await maintenanceToken(["module_install", "module_settings", "module_configure"], "read");
  const seen = await listed(readOnly.token);
  assert.ok(!seen.includes("maintenance_module_install") && !seen.includes("maintenance_module_configure"));
  assert.ok(seen.includes("maintenance_module_settings"), "la lecture des réglages est de la lecture seule");
});

test("install : crée une DEMANDE (rien n'est installé), avec les modules qui viennent avec et les permissions ; l'IA ne peut pas viser un dépôt", async () => {
  const { token } = await maintenanceToken(["module_install"]);
  const r = (await call(token, "maintenance_module_install", { module: "atelier" })).value;
  assert.equal(r.status, "pending_approval");
  assert.match(r.requestId, /^req_/);
  assert.equal(r.plan.module, "atelier"); assert.equal(r.plan.to, "1.2.0"); assert.equal(r.plan.name, "Atelier");
  assert.deepEqual(r.plan.adds, [{ id: "carnet", action: "install", name: "Carnet" }], "les dépendances sont dans la demande, pas installées en cachette");
  assert.deepEqual(r.plan.permissions, ["routes", "storage", "admin"]);
  assert.equal(await db.prisma.module.count(), 0, "rien d'installé avant l'accord");
  assert.equal((await auditRows("mcp.maintenance.request")).length, 1);
  // Un appel identique renvoie la même demande.
  assert.equal((await call(token, "maintenance_module_install", { module: "atelier" })).value.requestId, r.requestId);
  // Phrase pour la propriétaire (français et anglais).
  const request = await Q.getRequest(r.requestId);
  const names = (id) => id;
  const fr = describeRequest(request, makeTranslator("fr"), names), en = describeRequest(request, makeTranslator("en"), names);
  assert.match(fr, /Installer la fonctionnalité « Atelier » \(version 1\.2\.0\).*Carnet.*Elle demande/s);
  assert.match(en, /Install the feature "Atelier" \(version 1\.2\.0\).*Carnet.*It asks for/s);
  for (const arg of [{ module: "atelier", repo: "https://example.org/x" }, { module: "https://example.org/x" }, { module: "../x" }, {}]) assert.ok((await call(token, "maintenance_module_install", arg)).error, JSON.stringify(arg));
});

test("install : même en « exécution directe » pour le jeton, l'installation attend l'accord de la propriétaire", async () => {
  const { token, id } = await maintenanceToken(["module_install", "module_update"]);
  await S.setApprovalMode(id, "direct");
  const r = (await call(token, "maintenance_module_install", { module: "solo" })).value;
  assert.equal(r.status, "pending_approval");
  assert.equal(await db.prisma.module.count(), 0);
});

test("install : approbation → module installé, fournisseur apporté, première instance créée, audit complet, état suivi par request_status", async () => {
  const { token } = await maintenanceToken(["module_install"]);
  const r = (await call(token, "maintenance_module_install", { module: "atelier" })).value;
  assert.equal((await call(token, "maintenance_request_status", { requestId: r.requestId })).value.status, "pending_approval");
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, true);
  assert.match(done.message, /Module "atelier" 1\.2\.0 installed with carnet\. Instance "atelier" is ready/);
  assert.match(done.message, /To fill in: .*apiKey/);
  assert.deepEqual((await db.prisma.module.findMany({ orderBy: { id: "asc" } })).map((m) => m.id), ["atelier", "carnet"]);
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "atelier" } }), 1);
  assert.equal(await db.prisma.moduleInstance.count({ where: { moduleId: "carnet" } }), 1, "le fournisseur a lui aussi son instance");
  const status = (await call(token, "maintenance_request_status", { requestId: r.requestId })).value;
  assert.equal(status.status, "done");
  const actions = (await db.prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => `${a.action} ${a.actor}`);
  for (const wanted of ["mcp.maintenance.request mcp:Ma maintenance", "mcp.maintenance.approve owner@example.org", "module.install.auto mcp:Ma maintenance", "module.install mcp:Ma maintenance", "instance.create mcp:Ma maintenance", "mcp.maintenance.module_install mcp:Ma maintenance"]) {
    assert.ok(actions.includes(wanted), `audit : ${wanted} (reçu : ${actions.join(" ; ")})`);
  }
  assert.ok((await auditRows("mcp.maintenance.module_install"))[0].target.includes("approved"));
  // Déjà installé : refusé, avec la piste « mise à jour ».
  assert.match((await call(token, "maintenance_module_install", { module: "atelier" })).error, /already installed.*maintenance_module_update/);
});

test("install : refuse un module déjà installé, inconnu, incompatible avec ce cœur, dont un fournisseur manque, ou venant de l'index supplémentaire", async () => {
  const { token } = await maintenanceToken(["module_install"]);
  assert.match((await call(token, "maintenance_module_install", { module: "inconnu" })).error, /not in the catalogue/);
  assert.match((await call(token, "maintenance_module_install", { module: "ancien" })).error, /needs Curiosa 9\.9\.9/);
  assert.match((await call(token, "maintenance_module_install", { module: "orphelin" })).error, /rare\.thing/);
  assert.equal(await Q.pendingCount(), 0, "aucune demande inutile");
  // Un manifeste qui exige un cœur plus récent que l'index ne l'annonce est refusé aussi.
  await cat.add("sournois", { manifest: { name: "Sournois", description: "d", minCore: "8.0.0" } });
  assert.match((await call(token, "maintenance_module_install", { module: "sournois" })).error, /needs Curiosa 8\.0\.0/);
  // Un module dont l'identifiant ne correspond pas à son entrée est refusé avant toute demande.
  const bad = await cat.add("vrai", { manifest: { name: "Vrai", description: "d" }, listed: false });
  await cat.setIndex(...JSON.parse(JSON.stringify([{ ...bad, id: "faux" }])));
  assert.match((await call(token, "maintenance_module_install", { module: "faux" })).error, /does not match/);
  // Index supplémentaire : jamais depuis ici.
  process.env.MODULES_INDEX_URL = "https://extra.example.org/index.json";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).startsWith("https://extra.example.org") ? new Response(JSON.stringify([{ id: "tiers", name: "Tiers", description: "Non vérifié", repo: "https://github.com/test/curiosa-extras" }])) : realFetch(url, init);
  try {
    clearRecognizedCache();
    const list = (await call(token, "maintenance_catalog_list", { query: "tiers" })).value;
    assert.equal(list.items[0].verified, false); assert.equal(list.items[0].installable, false);
    assert.match(list.items[0].reason, /only the owner can install it/);
    assert.match((await call(token, "maintenance_module_install", { module: "tiers" })).error, /only the owner can install it/);
  } finally { globalThis.fetch = realFetch; delete process.env.MODULES_INDEX_URL; clearRecognizedCache(); }
});

test("install : instanceKey — valide et libre, refusée pour un module à une seule instance, déjà prise ou mal formée", async () => {
  const { token } = await maintenanceToken(["module_install"]);
  for (const key of ["Bad Key", "x", "1abc", "a".repeat(40), "a_b"]) assert.ok((await call(token, "maintenance_module_install", { module: "atelier", instanceKey: key })).error, key);
  assert.match((await call(token, "maintenance_module_install", { module: "solo", instanceKey: "mon-solo" })).error, /only one instance/);
  const ok = (await call(token, "maintenance_module_install", { module: "atelier", instanceKey: "commandes" })).value;
  assert.equal(ok.plan.instanceKey, "commandes");
  assert.equal((await M.approveRequest(ok.requestId, owner)).ok, true);
  assert.equal((await db.prisma.moduleInstance.findFirst({ where: { moduleId: "atelier" } })).key, "commandes");
  // Une clé déjà prise par une autre instance.
  await db.prisma.module.create({ data: { id: "faux-installe", source: "git", version: "1.0.0", enabled: true } });
  await db.prisma.moduleInstance.create({ data: { moduleId: "faux-installe", key: "pris", showInNav: false, navOrder: 9 } });
  assert.match((await call(token, "maintenance_module_install", { module: "solo", instanceKey: "pris" })).error, /only one instance|already used/);
});

test("install : si le plan change entre la demande et l'accord (nouvelle version), rien n'est fait ; une demande refusée ne s'exécute jamais", async () => {
  const { token } = await maintenanceToken(["module_install"]);
  const r = (await call(token, "maintenance_module_install", { module: "atelier" })).value;
  await cat.add("atelier", { manifest: { ...ATELIER, version: "1.3.0" }, entry: { name: "Atelier", description: "Prise de commandes pour illustratrice.", needs: [{ service: "contact.store" }, { service: "mail.send", optional: true }], platform: "boutique" } });
  clearPreviewCache();
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, false);
  assert.match(done.message, /Not done.*changed since the request/);
  assert.equal(await db.prisma.module.count(), 0);
  const second = (await call(token, "maintenance_module_install", { module: "atelier" })).value;
  assert.equal(second.plan.to, "1.3.0");
  assert.equal((await M.denyRequestBy(second.requestId, owner)).ok, true);
  assert.equal((await M.approveRequest(second.requestId, owner)).ok, false);
  assert.equal(await db.prisma.module.count(), 0);
  assert.equal((await M.approveRequest(r.requestId, { email: "x@example.org", owner: false })).reason, "forbidden");
});

test("install : échec au téléchargement → rien de laissé à moitié, résultat « failed » lisible", async () => {
  const { token } = await maintenanceToken(["module_install"]);
  const r = (await call(token, "maintenance_module_install", { module: "atelier" })).value;
  D.setMaintenanceDeps({ installFromCatalogue: async () => ({ ok: false, error: "modules.error.clone" }) });
  const done = await M.approveRequest(r.requestId, owner);
  assert.equal(done.ok, false);
  assert.match(done.message, /could not be downloaded.*Nothing was left half installed/);
  assert.equal((await call(token, "maintenance_request_status", { requestId: r.requestId })).value.status, "failed");
});

test("quotas : 12 actions par heure et par jeton, comptées aussi pour l'installation et les réglages ; 5 demandes en attente au plus", async () => {
  const { token } = await maintenanceToken(["module_install", "module_configure"]);
  for (let i = 0; i < 12; i++) await call(token, "maintenance_module_configure", { instance: "nulle-part", changes: { a: 1 } });
  assert.match((await call(token, "maintenance_module_configure", { instance: "nulle-part", changes: { a: 1 } })).error, /Too many maintenance actions/);
  assert.match((await call(token, "maintenance_module_install", { module: "atelier" })).error, /Too many maintenance actions/);
  M.resetMaintenanceState();
  const fresh = await maintenanceToken(["module_install"], "write", "Autre jeton");
  for (const id of ["atelier", "carnet", "courrier", "solo"]) assert.equal((await call(fresh.token, "maintenance_module_install", { module: id })).value.status, "pending_approval", id);
});

// ── Réglages ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("module_settings : libellés, aide, type, valeur actuelle, valeurs permises ; un secret ne montre JAMAIS sa valeur ; une adresse perd sa partie privée", async () => {
  const key = await installAtelier();
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key } });
  await setSetting(`instance.${inst.id}.apiKey`, SECRET);
  await setSetting(`instance.${inst.id}.title`, "Commandes ouvertes");
  await setSetting(`instance.${inst.id}.shopUrl`, "https://shop.example.org/page?token=abcdef123456&x=1");
  const { token } = await maintenanceToken(["module_settings"]);
  const res = await call(token, "maintenance_module_settings", { instance: key });
  assert.ok(!res.text.includes(SECRET), "la valeur du secret n'apparaît nulle part");
  assert.ok(!res.text.includes("abcdef123456"), "ni la partie privée d'une adresse");
  const by = Object.fromEntries(res.value.settings.map((s) => [s.key, s]));
  assert.deepEqual([by.apiKey.isSet, by.apiKey.editableByAi, "value" in by.apiKey, "values" in by.apiKey, "default" in by.apiKey], [true, false, false, false, false]);
  assert.match(by.apiKey.howToSet, /admin/);
  assert.equal(by.title.value, "Commandes ouvertes"); assert.equal(by.title.usingDefault, false);
  assert.equal(by.slots.value, null); assert.equal(by.slots.usingDefault, true); assert.equal(by.slots.default, 3);
  assert.equal(by.shopUrl.value, "https://shop.example.org/page (+ hidden part)");
  assert.equal(by.mode.allowed, "one of: open, closed");
  assert.deepEqual(by.mode.options, [{ value: "open", label: "Ouvert" }, { value: "closed", label: "Fermé" }]);
  assert.equal(by.debug.advanced, true); assert.equal(by.debug.editableWith, "maintenance_module_configure_advanced");
  assert.equal(by.title.editableWith, "maintenance_module_configure");
  assert.deepEqual(Object.keys(by.intro.values).sort(), ["en", "fr"]);
  assert.equal(res.value.settings.find((s) => s.key === "title").label, "title (fr)");
  const tabOnly = (await call(token, "maintenance_module_settings", { instance: key, tab: "nope" })).value;
  assert.equal(tabOnly.count, 0);
  assert.match((await call(token, "maintenance_module_settings", { instance: "inconnue" })).error, /Unknown instance/);
  assert.ok((await call(token, "maintenance_module_settings", { instance: "Bad Key!" })).error);
});

test("module_configure : types, bornes, choix ; vider = valeur par défaut ; audit ancien → nouveau ; rien ne bouge si une valeur est fausse (tous les problèmes listés, en français avec un exemple)", async () => {
  const key = await installAtelier();
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key } });
  const get = async (k, locale = "") => (await getSettingByLocale(`instance.${inst.id}.${k}`))[locale];
  const { token } = await maintenanceToken(["module_configure"]);
  const ok = await call(token, "maintenance_module_configure", { instance: key, changes: { title: "Mes illustrations", slots: 5, mode: "closed", accent: "#ff8800", shopUrl: "https://shop.example.org", notify: true } });
  assert.equal(ok.value.status, "saved", ok.error ?? ok.text);
  assert.deepEqual(ok.value.changed.map((c) => c.setting), ["title", "slots", "mode", "accent", "shopUrl", "notify"]);
  assert.deepEqual([await get("title"), await get("slots"), await get("mode"), await get("accent"), await get("notify")], ["Mes illustrations", 5, "closed", "#ff8800", true]);
  assert.ok(ok.value.stillToFill.includes("apiKey"), "le secret reste à saisir par la personne");
  // Idem : rien à faire.
  const again = (await call(token, "maintenance_module_configure", { instance: key, changes: { title: "Mes illustrations" } })).value;
  assert.deepEqual(again.alreadySet, ["title"]);
  // Vider : retour à la valeur par défaut.
  await call(token, "maintenance_module_configure", { instance: key, changes: { title: "", slots: null } });
  assert.equal(await get("title"), undefined); assert.equal(await get("slots"), undefined);
  // Un paquet avec plusieurs erreurs : rien n'est enregistré, tout est listé, en français, avec un exemple.
  const bad = (await call(token, "maintenance_module_configure", { instance: key, changes: { title: "Bonne valeur", slots: "beaucoup", mode: "ajar", accent: "rouge", shopUrl: "ftp://x", notify: "oui", inconnu: 1 } })).value;
  assert.equal(bad.status, "rejected"); assert.equal(bad.saved, false);
  assert.deepEqual(bad.problems.map((p) => p.setting), ["slots", "mode", "accent", "shopUrl", "notify", "inconnu"]);
  assert.match(bad.problems[0].problem, /attend un nombre, par exemple 12/);
  assert.match(bad.problems[1].problem, /open, closed/);
  assert.match(bad.problems[2].problem, /#rrggbb/);
  assert.match(bad.problems[3].problem, /https:\/\//);
  assert.match(bad.problems[4].problem, /true ou false/);
  assert.match(bad.problems[5].problem, /n'est pas un réglage/);
  assert.ok(bad.problems.every((p) => p.label || p.setting === "inconnu"));
  assert.equal(await get("title"), undefined, "« Bonne valeur » n'a pas été enregistrée : le paquet est refusé en bloc");
  // Bornes : texte trop long, nombre hors limites, caractère interdit.
  const limits = (await call(token, "maintenance_module_configure", { instance: key, changes: { title: "x".repeat(5001), slots: 1e15, intro: { fr: "ok" } } })).value;
  assert.equal(limits.status, "rejected");
  assert.match(limits.problems.map((p) => p.problem).join(" "), /trop long.*5000/);
  assert.match(limits.problems.map((p) => p.problem).join(" "), /attend un nombre/);
  assert.ok((await call(token, "maintenance_module_configure", { instance: key, changes: { title: "a\u0000b" } })).value.problems.length);
  // Forme de l'appel : 21 réglages, rien, mauvais type de valeur, argument inconnu.
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1]));
  for (const args of [{ instance: key, changes: many }, { instance: key, changes: {} }, { instance: key, changes: { title: ["a"] } }, { instance: key, changes: { title: { a: { b: 1 } } } }, { instance: key }, { instance: key, changes: { title: "a" }, extra: 1 }, { instance: "Bad!", changes: { title: "a" } }]) {
    assert.ok((await call(token, "maintenance_module_configure", args)).error, JSON.stringify(args).slice(0, 60));
  }
  // Audit : ancien → nouveau, sans secret.
  const rows = await auditRows("mcp.maintenance.module_configure");
  assert.ok(rows.length >= 3);
  assert.match(rows[0].target, /ok \[.*title.*slots.*\] — Saved 6 change\(s\).*title: null → "Mes illustrations"/);
  assert.match(rows.at(-1).target, /^failed/);
});

test("module_configure : un réglage SECRET n'est jamais posé ni lu (refus avec le chemin de l'admin, rien n'est écrit, rien dans l'audit)", async () => {
  const key = await installAtelier();
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key } });
  const { token } = await maintenanceToken(["module_configure", "module_configure_advanced", "module_settings"]);
  for (const tool of ["maintenance_module_configure", "maintenance_module_configure_advanced"]) {
    const r = await call(token, tool, { instance: key, changes: { apiKey: SECRET, title: "Autre" } });
    assert.equal(r.value.status, "rejected");
    assert.ok(!r.text.includes(SECRET), "la valeur proposée n'est pas renvoyée");
    assert.match(r.value.problems[0].problem, /réglage secret.*saisir elle-même dans l'admin \(Extensions › Atelier › Réglages\)/);
  }
  assert.equal((await getSettingByLocale(`instance.${inst.id}.apiKey`))[""], undefined);
  assert.equal((await getSettingByLocale(`instance.${inst.id}.title`))[""], undefined, "rien d'autre n'a été écrit");
  for (const a of await db.prisma.auditLog.findMany()) assert.ok(!`${a.target}${a.actor}`.includes(SECRET), "jamais dans l'audit");
  // Un secret saisi par la personne : « renseigné » seulement, et il survit à une autre modification.
  await setSetting(`instance.${inst.id}.apiKey`, SECRET);
  await call(token, "maintenance_module_configure", { instance: key, changes: { title: "Titre" } });
  assert.equal((await getSettingByLocale(`instance.${inst.id}.apiKey`))[""], SECRET);
  const view = await call(token, "maintenance_module_settings", { instance: key });
  assert.ok(!view.text.includes(SECRET));
  assert.equal(view.value.settings.find((s) => s.key === "apiKey").isSet, true);
  for (const a of await db.prisma.auditLog.findMany()) assert.ok(!`${a.target}${a.actor}`.includes(SECRET));
});

test("module_configure : un réglage AVANCÉ exige l'outil « avancé » que le propriétaire accorde à part", async () => {
  const key = await installAtelier();
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key } });
  const plain = await maintenanceToken(["module_configure"], "write", "Simple");
  const refused = (await call(plain.token, "maintenance_module_configure", { instance: key, changes: { debug: true, title: "T" } })).value;
  assert.equal(refused.status, "rejected");
  assert.match(refused.problems[0].problem, /réglage avancé.*propriétaire doit d'abord vous accorder/);
  assert.equal((await getSettingByLocale(`instance.${inst.id}.title`))[""], undefined, "rien d'enregistré");
  assert.match((await call(plain.token, "maintenance_module_configure_advanced", { instance: key, changes: { debug: true } })).error, /Unknown tool/, "l'outil avancé n'est pas visible sans l'accord");
  const trusted = await maintenanceToken(["module_configure_advanced"], "write", "De confiance");
  const ok = (await call(trusted.token, "maintenance_module_configure_advanced", { instance: key, changes: { debug: true, endpoint: "https://api.example.org/v1", title: "T" } })).value;
  assert.equal(ok.status, "saved");
  assert.equal((await getSettingByLocale(`instance.${inst.id}.debug`))[""], true);
  assert.equal((await auditRows("mcp.maintenance.module_configure_advanced")).length, 1);
});

test("module_configure : réglage traduisible (une valeur par langue), groupe facultatif (champ obligatoire), langue inconnue", async () => {
  const key = await installAtelier();
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key } });
  const { token } = await maintenanceToken(["module_configure"]);
  const one = (await call(token, "maintenance_module_configure", { instance: key, changes: { intro: "Bonjour" } })).value;
  assert.match(one.problems[0].problem, /chaque langue du site.*par exemple/);
  assert.match((await call(token, "maintenance_module_configure", { instance: key, changes: { title: { fr: "a" } } })).value.problems[0].problem, /qu'une seule valeur/);
  assert.match((await call(token, "maintenance_module_configure", { instance: key, changes: { intro: { xx: "a" } } })).value.problems[0].problem, /la langue « xx » n'existe pas/);
  const ok = (await call(token, "maintenance_module_configure", { instance: key, changes: { intro: { fr: "Bonjour", en: "Hello" } } })).value;
  assert.equal(ok.status, "saved");
  assert.equal((await getSettingByLocale(`instance.${inst.id}.intro`)).en, "Hello");
  // Groupe « Promotion » : ouvrir avec le lien seul est refusé (le texte est obligatoire), avec les deux c'est bon, vider tout le groupe aussi.
  const half = (await call(token, "maintenance_module_configure", { instance: key, changes: { promoLink: "/promo" } })).value;
  assert.equal(half.status, "rejected"); assert.match(half.problems[0].problem, /groupe « Promotion » est ouvert/);
  assert.equal((await call(token, "maintenance_module_configure", { instance: key, changes: { promoLink: "/promo", promoText: "-10 %" } })).value.status, "saved");
  assert.equal((await call(token, "maintenance_module_configure", { instance: key, changes: { promoLink: null, promoText: null } })).value.status, "saved");
  assert.match((await call(token, "maintenance_module_configure", { instance: key, changes: { promoText: "x", promoLink: "pas un lien" } })).value.problems[0].problem, /page du site/);
});

test("module_configure : la validation est celle de l'admin (mêmes règles que checkFieldInput pour chaque type)", async () => {
  const key = await installAtelier();
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key } });
  const { token } = await maintenanceToken(["module_configure"]);
  const types = { slots: "number", mode: "select", accent: "color", shopUrl: "url", promoLink: "link" };
  const fieldsByKey = Object.fromEntries(ATELIER.settings.map((f) => [f.key, f]));
  const samples = { slots: ["7", "-3.5", "abc", "1e400", "0"], mode: ["open", "closed", "other"], accent: ["#fff", "#ff8800", "#12345", "red"], shopUrl: ["https://a.b", "http://a.b", "ftp://a.b", "a.b"], promoLink: ["/x", "https://a.b/c", "mailto:a@b.co", "x", "//evil", "javascript:alert(1)"] };
  for (const [k, values] of Object.entries(samples)) {
    for (const v of values) {
      M.resetMaintenanceState();   // une soixantaine d'appels : la cadence de 12 par heure n'est pas l'objet ici
      const admin = checkFieldInput(fieldsByKey[k], v);
      const changes = k === "promoLink" ? { promoText: "t", promoLink: v } : { [k]: v };
      const r = (await call(token, "maintenance_module_configure", { instance: key, changes })).value;
      const accepted = r.status === "saved";
      const expected = admin.ok && !(k === "slots" && !Number.isFinite(Number(v)));
      assert.equal(accepted, expected, `${types[k]} « ${v} » : admin=${admin.ok} outil=${r.status}`);
    }
  }
  assert.equal(inst.moduleId, "atelier");
});

test("module_configure : ne touche ni aux droits, ni aux rôles, ni au nom ou au chemin de l'instance", async () => {
  const key = await installAtelier();
  const before = await db.prisma.moduleInstance.findFirst({ where: { key }, include: { translations: true } });
  const roles = await db.prisma.role.count();
  const { token } = await maintenanceToken(["module_configure_advanced"]);
  for (const k of ["basePath", "name", "roles", "rights", "nickname", "showInNav", "__mcp", "__placement"]) {
    M.resetMaintenanceState();
    const r = await call(token, "maintenance_module_configure_advanced", { instance: key, changes: { [k]: "x" } });
    assert.ok(r.value?.status === "rejected" || /not a setting key/.test(r.error), `${k} : ${r.error}`);   // une clé interne (« __mcp ») est refusée dès la forme de l'appel
  }
  const after = await db.prisma.moduleInstance.findFirst({ where: { key }, include: { translations: true } });
  assert.deepEqual(after, before);
  assert.equal(await db.prisma.role.count(), roles);
  assert.equal(await db.prisma.setting.count({ where: { key: { startsWith: `instance.${before.id}.__` } } }), 0, "aucun réglage interne de l'instance (menu, accès IA, placement) n'a été posé");
});

test("module_configure : sur un site à UNE seule langue, un réglage traduisible accepte une valeur simple", async () => {
  const key = await installAtelier();
  const inst = await db.prisma.moduleInstance.findFirst({ where: { key } });
  await setSetting("i18n.enabled", ["fr"]);
  const { token } = await maintenanceToken(["module_configure"]);
  const r = (await call(token, "maintenance_module_configure", { instance: key, changes: { intro: "Bonjour" } })).value;
  assert.equal(r.status, "saved");
  assert.equal((await getSettingByLocale(`instance.${inst.id}.intro`)).fr, "Bonjour");
});
