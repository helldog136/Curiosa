// TV text size and canvas formats (core 0.23.0): TV sizes follow the shortest side for new pages, old vertical pages keep their size until "Fix the text
// size" (owner decision 5), the vertical, 4:3 and 21:9 formats, TV size for new elements without TV sizes of their own.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const TS = await import("@/core/overlays/textScale");
const M = await import("@/core/overlays/model");
const { parseStyle } = await import("@/core/overlays/tokens");
const { addElement } = await import("@/core/overlays/editorModel");
const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const page = (width, height, tvBase) => ({ width, height, style: { text: "light", background: "transparent", corners: "round", ...(tvBase ? { tvBase } : {}) } });
const factor = (p) => TS.tvFactor(TS.tvSide(p), 100, 1);

test("TV factor on the shortest side (design 3.3): 1280x720 0.667, 1920x1080 1, 2560x1440 and 3440x1440 1.333, 3840x2160 2, 1080x1920 1, 1440x1080 1", () => {
  const want = [[1280, 720, 0.6667], [1920, 1080, 1], [2560, 1440, 1.3333], [3440, 1440, 1.3333], [3840, 2160, 2], [1080, 1920, 1], [1440, 1080, 1], [2560, 1080, 1]];
  for (const [w, h, f] of want) assert.equal(factor(page(w, h, "short")), f, `${w}x${h}`);
});

test("owner decision 5: a page made before keeps its height-based size (no automatic change); landscape pages are the same either way", () => {
  assert.equal(factor(page(1080, 1920)), 1.7778, "an old vertical page: unchanged until the person clicks");
  assert.equal(TS.tvTextTooLarge(page(1080, 1920)), true);
  assert.equal(TS.tvTextTooLarge(page(1080, 1920, "short")), false);
  assert.equal(TS.tvTextTooLarge(page(1920, 1080)), false, "a landscape page never needs the fix");
  for (const [w, h] of M.RESOLUTIONS.filter(([w, h]) => w >= h)) assert.equal(factor(page(w, h)), factor(page(w, h, "short")), `${w}x${h}`);
  assert.deepEqual(parseStyle({ text: "light", background: "soft", corners: "round" }), { text: "light", background: "soft", corners: "round" }, "nothing stored for old pages");
  assert.equal(parseStyle({ tvBase: "short" }).tvBase, "short");
  assert.equal("tvBase" in parseStyle({ tvBase: "long" }), false);
  const resolve = fs.readFileSync("src/core/overlays/resolve.ts", "utf8");
  assert.match(resolve, /tvFactor\(tvSide\(page\), percent, layout\.scale\)/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/overlay-pages/actions.ts", "utf8"), /createPage\(\{[^}]*tvBase: "short" \}/, "every NEW page is sized on its short side");
});

test("formats: vertical 1080x1920, 4:3 1440x1080 and 21:9 2560x1080 are offered, named in the lists", () => {
  for (const r of [[1080, 1920], [1440, 1080], [2560, 1080]]) assert.ok(M.RESOLUTIONS.some(([w, h]) => w === r[0] && h === r[1]), r.join("x"));
  assert.deepEqual(M.RESOLUTIONS.slice(0, 5), [[1280, 720], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160]], "the 0.22.0 choices keep their order (1920x1080 stays the default)");
  assert.deepEqual(M.DEFAULT_RESOLUTION, [1920, 1080]);
  assert.equal(M.formatOf(1080, 1920), "vertical"); assert.equal(M.formatOf(1440, 1080), "fourThree"); assert.equal(M.formatOf(2560, 1080), "ultrawide"); assert.equal(M.formatOf(1920, 1080), null);
  for (const f of ["vertical", "fourThree", "ultrawide"]) for (const k of [`ovp.format.${f}`, `ovp.ed.format.${f}`]) assert.ok(fr[k] && en[k], k);
});

test("a new element without TV sizes of its own starts at TV (recommended); with TV sizes, or on a page already large, it follows the page", () => {
  const decl = { fit: "scale", size: [640, 260] };
  const pick = { instance: "al", element: "alerts", decl, defaults: {} };
  assert.equal(addElement([], { width: 1920, height: 1080 }, { ...pick, textScale: 200 }, "aaaaaa1111")[0].textScale, 200);
  assert.equal("textScale" in addElement([], { width: 1920, height: 1080 }, pick, "aaaaaa1111")[0], false);
  const editor = fs.readFileSync("src/components/admin/OverlayEditor.tsx", "utf8");
  assert.match(editor, /a\.tvScale === false && \(style\.textScale \?\? 100\) <= 100 \? \{ textScale: TV_PERCENT \}/);
  assert.match(fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/page.tsx", "utf8"), /tvScale: !!c\.decl\.tvScale/);
});

test("editor: an old vertical page shows 'Fix the text size' (a warning with its text, a button, a help bubble); a new one does not", async () => {
  const { OverlayEditor } = await import("@/components/admin/OverlayEditor");
  const strings = Object.fromEntries(Object.entries(fr).filter(([k]) => k.startsWith("ovp.ed.")).map(([k, v]) => [k.slice(4), v]));
  const render = (style) => renderToStaticMarkup(React.createElement(OverlayEditor, {
    initial: { name: "Vertical", width: 1080, height: 1920, style: { text: "light", background: "transparent", corners: "round", ...style }, elements: [] },
    available: [], resolutions: M.RESOLUTIONS.map(([w, h]) => [w, h]), limits: { elements: 30, fold: 3, minSide: 320, maxSide: 7680 }, previewSrc: "/x", strings, pageId: "p1",
  }));
  const old = render({});
  assert.match(old, /data-testid="tv-fix"/); assert.match(old, /Texte trop grand pour ce format vertical/); assert.match(old, />Corriger la taille du texte</);
  assert.doesNotMatch(render({ tvBase: "short" }), /data-testid="tv-fix"/);
  assert.match(old, /1080×1920 · Vertical/); assert.match(old, /1440×1080 · 4:3/);
  for (const k of ["ovp.ed.tvFix", "ovp.ed.tvFix.warn", "ovp.ed.tvFix.done"]) for (const d of [fr, en]) { assert.ok(d[k].length <= 60, k); assert.doesNotMatch(d[k], /:\s*$/); }
  const tr = fs.readFileSync("docs/TRANSLATING.md", "utf8");
  assert.ok(tr.includes("| Fix the text size |"));
});
