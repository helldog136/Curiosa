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

const TOKEN = "github_pat_11TESTONLY0AbCdEfGhIjKl_0123456789zYxWvUtSrQp";
const B64 = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const bin = makeTempDir("curiosa-fakegit-");
const LOG = path.join(bin, "calls.log");
const MODE = path.join(bin, "mode");
const REAL_GIT = execFileSync("which", ["git"]).toString().trim();
fs.writeFileSync(MODE, "ok");
fs.writeFileSync(path.join(bin, "git"), `#!/bin/bash
mode=$(cat "${MODE}")
{ echo "ARGV: $*"; env | grep -E '^GIT_CONFIG_(COUNT|KEY_|VALUE_)' | sed 's/^/ENV: /';
  [ -n "$CURIOSA_GIT_CODE" ] && echo "LEGACY: carrier set";
  env | grep -v -E '^(GIT_CONFIG_VALUE_|CURIOSA_GIT_CODE=)' | grep -F -e "${TOKEN}" -e "${B64}" | sed 's/=.*//; s/^/LEAK: /';
  echo "--"; } >> "${LOG}"
[ "$mode" = "slow" ] && case "$*" in *private-cat*) sleep 9;; esac
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

const PRIV = "https://github.com/test-owner/private-cat";
const SECOND = "https://github.com/test-owner/second-cat";
const PID = P.idOf(PRIV);
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
  assert.deepEqual(mine.personal, { id: PID, name: "Camille" });
  assert.equal(entries.find((e) => e.id === "blog").personal, undefined);
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
  assert.deepEqual(second.refused, [{ id: "etoile-nord", reason: "duplicate", by: "A" }]);
  assert.deepEqual(second.offers.map((o) => o.id), ["autre-mod"]);
  assert.equal((await P.addCatalogue(SECOND, "B", "o")).ok, true);
  const owners = (await C.getCatalogue()).filter((e) => e.personal).map((e) => [e.id, e.personal.name]).sort();
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
  const gone = await P.removeCatalogue(PID, "o");
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
  const log = calls();
  assert.ok(log.includes(B64), "the header was handed to git");
  assert.ok(!log.split("\n").filter((l) => l.startsWith("ARGV:")).join("\n").includes(TOKEN), "never in argv");
  const everything = JSON.stringify([await db.prisma.setting.findMany({ where: { NOT: { key: G.ACCESS_SETTING } } }), await db.prisma.auditLog.findMany(), await db.prisma.module.findMany()]);
  assert.ok(!everything.includes(TOKEN) && !everything.includes(B64), "not in settings, audit or module rows");
  // Removing the catalogue while a module still uses the repository keeps the code; the module keeps updating.
  assert.deepEqual((await P.removeCatalogue(PID, "o")).accessRemoved, false);
  assert.equal((await G.accessState(PRIV)).state, "configured");
});

test("removing the last use of a private repository removes its access code", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  await A.saveAccessCode(PRIV, TOKEN, "o");
  await P.addCatalogue(PRIV, "Camille", "o");
  const gone = await P.removeCatalogue(PID, "o");
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

/* ───────────── Review fixes (core 0.47.0, second pass) ───────────── */

const M = await import("@/core/maintenance/actions");
const D = await import("@/core/maintenance/deps");
const S = await import("@/core/settings");
const Rs = await import("@/core/backup/restore");
const { DATA_DIR } = await import("@/core/config");

const report = (outdated) => ({ checkedAt: Date.now(), checked: outdated.length, outdated, unchecked: [] });
const behind = [{ id: "etoile-nord", current: "1.0.0", target: "v1.1.0", level: "minor" }];
const withDeps = async (patch, fn) => { D.setMaintenanceDeps(patch); try { return await fn(); } finally { D.resetMaintenanceDeps(); } };
const installPersonal = async (repo, name = "Camille") => {
  await P.addCatalogue(PRIV, name, "o");
  assert.equal((await I.installFromCatalogue("etoile-nord", { confirmExtra: true })).ok, true);
  publish(repo, "etoile-nord", "1.1.0");
};
const assistantPaths = async () => {
  const out = {};
  await withDeps({ checkModule: async () => ({ check: { available: true, target: "v1.1.0", level: "minor" }, failed: false }), modulesReport: async () => report(behind) }, async () => {
    for (const [name, run] of Object.entries({
      module_update: () => M.prepare("module_update", { module: "etoile-nord" }),
      modules_update_all: () => M.prepare("modules_update_all", {}, { patient: true }),
    })) out[name] = await run().then(() => "allowed", (e) => String(e.message));
    out.reinstall = (await M.runLevel2("module_reinstall", { module: "etoile-nord" }, { name: "assistant" })).message;
    out.updates = (await Insp.updates({ updates: Promise.resolve({ report: report(behind), stale: false }) })).modules.map((m) => [m.aiCanUpdate, m.reason]);
  });
  return out;
};

test("the origin is written on the module: the assistant is refused on every path, also after the catalogue is removed or cannot be listed", async () => {
  const repo = makeCatalogue(PRIV, { "etoile-nord": {} });
  await installPersonal(repo);
  assert.deepEqual(Object.keys(await P.personalMarks()), ["etoile-nord"]);
  const check = (paths) => {
    assert.match(paths.module_update, /personal catalogue/, "prepare(module_update)");
    assert.match(paths.modules_update_all, /No module can be updated by an AI/, "prepare(modules_update_all) skips it");
    assert.match(paths.reinstall, /personal catalogue/, "reinstall");
    assert.deepEqual(paths.updates.map(([can]) => can), [false], "updates() says the assistant cannot");
    assert.match(paths.updates[0][1], /personal catalogue/);
  };
  check(await assistantPaths());
  // The catalogue is removed: the module keeps its origin ("source removed"), it does not become a module an assistant may update.
  await P.removeCatalogue(PID, "o");
  assert.deepEqual(await P.listCatalogues(), []);
  check(await assistantPaths());
  const still = await I.checkForUpdate("etoile-nord");
  assert.equal(still.available, false, "without its catalogue the module has nothing to update from");
  // Another module of the same repository, installed before the mark existed, is still caught by the registered address while the catalogue exists.
  assert.deepEqual(await P.withoutPersonal(["etoile-nord", "blog"]), ["blog"], "update all never takes it");
});

test("fail closed: when the origin cannot be read, every module counts as personal for the assistant and for update-all", async () => {
  const repo = makeCatalogue(PRIV, { "etoile-nord": {} });
  await installPersonal(repo);
  await I.installFromCatalogue("blog", { confirmExtra: true }).catch(() => {});
  const real = db.prisma.setting.findMany;
  S.resetSettingsCache();
  db.prisma.setting.findMany = async () => { throw new Error("database busy"); };
  try {
    assert.equal(await P.personalIndex(), null);
    assert.deepEqual(await P.withoutPersonal(["etoile-nord", "blog"]), []);
    const paths = await assistantPaths().catch((e) => ({ failed: String(e.message) }));
    if (!paths.failed) { assert.match(paths.module_update, /personal catalogue/); assert.match(paths.reinstall, /personal catalogue/); }
  } finally { db.prisma.setting.findMany = real; S.resetSettingsCache(); }
});

test("a backup that claims origin 'catalogue' never reinstalls a personal module without confirmation; a private repository without its code is reported", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  await P.addCatalogue(PRIV, "Camille", "o");
  const claim = { id: "etoile-nord", source: "git", origin: "catalogue", name: "etoile-nord", version: "1.0.0", enabled: true, repoUrl: PRIV, ref: "etoile-nord-v1.0.0", subdir: "modules/etoile-nord", commit: null };
  const plan = (await Rs.planModules([claim]))[0];
  assert.deepEqual([plan.status, plan.needsConfirmation], ["custom", true]);
  const backup = { manifest: { createdAt: "2026-01-01T00:00:00Z", frameworkVersion: "1.0.0", site: { name: "S" }, counts: {}, modules: [claim], files: [], format: "curiosa-backup", formatVersion: 1 },
    data: { users: [{ id: "u1", email: "o@x.org", name: "O", role: "owner", passwordHash: "h", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", advanced: false, locale: null }], settings: [], modules: [claim], instances: [], instanceTranslations: [], entries: [], entryTranslations: [], redirects: [], records: [] }, uploads: [] };
  const calls1 = [];
  const installers = { fromCatalogue: async (id) => { calls1.push(["catalogue", id]); return { ok: true, id }; }, fromRepo: async (url) => { calls1.push(["repo", url]); return { ok: false, error: "modules.error.access" }; } };
  const first = await Rs.applyRestore(backup, { confirmCustom: [], actor: "o", installers });
  assert.equal(first.ok, true);
  assert.deepEqual(calls1, [], "not confirmed: nothing is installed, whatever the backup says");
  const second = await Rs.applyRestore(backup, { confirmCustom: ["etoile-nord"], actor: "o", installers });
  assert.deepEqual(calls1.map((c) => c[0]), ["repo"], "confirmed: from its address, never as a catalogue module");
  assert.ok(second.report.failed.some((f) => f.note === "moduleAccess"), "the private repository without its code is explained");
});

test("a check never saves the access code; the code is saved only when the catalogue is really added, and removed again when the add fails", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  const checked = await P.checkCatalogue(PRIV, TOKEN);
  assert.equal(checked.ok, true);
  assert.equal((await G.accessState(PRIV)).state, "none", "nothing stored by a check");
  assert.ok(calls().includes(B64), "the pasted code was used from memory for the reading");
  // A failing add (the limit) leaves no orphan code behind.
  for (let i = 0; i < 5; i += 1) { makeCatalogue(`https://github.com/test-owner/fill-${i}`, { [`fill-mod-${i}`]: {} }); assert.equal((await P.addCatalogue(`https://github.com/test-owner/fill-${i}`, `F${i}`, "o")).ok, true); }
  assert.deepEqual(await P.addCatalogue(PRIV, "Camille", "o", TOKEN), { ok: false, error: "personal.error.max" });
  assert.equal((await G.accessState(PRIV)).state, "none", "the orphan code was removed");
  await P.removeCatalogue(P.idOf("https://github.com/test-owner/fill-0"), "o");
  assert.equal((await P.addCatalogue(PRIV, "Camille", "o", TOKEN)).ok, true);
  assert.equal((await G.accessState(PRIV)).state, "configured", "saved once the catalogue exists");
});

