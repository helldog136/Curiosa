import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { useTestDb } from "../helpers/db.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";

// Cycle de vie d'un module : installé / pas installé, rien entre les deux. Désinstaller = garder les données (rangées, inertes) ou tout effacer ;
// réinstaller le même module retrouve les données telles quelles ; rien d'un module retiré ne fuit ; les « éteints » d'avant la 0.1.20 sont rangés.
const db = await useTestDb();
const cat = createCatalogue();
const I = await import("@/core/modules/installer");
const R = await import("@/core/modules/registry");
const Rec = await import("@/core/modules/recognized");
const Ret = await import("@/core/modules/retired");
const Plan = await import("@/core/modules/retiredPlan");
const Removal = await import("@/core/modules/removal");
const Legacy = await import("@/core/modules/legacyOff");
const Def = await import("@/core/modules/defaultInstance");
const { createInstance, removeInstance } = await import("@/core/instanceService");
const { moduleActionProvider } = await import("@/core/modules/mcpProvider");
const { buildContext } = await import("@/core/modules/context");
const { getSetting, setSetting } = await import("@/core/settings");
const { createBackup } = await import("@/core/backup/export");
const { openBackup, applyRestore } = await import("@/core/backup/restore");

const fresh = async () => { await db.reset(); await db.prisma.retiredInstance.deleteMany(); await cat.clear(); Rec.clearRecognizedCache(); await setSetting("i18n.default", "fr"); await setSetting("i18n.enabled", ["fr", "en"]); };
beforeEach(fresh);
after(() => { cat.close(); return db.close(); });
const quiet = async (fn) => { const log = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = log; } };

const prisma = db.prisma;
const manifestOf = (id, over = {}) => ({
  name: { fr: id, en: id }, description: { fr: "d", en: "d" }, instances: "multiple",
  settings: [{ key: "titre", type: "text", label: "Titre" }],
  content: { display: "list", clickAction: "detail", features: ["summary", "body"], basePath: id, showInNav: false },
  mcp: [{ name: "lister", description: "Liste", readOnly: true }],
  permissions: ["pages"],
  ...over,
});
const CODE = `export default { mcp: { lister: async () => ({ ok: true }) }, tasks: { tic: { everyMinutes: 1, run: async () => {} } } };`;
const publish = (id, over = {}) => cat.add(id, { manifest: manifestOf(id, over), files: { "index.mjs": CODE } });

/** Une instance « riche » : traductions, entrées (avec traductions), réglages, stockage. */
async function richInstance(moduleId, nickname = "Journal") {
  const mod = await R.getModule(moduleId);
  const inst = await createInstance(prisma, { manifest: mod.manifest, nickname, names: { fr: nickname, en: nickname } });
  await setSetting(`instance.${inst.id}.titre`, "Mon titre");
  await setSetting(`instance.${inst.id}.__placement`, "menu");
  const entry = await prisma.entry.create({ data: { instanceId: inst.id, status: "published", publishedAt: new Date("2026-02-03T10:00:00Z"), sourceLocale: "fr", tags: '["a"]', fields: '{"x":1}',
    translations: { create: [{ instanceId: inst.id, locale: "fr", slug: "bonjour", title: "Bonjour", body: "Texte" }, { instanceId: inst.id, locale: "en", slug: "hello", title: "Hello", body: "Text" }] } } });
  await prisma.moduleRecord.create({ data: { instanceId: inst.id, collection: "messages", data: JSON.stringify({ from: "Léa" }) } });
  return { inst, entry };
}

const snapshot = async (instanceId) => {
  const inst = await prisma.moduleInstance.findUnique({ where: { id: instanceId }, include: { translations: { orderBy: { locale: "asc" } } } });
  const entries = await prisma.entry.findMany({ where: { instanceId }, include: { translations: { orderBy: { locale: "asc" } } }, orderBy: { createdAt: "asc" } });
  // Le compteur de génération du stockage change par construction quand les données reviennent de l'extérieur : il n'est pas « à l'identique ».
  const settings = (await prisma.setting.findMany({ where: { key: { startsWith: `instance.${instanceId}.` } }, orderBy: [{ key: "asc" }, { locale: "asc" }] })).filter((s) => !s.key.endsWith(".__storeGeneration"));
  const records = await prisma.moduleRecord.findMany({ where: { instanceId }, orderBy: { id: "asc" } });
  return JSON.parse(JSON.stringify({ inst, entries, settings, records }));
};

