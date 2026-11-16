// Overlay page editor comfort (core 0.20.0): preview backgrounds, safe margins and their snapping, colour-blind view (maths AND a real Chromium render),
// undo/redo document, saved versions (pure + real database + preview route), the editor markup (texts, parity, nothing leaks to the public page).
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useTestDb } from "../helpers/db.mjs";

process.env.AUTH_SECRET = "test-auth-secret-overlay-comfort";
const db = await useTestDb();
const V = await import("@/core/overlays/editorView");
const L = await import("@/core/overlays/layout");
const H = await import("@/core/compose/history");
const S = await import("@/core/overlays/store");
beforeEach(() => db.reset());
after(() => db.close());

const PAGE = { width: 1920, height: 1080 };
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));

// ── Preview backgrounds ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("preview backgrounds: five choices, drawn in CSS by the core (no file, no address), the game scene has bright AND dark parts", () => {
  assert.deepEqual([...V.PREVIEW_BACKDROPS], ["checker", "dark", "bright", "game", "own"]);
  for (const [k, css] of Object.entries(V.BACKDROP_CSS)) {
    assert.doesNotMatch(JSON.stringify(css), /url\(|https?:|\/\//, `${k} loads nothing`);
    assert.match(css.backgroundColor, /^#[0-9a-f]{6}$/i);
  }
  const game = V.BACKDROP_CSS.game.backgroundImage;
  assert.match(game, /#0b0e14/, "a dark HUD corner"); assert.match(game, /#fffbe0|#d9f1ff/, "a bright sky and sun");
  assert.equal(V.isPreviewBackdrop("own"), true); assert.equal(V.isPreviewBackdrop("url(x)"), false);
  assert.ok(V.OWN_BACKDROP_MAX_BYTES <= 2_000_000, "a screenshot kept in the browser stays small");
});

// ── Safe margins ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("safe margins: action 3.5 %, text 5 % of each edge; the vertical format adds a bottom band (20 %) and a right column (12 %)", () => {
  assert.deepEqual(V.safeAreas("none", PAGE), []);
  const [action, text] = V.safeAreas("broadcast", PAGE);
  assert.deepEqual(action, { kind: "action", x: 67, y: 38, w: 1786, h: 1004 });
  assert.deepEqual(text, { kind: "text", x: 96, y: 54, w: 1728, h: 972 });
  const vert = V.safeAreas("vertical", { width: 1080, height: 1920 });
  assert.equal(vert.length, 4);
  assert.deepEqual(vert[2], { kind: "app", x: 0, y: 1536, w: 1080, h: 384 });
  assert.deepEqual(vert[3], { kind: "app", x: 950, y: 0, w: 130, h: 1536 });
});

test("safe margins: frames snap to them (start or end of the frame), as well as to the page edges and centre; without margins nothing changes", () => {
  const lines = V.safeLines("broadcast", PAGE);
  assert.deepEqual(lines.x, [67, 96, 1824, 1853]);
  assert.deepEqual(lines.y, [38, 54, 1026, 1042]);
  const r = { x: 100, y: 60, w: 400, h: 200 };
  const snapped = L.snapMove(r, PAGE, 8, lines);
  assert.deepEqual([snapped.rect.x, snapped.rect.y], [96, 54]);
  assert.deepEqual(snapped.guides, [{ axis: "x", at: 96 }, { axis: "y", at: 54 }]);
  const end = L.snapMove({ x: 1820 - 400, y: 500, w: 400, h: 100 }, PAGE, 8, lines);
  assert.equal(end.rect.x + 400, 1824, "the frame's right edge snaps to the text zone");
  assert.deepEqual(L.snapMove(r, PAGE, 8), L.snapMove(r, PAGE, 8, V.safeLines("none", PAGE)), "no margins: exactly the previous behaviour");
  assert.deepEqual(L.snapMove(r, PAGE, 8).rect, r, "far from every line: not moved");
});

test("near the edge: a frame outside the text zone, or over a phone band, gets the hint; never without margins", () => {
  assert.equal(V.nearEdge({ x: 40, y: 40, w: 300, h: 100 }, "broadcast", PAGE), true);
  assert.equal(V.nearEdge({ x: 96, y: 54, w: 300, h: 100 }, "broadcast", PAGE), false);
  assert.equal(V.nearEdge({ x: 40, y: 40, w: 300, h: 100 }, "none", PAGE), false);
  const tall = { width: 1080, height: 1920 };
  assert.equal(V.nearEdge({ x: 100, y: 1500, w: 400, h: 200 }, "broadcast", tall), false);
  assert.equal(V.nearEdge({ x: 100, y: 1500, w: 400, h: 200 }, "vertical", tall), true, "covers the bottom band of phone apps");
});

