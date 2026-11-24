// Personal catalogues (core 0.47.0): a private (or public) git repository that is itself a module catalogue, merged into the catalogue of the site.
// Local fixture repositories only: the https address of each repository is mapped to a local folder by the throw-away git config of useTestDb().
// A fake `git` first in the PATH records what reaches git (argv, authentication environment) so the access code can be searched for in everything.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { createCatalogue } from "../helpers/catalogue.mjs";
import { TEST_CORE } from "../helpers/skins.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

const bin = makeTempDir("curiosa-fakegit-");
const LOG = path.join(bin, "calls.log");
const MODE = path.join(bin, "mode");
const REAL_GIT = execFileSync("which", ["git"]).toString().trim();
fs.writeFileSync(MODE, "ok");
fs.writeFileSync(path.join(bin, "git"), `#!/bin/bash
mode=$(cat "${MODE}")
{ echo "ARGV: $*"; env | grep -E '^GIT_CONFIG_(COUNT|KEY_|VALUE_)' | sed 's/^/ENV: /'; echo "--"; } >> "${LOG}"
case " $* " in
  *" fetch "*|*" clone "*|*" ls-remote "*)
    case "$mode" in
      401) echo "fatal: Authentication failed for 'https://github.com/test-owner/private-cat/'" >&2; exit 128;;
      404) echo "remote: Repository not found." >&2; exit 128;;
    esac;;
esac
exec "${REAL_GIT}" "$@"
`, { mode: 0o755 });
process.env.PATH = `${bin}:${process.env.PATH}`;

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const P = await import("@/core/modules/personalCatalogues");
const R = await import("@/core/modules/recognized");
const C = await import("@/core/modules/catalogue");
const I = await import("@/core/modules/installer");
const A = await import("@/core/gitAccessAdmin");
const G = await import("@/core/gitAccess");
const Cat = await import("@/core/maintenance/catalog");
const Insp = await import("@/core/maintenance/inspect");

const TOKEN = "github_pat_11TESTONLY0AbCdEfGhIjKl_0123456789zYxWvUtSrQp";
const PRIV = "https://github.com/test-owner/private-cat";
const SECOND = "https://github.com/test-owner/second-cat";
const code = (marker) => `export default { marker: ${JSON.stringify(marker)} };\n`;
const man = (id, over = {}) => ({ apiVersion: 2, id, name: id, version: "1.0.0", main: "index.mjs", ...over });

/** A catalogue repository with the layout of the official one: modules/<id>/ and catalogue/index.json pinned on tags. */
function makeCatalogue(https, modules, { entryRepo = https } = {}) {
  const files = {};
  const entries = [];
  for (const [id, over] of Object.entries(modules)) {
    const m = man(id, over);
    files[`modules/${id}/module.json`] = m;
    files[`modules/${id}/index.mjs`] = code("v1");
    entries.push({ id, name: m.name, description: "d", repo: entryRepo, subdir: `modules/${id}`, ref: `${id}-v${m.version}`, version: m.version, apiVersion: 2, ...(over.requires ? { requires: over.requires } : {}) });
  }
  files["catalogue/index.json"] = { version: 1, modules: entries };
  const repo = makeRepo(files);
  for (const e of entries) repo.g("tag", "-f", e.ref);
  fs.appendFileSync(process.env.GIT_CONFIG_GLOBAL, `[url "${repo.url}"]\n\tinsteadOf = ${https}\n`);
  return repo;
}
const publish = (repo, id, version) => {
  fs.writeFileSync(path.join(repo.dir, `modules/${id}/module.json`), JSON.stringify(man(id, { version })));
  fs.writeFileSync(path.join(repo.dir, `modules/${id}/index.mjs`), code(`v${version}`));
  const idx = JSON.parse(fs.readFileSync(path.join(repo.dir, "catalogue/index.json"), "utf8"));
  for (const e of idx.modules) if (e.id === id) { e.version = version; e.ref = `${id}-v${version}`; }
  fs.writeFileSync(path.join(repo.dir, "catalogue/index.json"), JSON.stringify(idx));
  repo.g("add", "-A"); repo.g("commit", "-q", "--no-verify", "-m", `${id} ${version}`); repo.g("tag", "-f", `${id}-v${version}`);
  R.clearRecognizedCache();
};
const setMode = (m) => fs.writeFileSync(MODE, m);
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8") : "");

