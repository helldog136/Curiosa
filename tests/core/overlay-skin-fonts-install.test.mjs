// A contract 6 overlay skin with a font goes through the SAME validator as every other way in: dropped as a .zip, then loaded from the installed files (payload with fonts).
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { fontSkin, FONT } from "../helpers/overlay-font-skin.mjs";
import { zipFolder } from "../helpers/zip.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests("0.47.0");
const S = await import("@/core/skins/service");
const U = await import("@/core/skins/uploadService");
const L = await import("@/core/overlays/skinLoad");
after(() => db.close());
beforeEach(async () => { await db.reset(); fs.rmSync(path.join(db.dir, "skins"), { recursive: true, force: true }); S.setServiceHooksForTests({}); S.clearSkinCaches(); });

test("zip: the font skin is checked, added, its font is on disk, and the payload carries the fonts and the generated rule", async () => {
  const zip = zipFolder(fontSkin("emma-skin", { manifest: { twinOf: "lune-douce" } }), { top: "emma-skin" });
  const st = await U.stageUpload(zip, { actor: "camille@test" });
  assert.equal(st.ok, true, JSON.stringify(st));
  const added = await U.addStaged(st.token, { actor: "camille@test" });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.deepEqual(fs.readFileSync(path.join(db.dir, "skins/emma-skin/1.0.0/fonts/fredoka.woff2")), FONT);
  const listed = (await S.installed()).find((s) => s.id === "emma-skin");
  assert.deepEqual([listed.status, listed.twinOf], ["ok", "lune-douce"]);
  const p = await L.skinPayload("emma-skin");
  assert.ok(p, "the payload loads");
  assert.deepEqual(p.fonts.map((f) => f.family), ["ov-emma-skin-fredoka"]);
  assert.match(p.css, /^@font-face\{font-family:"ov-emma-skin-fredoka"/);
});

test("zip: a font that is not a woff2, or a family nobody declared, is refused with the same messages and nothing is staged", async () => {
  const bad = Buffer.from(FONT); bad.write("XXXX", 0);
  const a = await U.stageUpload(zipFolder(fontSkin("emma-skin", { fonts: { "fredoka.woff2": bad } }), { top: "emma-skin" }), { actor: "camille@test" });
  assert.equal(a.ok, false); assert.ok(JSON.stringify(a).includes("asset-signature"), JSON.stringify(a));
  const b = await U.stageUpload(zipFolder(fontSkin("emma-skin", { tokens: { "--ov-fg": "#fff", "--ov-surface": "#000", "--ov-font": '"Cinzel", serif' } }), { top: "emma-skin" }), { actor: "camille@test" });
  assert.equal(b.ok, false); assert.ok(JSON.stringify(b).includes("overlay-font-undeclared"), JSON.stringify(b));
  assert.equal(fs.existsSync(path.join(db.dir, "skins/emma-skin")), false);
});
