// Overlay admin hygiene (core 0.26.0): the "Overlay pages" entry and the overlay-skin AI tools only on a site that uses overlays, the "Addresses for OBS" page,
// "Add an element" no longer a primary button (R3), and the read-only placement service for extensions (`ctx.api.overlays.placement`).
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useTestDb } from "../helpers/db.mjs";

const db = await useTestDb();
const P = await import("@/core/overlays/presence");
const S = await import("@/core/overlays/store");
const { administrationEntries } = await import("@/core/modules/adminMenu");
const { overlaySkinsToolProvider } = await import("@/core/overlaySkinsMcp");
const { fakeCtx } = await import("../../testsupport/fakeCtx.mjs");
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
beforeEach(() => db.reset());
after(() => db.close());

const el = (uid, instance, element, extra = {}) => ({ uid, instance, element, x: 0, y: 0, w: 100, h: 100, visible: true, options: {}, ...extra });

test("menu: 'Overlay pages' only on a site that uses overlays; absent information keeps the entry (as before)", () => {
  assert.ok(administrationEntries({ role: "owner", advanced: false }).includes("overlays"));
  assert.ok(administrationEntries({ role: "owner", advanced: false, overlays: true }).includes("overlays"));
  assert.ok(!administrationEntries({ role: "owner", advanced: true, overlays: false }).includes("overlays"));
  assert.ok(!administrationEntries({ role: "editor", advanced: false, overlays: true }).includes("overlays"), "still an administration task");
  assert.match(fs.readFileSync("src/app/admin/(panel)/layout.tsx", "utf8"), /administrationEntries\(\{ role: user\.level, advanced, overlays: canManage \? await overlaysUseful\(\) : false \}\)/);
});

test("overlaysUseful: false on a site without any overlay; true as soon as a page exists (even with every extension removed)", async () => {
  assert.equal(await P.overlaysUseful(), false);
  assert.deepEqual(await overlaySkinsToolProvider.list(), [], "no overlay-skin AI tools on such a site");
  await S.createPage({ name: "Jeu", width: 1920, height: 1080 });
  assert.equal(await P.overlaysUseful(), true);
  assert.ok((await overlaySkinsToolProvider.list()).some((t) => t.name === "overlay_skins_list"));
});

test("placementOf: visible elements of this instance only, with the page state; never an address; a hidden element is not placed", async () => {
  const a = (await S.createPage({ name: "Jeu", width: 1920, height: 1080, elements: [el("aaaaaa1111", "al", "alerts"), el("bbbbbb2222", "pl", "poll")] })).page;
  const b = (await S.createPage({ name: "Pause", width: 1920, height: 1080, elements: [el("cccccc3333", "al", "alerts", { visible: false }), el("dddddd4444", "al", "alerts-stage")] })).page;
  await S.setActive(a.id, false);
  const all = await P.placementOf("al");
  assert.deepEqual(all, { placed: true, onActivePage: true, pages: [{ name: "Jeu", active: false }, { name: "Pause", active: true }] });
  assert.deepEqual(await P.placementOf("al", "alerts"), { placed: true, onActivePage: false, pages: [{ name: "Jeu", active: false }] }, "the hidden copy on Pause does not count");
  assert.deepEqual(await P.placementOf("nobody"), { placed: false, onActivePage: false, pages: [] });
  const secret = await S.readSecret(b.id);
  assert.ok(!JSON.stringify(all).includes(secret));
});

test("ctx.api.overlays.placement: on the real context (no permission), in the test kit (option overlayPlacement), absent on an older core", async () => {
  assert.match(fs.readFileSync("src/core/modules/api.ts", "utf8"), /overlays: \{ placement: \(element\?: string\) => placementOf\(instance\.key/);
  const ctx = fakeCtx({ overlayPlacement: [{ name: "Jeu", active: true, elements: ["alerts"] }, { name: "Pause", active: false, elements: ["poll"] }] });
  assert.deepEqual(await ctx.api.overlays.placement("alerts"), { placed: true, onActivePage: true, pages: [{ name: "Jeu", active: true }] });
  assert.deepEqual(await ctx.api.overlays.placement("poll"), { placed: true, onActivePage: false, pages: [{ name: "Pause", active: false }] });
  assert.deepEqual((await fakeCtx({}).api.overlays.placement()).placed, false);
  assert.deepEqual(ctx.calls.overlayPlacement, ["alerts", "poll"]);
  assert.equal(fakeCtx({ overlayPlacement: null }).api.overlays, undefined);
});

test("R3: 'Add an element' is a secondary button; the page keeps one primary action (Save)", async () => {
  const { OverlayEditor } = await import("@/components/admin/OverlayEditor");
  const { ui } = await import("@/components/admin/ui");
  const strings = Object.fromEntries(Object.entries(fr).filter(([k]) => k.startsWith("ovp.ed.")).map(([k, v]) => [k.slice(4), v]));
  const html = renderToStaticMarkup(React.createElement(OverlayEditor, { initial: { name: "Jeu", width: 1920, height: 1080, style: { text: "light", background: "transparent", corners: "round" }, elements: [] }, available: [], resolutions: [[1920, 1080]], limits: { elements: 30, fold: 3, minSide: 320, maxSide: 7680 }, previewSrc: "/x", strings }));
  const add = /<button[^>]*data-testid="ov-add"[^>]*>/.exec(html)[0];
  assert.ok(add.includes(`class="${ui.btn}"`), add);
  assert.ok(!html.includes(ui.btnPrimary), "no primary button inside the editor itself");
});

test("Addresses for OBS: one table (overlay pages and extension overlays), a written pill per kind, filters with counts, live search; texts FR/EN", () => {
  const src = fs.readFileSync("src/app/admin/(panel)/overlay-pages/obs/page.tsx", "utf8");
  assert.match(src, /<LiveSearch scope="obs"/); assert.match(src, /data-live-item="obs" data-live-kind=\{r\.kind\}/); assert.match(src, /<Badge tone=\{r\.kind === "page" \? "accent" : "info"\}>\{t\(`ovp\.obs\.kind\.\$\{r\.kind\}`\)\}<\/Badge>/);
  assert.match(src, /adminCtx\(OVERLAY_NEED\)/, "same right as the overlay pages");
  assert.doesNotMatch(src, /btnPrimary|<form/, "a page to read and copy: no action, no primary button");
  const keys = Object.keys(fr).filter((k) => k.startsWith("ovp.obs.") || k === "ovp.tab.pages" || k === "ovp.list.tabs");
  assert.ok(keys.length >= 13);
  for (const k of keys) {
    assert.ok(en[k], k);
    if (!/Help$|\.intro$/.test(k)) for (const t of [fr[k], en[k]]) { assert.ok(t.length <= 60, k); assert.doesNotMatch(t, /:\s*$/, k); }
  }
  assert.ok(fs.readFileSync("docs/TRANSLATING.md", "utf8").includes("| addresses for OBS |"));
});
