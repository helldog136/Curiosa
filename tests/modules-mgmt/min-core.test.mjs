import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

const db = await useTestDb();
const { parseManifest } = await import("@/core/modules/manifest");
const C = await import("@/core/modules/compat");
const { sanitizeEntries, clearRecognizedCache } = await import("@/core/modules/recognized");
const { installModule, installFromCatalogue, updateModule, checkForUpdate, setModuleEnabled } = await import("@/core/modules/installer");
const { updateSequentially, collectReport } = await import("@/core/modules/bulkUpdate");
const { getModulesReport, updateModules } = await import("@/core/modules/updateStatus");
const { getCatalogue } = await import("@/core/modules/catalogue");
const { getModule } = await import("@/core/modules/registry");
const Rs = await import("@/core/backup/restore");

const EXTRAS = process.env.CURIOSA_EXTRAS_DIR;
beforeEach(async () => { await db.reset(); C.setCoreVersionForTests("0.1.9"); process.env.CURIOSA_EXTRAS_DIR = EXTRAS; clearRecognizedCache(); });
after(() => { C.setCoreVersionForTests(null); process.env.CURIOSA_EXTRAS_DIR = EXTRAS; return db.close(); });

const base = (over = {}) => ({ apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", ...over });
const manifest = (id, version, minCore) => ({ apiVersion: 2, id, name: id, version, main: "index.mjs", ...(minCore ? { minCore } : {}) });

/* ───────────── Schéma ───────────── */

test("manifeste : minCore valide, absent (aucune exigence) ou au mauvais format (refusé avec un message clair)", () => {
  assert.equal(parseManifest(base({ minCore: "0.1.10" })).manifest.minCore, "0.1.10");
  const none = parseManifest(base());
  assert.equal(none.ok, true);
  assert.equal(none.manifest.minCore, undefined);
  for (const bad of ["0.1", "v0.1.10", "0.1.10-rc.1", "1.x.0", "", 10, { core: "0.1.10" }]) {
    const r = parseManifest(base({ minCore: bad }));
    assert.equal(r.ok, false, `refusé : ${JSON.stringify(bad)}`);
    assert.match(r.error, /minCore/);
  }
  assert.match(parseManifest(base({ minCore: "0.1" })).error, /X\.Y\.Z/);
});

test("manifeste : minCore ne remplace pas `requires` (services) et ne dépend d'aucune comparaison avec le cœur (un module trop exigeant reste lisible)", () => {
  const r = parseManifest(base({ minCore: "99.0.0", requires: [{ service: "contact.store" }] }));
  assert.equal(r.ok, true, "le format seul est vérifié ici : la comparaison se fait à l'installation et à la mise à jour");
});

/* ───────────── Comparaison ───────────── */

test("comparaison : égal, plus récent, plus ancien, versions à deux chiffres, sans exigence", () => {
  const ok = (need, core) => C.isCompatible({ core: need }, core);
  assert.equal(ok("0.1.10", "0.1.10"), true);
  assert.equal(ok("0.1.10", "0.2.0"), true);
  assert.equal(ok("0.1.10", "1.0.0"), true);
  assert.equal(ok("0.1.10", "0.1.9"), false, "0.1.10 est plus récent que 0.1.9 (comparaison de nombres, pas de texte)");
  assert.equal(ok("0.1.9", "0.1.10"), true);
  assert.equal(ok("0.2.0", "0.1.99"), false);
  assert.equal(ok("1.0.0", "0.9.9"), false);
  assert.equal(C.isCompatible(undefined, "0.0.1"), true);
  assert.equal(C.isCompatible({}, "0.0.1"), true);
  assert.equal(C.isCompatible(null, "0.0.1"), true);
});

test("comparaison : la pré-version du cœur est ignorée (0.1.10-rc.1 satisfait 0.1.10) ; une version illisible ne bloque jamais", () => {
  assert.equal(C.isCompatible({ core: "0.1.10" }, "0.1.10-rc.1"), true);
  assert.equal(C.isCompatible({ core: "0.1.10" }, "v0.1.10-rc.3"), true);
  assert.equal(C.isCompatible({ core: "0.1.11" }, "0.1.10-rc.1"), false);
  assert.equal(C.isCompatible({ core: "0.1.10" }, "n'importe quoi"), true);
});

test("describeIncompat : null si compatible, sinon la clé de message et les versions", () => {
  assert.equal(C.describeIncompat({ core: "0.1.10" }, "0.1.10-rc.1"), null);
  assert.equal(C.describeIncompat(undefined, "0.1.9"), null);
  const d = C.describeIncompat({ core: "0.1.10" }, "v0.1.9");
  assert.deepEqual(d, { key: "modules.core.needs", badgeKey: "modules.core.badge", params: { version: "0.1.10", current: "0.1.9" }, needs: "0.1.10" });
  for (const lang of ["fr", "en"]) {
    const dict = JSON.parse(fs.readFileSync(`src/locales/${lang}.json`, "utf8"));
    assert.match(dict[d.key], /\{version\}/);
    assert.match(dict[d.badgeKey], /\{version\}.*\{current\}/);
    assert.ok(dict["modules.error.core"] && dict["updates.modules.incompatLine"]);
  }
});

/* ───────────── Index du catalogue ───────────── */

test("index : une entrée avec requires.core est lue, sans requires elle n'a aucune exigence, un requires mal formé est ignoré (jamais bloquant)", () => {
  const entry = (id, requires) => ({ id, repo: "https://github.com/moi/extras", name: id, ...(requires === undefined ? {} : { requires }) });
  const items = sanitizeEntries({ version: 1, modules: [entry("avec", { core: "0.1.10" }), entry("sans"), entry("mauvais", { core: "dix" }), entry("tableau", ["0.1.10"]), entry("texte", "0.1.10")] });
  const by = Object.fromEntries(items.map((i) => [i.id, i.requires]));
  assert.deepEqual(by, { avec: { core: "0.1.10" }, sans: undefined, mauvais: undefined, tableau: undefined, texte: undefined });
});

function indexRoot(modules) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-idx-"));
  fs.mkdirSync(path.join(root, "catalogue"), { recursive: true });
  fs.writeFileSync(path.join(root, "catalogue", "index.json"), JSON.stringify({ version: 1, modules }));
  process.env.CURIOSA_EXTRAS_DIR = root; clearRecognizedCache();
  return root;
}
const remote = (id, requires) => ({ id, name: id, repo: "https://github.com/moi/extras", subdir: `modules/${id}`, apiVersion: 2, ...(requires ? { requires } : {}) });

test("catalogue : l'index dit SANS télécharger si le module convient à ce cœur", async () => {
  indexRoot([remote("recent", { core: "0.1.10" }), remote("ancien", { core: "0.1.0" }), remote("libre")]);
  const by = Object.fromEntries((await getCatalogue()).map((e) => [e.id, e]));
  assert.equal(by.recent.needsNewerCore, "0.1.10");
  assert.equal(by.ancien.needsNewerCore, undefined);
  assert.equal(by.libre.needsNewerCore, undefined);
  assert.equal(by.recent.compatible, true, "l'API est la bonne : seul le cœur est trop ancien");
  C.setCoreVersionForTests("0.1.10-rc.1");
  assert.equal(Object.fromEntries((await getCatalogue()).map((e) => [e.id, e])).recent.needsNewerCore, undefined);
});

/* ───────────── Installation ───────────── */

test("installation depuis le catalogue : refusée avant tout téléchargement, avec la version demandée", async () => {
  indexRoot([remote("recent", { core: "0.1.10" })]);
  const r = await installFromCatalogue("recent");
  assert.deepEqual(r, { ok: false, error: "modules.error.core", detail: "0.1.10", needsCore: "0.1.10" });
  assert.equal(await db.prisma.module.findUnique({ where: { id: "recent" } }), null);
});

test("installation depuis un dépôt : refusée si le manifeste demande un cœur plus récent, acceptée sinon (et sans exigence)", async () => {
  const exigeant = makeRepo({ "module.json": manifest("exigeant", "1.0.0", "0.1.10"), "index.mjs": "export default {};\n" });
  const r = await installModule(exigeant.url);
  assert.deepEqual(r, { ok: false, error: "modules.error.core", detail: "0.1.10", needsCore: "0.1.10" });
  assert.equal(await db.prisma.module.findUnique({ where: { id: "exigeant" } }), null, "rien n'est installé");
  const libre = makeRepo({ "module.json": manifest("libre", "1.0.0"), "index.mjs": "export default {};\n" });
  assert.equal((await installModule(libre.url)).ok, true);
  C.setCoreVersionForTests("0.1.10-rc.1");
  assert.equal((await installModule(exigeant.url)).ok, true, "une rc du cœur satisfait 0.1.10");
});

/* ───────────── Mise à jour ───────────── */

function releasable(id) {
  const repo = makeRepo({ "module.json": manifest(id, "1.0.0"), "index.mjs": "export default {};\n" });
  repo.g("tag", "v1.0.0");
  repo.release = (v, min) => {
    fs.writeFileSync(`${repo.dir}/module.json`, JSON.stringify(manifest(id, v, min)));
    repo.g("commit", "-qam", `release ${v}`); repo.g("tag", `v${v}`);
  };
  return repo;
}

test("mise à jour refusée : version et fichiers inchangés, message clair ; acceptée dès que le cœur suit", async () => {
  const repo = releasable("alpha");
  assert.equal((await installModule(`${repo.url}#v1.0.0`)).ok, true);
  await setModuleEnabled("alpha", true);
  repo.release("1.1.0", "0.1.10");
  const before = await db.prisma.module.findUnique({ where: { id: "alpha" } });
  const r = await updateModule("alpha");
  assert.deepEqual(r, { ok: false, error: "modules.error.core", detail: "0.1.10", needsCore: "0.1.10" });
  const after = await db.prisma.module.findUnique({ where: { id: "alpha" } });
  assert.equal(after.version, "1.0.0"); assert.equal(after.commit, before.commit); assert.equal(after.enabled, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(db.dir, "modules", "alpha", "module.json"), "utf8")).version, "1.0.0");
  C.setCoreVersionForTests("0.1.10");
  assert.equal((await updateModule("alpha")).ok, true);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "alpha" } })).version, "1.1.0");
});

