// The assistant's tool for skin customization (docs/MAINTENANCE-IA.md): values, looks and resets of the skin in use; the SAME validation as the page; no upload;
// nothing applied before the owner approves (a request, like every level 3 tool); a hard-to-read colour is applied as chosen and reported, never corrected.
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb is not a React hook
const db = await useTestDb();
const { setCoreVersionForTests } = await import("@/core/modules/compat");
setCoreVersionForTests(TEST_CORE);
const SK = await import("@/core/maintenance/skins");
const { MAINTENANCE_TOOLS } = await import("@/core/maintenance/tools");
const S = await import("@/core/skins/service");
const A = await import("@/core/skins/appearance");
const C = await import("@/core/skins/customizeStore");
const { McpToolError } = await import("@/core/services/mcp/validate");
const cat = createSkinsRepo();
const SKINS = path.join(db.dir, "skins");

beforeEach(async () => {
  await db.reset();
  fs.rmSync(SKINS, { recursive: true, force: true });
  await cat.clear();
  S.clearSkinCaches();
});
after(() => { db.close(); cat.close(); });

async function setup() {
  await cat.publish("customizable", { from: "customizable" });
  assert.equal((await S.installFromCatalogue("customizable")).ok, true);
  await A.chooseSkin("customizable");
}
const refused = async (args, re) => { await assert.rejects(() => SK.prepareSkinCustomize(args), (e) => e instanceof McpToolError && re.test(e.message), JSON.stringify(args)); };

test("the tool is a level 3 request, off by default, in the full profile only", () => {
  const t = MAINTENANCE_TOOLS.find((x) => x.name === "maintenance_skin_customize");
  assert.deepEqual([t.level, t.request, t.destructive, t.readOnly], [3, true, false, false]);
});

test("status lists what can be customized: ids, types, allowed values, current values; and no upload for an assistant", async () => {
  await setup();
  const st = (await SK.skinStatus()).activeSkin.customize;
  assert.deepEqual(st.looks.map((l) => l.id), ["royal", "crimson", "forest", "night"]);
  const banner = st.settings.find((s) => s.id === "banner");
  assert.deepEqual([banner.type, banner.current, banner.freeColor, banner.swatches], ["color", "royal", true, ["royal", "crimson", "forest", "night"]]);
  assert.equal(st.settings.find((s) => s.id === "emblem").upload, "not available to an assistant");
});

test("prepare checks every value like the page does; nothing is written; uploads and unknown things are refused", async () => {
  await setup();
  const plan = await SK.prepareSkinCustomize({ values: [{ id: "banner", value: "forest" }, { id: "corner", value: "0.8" }, { id: "emblem", value: "helm" }] });
  assert.equal(plan.skin, "customizable");
  assert.deepEqual(plan.customize.values, { banner: "forest", corner: 0.8, emblem: "helm" });
  assert.match(plan.customize.names, /banner forest/);
  assert.equal(await C.readStored("customizable"), null, "preparing writes nothing");
  await refused({ values: [{ id: "nope", value: "x" }] }, /Unknown setting/);
  await refused({ values: [{ id: "banner", value: "#fff;}body{display:none}" }] }, /does not accept/);
  await refused({ values: [{ id: "corner", value: "wide" }] }, /does not accept/);
  await refused({ values: [{ id: "emblem", value: "/uploads/123e4567-e89b-12d3-a456-426614174000.webp" }] }, /does not accept/);
  await refused({ values: [{ id: "banner-image", value: '{"upload":"123e4567-e89b-12d3-a456-426614174000.webp"}' }] }, /does not accept/);
  await refused({ look: "no-such-look" }, /Unknown look/);
  await refused({}, /Give a look/);
  await refused({ reset: ["nope"] }, /does not exist/);
});

test("execute: a look then values on top; merges onto what the owner saved in between; reset puts the skin's own back", async () => {
  await setup();
  await C.saveCustom({ id: "customizable", version: "1.0.0", customize: (await (await import("@/core/skins/appearanceView")).definitionOf("customizable")).customize }, { values: { corner: 0.9 } });
  const plan = await SK.prepareSkinCustomize({ look: "forest", values: [{ id: "trim", value: "silver" }] });
  const out = await SK.executeSkinCustomize(plan, "token-1");
  assert.equal(out.ok, true, JSON.stringify(out));
  const stored = await C.readStored("customizable");
  assert.deepEqual(stored.values, { corner: 0.9, banner: "forest", pennants: "forest", trim: "silver" }, "the owner's own change is kept");
  assert.equal(stored.look, "forest");
  const reset = await SK.executeSkinCustomize(await SK.prepareSkinCustomize({ reset: ["trim", "corner"] }), "token-1");
  assert.equal(reset.ok, true);
  assert.deepEqual((await C.readStored("customizable")).values, { banner: "forest", pennants: "forest" });
  assert.equal((await SK.executeSkinCustomize(await SK.prepareSkinCustomize({ reset: ["all"] }), "t")).ok, true);
  assert.equal(await C.readStored("customizable"), null);
  const again = await SK.executeSkinCustomize(await SK.prepareSkinCustomize({ look: "royal" }), "t");
  assert.match(again.message, /Customization updated|Nothing needed/);
});

test("a hard-to-read colour is applied as chosen and reported (nothing is corrected); a changed skin cancels the request", async () => {
  await setup();
  const out = await SK.executeSkinCustomize(await SK.prepareSkinCustomize({ values: [{ id: "trim", value: "#d9d2c0" }] }), "t");
  assert.equal(out.ok, true);
  assert.match(out.message, /Hard to read: trim \(light\)/);
  assert.match((await C.readStored("customizable")).values.trim, /^#[0-9a-f]{6}$/);
  const plan = await SK.prepareSkinCustomize({ look: "royal" });
  await cat.publish("plain-light", { from: "plain-light" });
  await S.installFromCatalogue("plain-light");
  await A.chooseSkin("plain-light");
  const late = await SK.executeSkinCustomize(plan, "t");
  assert.equal(late.ok, false);
  await assert.rejects(() => SK.prepareSkinCustomize({ look: "royal" }), /declares nothing/);
});