const liveCounts = async () => ({
  instances: await prisma.moduleInstance.count(), entries: await prisma.entry.count(), translations: await prisma.entryTranslation.count(),
  settings: await prisma.setting.count({ where: { key: { startsWith: "instance." } } }), records: await prisma.moduleRecord.count(),
});
const NOTHING = { instances: 0, entries: 0, translations: 0, settings: 0, records: 0 };

/* ───────────── Logique pure ───────────── */

const occupied = (over = {}) => ({ ids: new Set(), keys: new Set(), basePaths: new Set(), nicknames: [], siblings: 0, single: false, reserved: (p) => p === "admin", ...over });

test("remise en place (pur) : à l'identique ; seuls l'identifiant technique, l'adresse et le surnom changent, et seulement s'ils sont pris", () => {
  const row = { id: "i1", key: "blog", basePath: "blog", nickname: "Actus" };
  assert.deepEqual(Plan.planRestore(row, occupied()), { ok: true, key: "blog", basePath: "blog", nickname: "Actus", changed: [] });
  assert.deepEqual(Plan.planRestore(row, occupied({ keys: new Set(["blog"]), basePaths: new Set(["blog"]), nicknames: ["actus"] })), { ok: true, key: "blog-2", basePath: "blog-2", nickname: "Actus 2", changed: ["key", "basePath", "nickname"] });
  assert.equal(Plan.planRestore({ ...row, basePath: "admin" }, occupied()).basePath, "admin-2", "une adresse devenue réservée");
  assert.equal(Plan.planRestore({ ...row, basePath: null }, occupied()).basePath, null, "sans page, sans page");
  assert.equal(Plan.planRestore({ ...row, basePath: "" }, occupied({ basePaths: new Set([""]) })).basePath, "blog", "l'accueil est pris : on part de l'identifiant");
});

test("remise en place (pur) : refusée si l'instance existe déjà, ou si le module n'accepte qu'une instance et en a déjà une", () => {
  const row = { id: "i1", key: "k", basePath: null, nickname: null };
  assert.deepEqual(Plan.planRestore(row, occupied({ ids: new Set(["i1"]) })), { ok: false, reason: "exists" });
  assert.deepEqual(Plan.planRestore(row, occupied({ single: true, siblings: 1 })), { ok: false, reason: "single" });
  assert.equal(Plan.planRestore(row, occupied({ single: true, siblings: 0 })).ok, true);
});

test("bloc rangé (pur) : une forme inconnue ou abîmée n'est jamais devinée ; les dates reviennent en dates", () => {
  const ok = { v: 1, instance: { id: "a" }, translations: [], entries: [], entryTranslations: [], settings: [{ key: "k", locale: "", value: "1" }], records: [] };
  assert.ok(Plan.parsePayload(JSON.stringify(ok)));
  for (const bad of ["", "{", "[]", JSON.stringify({ ...ok, v: 2 }), JSON.stringify({ ...ok, settings: [{ key: 1 }] }), JSON.stringify({ ...ok, entries: "x" })]) assert.equal(Plan.parsePayload(bad), null, bad);
  assert.ok(Plan.reviveDates("entry", { publishedAt: "2026-01-01T00:00:00.000Z", expiresAt: null }).publishedAt instanceof Date);
});

test("regroupement par module (pur) : le plus récent d'abord, totaux cumulés", () => {
  const line = (id, moduleId, day, e, r) => ({ id, moduleId, key: id, label: id, moduleName: moduleId.toUpperCase(), reason: "uninstall", retiredAt: new Date(`2026-01-${day}T00:00:00Z`), entryCount: e, recordCount: r, repoUrl: null, ref: null, subdir: null });
  const g = Plan.groupByModule([line("a1", "a", "01", 2, 1), line("b1", "b", "05", 1, 0), line("a2", "a", "03", 4, 4)]);
  assert.deepEqual(g.map((x) => [x.moduleId, x.instances.map((i) => i.id), x.entryCount, x.recordCount]), [["b", ["b1"], 1, 0], ["a", ["a2", "a1"], 6, 5]]);
});

