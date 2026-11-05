import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// A pass over several modules of ONE repository (checking for updates, updating) downloads that repository once, not once per module; and a check where nothing was
// released downloads nothing at all. `git` is wrapped by a script that logs every call, so the downloads can be counted.

process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
const shim = makeTempDir("curiosa-gitshim-");
const log = path.join(shim, "calls.log");
const realGit = (await import("node:child_process")).execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
fs.writeFileSync(path.join(shim, "git"), `#!/bin/sh\necho "$@" >> "${log}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
process.env.PATH = `${shim}${path.delimiter}${process.env.PATH}`;

const db = await useTestDb();
const I = await import("@/core/modules/installer");
const { MODULES_DIR } = await import("@/core/config");
const { collectReport } = await import("@/core/modules/bulkUpdate");
const { moduleDir } = await import("@/core/modules/registry");

beforeEach(async () => { await db.reset(); fs.rmSync(log, { force: true }); });
after(() => db.close());

const manifest = (id, version = "1.0.0") => ({ apiVersion: 2, id, name: id, version, main: "index.mjs" });
const code = (v) => `export default { sections: {} }; // ${v}\n`;
const IDS = ["alpha", "beta", "gamma", "delta"];
/** The logged git calls of one kind; the read of the module catalogue (`--no-tags`) is not a module download. */
const calls = (verb) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter((l) => new RegExp(`(^| )${verb}( |$)`).test(l) && !l.includes("--no-tags")) : []);
const incoming = () => fs.readdirSync(MODULES_DIR).filter((n) => n.startsWith(".incoming-"));

function monorepo() {
  const files = {};
  for (const id of IDS) { files[`${id}/module.json`] = manifest(id); files[`${id}/index.mjs`] = code(id + "1"); }
  const repo = makeRepo(files);
  repo.g("tag", "v1.0.0");
  repo.change = (file, text, msg = "change") => { fs.writeFileSync(path.join(repo.dir, file), text); repo.g("add", "-A"); repo.g("commit", "-qm", msg); };
  return repo;
}
async function installAll(repo) {
  for (const id of IDS) assert.equal((await I.installModule(`${repo.url}#v1.0.0:${id}`, { expectId: id })).ok, true);
  fs.rmSync(log, { force: true });
}

test("nothing was released: checking every module reads the remote commit once and downloads nothing", async () => {
  const repo = monorepo();
  await installAll(repo);
  const report = await I.withSharedSources(() => collectReport(IDS.map((id) => ({ id, version: "1.0.0" })), (id) => I.checkForUpdateDetailed(id)));
  assert.deepEqual([report.outdated.length, report.unchecked.length], [0, 0]);
  assert.deepEqual(calls("fetch"), [], "no download: the commit is the one installed");
  assert.equal(calls("ls-remote").length, 1, "the remote commit of the reference is read once for the four modules");
  assert.deepEqual(incoming(), []);
});

test("a release changes one module of four: the four are checked with ONE download, and only that one is offered", async () => {
  const repo = monorepo();
  await installAll(repo);
  repo.change("beta/index.mjs", code("b2")); repo.change("beta/module.json", JSON.stringify(manifest("beta", "1.0.1")));
  repo.g("tag", "-f", "v1.0.0");   // the reference the modules follow moves, like a branch
  for (const id of IDS) await db.prisma.module.update({ where: { id }, data: { ref: "main" } });
  const report = await I.withSharedSources(async () => {
    const r = await collectReport(IDS.map((id) => ({ id, version: "1.0.0" })), (id) => I.checkForUpdateDetailed(id));
    assert.equal(incoming().length, 1, "one shared copy of the repository exists during the pass");
    return r;
  });
  assert.deepEqual(report.outdated.map((o) => [o.id, o.target]), [["beta", "1.0.1"]]);
  assert.equal(calls("fetch").length, 1, "one download for the whole pass (it was four)");
  assert.deepEqual(incoming(), [], "the shared copy is deleted when the pass ends");
});