test("two adds at the same time respect the limit and lose nothing", async () => {
  const urls = Array.from({ length: 8 }, (_, i) => `https://github.com/test-owner/race-${i}`);
  urls.forEach((u, i) => makeCatalogue(u, { [`race-mod-${i}`]: {} }));
  const results = await Promise.all(urls.map((u, i) => P.addCatalogue(u, `R${i}`, "o")));
  assert.equal(results.filter((r) => r.ok).length, P.MAX_CATALOGUES);
  assert.equal(results.filter((r) => !r.ok && r.error === "personal.error.max").length, urls.length - P.MAX_CATALOGUES);
  const list = await P.listCatalogues();
  assert.equal(list.length, P.MAX_CATALOGUES);
  assert.deepEqual(list.map((c) => c.url).sort(), results.map((r, i) => (r.ok ? urls[i] : null)).filter(Boolean).sort(), "every successful add is in the list");
  // Rename and remove at the same time do not undo each other.
  const [a, b] = list;
  await Promise.all([P.renameCatalogue(a.id, "Renamed"), P.removeCatalogue(b.id, "o")]);
  const after2 = await P.listCatalogues();
  assert.deepEqual(after2.map((c) => c.id).sort(), list.filter((c) => c.id !== b.id).map((c) => c.id).sort());
  assert.equal(after2.find((c) => c.id === a.id).name, "Renamed");
});