test("mise à jour d'un module logé dans un dossier : refusée sans toucher aux fichiers, et la vérification le dit", async () => {
  const mk = (v, min) => ({ "modules/sub/module.json": manifest("sub", v, min), "modules/sub/index.mjs": "export default {};\n" });
  const repo = makeRepo(mk("1.0.0"));
  assert.equal((await installModule(`${repo.url}#:modules/sub`)).ok, true);
  for (const [f, c] of Object.entries(mk("1.1.0", "0.1.10"))) fs.writeFileSync(`${repo.dir}/${f}`, JSON.stringify(c));
  repo.g("commit", "-qam", "1.1.0");
  const check = await checkForUpdate("sub");
  assert.equal(check.available, true); assert.equal(check.needsCore, "0.1.10");
  assert.equal((await updateModule("sub")).needsCore, "0.1.10");
  assert.equal((await db.prisma.module.findUnique({ where: { id: "sub" } })).version, "1.0.0");
});

/* ───────────── « Tout mettre à jour » ───────────── */

test("bilan en bloc : le module incompatible est SAUTÉ et listé (pas un échec), les autres sont mis à jour", async () => {
  const s = await updateSequentially(["a", "b", "c"], async (id) => (id === "b" ? { ok: false, error: "modules.error.core", needsCore: "0.1.10" } : { ok: true }));
  assert.deepEqual(s.updated, ["a", "c"]);
  assert.deepEqual(s.failed, []);
  assert.deepEqual(s.incompatible, [{ id: "b", core: "0.1.10" }]);
  assert.equal(s.stoppedOn, null);
  const none = await updateSequentially(["a"], async () => ({ ok: true }));
  assert.equal(none.incompatible, undefined);
});