test("an update pass shares the download too, and each module still ends up with ITS files", async () => {
  const repo = monorepo();
  await installAll(repo);
  for (const id of ["alpha", "gamma"]) { repo.change(`${id}/index.mjs`, code(id + "2")); repo.change(`${id}/module.json`, JSON.stringify(manifest(id, "1.0.1"))); }
  repo.g("tag", "-f", "v1.0.0");
  for (const id of IDS) await db.prisma.module.update({ where: { id }, data: { ref: "main" } });
  const U = await import("@/core/modules/updateStatus");
  const summary = await U.updateModules(["alpha", "gamma"]);
  assert.deepEqual(summary.updated.sort(), ["alpha", "gamma"]);
  assert.deepEqual(summary.failed, []);
  assert.match(fs.readFileSync(path.join(moduleDir("alpha"), "index.mjs"), "utf8"), /alpha2/);
  assert.match(fs.readFileSync(path.join(moduleDir("gamma"), "index.mjs"), "utf8"), /gamma2/);
  assert.match(fs.readFileSync(path.join(moduleDir("beta"), "index.mjs"), "utf8"), /beta1/, "an untouched module is untouched");
  assert.equal((await db.prisma.module.findUnique({ where: { id: "alpha" } })).version, "1.0.1");
  assert.equal(calls("fetch").length, 1, "one download for the two modules updated");
  assert.deepEqual(incoming(), []);
});

test("outside a pass nothing is shared: each call downloads its own copy and cleans up", async () => {
  const repo = monorepo();
  await installAll(repo);
  repo.change("alpha/index.mjs", code("a2")); repo.change("alpha/module.json", JSON.stringify(manifest("alpha", "1.0.1")));
  for (const id of IDS) await db.prisma.module.update({ where: { id }, data: { ref: "main" } });
  await I.checkForUpdateDetailed("alpha"); await I.checkForUpdateDetailed("beta");
  assert.equal(calls("fetch").length, 2);
  assert.deepEqual(incoming(), []);
});

test("startup recovery: a module swap that a dead process left half done is put right (old copy back, or old copy deleted when the swap was complete)", async () => {
  const dead = 4194000;   // no such process
  await db.prisma.module.create({ data: { id: "kept", source: "git", repoUrl: "https://example.org/k.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  await db.prisma.module.create({ data: { id: "lost", source: "git", repoUrl: "https://example.org/l.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  await db.prisma.module.create({ data: { id: "live", source: "git", repoUrl: "https://example.org/v.git", ref: "v1.0.0", version: "1.0.0", enabled: true } });
  const put = (dir, id, version) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "module.json"), JSON.stringify(manifest(id, version))); };
  // "kept": the new folder is in place and is the version of the database -> the swap was complete, the old copy goes.
  put(path.join(MODULES_DIR, "kept"), "kept", "1.0.0"); put(path.join(MODULES_DIR, `kept.previous-${dead}`), "kept", "0.9.0");
  // "lost": the process died between "set aside" and "copied": the old copy comes back.
  put(path.join(MODULES_DIR, `lost.previous-${dead}`), "lost", "1.0.0");
  // "live": the folder belongs to a process that still runs (ours): never touched.
  put(path.join(MODULES_DIR, "live"), "live", "1.0.0"); put(path.join(MODULES_DIR, `live.previous-${process.pid}`), "live", "0.9.0");
  fs.mkdirSync(path.join(MODULES_DIR, ".incoming-abc123"), { recursive: true });
  fs.mkdirSync(path.join(MODULES_DIR, `kept.incoming-${dead}`), { recursive: true });
  const done = await I.recoverInterruptedSwaps();
  assert.deepEqual(done.restored, ["lost"]);
  assert.ok(!fs.existsSync(path.join(MODULES_DIR, `kept.previous-${dead}`)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(MODULES_DIR, "kept", "module.json"), "utf8")).version, "1.0.0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(MODULES_DIR, "lost", "module.json"), "utf8")).version, "1.0.0");
  assert.ok(!fs.existsSync(path.join(MODULES_DIR, `lost.previous-${dead}`)));
  assert.ok(fs.existsSync(path.join(MODULES_DIR, `live.previous-${process.pid}`)), "a swap of a live process is left alone");
  assert.deepEqual(incoming(), [], "temporary folders of dead processes are removed");
  assert.ok(!fs.existsSync(path.join(MODULES_DIR, `kept.incoming-${dead}`)));
});