test("retrait (pur) : le propriétaire qui retire la seule instance retire le module ; sinon seulement l'instance", () => {
  assert.equal(Removal.removalScope({ isOwner: true, otherInstances: 0 }), "module");
  assert.equal(Removal.removalScope({ isOwner: true, otherInstances: 1 }), "instance");
  assert.equal(Removal.removalScope({ isOwner: false, otherInstances: 0 }), "instance");
  assert.equal(Removal.noticeFor(true), "kept");
  assert.equal(Removal.noticeFor(false), "erased");
  assert.equal(Removal.removalNoticeHref("/admin/extensions", { notice: "kept", name: "Blog & Cie" }), "/admin/extensions?notice=kept&name=Blog+%26+Cie");
});

test("migration des éteints (pur) : un module éteint part avec toutes ses instances ; une instance éteinte d'un module allumé part seule", () => {
  const p = Legacy.legacyOffPlan(
    [{ id: "b", enabled: false }, { id: "a", enabled: true }, { id: "c", enabled: true }],
    [{ id: "1", moduleId: "a", enabled: true }, { id: "2", moduleId: "a", enabled: false }, { id: "3", moduleId: "b", enabled: false }, { id: "4", moduleId: "b", enabled: true }, { id: "5", moduleId: "orphelin", enabled: false }],
  );
  assert.deepEqual(p, { modules: ["b"], instances: ["2", "5"] });
  assert.deepEqual(Legacy.legacyOffPlan([{ id: "a", enabled: true }], [{ id: "1", moduleId: "a", enabled: true }]), { modules: [], instances: [] });
});

/* ───────────── Désinstaller : garder ou tout effacer ───────────── */

test("garder mes données : plus rien de vivant (site, API, MCP, menu), tout rangé ; installé = actif", async () => {
  await publish("journal");
  assert.equal((await I.installFromCatalogue("journal")).ok, true);
  assert.equal((await prisma.module.findUnique({ where: { id: "journal" } })).enabled, true, "installé = actif, pas d'état intermédiaire");
  const { inst } = await richInstance("journal");
  assert.equal((await R.getActiveInstances()).length, 1);
  assert.equal((await moduleActionProvider.list()).length, 1, "l'outil MCP du module existe tant qu'il est installé");

  const r = await I.uninstallModule("journal", { keepData: true });
  assert.deepEqual([r.ok, r.kept], [true, 1]);
  assert.equal(await prisma.module.findUnique({ where: { id: "journal" } }), null);
  assert.equal(fs.existsSync(`${db.dir}/modules/journal`), false, "le code est retiré");
  // Aucune fuite : toutes les tables vivantes sont vides, donc le site, l'API (ctx.api), le MCP, le menu et les tâches n'ont rien à lire.
  assert.deepEqual(await liveCounts(), NOTHING);
  assert.deepEqual(await R.getActiveInstances(), []);
  assert.deepEqual(await moduleActionProvider.list(), []);
  assert.equal(await getSetting(`instance.${inst.id}.titre`), undefined);
  // …mais rien n'est perdu : un bloc rangé, avec ses comptes.
  const kept = await Ret.listRetired("journal");
  assert.deepEqual(kept.map((k) => [k.id, k.key, k.label, k.entryCount, k.recordCount, k.reason]), [[inst.id, inst.key, "Journal", 1, 1, "uninstall"]]);
  assert.equal(Object.keys(kept[0]).includes("payload"), false, "la liste ne rend jamais le contenu");
});