test("rapport des mises à jour : la version proposée qui demande un cœur plus récent est marquée", async () => {
  const r = await collectReport([{ id: "a", version: "1.0.0" }, { id: "b", version: "1.0.0" }], async (id) => ({ check: { available: true, target: "v1.1.0", level: "minor", ...(id === "b" ? { needsCore: "0.1.10" } : {}) }, failed: false }), () => 1);
  assert.deepEqual(r.outdated.map((o) => [o.id, o.needsCore]), [["a", undefined], ["b", "0.1.10"]]);
});

test("de bout en bout : « Tout mettre à jour » saute le module incompatible, met à jour l'autre, et le premier garde sa version", async () => {
  const a = releasable("alpha"), b = releasable("beta");
  for (const r of [a, b]) assert.equal((await installModule(`${r.url}#v1.0.0`)).ok, true);
  a.release("1.1.0", "0.1.10"); b.release("1.1.0");
  const report = await getModulesReport(true);
  assert.deepEqual(report.outdated.map((o) => o.id), ["alpha", "beta"]);
  const s = await updateModules(["alpha", "beta"]);
  assert.deepEqual(s.updated, ["beta"]); assert.deepEqual(s.failed, []); assert.deepEqual(s.incompatible, [{ id: "alpha", core: "0.1.10" }]);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "alpha" } })).version, "1.0.0");
});