let official;
const realFetch = globalThis.fetch;
let fetched;
beforeEach(async () => {
  await db.reset();
  setMode("ok");
  fs.writeFileSync(LOG, "");
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, "");   // each test maps the addresses to its own fixture repositories
  official = createCatalogue();
  process.env.CURIOSA_CATALOGUE_REPO = official.https;
  await official.add("blog");
  R.clearRecognizedCache();
  fetched = [];
  globalThis.fetch = async (url, ...rest) => { fetched.push(String(url)); return realFetch(url, ...rest); };
});
after(() => { globalThis.fetch = realFetch; db.close(); });

test("check: how many modules a repository offers, which are refused and why; nothing is registered by a check", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {}, "lune-douce": { requires: { core: "9.0.0" } }, blog: {} });
  const r = await P.checkCatalogue(PRIV);
  assert.equal(r.ok, true);
  assert.deepEqual(r.offers.map((o) => o.id).sort(), ["etoile-nord", "lune-douce"]);
  assert.deepEqual(r.refused, [{ id: "blog", reason: "clash" }], "an id the official catalogue has is refused, the official one wins");
  assert.equal(r.alreadyAdded, false);
  assert.deepEqual(await P.listCatalogues(), []);
});

test("an entry that points to another repository is refused: one repository, one access code, one decision of trust", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} }, { entryRepo: "https://github.com/test-owner/elsewhere" });
  const r = await P.checkCatalogue(PRIV);
  assert.equal(r.ok, true);
  assert.deepEqual(r.offers, []);
  assert.deepEqual(r.refused, [{ id: "etoile-nord", reason: "elsewhere" }]);
  assert.deepEqual(await P.addCatalogue(PRIV, "x", "owner"), { ok: false, error: "personal.error.empty" });
});

test("adding: the modules are merged next to the official ones, flagged personal, unverified, never installed without the owner's confirmation", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {}, "lune-douce": {} });
  const added = await P.addCatalogue(PRIV, "Camille", "owner");
  assert.equal(added.ok, true);
  assert.equal(added.offered, 2);
  const entries = await C.getCatalogue();
  assert.deepEqual(entries.map((e) => e.id).sort(), ["blog", "etoile-nord", "lune-douce"]);
  const mine = entries.find((e) => e.id === "etoile-nord");
  assert.equal(mine.origin, "extra");
  assert.deepEqual(mine.source, { id: "test-owner-private-cat", name: "Camille" });
  assert.equal(entries.find((e) => e.id === "blog").source, undefined);
  assert.equal(mine.suggested, false);
  assert.deepEqual(await I.installFromCatalogue("etoile-nord"), { ok: false, error: "modules.error.extraConfirm" });
  const done = await I.installFromCatalogue("etoile-nord", { confirmExtra: true });
  assert.equal(done.ok, true);
  const row = await db.prisma.module.findUnique({ where: { id: "etoile-nord" } });
  assert.equal(C.moduleOrigin(row, entries), "custom", "a backup says custom: a restore asks first");
});

test("refusals: the same address twice, a duplicate id across two personal catalogues (the first wins), an empty catalogue, the limit", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  assert.equal((await P.addCatalogue(PRIV, "A", "o")).ok, true);
  assert.deepEqual(await P.addCatalogue(`${PRIV}.git`, "again", "o"), { ok: false, error: "personal.error.exists" });
  makeCatalogue(SECOND, { "etoile-nord": {}, "autre-mod": {} });
  const second = await P.checkCatalogue(SECOND);
  assert.deepEqual(second.refused, [{ id: "etoile-nord", reason: "duplicate", by: "test-owner-private-cat" }]);
  assert.deepEqual(second.offers.map((o) => o.id), ["autre-mod"]);
  assert.equal((await P.addCatalogue(SECOND, "B", "o")).ok, true);
  const owners = (await C.getCatalogue()).filter((e) => e.source).map((e) => [e.id, e.source.name]).sort();
  assert.deepEqual(owners, [["autre-mod", "B"], ["etoile-nord", "A"]]);
  const bad = await P.checkCatalogue("https://github.com/test-owner/no-index");
  assert.equal(bad.ok, false);
});

test("updates follow the catalogue (same installer, same checks); removing the catalogue uninstalls NOTHING and stops the offer", async () => {
  const repo = makeCatalogue(PRIV, { "etoile-nord": {} });
  await P.addCatalogue(PRIV, "Camille", "o");
  assert.equal((await I.installFromCatalogue("etoile-nord", { confirmExtra: true })).ok, true);
  publish(repo, "etoile-nord", "1.1.0");
  const check = await I.checkForUpdate("etoile-nord");
  assert.equal(check.available, true);
  assert.match(String(check.target), /1\.1\.0/);
  assert.equal((await I.updateModule("etoile-nord")).ok, true);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "etoile-nord" } })).version, "1.1.0");
  assert.deepEqual(await P.installedFrom({ url: PRIV }), ["etoile-nord"]);
  const gone = await P.removeCatalogue("test-owner-private-cat", "o");
  assert.deepEqual(gone, { ok: true, keptModules: ["etoile-nord"], accessRemoved: false });
  assert.ok(await db.prisma.module.findUnique({ where: { id: "etoile-nord" } }), "still installed");
  assert.equal((await C.getCatalogue()).some((e) => e.id === "etoile-nord"), false, "no longer offered");
});