// ── Colour-blind view ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("colour-blind view: matrices keep white and black, red and green become close for deuteranopia and protanopia, blue and green for tritanopia", () => {
  for (const m of ["deuteranopia", "protanopia", "tritanopia"]) {
    const M = V.CVD_MATRICES[m];
    for (let r = 0; r < 3; r++) assert.ok(Math.abs(M[r * 3] + M[r * 3 + 1] + M[r * 3 + 2] - 1) < 0.002, `${m} row ${r} sums to 1`);
    assert.deepEqual(V.simulateCvd([255, 255, 255], m), [255, 255, 255]);
    assert.deepEqual(V.simulateCvd([0, 0, 0], m), [0, 0, 0]);
    assert.equal(V.cvdFilterValues(m).split(/\s+/).length, 20);
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const red = [214, 40, 40], green = [40, 160, 60];
  for (const m of ["deuteranopia", "protanopia"]) assert.ok(dist(V.simulateCvd(red, m), V.simulateCvd(green, m)) < dist(red, green) * 0.5, `${m}: red and green look alike`);
  const blue = [40, 80, 220], teal = [40, 170, 120];
  assert.ok(dist(V.simulateCvd(blue, "tritanopia"), V.simulateCvd(teal, "tritanopia")) < dist(blue, teal) * 0.5, "tritanopia: blue and green look alike");
  assert.deepEqual(V.simulateCvd(red, "none"), red);
});

let pw = null;
try { const lib = await import("../../scripts/visual/lib/playwright.mjs"); pw = { chromium: lib.loadPlaywright().chromium, path: lib.chromiumPath(), args: lib.CHROMIUM_ARGS }; } catch { pw = null; }
const skipBrowser = pw ? false : "Chromium or playwright not found: real render not tried";

test("real browser: the SVG filter the editor draws turns red and green into close colours, as the maths say (within 6 levels)", { skip: skipBrowser, timeout: 60000 }, async () => {
  const filters = ["deuteranopia", "protanopia", "tritanopia"].map((m) => `<filter id="f-${m}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${V.cvdFilterValues(m)}"/></filter>`).join("");
  const sw = (c) => `<div style="width:40px;height:40px;background:rgb(${c.join(",")})"></div>`;
  const html = `<!doctype html><html><body style="margin:0"><svg width="0" height="0" style="position:absolute"><defs>${filters}</defs></svg>${["deuteranopia", "protanopia", "tritanopia"].map((m) => `<div style="display:flex;filter:url(#f-${m})">${sw([214, 40, 40])}${sw([40, 160, 60])}${sw([255, 255, 255])}</div>`).join("")}</body></html>`;
  const browser = await pw.chromium.launch({ executablePath: pw.path, args: pw.args });
  try {
    const page = await browser.newPage({ viewport: { width: 200, height: 200 } });
    await page.setContent(html);
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 120, height: 120 } });
    const px = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
      const at = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
      return [0, 1, 2].map((row) => [at(20, row * 40 + 20), at(60, row * 40 + 20), at(100, row * 40 + 20)]);
    }, shot.toString("base64"));
    ["deuteranopia", "protanopia", "tritanopia"].forEach((m, row) => {
      const [r, g, w] = px[row];
      const er = V.simulateCvd([214, 40, 40], m), eg = V.simulateCvd([40, 160, 60], m);
      for (let i = 0; i < 3; i++) { assert.ok(Math.abs(r[i] - er[i]) <= 6, `${m} red ${r} vs ${er}`); assert.ok(Math.abs(g[i] - eg[i]) <= 6, `${m} green ${g} vs ${eg}`); }
      assert.deepEqual(w, [255, 255, 255]);
    });
  } finally { await browser.close(); }
});