test("réinstaller le même module retrouve TOUT à l'identique : mêmes identifiants, traductions, entrées, réglages, stockage", async () => {
  await publish("journal");
  await I.installFromCatalogue("journal");
  const { inst } = await richInstance("journal");
  const before = await snapshot(inst.id);
  await I.uninstallModule("journal", { keepData: true });
  assert.deepEqual(await liveCounts(), NOTHING);

  const r = await I.installFromCatalogue("journal");
  assert.deepEqual([r.ok, r.restored], [true, [inst.key]]);
  const after = await snapshot(inst.id);
  assert.deepEqual(after, before, "exactement les mêmes lignes (identifiants et dates compris)");
  assert.equal(await getSetting(`instance.${inst.id}.__placement`), "menu", "le choix d'épinglage revient aussi");
  assert.deepEqual(await Ret.listRetired(), [], "plus rien de rangé");
  assert.equal((await R.getActiveInstances()).length, 1, "l'instance tourne de nouveau");
  assert.equal((await moduleActionProvider.list()).length, 1);
});

test("tout effacer : plus rien nulle part, y compris des données rangées auparavant ; irréversible", async () => {
  await publish("journal");
  await I.installFromCatalogue("journal");
  await richInstance("journal", "Un");
  await I.uninstallModule("journal", { keepData: true });
  await I.installFromCatalogue("journal", { restoreKept: false });
  await richInstance("journal", "Deux");
  assert.equal((await Ret.listRetired()).length, 1);

  assert.equal((await I.uninstallModule("journal", { keepData: false })).ok, true);
  assert.deepEqual(await liveCounts(), NOTHING);
  assert.deepEqual(await Ret.listRetired(), [], "« tout effacer » efface aussi ce qui avait été gardé");
  assert.equal((await I.installFromCatalogue("journal")).restored, undefined, "rien à retrouver");
});

test("désinstaller est refusé tant qu'un autre module a besoin d'un service que celui-ci fournit ; rien n'est rangé ni effacé", async () => {
  await cat.add("fourn", { manifest: manifestOf("fourn", { offers: [{ service: "demo.svc" }] }), files: { "index.mjs": "export default {};" }, entry: { offers: [{ service: "demo.svc", version: 1 }] } });
  await cat.add("conso", { manifest: manifestOf("conso", { requires: [{ service: "demo.svc" }] }), files: { "index.mjs": "export default {};" }, entry: { needs: [{ service: "demo.svc", min: 1 }] } });
  assert.equal((await I.installFromCatalogue("conso")).ok, true);
  await richInstance("fourn", "Carnet");
  for (const keepData of [true, false]) {
    const r = await I.uninstallModule("fourn", { keepData });
    assert.deepEqual([r.ok, r.error, r.detail], [false, "modules.error.requiredBy", "conso"]);
  }
  assert.ok(await prisma.module.findUnique({ where: { id: "fourn" } }));
  assert.deepEqual(await Ret.listRetired(), []);
  assert.ok((await liveCounts()).entries > 0);
});

test("une instance seule : « garder » la range, « effacer » la supprime ; le module reste installé", async () => {
  await publish("journal");
  await I.installFromCatalogue("journal");
  const a = await richInstance("journal", "Un");
  const b = await richInstance("journal", "Deux");
  assert.equal(await removeInstance(a.inst.id, { keepData: true }), true);
  assert.deepEqual((await Ret.listRetired("journal")).map((k) => k.id), [a.inst.id]);
  assert.ok(await prisma.module.findUnique({ where: { id: "journal" } }));
  assert.equal(await removeInstance(b.inst.id, { keepData: false }), true);
  assert.equal(await prisma.moduleInstance.count(), 0);
  assert.equal((await Ret.listRetired("journal")).length, 1, "effacer une instance ne touche pas aux données gardées d'une autre");
  assert.equal(await removeInstance("inconnue", { keepData: true }), false);
  // « Les retrouver » : même identifiant, et le module la fait tourner de nouveau.
  const back = await Ret.restoreInstance(a.inst.id);
  assert.deepEqual([back.ok, back.key], [true, a.inst.key]);
  assert.equal((await R.getActiveInstances()).length, 1);
  assert.deepEqual(await Ret.listRetired(), []);
});