/* ───────────── Module déjà installé ───────────── */

test("un module déjà installé et activé n'est jamais désactivé ni cassé, même si son manifeste demande un cœur plus récent que le nôtre", async () => {
  const repo = makeRepo({ "module.json": manifest("deja", "1.0.0", "0.1.0"), "index.mjs": "export default {};\n" });
  assert.equal((await installModule(repo.url)).ok, true);
  await setModuleEnabled("deja", true);
  C.setCoreVersionForTests("0.0.5");   // le cœur « recule » : le module reste chargé tel quel
  const mod = await getModule("deja");
  assert.ok(mod, "chargé");
  assert.equal(mod.manifest.minCore, "0.1.0");
  assert.equal((await db.prisma.module.findUnique({ where: { id: "deja" } })).enabled, true);
  assert.equal((await setModuleEnabled("deja", true)).ok, true, "même l'activation ne regarde pas ce champ");
});

/* ───────────── Restauration ───────────── */

const fakeBackup = (modules) => ({ manifest: { createdAt: "2026-01-01T00:00:00Z", frameworkVersion: "1.0.0", site: { name: "S" }, counts: {}, modules, files: [], format: "curiosa-backup", formatVersion: 1 },
  data: { users: [{ id: "u1", email: "o@x.org", name: "O", role: "owner", passwordHash: "h", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", advanced: false, locale: null }], settings: [], modules, instances: [], instanceTranslations: [], entries: [], entryTranslations: [], redirects: [], records: [] }, uploads: [] });
const saved = (id) => ({ id, source: "git", origin: "catalogue", name: id, version: "1", enabled: true, repoUrl: "https://github.com/moi/extras", ref: null, commit: null });

test("restauration : un module du catalogue qui demande un cœur plus récent est signalé dans l'aperçu et le bilan, jamais installé", async () => {
  indexRoot([remote("recent", { core: "0.1.10" }), remote("libre")]);
  const mods = [saved("recent"), saved("libre")];
  const plan = Object.fromEntries((await Rs.planModules(mods)).map((p) => [p.id, p]));
  assert.equal(plan.recent.needsCore, "0.1.10"); assert.equal(plan.libre.needsCore, undefined);
  const calls = [];
  const installers = { fromCatalogue: async (id) => { calls.push(id); return { ok: true, id }; }, fromRepo: async () => ({ ok: false, error: "x" }) };
  const report = await Rs.applyRestore(fakeBackup(mods), { confirmCustom: [], actor: "o", installers });
  assert.equal(report.ok, true, "la restauration des données continue");
  assert.deepEqual(calls, ["libre"]);
  assert.deepEqual(report.modules.find((m) => m.id === "recent"), { id: "recent", outcome: "failed", error: "modules.error.core", needsCore: "0.1.10" });
});