// ── Undo / redo ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("undo: the editor document reuses the 50-step history of the composition editor; a click that changes nothing is not a step", () => {
  const doc = (x) => ({ size: PAGE, style: { text: "light", background: "transparent", corners: "round" }, elements: [{ uid: "u000001", x }] });
  let h = H.startHistory(doc(0));
  h = H.record(h, doc(0), V.sameDoc);
  assert.equal(h.past.length, 0, "same value: no step");
  for (let i = 1; i <= 60; i++) h = H.record(h, doc(i), V.sameDoc);
  assert.equal(h.past.length, 50);
  h = H.undo(H.undo(h));
  assert.equal(h.present.elements[0].x, 58);
  h = H.redo(h);
  assert.equal(h.present.elements[0].x, 59);
  assert.equal(V.sameDoc(doc(3), doc(3)), true); assert.equal(V.sameDoc(doc(3), doc(4)), false);
});

// ── Saved versions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const base = (name, x = 0) => ({ name, width: 1920, height: 1080, style: { text: "light", background: "transparent", corners: "round" }, elements: [{ uid: "u000001", instance: "demo", element: "board", x, y: 0, w: 400, h: 300, visible: true, options: {} }] });

test("saved versions (pure): the replaced state goes first, 10 at most, an unchanged save adds nothing, a damaged column gives fewer versions", () => {
  let list = [];
  for (let i = 0; i < 14; i++) list = S.pushVersion(list, { at: 1000 + i, rev: i + 1, ...base(`v${i}`) }, base(`v${i + 1}`));
  assert.equal(list.length, S.MAX_VERSIONS);
  assert.deepEqual(list.map((v) => v.name).slice(0, 3), ["v13", "v12", "v11"]);
  assert.equal(S.pushVersion(list, { at: 5000, rev: 99, ...base("same") }, base("same")).length, list.length, "nothing changed: no version");
  assert.deepEqual(S.parseVersions("not json"), []);
  assert.deepEqual(S.parseVersions(JSON.stringify([{ at: "x" }, { at: 5, name: "" }, null])), []);
  const back = S.parseVersions(JSON.stringify(list));
  assert.equal(back.length, 10); assert.equal(back[0].elements[0].uid, "u000001");
  assert.ok(!JSON.stringify(back).includes("secret"));
});

test("saved versions (database): each save keeps the layout it replaces; restore puts it back and keeps the current one; the look is untouched", async () => {
  const made = (await S.createPage({ name: "Principale", width: 1920, height: 1080 })).page;
  assert.deepEqual(await S.listVersions(made.id), []);
  const { parseLook } = await import("@/core/overlays/look");
  await S.saveLook(made.id, parseLook({ skin: "night-neon" }));
  assert.ok((await S.savePage(made.id, base("Première", 10))).ok);
  assert.ok((await S.savePage(made.id, base("Deuxième", 20))).ok);
  const versions = await S.listVersions(made.id);
  assert.deepEqual(versions.map((v) => v.name), ["Première", "Principale"]);
  assert.deepEqual(versions[0].elements.map((e) => e.x), [10]);
  const r = await S.restoreVersion(made.id, versions[0].at);
  assert.ok(r.ok);
  assert.equal(r.page.name, "Première"); assert.equal(r.page.elements[0].x, 10);
  assert.deepEqual((await S.listVersions(made.id)).map((v) => v.name).slice(0, 2), ["Deuxième", "Première"], "the replaced layout is a version in turn");
  assert.equal((await S.restoreVersion(made.id, 12345)).error, "notFound");
  assert.equal((await S.restoreVersion("nope", versions[0].at)).error, "notFound");
  // A copy starts without versions; the secret never appears in them.
  const copy = (await S.duplicatePage(made.id, (n) => `${n} (copie)`)).page;
  assert.deepEqual(await S.listVersions(copy.id), []);
  const raw = (await db.prisma.overlayPage.findUnique({ where: { id: made.id } })).versions;
  const secret = await S.readSecret(made.id);
  assert.ok(secret && !raw.includes(secret));
  for (let i = 0; i < 13; i++) await S.savePage(made.id, base(`n${i}`, i));
  assert.equal((await S.listVersions(made.id)).length, 10);
});

test("migration: one column added to OverlayPage (versions, default empty list), nothing else; an older core ignores it", async () => {
  const sql = fs.readFileSync("prisma/migrations/20261116090000_overlay_page_versions/migration.sql", "utf8").replace(/^--.*$/gm, "").trim();
  assert.match(sql, /^ALTER TABLE "OverlayPage" ADD COLUMN "versions" TEXT NOT NULL DEFAULT '\[\]';$/);
  const cols = (await db.prisma.$queryRawUnsafe(`PRAGMA table_info("OverlayPage")`)).map((c) => c.name);
  assert.ok(cols.includes("versions"));
});

