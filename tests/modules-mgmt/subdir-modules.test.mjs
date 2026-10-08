import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
const db = await useTestDb();
const I = await import("@/core/modules/installer");
const { moduleDir } = await import("@/core/modules/registry");
const { sanitizeEntries } = await import("@/core/modules/recognized");
const { moduleOrigin } = await import("@/core/modules/catalogue");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id, version = "1.0.0", over = {}) => ({ apiVersion: 2, id, name: id, version, main: "index.mjs", ...over });
const code = (v) => `export default { sections: {} }; // ${v}\n`;

/** Un dépôt qui regroupe deux modules, chacun dans son dossier. */
function monorepo() {
  const repo = makeRepo({
    "alpha/module.json": manifest("alpha"), "alpha/index.mjs": code("a1"), "alpha/README.md": "# Alpha",
    "beta/module.json": manifest("beta"), "beta/index.mjs": code("b1"),
    "README.md": "# Dépôt de modules",
  });
  repo.change = (file, text, msg = "change") => { fs.writeFileSync(path.join(repo.dir, file), text); repo.g("add", "-A"); repo.g("commit", "-qm", msg); };
  return repo;
}
const mod = (id) => db.prisma.module.findUnique({ where: { id } });

test("adresse : dépôt#étiquette:dossier, dépôt#:dossier ; dossiers dangereux refusés", () => {
  const ok = (s) => I.parseRepoUrl(s);
  assert.deepEqual(ok("https://github.com/o/r#v1.0.0:alpha").repo, { url: "https://github.com/o/r", ref: "v1.0.0", subdir: "alpha" });
  assert.deepEqual(ok("https://github.com/o/r#:alpha").repo, { url: "https://github.com/o/r", ref: undefined, subdir: "alpha" });
  assert.deepEqual(ok("https://github.com/o/r#main:groupe/alpha").repo, { url: "https://github.com/o/r", ref: "main", subdir: "groupe/alpha" });
  assert.equal(ok("https://github.com/o/r#v1").repo.subdir, undefined);
  for (const bad of ["a/../b", "../x", "/abs", ".cache", "a//b", "a/b/c/d", "a b", "a:b", ""]) {
    assert.equal(I.parseRepoUrl(`https://github.com/o/r#v1:${bad}`).ok, false, `« ${bad} » doit être refusé`);
  }
  assert.equal(I.parseRepoUrl("https://github.com/o/r#v1:a:b").ok, false);
});

test("installation d'un module d'un dépôt qui en regroupe plusieurs : seul son dossier est copié, le module est identifié par son manifeste", async () => {
  const repo = monorepo();
  const r = await I.installModule(`${repo.url}#:alpha`, { expectId: "alpha" });
  assert.deepEqual(r, { ok: true, id: "alpha" });
  const files = fs.readdirSync(moduleDir("alpha")).sort();
  assert.deepEqual(files, ["README.md", "index.mjs", "module.json"], "pas de .git, pas le dossier d'un autre module");
  assert.ok(!fs.existsSync(path.join(moduleDir("alpha"), "..", "beta")) || !fs.existsSync(moduleDir("beta")), "beta n'est pas installé");
  const row = await mod("alpha");
  assert.equal(row.subdir, "alpha");
  assert.equal(row.repoUrl, repo.url);
  assert.match(row.tree, /^[0-9a-f]{40}$/);
  assert.equal(row.commit, repo.commit);
  assert.equal(row.enabled, false, "désactivé tant que l'administrateur ne l'a pas activé");
  // Le second module du même dépôt s'installe séparément.
  assert.equal((await I.installModule(`${repo.url}#:beta`)).ok, true);
  assert.equal((await mod("beta")).subdir, "beta");
});

test("dossier absent, sans manifeste, ou sortant du dépôt (lien symbolique) : refusé avec un message précis", async () => {
  const repo = monorepo();
  assert.deepEqual(await I.installModule(`${repo.url}#:inconnu`), { ok: false, error: "modules.error.nosubdir" });
  fs.mkdirSync(path.join(repo.dir, "vide")); fs.writeFileSync(path.join(repo.dir, "vide/x.txt"), "x"); repo.g("add", "-A"); repo.g("commit", "-qm", "vide");
  assert.deepEqual(await I.installModule(`${repo.url}#:vide`), { ok: false, error: "modules.error.nosubdir" });
  const outside = fs.mkdtempSync(path.join(path.dirname(repo.dir), "dehors-"));
  fs.writeFileSync(path.join(outside, "module.json"), JSON.stringify(manifest("evil")));
  fs.symlinkSync(outside, path.join(repo.dir, "piege")); repo.g("add", "-A"); repo.g("commit", "-qm", "piege");
  assert.equal((await I.installModule(`${repo.url}#:piege`)).ok, false, "un dossier qui pointe hors du dépôt n'est jamais lu");
  assert.equal(await db.prisma.module.count(), 0);
  // Un dépôt reconnu ne peut pas servir un autre module que celui annoncé.
  assert.deepEqual(await I.installModule(`${repo.url}#:alpha`, { expectId: "beta" }), { ok: false, error: "modules.error.idmismatch" });
});