test("two different repositories never share an id, whatever their names look like", async () => {
  const one = "https://github.com/a/b-c";
  const two = "https://github.com/a-b/c";
  assert.notEqual(P.idOf(one), P.idOf(two));
  assert.equal(P.idOf(one), P.idOf(`${one}.git`));
  assert.equal(P.idOf(one), P.idOf("https://GitHub.com/A/B-C/"));
  makeCatalogue(one, { "mod-one": {} });
  makeCatalogue(two, { "mod-two": {} });
  assert.equal((await P.addCatalogue(one, "One", "o")).ok, true);
  const check = await P.checkCatalogue(two);
  assert.equal(check.ok, true);
  assert.equal(check.alreadyAdded, false, "a different repository is not reported as already added");
  assert.equal((await P.addCatalogue(two, "Two", "o")).ok, true);
  assert.equal((await P.listCatalogues()).length, 2);
});

test("without the official index, no personal item is offered (an official id could be copied)", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  await P.addCatalogue(PRIV, "Camille", "o");
  assert.equal((await C.getCatalogue()).some((e) => e.personal), true);
  process.env.CURIOSA_CATALOGUE_REPO = "https://github.com/test-owner/nowhere-at-all";
  R.clearRecognizedCache();
  // With an older copy of the official index the personal ids can still be checked against it; with nothing at all they cannot.
  const older = await R.getRecognizedDetailed();
  assert.equal(older.source, "cache");
  assert.ok(older.items.some((i) => i.catalogueSource) && older.items.some((i) => i.id === "blog"));
  fs.rmSync(path.join(DATA_DIR, "cache", "recognized-index.json"), { force: true });
  R.clearRecognizedCache();
  const down = await R.getRecognizedDetailed();
  assert.equal(down.source, "none");
  assert.deepEqual(down.items, [], "no official index at all: not a single personal item");
});

