// Monorepo tags (0.42.0): `<id>/vX.Y.Z` is read next to `vX.Y.Z`, for the update check of a custom skin and of a custom module.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { makeRepo } from "../helpers/repo.mjs";
import { copySkin, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const V = await import("@/core/updates/versions");
const S = await import("@/core/skins/service");
after(() => db.close());

const ls = (...tags) => tags.map((t, i) => `${String(i).padStart(40, "a")}\trefs/tags/${t}`).join("\n");

test("pickLatestTag: the plain series ignores prefixed tags, a prefix reads only its own series", () => {
  const out = ls("v1.0.0", "v1.2.0", "glass/v1.0.1", "glass/v1.1.0", "other/v9.0.0", "glass/v1.1.0-rc.1");
  assert.equal(V.pickLatestTag(out), "v1.2.0");
  assert.equal(V.pickLatestTag(out, "glass/"), "glass/v1.1.0");
  assert.equal(V.pickLatestTag(out, "none/"), null);
  assert.equal(V.pickLatestTag(ls("glass/v1.0.0"), ""), null);
});

test("release tags, prefixes and comparisons", () => {
  assert.ok(V.isReleaseTag("v1.2.3") && V.isReleaseTag("1.2.3") && V.isReleaseTag("glass/v1.2.3"));
  for (const bad of ["glass/main", "Glass/v1.0.0", "a/b/v1.0.0", "v1.0", "", null]) assert.equal(V.isReleaseTag(bad), false, String(bad));
  assert.equal(V.tagPrefix("glass/v1.0.0"), "glass/");
  assert.equal(V.tagPrefix("v1.0.0"), "");
  assert.equal(V.classify("glass/v1.0.0", "glass/v1.1.0"), "minor");
  assert.equal(V.classify("glass/v1.0.0", "glass/v2.0.0"), "major");
  assert.equal(V.classify("glass/v1.1.0", "glass/v1.0.0"), null);
  assert.equal(V.compareVersions("glass/v1.0.9", "glass/v1.0.10"), -1);
});

test("a custom skin pinned on <id>/vX.Y.Z is offered the next tag of its own series only", async () => {
  process.env.CURIOSA_ALLOW_LOCAL_MODULES = "1";
  const repo = makeRepo({ "README.md": "mono" });
  const commit = (m) => { repo.g("add", "-A"); repo.g("commit", "-q", "--allow-empty", "--no-verify", "-m", m); };
  copySkin("plain-light", path.join(repo.dir, "skins/glass-sample"), { id: "glass-sample", version: "1.0.0" });
  commit("v1"); repo.g("tag", "glass-sample/v1.0.0");
  const r = await S.install(`${repo.url}#glass-sample/v1.0.0:skins/glass-sample`, { confirmPersonal: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(await S.checkUpdate("glass-sample"), { available: false });
  repo.g("tag", "other-skin/v7.0.0"); repo.g("tag", "v8.0.0");
  assert.deepEqual(await S.checkUpdate("glass-sample"), { available: false }, "another series does not count");
  copySkin("plain-light", path.join(repo.dir, "skins/glass-sample"), { id: "glass-sample", version: "1.1.0" });
  commit("v1.1"); repo.g("tag", "glass-sample/v1.1.0");
  const c = await S.checkUpdate("glass-sample");
  assert.deepEqual([c.available, c.target, c.level], [true, "glass-sample/v1.1.0", "minor"]);
  const u = await S.update("glass-sample", { actor: "o@e.org" });
  assert.deepEqual([u.ok, u.version], [true, "1.1.0"], JSON.stringify(u));
  assert.equal((await S.installed())[0].ref, "glass-sample/v1.1.0");
  fs.rmSync(repo.dir, { recursive: true, force: true });
});