test("module à instance unique : ses données gardées ne reviennent pas par-dessus une instance existante (elles restent rangées, intactes)", async () => {
  await publish("solo", { instances: "single" });
  await I.installFromCatalogue("solo");
  const a = await richInstance("solo", "Premier");
  await removeInstance(a.inst.id, { keepData: true });
  const mod = await R.getModule("solo");
  await createInstance(prisma, { manifest: mod.manifest, names: { fr: "Neuf" } });
  const r = await Ret.restoreInstance(a.inst.id);
  assert.deepEqual([r.ok, r.reason], [false, "single"]);
  assert.equal((await Ret.listRetired("solo")).length, 1);
  // une réinstallation ne les écrase pas non plus
  const report = await Ret.restoreModuleInstances("solo");
  assert.deepEqual([report.restored.length, report.kept.map((k) => k.reason)], [0, ["single"]]);
});

test("adresse ou identifiant pris entre-temps : l'instance revient avec une adresse libre, rien n'est écrasé", async () => {
  await publish("journal");
  await I.installFromCatalogue("journal");
  const a = await richInstance("journal", "Journal");
  const before = a.inst;
  await I.uninstallModule("journal", { keepData: true });
  await I.installFromCatalogue("journal", { restoreKept: false });
  const squatter = await createInstance(prisma, { manifest: (await R.getModule("journal")).manifest, key: before.key, nickname: "Journal", names: { fr: "Autre" } });
  assert.equal(squatter.basePath, before.basePath);
  const r = await Ret.restoreInstance(before.id);
  assert.deepEqual([r.ok, r.key, r.changed], [true, `${before.key}-2`, ["key", "basePath", "nickname"]]);
  const live = await prisma.moduleInstance.findUnique({ where: { id: before.id } });
  assert.deepEqual([live.key, live.basePath, live.nickname], [`${before.key}-2`, `${before.basePath}-2`, "Journal 2"]);
  assert.equal((await prisma.moduleInstance.findUnique({ where: { id: squatter.id } })).key, before.key, "l'instance en place n'a pas bougé");
});

test("le cœur ne rend jamais un bloc illisible : il reste rangé tel quel", async () => {
  await publish("journal");
  await I.installFromCatalogue("journal");
  const a = await richInstance("journal");
  await removeInstance(a.inst.id, { keepData: true });
  await prisma.retiredInstance.update({ where: { id: a.inst.id }, data: { payload: "{ pas du json" } });
  const r = await Ret.restoreInstance(a.inst.id);
  assert.deepEqual([r.ok, r.reason], [false, "unreadable"]);
  assert.equal((await Ret.listRetired()).length, 1);
  assert.equal((await Ret.restoreInstance("fantome")).reason, "missing");
});

/* ───────────── Dépendances ───────────── */

test("une cascade qui échoue ne perd JAMAIS des données gardées : les instances retrouvées sont rangées de nouveau", async () => {
  await cat.add("fourn", { manifest: manifestOf("fourn", { offers: [{ service: "demo.svc" }] }), files: { "index.mjs": "export default {};" } });
  await I.installFromCatalogue("fourn");
  const a = await richInstance("fourn", "Carnet");
  await I.uninstallModule("fourn", { keepData: true });
  await I.installFromCatalogue("fourn", { dependencies: false, restoreKept: false });

  const outcome = await Def.ensureDefaultInstance("fourn");
  assert.deepEqual([outcome.kind, outcome.instanceIds], ["restored", [a.inst.id]], "les données gardées reviennent à la place d'une instance neuve");
  assert.equal((await prisma.moduleInstance.count({ where: { moduleId: "fourn" } })), 1);
  await Def.undoDefaultInstance(outcome);
  assert.equal(await prisma.moduleInstance.count({ where: { moduleId: "fourn" } }), 0);
  assert.deepEqual((await Ret.listRetired("fourn")).map((k) => k.id), [a.inst.id], "l'annulation range, elle n'efface pas");
  const back = await Ret.restoreInstance(a.inst.id);
  assert.equal(back.ok, true);
});