test("an entry with no pinned reference is refused with a plain reason", async () => {
  const repo = makeCatalogue(PRIV, { "etoile-nord": {}, "lune-douce": {} });
  const idx = JSON.parse(fs.readFileSync(path.join(repo.dir, "catalogue/index.json"), "utf8"));
  delete idx.modules.find((e) => e.id === "lune-douce").ref;
  fs.writeFileSync(path.join(repo.dir, "catalogue/index.json"), JSON.stringify(idx));
  repo.g("add", "-A"); repo.g("commit", "-q", "--no-verify", "-m", "unpin");
  R.clearRecognizedCache();
  const r = await P.checkCatalogue(PRIV);
  assert.deepEqual(r.offers.map((o) => o.id), ["etoile-nord"]);
  assert.deepEqual(r.refused, [{ id: "lune-douce", reason: "unpinned" }]);
});

test("personal entries cannot steer the core: no suggestion, no topic provided, no social source", async () => {
  const repo = makeCatalogue(PRIV, { "etoile-nord": {} });
  const file = path.join(repo.dir, "catalogue/index.json");
  const idx = JSON.parse(fs.readFileSync(file, "utf8"));
  Object.assign(idx.modules[0], { provides: ["social.link"], social: { label: "Fake" } });
  fs.writeFileSync(file, JSON.stringify(idx));
  fs.writeFileSync(path.join(repo.dir, "catalogue/suggested.json"), JSON.stringify(["etoile-nord"]));
  repo.g("add", "-A"); repo.g("commit", "-q", "--no-verify", "-m", "claims");
  R.clearRecognizedCache();
  await P.addCatalogue(PRIV, "Camille", "o");
  const entry = (await C.getCatalogue()).find((e) => e.id === "etoile-nord");
  assert.ok(entry?.personal);
  assert.deepEqual([entry.suggested, entry.provides, entry.social], [false, undefined, undefined]);
});

test("a private repository: nothing about it reaches an assistant; a public one is shown, flagged personal", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  await A.saveAccessCode(PRIV, TOKEN, "o");
  await P.addCatalogue(PRIV, "Camille", "o");
  const hidden = await Cat.catalogList({ include: "all" });
  assert.equal(hidden.items.some((m) => m.id === "etoile-nord"), false, "a private repository's modules are not listed for an assistant");
  assert.equal(JSON.stringify(hidden).includes("Camille"), false);
  await assert.rejects(() => Cat.catalogGet({ module: "etoile-nord" }), /Unknown module/);
  assert.equal((await C.getCatalogue()).some((e) => e.id === "etoile-nord"), true, "the owner still sees it");
});

