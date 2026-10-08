import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
const db = await useTestDb();
const S = await import("@/core/modules/sources");
const I = await import("@/core/modules/installer");
const { moduleOrigin } = await import("@/core/modules/catalogue");

beforeEach(async () => { await db.reset(); S.clearSourcesCache(); });
after(() => db.close());

const manifest = (id, over = {}) => ({ apiVersion: 2, id, name: { fr: id, en: id }, version: "1.0.0", description: "d", main: "index.mjs", ...over });
const code = "export default { sections: {} };\n";
/** « jeanmi/mes-modules-curiosa » : plusieurs modules, dont un rangé plus profond, un manifeste cassé, un dossier ignoré. */
const jeanmi = () => makeRepo({
  "README.md": "# Mes modules",
  "modules/rss/module.json": manifest("rss"), "modules/rss/index.mjs": code,
  "modules/agenda/module.json": manifest("agenda"), "modules/agenda/index.mjs": code,
  "outils/divers/profond/module.json": manifest("profond"), "outils/divers/profond/index.mjs": code,
  "a/b/c/d/trop/module.json": manifest("trop-profond"), "a/b/c/d/trop/index.mjs": code,
  "modules/casse/module.json": "{pas du json",
  "node_modules/intrus/module.json": manifest("intrus"),
  ".cache/module.json": manifest("cache"),
});

test("dépôt de modules : on retrouve les modules de chaque dossier, sans lire node_modules ni les dossiers cachés, jusqu'à trois niveaux de profondeur", async () => {
  const repo = jeanmi();
  const list = await S.discoverModules({ url: repo.url });
  assert.deepEqual(list.map((m) => [m.id, m.subdir, m.compatible]).sort(), [["agenda", "modules/agenda", true], ["profond", "outils/divers/profond", true], ["rss", "modules/rss", true]]);
});

test("dépôt d'un seul module (module.json à la racine) : le module est le dépôt entier", async () => {
  const repo = makeRepo({ "module.json": manifest("solo"), "index.mjs": code, "autre/module.json": manifest("ignore") });
  const list = await S.discoverModules({ url: repo.url });
  assert.deepEqual(list.map((m) => [m.id, m.subdir]), [["solo", undefined]]);
});

test("ajouter un dépôt : il doit contenir un module ; une adresse avec dossier est refusée ; doublon sans effet ; limite", async () => {
  const repo = jeanmi();
  const ok = await S.addSource(repo.url);
  assert.equal(ok.ok, true); assert.equal(ok.modules.length, 3);
  assert.equal((await S.addSource(repo.url)).ok, true);
  assert.deepEqual((await S.listSources()).map((s) => s.url), [repo.url], "pas de doublon");
  assert.equal((await S.addSource(`${repo.url}#:modules/rss`)).error, "modules.error.sourceSubdir");
  assert.equal((await S.addSource(makeRepo({ "readme.md": "rien" }).url)).error, "modules.error.sourceEmpty");
  assert.equal((await S.addSource("https://evil.example/x/y")).ok, false);
  assert.equal((await S.addSource("file:///inexistant/depot")).ok, false, "dépôt injoignable : refusé, rien enregistré");
  assert.equal((await S.listSources()).length, 1);
  for (let i = 0; i < S.MAX_SOURCES; i++) await S.addSource(makeRepo({ "module.json": manifest(`m${i}`), "index.mjs": code }).url);
  assert.equal((await S.listSources()).length, S.MAX_SOURCES);
  assert.equal((await S.addSource(makeRepo({ "module.json": manifest("trop"), "index.mjs": code }).url)).error, "modules.error.sourceMax");
});

test("retirer un dépôt : il disparaît de la liste, les modules déjà installés restent", async () => {
  const repo = jeanmi();
  await S.addSource(repo.url);
  const [src] = await S.listSources();
  const mod = (await S.discoverModules(src)).find((m) => m.id === "rss");
  assert.equal((await I.installModule(S.sourceAddress(src, mod))).ok, true);
  await S.removeSource(src.url);
  assert.deepEqual(await S.listSources(), []);
  assert.ok(await db.prisma.module.findUnique({ where: { id: "rss" } }));
});

test("installer depuis un dépôt ajouté : un seul module, désactivé, « personnel » (non vérifié), mis à jour depuis son dossier du même dépôt", async () => {
  const repo = jeanmi();
  await S.addSource(repo.url);
  const [src] = await S.listSources();
  const list = await S.discoverModules(src);
  const rss = list.find((m) => m.id === "rss");
  assert.equal(S.sourceAddress(src, rss), `${repo.url}#:modules/rss`);
  assert.deepEqual(await I.installModule(S.sourceAddress(src, rss)), { ok: true, id: "rss" });
  const row = await db.prisma.module.findUnique({ where: { id: "rss" } });
  assert.deepEqual([row.enabled, row.subdir, row.source], [false, "modules/rss", "git"]);
  assert.equal(await db.prisma.module.findUnique({ where: { id: "agenda" } }), null, "les autres modules du dépôt ne sont pas installés");
  assert.equal(moduleOrigin(row, []), "custom");
  assert.equal((await I.checkForUpdate("rss")).available, false);
  fs.writeFileSync(path.join(repo.dir, "modules/agenda/index.mjs"), code + "// autre\n"); repo.g("add", "-A"); repo.g("commit", "-qm", "agenda");
  assert.equal((await I.checkForUpdate("rss")).available, false, "un autre module du dépôt change : rien à faire pour celui-ci");
});

test("branchements : réservé au propriétaire, journalisé, affiché dans le Catalogue avancé avec confirmation avant installation", () => {
  const actions = fs.readFileSync("src/app/admin/(panel)/catalogue/actions.ts", "utf8");
  for (const name of ["addSourceAction", "removeSourceAction", "refreshSourcesAction"]) assert.match(actions, new RegExp(`export async function ${name}[\\s\\S]*?adminCtx\\("owner"\\)`));
  assert.match(actions, /module\.source\.add/);
  const page = fs.readFileSync("src/app/admin/(panel)/catalogue/page.tsx", "utf8");
  assert.match(page, /isOwner && advanced && \(\s*<section[\s\S]*catalogue\.sources/);
  assert.match(page, /details\?repo=/, "chaque module passe par la page de détails (README, permissions, case « je comprends »)");
});