test("private repository: the access code reaches git through the environment of the child only, and appears nowhere else", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  setMode("401");
  const refused = await P.checkCatalogue(PRIV);
  assert.deepEqual([refused.ok, refused.needsCode], [false, true], "no code: a plain message and the way to give one");
  setMode("ok");
  assert.equal((await A.saveAccessCode(PRIV, TOKEN, "o")).ok, true);
  assert.equal((await P.addCatalogue(PRIV, "Camille", "o")).ok, true);
  assert.equal((await I.installFromCatalogue("etoile-nord", { confirmExtra: true })).ok, true);
  const B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
  const log = calls();
  assert.ok(log.includes(B64), "the header was handed to git");
  assert.ok(!log.split("\n").filter((l) => l.startsWith("ARGV:")).join("\n").includes(TOKEN), "never in argv");
  const everything = JSON.stringify([await db.prisma.setting.findMany({ where: { NOT: { key: G.ACCESS_SETTING } } }), await db.prisma.auditLog.findMany(), await db.prisma.module.findMany()]);
  assert.ok(!everything.includes(TOKEN) && !everything.includes(B64), "not in settings, audit or module rows");
  // Removing the catalogue while a module still uses the repository keeps the code; the module keeps updating.
  assert.deepEqual((await P.removeCatalogue("test-owner-private-cat", "o")).accessRemoved, false);
  assert.equal((await G.accessState(PRIV)).state, "configured");
});

test("removing the last use of a private repository removes its access code", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  await A.saveAccessCode(PRIV, TOKEN, "o");
  await P.addCatalogue(PRIV, "Camille", "o");
  const gone = await P.removeCatalogue("test-owner-private-cat", "o");
  assert.deepEqual(gone, { ok: true, keptModules: [], accessRemoved: true });
  assert.equal((await G.accessState(PRIV)).state, "none");
});

test("no licence and no website request: the only traffic is git towards the registered address", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  await P.addCatalogue(PRIV, "Camille", "o");
  await I.installFromCatalogue("etoile-nord", { confirmExtra: true });
  assert.ok(!fetched.some((u) => /github\.com\/test-owner|licen[cs]e/i.test(u)), `unexpected requests: ${fetched.join(", ")}`);
});

test("an assistant sees personal modules, never installs, updates or reinstalls them", async () => {
  const repo = makeCatalogue(PRIV, { "etoile-nord": {} });
  await P.addCatalogue(PRIV, "Camille", "o");
  const list = await Cat.catalogList({ include: "all" });
  const item = list.items.find((m) => m.id === "etoile-nord");
  assert.equal(item.origin, "personal");
  assert.equal(item.installable, false);
  assert.match(item.reason, /personal catalogue/);
  assert.equal(list.items.find((m) => m.id === "blog").origin, "official");
  const sheet = await Cat.catalogGet({ module: "etoile-nord" });
  assert.equal(sheet.origin, "personal");
  assert.equal(sheet.source, undefined, "the address of a personal repository is not given to an assistant");
  assert.equal(sheet.sheet, "partial: the module description file could not be read now (network or invalid), so only the catalogue summary is shown. Try again later.");
  assert.match(Insp.moduleUpdateRefusal({ id: "etoile-nord", ref: "etoile-nord-v1.0.0", source: "git", target: "1.1.0", personal: true }), /personal catalogue/);
  await I.installFromCatalogue("etoile-nord", { confirmExtra: true });
  publish(repo, "etoile-nord", "1.1.0");
  const { runLevel2 } = await import("@/core/maintenance/actions");
  const out = await runLevel2("module_reinstall", { module: "etoile-nord" }, { name: "assistant" });
  assert.equal(out.ok, false);
  assert.match(out.message, /personal catalogue/);
});

test("a restore without the access code does not break: the module is reported with the way to fix it", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  setMode("401");
  const r = await I.installFromCatalogue("etoile-nord", { confirmExtra: true });
  assert.deepEqual([r.ok, r.error], [false, "modules.error.notfound"], "not offered while the repository refuses: nothing half-installed");
  assert.equal(await db.prisma.module.count({ where: { id: "etoile-nord" } }), 0);
});