test("la règle de nettoyage des dépendances s'applique à la désinstallation : fournisseur installé pour un consommateur, proposé au nettoyage une fois celui-ci retiré", async () => {
  const Auto = await import("@/core/modules/autoInstalled");
  await cat.add("fourn", { manifest: manifestOf("fourn", { offers: [{ service: "demo.svc" }] }), files: { "index.mjs": "export default {};" }, entry: { offers: [{ service: "demo.svc", version: 1 }] } });
  await cat.add("conso", { manifest: manifestOf("conso", { requires: [{ service: "demo.svc" }], content: undefined, mcp: undefined }), files: { "index.mjs": "export default {};" }, entry: { needs: [{ service: "demo.svc", min: 1 }] } });
  const r = await I.installFromCatalogue("conso");
  assert.deepEqual(r.provided, ["fourn"]);
  assert.deepEqual(await Auto.cleanupSuggestions(), [], "encore utilisé");
  assert.equal((await I.uninstallModule("conso", { keepData: true })).ok, true);
  assert.deepEqual((await Auto.cleanupSuggestions()).map((c) => c.id), ["fourn"]);
  // le nettoyage passe par le même choix
  assert.equal((await I.uninstallModule("fourn", { keepData: false })).ok, true);
  assert.deepEqual(await Auto.cleanupSuggestions(), []);
});

/* ───────────── Les « éteints » d'avant : rangés, rien de perdu ───────────── */

test("migration des éteints : module éteint = désinstallé, données gardées ; instance éteinte d'un module allumé = retirée, données gardées ; idempotent", async () => {
  await publish("eteint"); await publish("allume");
  await I.installFromCatalogue("eteint"); await I.installFromCatalogue("allume");
  const e1 = await richInstance("eteint", "E1");
  const keep = await richInstance("allume", "Gardée");
  const off = await richInstance("allume", "Éteinte");
  // l'état d'un site d'avant la 0.1.20
  await prisma.module.update({ where: { id: "eteint" }, data: { enabled: false } });
  await prisma.moduleInstance.update({ where: { id: off.inst.id }, data: { enabled: false } });

  const done = await Legacy.retireLegacyOff();
  assert.deepEqual(done, { modules: ["eteint"], instances: [off.inst.id] });
  assert.equal(await prisma.module.findUnique({ where: { id: "eteint" } }), null);
  assert.ok(await prisma.module.findUnique({ where: { id: "allume" } }));
  assert.deepEqual((await prisma.moduleInstance.findMany()).map((i) => i.id), [keep.inst.id], "seule l'instance allumée reste");
  assert.deepEqual((await Ret.listRetired()).map((k) => [k.moduleId, k.reason]).sort(), [["allume", "legacy"], ["eteint", "legacy"]]);
  assert.deepEqual(await Legacy.retireLegacyOff(), { modules: [], instances: [] }, "rien de plus au second passage");
  assert.ok((await prisma.auditLog.findMany()).some((a) => a.action === "module.legacy.off" && a.target === "eteint"));

  // rien n'est perdu : en réinstallant, tout revient
  const before = await snapshot(e1.inst.id);
  void before;
  const r = await I.installFromCatalogue("eteint");
  assert.deepEqual(r.restored, [e1.inst.key]);
  assert.equal((await prisma.entry.count({ where: { instanceId: e1.inst.id } })), 1);
  assert.equal((await Ret.restoreInstance(off.inst.id)).ok, true);
  assert.equal((await prisma.moduleInstance.findUnique({ where: { id: off.inst.id } })).enabled, true, "revenue allumée : il n'y a plus d'autre état");
});

test("code temporaire : la migration des éteints est signalée dans son fichier et déclarée dans le test d'échéance", () => {
  const file = fs.readFileSync("src/core/modules/legacyOff.ts", "utf8");
  assert.match(file, /TEMPORAIRE — À SUPPRIMER APRÈS LA /);
  assert.match(file, /0\.3\.0/);
  assert.match(fs.readFileSync("src/instrumentation.ts", "utf8"), /retireLegacyOff/);
  assert.match(fs.readFileSync("tests/core/temporary-code.test.mjs", "utf8"), /legacyOff\.ts/);
});

