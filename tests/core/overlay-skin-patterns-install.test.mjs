// A contract 7 overlay skin with its own mosaic pieces goes through the SAME validator as every other way in: dropped as a .zip, then read back from the installed files on
// every use. The page gets the numbers inside the recipe, never the file; a file altered on disk is no longer trusted.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { patternSkin, LT } from "../helpers/overlay-pattern-skin.mjs";
import { zipFolder } from "../helpers/zip.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests("0.48.0");
const S = await import("@/core/skins/service");
const U = await import("@/core/skins/uploadService");
const L = await import("@/core/overlays/skinLoad");
const Se = await import("@/core/skins/serve");
after(() => db.close());
beforeEach(async () => { await db.reset(); fs.rmSync(path.join(db.dir, "skins"), { recursive: true, force: true }); S.setServiceHooksForTests({}); S.clearSkinCaches(); });

const add = async (dir, top = "slate-test") => {
  const st = await U.stageUpload(zipFolder(dir, { top }), { actor: "camille@test" });
  if (!st.ok) return st;
  return U.addStaged(st.token, { actor: "camille@test" });
};

test("zip: the skin is checked, added, its pattern files are on disk, and the payload carries the numbers", async () => {
  const added = await add(patternSkin("slate-test"));
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(db.dir, "skins/slate-test/1.0.0/patterns/wide.json"), "utf8")), LT);
  assert.equal((await S.installed()).find((s) => s.id === "slate-test").status, "ok");
  const p = await L.skinPayload("slate-test");
  assert.ok(p?.anim, "the payload carries the recipe");
  assert.equal(p.anim.animateContract, 4);
  assert.equal(p.anim.patterns.arch.length, 1);
  assert.deepEqual(p.anim.patterns.arch[0].domain, [120, 60]);
  assert.doesNotMatch(JSON.stringify(p), /patterns\/wide\.json/, "the page never learns a file name");
});

test("zip: a pattern that overlaps, or one nobody declared, is refused with the same messages and nothing is staged", async () => {
  const overlap = { patternContract: 1, domain: [100, 100], cells: [{ p: [[0, 0], [60, 0], [60, 100], [0, 100]], tone: 0.2 }, { p: [[40, 0], [100, 0], [100, 100], [40, 100]], tone: 0.7 }] };
  const a = await U.stageUpload(zipFolder(patternSkin("slate-test", { patterns: { "wide.json": overlap } }), { top: "slate-test" }), { actor: "camille@test" });
  assert.equal(a.ok, false); assert.ok(JSON.stringify(a).includes("pattern-overlap"), JSON.stringify(a));
  const b = await U.stageUpload(zipFolder(patternSkin("slate-test", { patterns: { "wide.json": LT, "other.json": LT }, assets: [{ file: "patterns/wide.json", kind: "pattern" }] }), { top: "slate-test" }), { actor: "camille@test" });
  assert.equal(b.ok, false); assert.ok(JSON.stringify(b).includes("skin-file-unlisted"), JSON.stringify(b));
  assert.equal(fs.existsSync(path.join(db.dir, "skins/slate-test")), false);
});

test("a pattern file altered on disk after the install is no longer trusted: the skin is not served to a page", async () => {
  assert.equal((await add(patternSkin("slate-test"))).ok, true);
  assert.ok(await L.skinPayload("slate-test"));
  fs.writeFileSync(path.join(db.dir, "skins/slate-test/1.0.0/patterns/wide.json"), JSON.stringify({ ...LT, cells: LT.cells.slice(0, 2) }));
  S.clearSkinCaches();
  assert.equal(await L.skinPayload("slate-test"), null, "the fingerprint no longer matches");
  assert.equal((await S.installed()).find((s) => s.id === "slate-test").status !== "ok", true);
});

test("a pattern file is never served by the skin file route", async () => {
  assert.equal((await add(patternSkin("slate-test"))).ok, true);
  for (const dir of ["patterns", "images", "fonts"]) assert.equal(Se.resolveSkinAsset("slate-test", "1.0.0", dir, "wide.json"), null, dir);
});