test("old git (< 2.31): the code travels in the environment of git only, never in argv, logs or any other variable", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  const old = makeTempDir("curiosa-oldgit-");
  fs.writeFileSync(path.join(old, "git"), `#!/bin/bash\nif [ "$1" = "--version" ]; then echo "git version 2.30.2"; exit 0; fi\nexec "${path.join(bin, "git")}" "$@"\n`, { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${old}:${before}`;
  try {
    assert.equal((await P.checkCatalogue(PRIV, TOKEN)).ok, true);
    assert.equal((await P.addCatalogue(PRIV, "Camille", "o", TOKEN)).ok, true);
    assert.equal((await I.installFromCatalogue("etoile-nord", { confirmExtra: true })).ok, true);
  } finally { process.env.PATH = before; }
  const log = calls();
  assert.ok(/LEGACY: carrier set/.test(log), "the legacy carrier was used");
  assert.ok(!log.split("\n").filter((l) => l.startsWith("ARGV:")).join("\n").includes(TOKEN), "never in argv");
  assert.ok(!/^LEAK:/m.test(log), "no other variable of a git child carries it");
  assert.ok(!Object.values(process.env).some((v) => String(v).includes(TOKEN)), "not in the environment of the process (so not in any other child either)");
  const everything = JSON.stringify([await db.prisma.setting.findMany({ where: { NOT: { key: G.ACCESS_SETTING } } }), await db.prisma.auditLog.findMany(), await db.prisma.module.findMany()]);
  assert.ok(!everything.includes(TOKEN));
});

test("a slow personal repository never holds the official catalogue back, and the short copy is read again soon", async () => {
  makeCatalogue(PRIV, { "etoile-nord": {} });
  await P.addCatalogue(PRIV, "Camille", "o");
  R.clearRecognizedCache();
  setMode("slow");
  const t0 = Date.now();
  const got = await R.getRecognizedDetailed();
  const took = Date.now() - t0;
  assert.ok(took < P.PERSONAL_BUDGET_MS + 3000, `the official catalogue waited ${took} ms`);
  assert.ok(got.items.some((i) => i.id === "blog"), "official entries are there");
  assert.equal(got.items.some((i) => i.catalogueSource), false, "the slow catalogue is left out for now");
  setMode("ok");
  const before = calls().split("\n").filter((l) => /fetch/.test(l)).length;
  await new Promise((r) => setTimeout(r, 20_500));
  const again = await R.getRecognizedDetailed();
  assert.ok(again.items.some((i) => i.catalogueSource), "read again after a few seconds, not after 15 minutes");
  assert.ok(calls().split("\n").filter((l) => /fetch/.test(l)).length > before);
});

test("a clear while a read is running: the old read cannot write its result into the memory", async () => {
  const repo = makeCatalogue(PRIV, { "etoile-nord": {} });
  await P.addCatalogue(PRIV, "Camille", "o");
  R.clearRecognizedCache();
  const running = R.getRecognizedDetailed();
  R.clearRecognizedCache();
  await running;
  publish(repo, "etoile-nord", "1.1.0");   // also clears, but only AFTER the old read ended
  R.clearRecognizedCache();
  const fresh = (await R.getRecognizedDetailed()).items.find((i) => i.id === "etoile-nord");
  assert.equal(fresh.version, "1.1.0");
  // The memory and the generation live on globalThis: another bundle of the same process sees them.
  assert.ok(globalThis[Symbol.for("curiosa.recognized.state")], "shared state");
});

test("personal items never displace official ones: each source has its own cap", async () => {
  const many = Object.fromEntries(Array.from({ length: P.MAX_PERSONAL_ITEMS + 20 }, (_, i) => [`bulk-${String(i).padStart(3, "0")}`, {}]));
  makeCatalogue(PRIV, many);
  await P.addCatalogue(PRIV, "Camille", "o");
  const items = (await R.getRecognizedDetailed()).items;
  assert.equal(items.filter((i) => i.catalogueSource).length, P.MAX_PERSONAL_ITEMS);
  assert.ok(items.some((i) => i.id === "blog"));
});