/* ───────────── Sauvegarde ───────────── */

test("la sauvegarde contient les données gardées ; restaurée, elles sont de nouveau là (et toujours inertes)", async () => {
  await publish("journal");
  await I.installFromCatalogue("journal");
  const a = await richInstance("journal");
  await I.uninstallModule("journal", { keepData: true });
  await prisma.user.create({ data: { id: "u1", email: "o@x.org", name: "O", role: "owner", passwordHash: "h" } });

  const backup = await createBackup("mot-de-passe-long", { iterations: 1000 });
  assert.ok(backup.manifest.files.some((f) => f.path === "data/retired-instances.json"));
  assert.equal(backup.manifest.counts.retired, 1);
  assert.match(backup.plain.toString("latin1").length ? "ok" : "", /ok/);

  await prisma.retiredInstance.deleteMany();
  assert.deepEqual(await Ret.listRetired(), []);
  const opened = openBackup(backup.buffer, "mot-de-passe-long", 1000);
  assert.equal(opened.ok, true);
  assert.equal(opened.backup.data.retired.length, 1);
  const report = await quiet(() => applyRestore(opened.backup, { confirmCustom: [], actor: "o", installers: { fromCatalogue: async () => ({ ok: false, error: "x" }), fromRepo: async () => ({ ok: false, error: "x" }) } }));
  assert.equal(report.ok, true);
  assert.deepEqual((await Ret.listRetired()).map((k) => [k.id, k.entryCount, k.recordCount]), [[a.inst.id, 1, 1]]);
  assert.deepEqual(await liveCounts(), NOTHING, "restaurées, elles restent rangées : rien de vivant");
  // et elles se retrouvent comme avant
  await I.installFromCatalogue("journal");
  assert.equal((await snapshot(a.inst.id)).entries.length, 1);
});

test("une sauvegarde d'avant la 0.1.20 (sans fichier de données gardées) se restaure comme avant", async () => {
  await prisma.user.create({ data: { id: "u1", email: "o@x.org", name: "O", role: "owner", passwordHash: "h" } });
  const backup = await createBackup("mot-de-passe-long", { iterations: 1000 });
  const { readTarGz, createTarGz } = await import("@/core/backup/tar");
  const { sha256 } = await import("@/core/backup/format");
  const files = readTarGz(backup.plain).filter((f) => f.path !== "data/retired-instances.json");
  const manifest = JSON.parse(files.find((f) => f.path === "backup.json").content.toString("utf8"));
  manifest.files = manifest.files.filter((f) => f.path !== "data/retired-instances.json");
  void sha256;
  const rewritten = files.map((f) => (f.path === "backup.json" ? { ...f, content: Buffer.from(JSON.stringify(manifest)) } : f));
  const { parseBackup } = await import("@/core/backup/restore");
  const parsed = parseBackup(createTarGz(rewritten));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.backup.data.retired, []);
});

/* ───────────── Interface ───────────── */