// ── Nothing reaches the public page ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("the public page does not change: no preview background, no guide, no filter in what OBS reads", () => {
  const src = fs.readFileSync("src/core/overlays/render.ts", "utf8");
  for (const word of ["editorView", "BACKDROP_CSS", "feColorMatrix", "safeAreas"]) assert.ok(!src.includes(word), word);
});

// ── Editor texts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const NEW_KEYS = ["history", "undo", "redo", "undoKeys", "redoKeys", "undone", "redone", "backdrop", "backdropHelp", "backdrop.checker", "backdrop.dark", "backdrop.bright", "backdrop.game", "backdrop.own", "backdrop.ownChange", "backdrop.ownTooBig",
  "viewTools", "safe", "safeHelp", "safe.none", "safe.broadcast", "safe.vertical", "nearEdge", "cvd", "cvdHelp", "cvd.none", "cvd.deuteranopia", "cvd.protanopia", "cvd.tritanopia",
  "lookClip", "copyLook", "pasteLook", "applyLookAll", "lookCopied", "lookPasted", "lookAppliedAll", "lookAppliedAll.one"].map((k) => `ovp.ed.${k}`)
  .concat(["ovp.versions", "ovp.versions.intro", "ovp.versions.empty", "ovp.versions.help", "ovp.versions.row", "ovp.versions.row.one", "ovp.versions.preview", "ovp.versions.restore", "ovp.versions.restoring", "ovp.versions.confirm", "audit.action.overlay.restore"]);
const vars = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("texts: French and English for every new word, same variables; labels short without a final colon; long precisions only in help bubbles", () => {
  const page = fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/page.tsx", "utf8");
  for (const k of NEW_KEYS) {
    assert.ok(fr[k] && en[k], k);
    assert.equal(vars(fr[k]), vars(en[k]), k);
    if (k.startsWith("ovp.ed.") && !page.includes(`"${k.slice(7)}"`)) assert.fail(`${k} is not sent to the editor`);
    const isHelp = /Help$|\.help$|confirm$/.test(k);
    for (const t of [fr[k], en[k]]) {
      if (!isHelp) assert.ok(t.length <= 60, `${k}: ${t}`);
      assert.doesNotMatch(t, /:\s*$|!/, k);
      assert.doesNotMatch(t, /\b(clé|token|jeton|cache|JSON|API|key|slug)\b/i, k);
    }
  }
  const tr = fs.readFileSync("docs/TRANSLATING.md", "utf8");
  for (const w of ["saved version", "vertical format", "colour-blind view"]) assert.ok(tr.includes(`| ${w} |`), `glossary: ${w}`);
});

test("editor markup: undo and redo are labelled buttons, the preview background is a labelled list, nothing for the public page", async () => {
  const { OverlayEditor } = await import("@/components/admin/OverlayEditor");
  const strings = Object.fromEntries(Object.entries(fr).filter(([k]) => k.startsWith("ovp.ed.")).map(([k, v]) => [k.slice(4), v]));
  const html = renderToStaticMarkup(React.createElement(OverlayEditor, {
    initial: { name: "Jeu", width: 1920, height: 1080, style: { text: "light", background: "transparent", corners: "round" }, elements: [] },
    available: [], resolutions: [[1920, 1080]], limits: { elements: 30, fold: 3, minSide: 320, maxSide: 7680 }, previewSrc: "/x", strings, pageId: "p1",
  }));
  assert.match(html, /aria-label="Annuler"[^>]*data-testid="ov-undo"|data-testid="ov-undo"[^>]*aria-label="Annuler"/);
  assert.match(html, /data-testid="ov-redo"/);
  assert.match(html, /<label for="[^"]+-bg"[^>]*>Fond d&#x27;aperçu/);
  for (const v of ["Damier", "Vidéo sombre", "Vidéo claire", "Scène de jeu", "Votre capture"]) assert.ok(html.includes(`>${v}</option>`), v);
  assert.match(html, /Repères et couleurs/);
  assert.ok(!/feColorMatrix[^>]*url\(/.test(html));
});
