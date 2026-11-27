import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";

// (0.52.1) The version number of module.json is the ONLY update signal of a module that follows a branch or a folder of a repository: new content under the same
// number is not an update, a lower number or a release candidate is never one, and the target shown is never a commit.

process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
const db = await useTestDb();
const I = await import("@/core/modules/installer");
const { versionSignal } = await import("@/core/updates/versions");
const { collectReport } = await import("@/core/modules/bulkUpdate");

beforeEach(() => db.reset());
after(() => db.close());

const manifest = (id, version) => ({ apiVersion: 2, id, name: id, version, main: "index.mjs" });
const code = (v) => `export default { sections: {} }; // ${v}\n`;
const HEX = /^[0-9a-f]{7,40}$/;

test("versionSignal: higher stable = newer; equal, lower and pre-release = none; no comparable version = unknown", () => {
  assert.equal(versionSignal("1.2.0", "1.3.0"), "newer");
  assert.equal(versionSignal("1.2.0", "1.2.0"), "none");
  assert.equal(versionSignal("1.2.0", "1.1.9"), "none");
  assert.equal(versionSignal("1.2.0", "1.3.0-rc.1"), "none", "a release candidate is never offered as an update");
  assert.equal(versionSignal("1.2.0-rc.1", "1.2.0"), "newer", "the stable release that follows a candidate is an update");
  assert.equal(versionSignal("1.2.0", undefined), "unknown");
  assert.equal(versionSignal("1.2.0", "1.3.0+build5"), "unknown");
});

test("judgeModuleUpdate: same number with new content is no update; unknown version falls back to the content, without ever naming a commit", () => {
  assert.deepEqual(I.judgeModuleUpdate("1.2.0", "1.2.0", true), { available: false });
  assert.deepEqual(I.judgeModuleUpdate("1.2.0", "1.1.0", true), { available: false });
  assert.deepEqual(I.judgeModuleUpdate("1.2.0", "1.3.0", false), { available: true, target: "1.3.0", level: "minor" }, "a higher number is an update whatever the content check said");
  assert.deepEqual(I.judgeModuleUpdate("1.2.0", undefined, true), { available: true });
  assert.deepEqual(I.judgeModuleUpdate("1.2.0", undefined, false), { available: false });
  assert.deepEqual(I.judgeModuleUpdate("1.2.0", "1.3.0+b", true), { available: true, target: "1.3.0+b" });
});

function monorepo() {
  const repo = makeRepo({ "alpha/module.json": manifest("alpha", "1.2.0"), "alpha/index.mjs": code("a1") });
  repo.change = (file, text, msg = "change") => { fs.writeFileSync(path.join(repo.dir, file), text); repo.g("add", "-A"); repo.g("commit", "-qm", msg); };
  return repo;
}
const outdated = async () => (await I.withSharedSources(() => collectReport([{ id: "alpha", version: "1.2.0" }], (id) => I.checkForUpdateDetailed(id)))).outdated;

test("folder of a repository: same number, lower number and release candidate are no update; the update itself agrees; a higher number shows the version", async () => {
  const repo = monorepo();
  assert.equal((await I.installModule(`${repo.url}#:alpha`, { firstInstance: false })).ok, true);
  for (const v of ["1.2.0", "1.1.0", "1.3.0-rc.1"]) {
    fs.writeFileSync(path.join(repo.dir, "alpha/index.mjs"), code(`changed for ${v}`)); fs.writeFileSync(path.join(repo.dir, "alpha/module.json"), JSON.stringify(manifest("alpha", v)));
    repo.g("add", "-A"); repo.g("commit", "-qm", v);
    assert.equal((await I.checkForUpdate("alpha")).available, false, v);
    assert.deepEqual(await outdated(), [], `${v}: not in the late list`);
    assert.deepEqual(await I.updateModule("alpha"), { ok: false, error: "modules.error.uptodate" }, `${v}: the update refuses too`);
  }
  repo.change("alpha/module.json", JSON.stringify(manifest("alpha", "1.3.0")));
  const [late] = await outdated();
  assert.deepEqual([late.id, late.current, late.target, late.level], ["alpha", "1.2.0", "1.3.0", "minor"]);
  assert.doesNotMatch(late.target, HEX);
  assert.equal((await I.updateModule("alpha")).ok, true);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "alpha" } })).version, "1.3.0");
});

test("whole repository on a branch: new commits under the same number are no update; a higher number is, shown as a version", async () => {
  const repo = makeRepo({ "module.json": manifest("alpha", "1.2.0"), "index.mjs": code("a1") });
  repo.change = (file, text) => { fs.writeFileSync(path.join(repo.dir, file), text); repo.g("add", "-A"); repo.g("commit", "-qm", "change"); };
  assert.equal((await I.installModule(`${repo.url}#main`)).ok, true);
  repo.change("index.mjs", code("a2"));
  assert.deepEqual(await I.checkForUpdate("alpha").then((c) => c.available), false);
  assert.deepEqual(await outdated(), []);
  assert.deepEqual(await I.updateModule("alpha"), { ok: false, error: "modules.error.uptodate" });
  repo.change("module.json", JSON.stringify(manifest("alpha", "1.2.1")));
  const check = await I.checkForUpdate("alpha");
  assert.deepEqual([check.available, check.target, check.level], [true, "1.2.1", "patch"]);
  assert.equal((await I.updateModule("alpha")).ok, true);
  assert.equal((await db.prisma.module.findUnique({ where: { id: "alpha" } })).version, "1.2.1");
});