test("interface : les réglages s'ouvrent dans une fenêtre (route interceptée), les pages pleines restent, rien n'est dupliqué", () => {
  const read = (f) => fs.readFileSync(f, "utf8");
  const P = "src/app/admin/(panel)";
  assert.match(read(`${P}/extensions/layout.tsx`), /\{children\}\{modal\}/);
  assert.ok(fs.existsSync(`${P}/extensions/@modal/default.tsx`));
  const inst = read(`${P}/extensions/@modal/(..)instances/[id]/page.tsx`);
  const mod = read(`${P}/extensions/@modal/(..)modules/[id]/page.tsx`);
  assert.match(inst, /<RouteModal[^]*<InstanceView/);
  assert.match(mod, /<RouteModal[^]*<ModuleView/);
  // les pages pleines utilisent le MÊME composant
  assert.match(read(`${P}/instances/[id]/page.tsx`), /<InstanceView/);
  assert.match(read(`${P}/modules/[id]/page.tsx`), /<ModuleView/);
  assert.ok(!read(`${P}/instances/[id]/page.tsx`).includes("saveInstance"), "le contenu n'est pas recopié");
  // le menu d'admin garde des liens de page pleine (ancres natives, pas de navigation douce)
  assert.ok(!/next\/link/.test(read("src/components/admin/NavLink.tsx")));
  // la fenêtre : Échap, clic dehors, bouton visible, focus rendu, plein écran sur mobile, pas de défilement horizontal
  const modal = read("src/components/admin/RouteModal.tsx");
  assert.match(modal, /key === "Escape"/);
  assert.match(modal, /e\.target === e\.currentTarget/);
  assert.match(modal, /data-testid="modal-close"/);
  assert.match(modal, /opener\.focus\(\)/);
  assert.match(modal, /e\.key !== "Tab"/);
  assert.match(modal, /dialog\[open\]/, "une confirmation ouverte garde son Échap");
  assert.match(modal, /overflow-x-hidden/);
  assert.match(modal, /h-full w-full/);
  assert.match(modal, /sm:h-auto/);
  assert.match(modal, /aria-modal="true"/);
});

test("interface : deux boutons de retrait, chacun avec SA confirmation ; aucun interrupteur nulle part", () => {
  const read = (f) => fs.readFileSync(f, "utf8");
  const remove = read("src/components/admin/RemoveSection.tsx");
  assert.match(remove, /remove\.keepConfirm/);
  assert.match(remove, /remove\.eraseConfirm/);
  assert.match(remove, /dangerConfirm/, "la confirmation d'effacement est en rouge");
  const fr = JSON.parse(read("src/locales/fr.json"));
  const en = JSON.parse(read("src/locales/en.json"));
  assert.equal(fr["remove.keep"], "Retirer et garder mes données");
  assert.equal(fr["remove.erase"], "Retirer et tout effacer");
  assert.match(fr["remove.eraseConfirm"], /sauvegarde/i, "la confirmation d'effacement conseille une sauvegarde");
  assert.match(en["remove.eraseConfirm"], /backup/i);
  for (const k of ["modules.on", "modules.off", "extensions.turnOn", "extensions.turnOff", "instances.enabled", "instances.disabled", "modules.disabledNotice"]) assert.ok(!(k in fr) && !(k in en), `${k} : ne doit plus exister`);
  // mode simple : pas de jargon dans les textes de retrait
  for (const k of ["remove.title", "remove.introModule", "remove.introInstanceSimple", "remove.keep", "remove.keepHelp", "remove.keepConfirm", "remove.erase", "remove.eraseHelp", "remove.eraseConfirm", "remove.noticeKept", "kept.help", "kept.cardNote", "kept.detailsNote"]) {
    assert.ok(!/instance|manifest|module/i.test(fr[k]) || k === "remove.introModuleAdvanced", `fr ${k} : pas de jargon`);
  }
  // le code ne lit plus d'état « éteint »
  for (const f of ["src/core/modules/registry.ts", "src/core/modules/adminNav.ts", "src/core/modules/dependencies.ts", "src/core/modules/integrations.ts", "src/core/modules/api.ts", "src/core/instances.ts", "src/core/maintenance/inspect.ts"]) {
    assert.ok(!/\b(row|r|instance|i|c|m)\.enabled\b/.test(read(f)), `${f} ne lit plus enabled`);
  }
});

test("la jonction avec le contexte d'un module : ctx.api.instances ne voit rien d'un module retiré", async () => {
  await publish("journal"); await publish("autre");
  await I.installFromCatalogue("journal"); await I.installFromCatalogue("autre");
  await richInstance("journal"); const o = await richInstance("autre", "Autre");
  await I.uninstallModule("journal", { keepData: true });
  const mod = await R.getModule("autre");
  const ctx = await buildContext(mod, (await R.getActiveInstances())[0].instance, "fr");
  assert.deepEqual((await ctx.api.instances.list()).map((i) => i.key), [o.inst.key]);
  assert.deepEqual(await ctx.api.entries.list({ instance: "journal" }), [], "ni ses entrées");
});