test("mise à jour : proposée seulement quand CE module change (pas quand un autre module du dépôt évolue) ; appliquée sans toucher aux autres", async () => {
  const repo = monorepo();
  await I.installModule(`${repo.url}#:alpha`);
  await I.installModule(`${repo.url}#:beta`);
  assert.equal((await I.checkForUpdate("alpha")).available, false);
  repo.change("beta/index.mjs", code("b2"), "beta évolue");
  assert.equal((await I.checkForUpdate("alpha")).available, false, "alpha n'a pas changé");
  assert.equal((await I.checkForUpdate("beta")).available, true, "beta a changé");
  repo.change("alpha/module.json", JSON.stringify(manifest("alpha", "1.1.0")), "alpha 1.1.0");
  const check = await I.checkForUpdate("alpha");
  assert.equal(check.available, true);
  assert.equal(check.target, "1.1.0");
  assert.equal(check.level, "minor");
  const done = await I.updateModule("alpha");
  assert.equal(done.ok, true);
  const row = await mod("alpha");
  assert.equal(row.version, "1.1.0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(moduleDir("alpha"), "module.json"), "utf8")).version, "1.1.0");
  assert.equal((await I.checkForUpdate("alpha")).available, false, "à jour : plus rien à proposer");
  assert.equal((await I.updateModule("alpha")).error, "modules.error.uptodate");
  assert.equal((await mod("beta")).version, "1.0.0", "beta n'a pas bougé");
});

test("mise à jour : une version invalide est refusée et l'ancienne reste en place, intacte", async () => {
  const repo = monorepo();
  await I.installModule(`${repo.url}#:alpha`);
  const before = fs.readFileSync(path.join(moduleDir("alpha"), "index.mjs"), "utf8");
  repo.change("alpha/module.json", JSON.stringify(manifest("autre-id", "2.0.0")), "identifiant changé");
  const r = await I.updateModule("alpha");
  assert.equal(r.ok, false);
  assert.equal(r.error, "modules.error.nomanifest");
  assert.equal(fs.readFileSync(path.join(moduleDir("alpha"), "index.mjs"), "utf8"), before);
  assert.equal((await mod("alpha")).version, "1.0.0");
  assert.ok(!fs.readdirSync(path.dirname(moduleDir("alpha"))).some((n) => n.includes(".previous-") || n.includes(".incoming-")), "aucun résidu");
});

test("épinglé sur un commit (module personnel) : jamais de mise à jour ; sur une étiquette : l'étiquette est suivie", async () => {
  const repo = monorepo();
  await I.installModule(`${repo.url}#${repo.commit}:alpha`);
  repo.change("alpha/module.json", JSON.stringify(manifest("alpha", "1.2.0")), "suite");
  assert.equal((await I.checkForUpdate("alpha")).available, false);
  assert.equal((await I.updateModule("alpha")).error, "modules.error.pinned");
});

test("catalogue : l'entrée accepte un dossier ; un module installé depuis le bon dossier du bon dépôt est « du catalogue », pas un autre dossier", () => {
  const items = sanitizeEntries({ modules: [{ id: "alpha", repo: "https://github.com/o/extras", ref: "alpha-v1.0.0", subdir: "alpha" }, { id: "beta", repo: "https://github.com/o/extras", subdir: "../evil" }] });
  assert.equal(items[0].subdir, "alpha");
  assert.equal(items[1].subdir, undefined, "dossier invalide ignoré");
  const market = [{ id: "alpha", source: "recognized", repo: "https://github.com/o/extras", subdir: "alpha" }];
  assert.equal(moduleOrigin({ id: "alpha", source: "git", repoUrl: "https://github.com/o/extras", subdir: "alpha" }, market), "catalogue");
  assert.equal(moduleOrigin({ id: "alpha", source: "git", repoUrl: "https://github.com/o/extras", subdir: "autre" }, market), "custom");
  assert.equal(moduleOrigin({ id: "alpha", source: "git", repoUrl: "https://github.com/o/extras", subdir: null }, market), "custom");
});

test("branchements : aperçu, sauvegarde et restauration connaissent le dossier du module", () => {
  const read = (p) => fs.readFileSync(p, "utf8");
  assert.match(read("src/core/modules/readme.ts"), /HEAD:\$\{subdir\}/);
  assert.match(read("src/core/backup/export.ts"), /subdir: row\.subdir/);
  assert.match(read("src/core/backup/restore.ts"), /m\.subdir \? `:\$\{m\.subdir\}`/);
  assert.match(read("src/app/admin/(panel)/catalogue/details/page.tsx"), /subdir: entry\.subdir/);
});
