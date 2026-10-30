// Pages d'overlay (0.5.0) : la logique pure — déclaration du manifeste, géométrie des trois comportements, éditeur, options, adresse, page de rendu, mode test.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { parseManifest } = await import("@/core/modules/manifest");
const L = await import("@/core/overlays/layout");
const E = await import("@/core/overlays/editorModel");
const O = await import("@/core/overlays/options");
const M = await import("@/core/overlays/model");
const A = await import("@/core/overlays/address");
const R = await import("@/core/overlays/render");
const T = await import("@/core/overlays/tokens");
const { validatePageInput } = await import("@/core/overlays/pageInput");
const { issueMessages } = await import("@/core/overlays/messages");
const { makeTranslator } = await import("@/core/i18n/dictionary");

const base = (extra) => ({ apiVersion: 2, id: "demo", name: "Demo", version: "1.0.0", minCore: "0.5.0", ...extra });
const el = (extra = {}) => ({ id: "clock", label: { fr: "Horloge", en: "Clock" }, fit: "scale", size: { width: 600, height: 200 }, ...extra });
const parse = (extra) => parseManifest(base(extra));

// ── Manifeste ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("manifeste : un élément valide, les défauts (scale, suit le style) et les trois comportements", () => {
  const r = parse({ overlayElements: [el({ fit: undefined }), { id: "wide", label: "Wide", fit: "ratio", referenceHeight: 1080, ratios: { min: 1.3, max: 2.4 } }, { id: "list", label: "List", fit: "fluid", minSize: { width: 300, height: 200 } }] });
  assert.ok(r.ok, r.error);
  const [a, b, c] = r.manifest.overlayElements;
  assert.equal(a.fit, "scale"); assert.equal(a.followsStyle, true); assert.deepEqual(a.options, []);
  assert.equal(b.fit, "ratio"); assert.equal(c.fit, "fluid");
});

test("manifeste : refus propres (minCore, taille manquante, ratio manquant, doublons, clés inconnues)", () => {
  const bad = (extra, part) => { const r = parse(extra); assert.equal(r.ok, false, JSON.stringify(extra)); assert.match(r.error, part); };
  bad({ minCore: "0.4.0", overlayElements: [el()] }, /minCore 0\.5\.0/);
  bad({ minCore: undefined, overlayElements: [el()] }, /minCore 0\.5\.0/);
  bad({ overlayElements: [el({ size: undefined })] }, /natural size/);
  bad({ overlayElements: [{ id: "w", label: "W", fit: "ratio", ratios: { min: 1, max: 2 } }] }, /referenceHeight/);
  bad({ overlayElements: [{ id: "w", label: "W", fit: "ratio", referenceHeight: 1080 }] }, /ratios/);
  bad({ overlayElements: [{ id: "w", label: "W", fit: "fluid", size: { width: 100, height: 100 } }] }, /only for scale/);
  bad({ overlayElements: [el(), el()] }, /duplicate element id/);
  bad({ overlayElements: [el({ surprise: 1 })] }, /overlayElements/);
  bad({ overlayElements: [el({ id: "Bad Id" })] }, /element id/);
  bad({ overlayElements: [] }, /overlayElements/);
  bad({ overlayElements: [{ id: "w", label: "W", fit: "ratio", referenceHeight: 1080, ratios: { min: 3, max: 2 } }] }, /ratios\.min/);
});

test("manifeste : options (4 types), bornes dures à 20, défauts cohérents", () => {
  const opt = (i) => ({ id: `o${i}`, type: "boolean", label: "O" });
  assert.ok(parse({ overlayElements: [el({ options: Array.from({ length: 20 }, (_, i) => opt(i)) })] }).ok);
  assert.equal(parse({ overlayElements: [el({ options: Array.from({ length: 21 }, (_, i) => opt(i)) })] }).ok, false, "21 options : refusé");
  assert.equal(parse({ overlayElements: [el({ options: [{ id: "x", type: "color", label: "C" }] })] }).ok, false, "type inconnu");
  assert.equal(parse({ overlayElements: [el({ options: [{ id: "c", type: "choice", label: "C", choices: [{ value: "a", label: "A" }] }] })] }).ok, false, "un choix a au moins deux valeurs");
  assert.equal(parse({ overlayElements: [el({ options: [{ id: "n", type: "number", label: "N", min: 5, max: 1 }] })] }).ok, false);
  assert.equal(parse({ overlayElements: [el({ options: [{ id: "n", type: "number", label: "N", min: 1, max: 5, default: 9 }] })] }).ok, false);
  assert.equal(parse({ overlayElements: [el({ options: [opt(1), opt(1)] })] }).ok, false, "doublon d'option");
  assert.equal(parse({ overlayElements: [el({ options: [{ id: "t", type: "text", label: "T", maxLength: 500 }] })] }).ok, false, "texte trop long");
});

// ── Géométrie ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGE = { width: 3440, height: 1440 };
const scale = { fit: "scale", size: { width: 600, height: 200 } };
const ratio = { fit: "ratio", referenceHeight: 1080, ratios: { min: 1.3, max: 2.4 } };
const fluid = { fit: "fluid", minSize: { width: 300, height: 200 }, ratios: { min: 0.5, max: 4 } };

test("rendu scale : taille naturelle mise à l'échelle comme une image, ratio verrouillé", () => {
  const f = L.frameLayout(scale, { w: 1200, h: 400 });
  assert.deepEqual([f.iframeW, f.iframeH, f.scale, f.boxW, f.boxH], [600, 200, 2, 1200, 400]);
  const g = L.frameLayout(scale, { w: 300, h: 100 });
  assert.equal(g.scale, 0.5);
  const h = L.frameLayout(scale, { w: 900, h: 100 }); // cadre trop large : l'image reste à l'échelle de la hauteur, centrée
  assert.equal(h.scale, 0.5); assert.equal(h.boxW, 300); assert.equal(h.offsetX, 300);
});

test("rendu ratio : fenêtre virtuelle de hauteur de référence, largeur selon le ratio du cadre, puis échelle", () => {
  const f = L.frameLayout(ratio, { w: 3440, h: 1440 }); // 21:9 ≈ 2,389
  assert.equal(f.iframeH, 1080); assert.equal(f.iframeW, Math.round(1080 * (3440 / 1440)));
  assert.ok(Math.abs(f.scale - 1440 / 1080) < 1e-3, `échelle ${f.scale}`);
  const g = L.frameLayout(ratio, { w: 1920, h: 1080 });
  assert.deepEqual([g.iframeW, g.iframeH, g.scale], [1920, 1080, 1]);
  const h = L.frameLayout(ratio, { w: 4000, h: 1000 }); // ratio 4 > 2,4 : plafonné à la plage, scène centrée
  assert.equal(h.iframeW, Math.round(1080 * 2.4)); assert.ok(h.offsetX > 0);
});

test("rendu fluid : taille réelle ; sous la taille minimale, fenêtre minimale puis réduction", () => {
  const f = L.frameLayout(fluid, { w: 800, h: 500 });
  assert.deepEqual([f.iframeW, f.iframeH, f.scale], [800, 500, 1]);
  const g = L.frameLayout(fluid, { w: 150, h: 100 });
  assert.deepEqual([g.iframeW, g.iframeH, g.scale], [300, 200, 0.5]);
});

test("contraintes : scale verrouille le ratio, ratio/fluid restent dans la plage, tout rentre dans la page", () => {
  assert.deepEqual(L.constrainRect(scale, { x: 0, y: 0, w: 300, h: 999 }, PAGE), { x: 0, y: 0, w: 300, h: 100 });
  assert.deepEqual(L.constrainRect(scale, { x: 0, y: 0, w: 999, h: 100 }, PAGE, "h"), { x: 0, y: 0, w: 300, h: 100 });
  const r = L.constrainRect(ratio, { x: 0, y: 0, w: 3000, h: 500 }, PAGE); // ratio 6 > 2,4
  assert.ok(Math.abs(r.w / r.h - 2.4) < 0.01, `${r.w}/${r.h}`);
  const f = L.constrainRect(fluid, { x: 0, y: 0, w: 100, h: 50 }, PAGE);
  assert.ok(f.w >= 300 && f.h >= 200, JSON.stringify(f));
  const big = L.constrainRect(scale, { x: 3000, y: 1400, w: 9000, h: 3000 }, PAGE);
  assert.ok(big.x >= 0 && big.y >= 0 && big.x + big.w <= PAGE.width && big.y + big.h <= PAGE.height, JSON.stringify(big));
  assert.ok(Math.abs(big.w / big.h - 3) < 0.02);
  assert.deepEqual(L.constrainRect(fluid, { x: NaN, y: 5, w: NaN, h: 300 }, PAGE).x >= 0, true, "valeurs non numériques : jamais d'erreur");
});

test("poignées : coins seulement quand le ratio est verrouillé, huit pour fluid ; le bord opposé reste en place", () => {
  assert.deepEqual(L.handlesFor(scale), ["nw", "ne", "sw", "se"]);
  assert.equal(L.handlesFor(fluid).length, 8);
  const start = { x: 500, y: 400, w: 300, h: 100 };
  const grown = L.resizeRect(scale, start, "se", 300, 0, PAGE);
  assert.deepEqual(grown, { x: 500, y: 400, w: 600, h: 200 });
  const nw = L.resizeRect(scale, start, "nw", -100, -50, PAGE);
  assert.equal(nw.x + nw.w, 800, "bord droit inchangé"); assert.equal(nw.y + nw.h, 500, "bord bas inchangé");
  const free = L.resizeRect(fluid, { x: 100, y: 100, w: 600, h: 400 }, "e", 100, 0, PAGE);
  assert.deepEqual([free.w, free.h], [700, 400]);
});

test("aimant léger sur les bords et le centre, ancrages avec marge", () => {
  const s = L.snapMove({ x: 5, y: 3, w: 300, h: 100 }, PAGE, 8);
  assert.deepEqual([s.rect.x, s.rect.y], [0, 0]); assert.equal(s.guides.length, 2);
  const c = L.snapMove({ x: (PAGE.width - 300) / 2 + 4, y: 500, w: 300, h: 100 }, PAGE, 8);
  assert.equal(c.rect.x, (PAGE.width - 300) / 2);
  const far = L.snapMove({ x: 50, y: 50, w: 300, h: 100 }, PAGE, 8);
  assert.deepEqual([far.rect.x, far.rect.y, far.guides.length], [50, 50, 0], "loin des bords : pas d'aimant");
  const r = { x: 0, y: 0, w: 300, h: 100 };
  assert.deepEqual(L.anchorRect(r, "tl", PAGE, 24), { ...r, x: 24, y: 24 });
  assert.deepEqual(L.anchorRect(r, "br", PAGE, 24), { ...r, x: PAGE.width - 300 - 24, y: PAGE.height - 100 - 24 });
  assert.deepEqual(L.anchorRect(r, "c", PAGE, 24), { ...r, x: (PAGE.width - 300) / 2, y: (PAGE.height - 100) / 2 });
  assert.deepEqual(L.anchorRect(r, "tc", PAGE, 10), { ...r, x: (PAGE.width - 300) / 2, y: 10 });
  assert.deepEqual(L.anchorRect(r, "ml", PAGE, 10), { ...r, x: 10, y: (PAGE.height - 100) / 2 });
  assert.equal(L.ANCHORS.length, 9);
});

test("éditeur : ajout, retrait, ordre de superposition, champs précis, résolution", () => {
  const declOf = (i, e) => (e === "clock" ? scale : e === "wide" ? ratio : e === "list" ? fluid : null);
  const page = { width: 1920, height: 1080 };
  let list = [];
  list = E.addElement(list, page, { instance: "i", element: "clock", decl: scale, defaults: { size: 96 } }, "aaaaaa");
  list = E.addElement(list, page, { instance: "i", element: "wide", decl: ratio, defaults: {} }, "bbbbbb");
  list = E.addElement(list, page, { instance: "i", element: "list", decl: fluid, defaults: {} }, "cccccc");
  assert.deepEqual(list.map((e) => e.uid), ["aaaaaa", "bbbbbb", "cccccc"]);
  assert.ok(list.every((e) => e.x >= 0 && e.x + e.w <= 1920 && e.y + e.h <= 1080));
  assert.deepEqual(E.reorder(list, "aaaaaa", "front").map((e) => e.uid), ["bbbbbb", "cccccc", "aaaaaa"]);
  assert.deepEqual(E.reorder(list, "cccccc", "back").map((e) => e.uid), ["cccccc", "aaaaaa", "bbbbbb"]);
  assert.deepEqual(E.reorder(list, "aaaaaa", "up").map((e) => e.uid), ["bbbbbb", "aaaaaa", "cccccc"]);
  assert.deepEqual(E.reorder(list, "cccccc", "down").map((e) => e.uid), ["aaaaaa", "cccccc", "bbbbbb"]);
  assert.deepEqual(E.removeElement(list, "bbbbbb").map((e) => e.uid), ["aaaaaa", "cccccc"]);
  const typed = E.setField(list, "aaaaaa", "w", 400, page, declOf).find((e) => e.uid === "aaaaaa");
  assert.deepEqual([typed.w, typed.h], [400, 133]);
  const ignored = E.setField(list, "aaaaaa", "w", "abc", page, declOf).find((e) => e.uid === "aaaaaa");
  assert.equal(ignored.w, list[0].w, "saisie illisible ignorée");
  const anchored = E.anchorElement(list, "aaaaaa", "br", 20, page).find((e) => e.uid === "aaaaaa");
  assert.equal(anchored.x + anchored.w, 1920 - 20);
  const big = E.changeResolution(list, page, { width: 3840, height: 2160 }, declOf);
  assert.ok(big.every((e) => e.x + e.w <= 3840 && e.y + e.h <= 2160));
  assert.ok(big.find((e) => e.uid === "aaaaaa").w > list[0].w, "les tailles suivent l'échelle");
  assert.equal(E.addElement(Array.from({ length: 30 }, (_, i) => ({ ...list[0], uid: `u${String(i).padStart(6, "0")}` })), page, { instance: "i", element: "clock", decl: scale, defaults: {} }, "zzzzzz").length, 30, "30 éléments au plus");
  assert.match(E.newUid(new Set()), M.UID_RE);
});

// ── Options ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const optDecls = [
  { id: "format", type: "choice", label: "F", choices: [{ value: "24h", label: "a" }, { value: "12h", label: "b" }], default: "24h" },
  { id: "seconds", type: "boolean", label: "S" },
  { id: "size", type: "number", label: "Z", min: 20, max: 200, integer: true, example: "96" },
  { id: "label", type: "text", label: "L", maxLength: 10 },
];
test("options : valeurs contrôlées d'après la déclaration, défauts, inconnues ignorées, erreurs par option", () => {
  assert.deepEqual(O.defaultOptions(optDecls), { format: "24h", seconds: false, size: 20, label: "" });
  const ok = O.checkOptions(optDecls, { format: "12h", seconds: "on", size: "96", label: "  Hi  ", unknown: 1 });
  assert.deepEqual(ok.values, { format: "12h", seconds: true, size: 96, label: "Hi" }); assert.deepEqual(ok.errors, {});
  const bad = O.checkOptions(optDecls, { format: "nope", size: "abc", label: "x".repeat(11) });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["format", "label", "size"]);
  assert.equal(O.checkOption(optDecls[2], "500").code, "range");
  assert.equal(O.checkOption(optDecls[2], "1.5").code, "integer");
  assert.equal(O.checkOption(optDecls[2], "NaN").code, "number");
  assert.deepEqual(O.checkOption(optDecls[2], "96,0"), { ok: true, value: 96 });
  assert.deepEqual(O.checkOptions(optDecls, "n'importe quoi").values.size, 20);
  assert.deepEqual(O.keepOptions({ a: 1, "b c": 2, d: { x: 1 }, e: "ok", f: Infinity }), { a: 1, e: "ok" });
});

// ── Validation d'une page reçue du navigateur ────────────────────────────────────────────────────────────────────────
const catalog = new Map([[M.catalogKey("i", "clock"), { instance: "i", moduleId: "m", moduleName: "M", instanceLabel: "M", decl: { id: "clock", label: "Clock", fit: "scale", size: { width: 600, height: 200 }, followsStyle: true, options: optDecls } }]]);
const goodEl = (uid, extra = {}) => ({ uid, instance: "i", element: "clock", x: 10, y: 10, w: 600, h: 200, visible: true, options: { size: 50 }, ...extra });
test("validation serveur : bornes, élément inconnu, options, doublons, 30 éléments, élément disparu conservé", () => {
  const ctx = { catalog, previous: [] };
  const ok = validatePageInput({ name: "  Principale ", width: 1920, height: 1080, style: { text: "dark", junk: 1 }, elements: [goodEl("aaaaaa")] }, ctx);
  assert.ok(ok.ok); assert.equal(ok.value.name, "Principale"); assert.equal(ok.value.style.text, "dark"); assert.equal(ok.value.style.corners, "round");
  const codes = (raw, c = ctx) => { const r = validatePageInput(raw, c); return r.ok ? [] : r.issues.map((i) => i.code); };
  assert.deepEqual(codes({ name: "", width: 1920, height: 1080, elements: [] }), ["name"]);
  assert.deepEqual(codes({ name: "x".repeat(61), width: 1920, height: 1080, elements: [] }), ["name"]);
  assert.deepEqual(codes({ name: "x", width: 100, height: 1080, elements: [] }), ["resolution"]);
  assert.deepEqual(codes({ name: "x", width: 9000, height: 1080, elements: [] }), ["resolution"]);
  assert.deepEqual(codes({ name: "x", width: 1920, height: 1080, elements: [goodEl("aaaaaa", { element: "ghost" })] }), ["unknown"], "élément inconnu et absent avant : refusé");
  assert.deepEqual(codes({ name: "x", width: 1920, height: 1080, elements: [goodEl("aaaaaa"), goodEl("aaaaaa")] }), ["duplicateUid"]);
  assert.deepEqual(codes({ name: "x", width: 1920, height: 1080, elements: [goodEl("A!")] }), ["uid"]);
  assert.deepEqual(codes({ name: "x", width: 1920, height: 1080, elements: Array.from({ length: 31 }, (_, i) => goodEl(`u${String(i).padStart(6, "0")}`)) }), ["tooMany"]);
  assert.deepEqual(codes({ name: "x", width: 1920, height: 1080, elements: [goodEl("aaaaaa", { options: { size: 5000 } })] }), ["option"]);
  assert.deepEqual(codes("pas un objet"), ["format"]);
  assert.deepEqual(codes({ name: "x", width: 1920, height: 1080, elements: "non" }), ["format"]);
  // Un élément dont le module a disparu et qui était déjà dans la page : conservé, jamais refusé.
  const prev = [{ uid: "gonegg", instance: "old", element: "thing", x: 0, y: 0, w: 100, h: 50, visible: true, options: { a: 1 } }];
  const kept = validatePageInput({ name: "x", width: 1920, height: 1080, elements: [{ uid: "gonegg", instance: "old", element: "thing", x: 5000, y: 5000, w: 100, h: 50, visible: true, options: { a: 2, "bad key": 3 } }] }, { catalog, previous: prev });
  assert.ok(kept.ok); assert.deepEqual(kept.value.elements[0].options, { a: 2 }); assert.ok(kept.value.elements[0].x + kept.value.elements[0].w <= 1920);
  // Ce que dit l'éditeur sur un cadre est ramené à ce que le comportement permet (ratio verrouillé).
  const warped = validatePageInput({ name: "x", width: 1920, height: 1080, elements: [goodEl("aaaaaa", { w: 300, h: 999 })] }, ctx);
  assert.deepEqual([warped.value.elements[0].w, warped.value.elements[0].h], [300, 100]);
});

test("messages d'erreur sous les champs : exemple du module, plage, vouvoiement (FR) et parité EN", () => {
  const raw = { name: "x", width: 1920, height: 1080, elements: [goodEl("aaaaaa", { options: { size: 5000, label: "x".repeat(11), format: "zz" } })] };
  const r = validatePageInput(raw, { catalog, previous: [] });
  for (const lang of ["fr", "en"]) {
    const m = issueMessages(r.issues, raw, catalog, makeTranslator(lang));
    assert.match(m.errors["elements.aaaaaa.options.size"], /20/); assert.match(m.errors["elements.aaaaaa.options.size"], /200/); assert.match(m.errors["elements.aaaaaa.options.size"], /96/, "l'exemple du module est montré");
    assert.ok(m.errors["elements.aaaaaa.options.label"] && m.errors["elements.aaaaaa.options.format"]);
  }
  assert.match(issueMessages(r.issues, raw, catalog, makeTranslator("fr")).errors["elements.aaaaaa.options.size"], /^Entrez/);
});

// ── Adresse, jetons, page de rendu ───────────────────────────────────────────────────────────────────────────────────
test("adresse d'un élément : chemin du site seulement, paramètres ov-* et opt-* réservés au cœur", () => {
  for (const bad of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "/a b", "/../x", "/x#frag", "", "/x\n", "/m/k/élément"]) assert.equal(A.parseAddress({ url: bad }), null, bad);
  assert.equal(A.parseAddress(null), null); assert.equal(A.parseAddress({ url: 5 }), null);
  const base = A.parseAddress({ url: "/overlays/maze?k=SECRET&ov-w=1&opt-evil=1" });
  assert.ok(base);
  const decl = { id: "e", fit: "scale", size: { width: 600, height: 200 }, followsStyle: true, demo: true, options: [] };
  const layout = L.frameLayout(decl, { w: 1200, h: 400 });
  const url = A.finalAddress(base, { decl, layout, style: { text: "dark", background: "soft", corners: "square" }, options: { rows: 3, on: true }, lang: "fr" });
  const q = new URL(url, "http://x").searchParams;
  assert.equal(q.get("k"), "SECRET"); assert.equal(q.get("ov-w"), "600"); assert.equal(q.get("ov-h"), "200"); assert.equal(q.get("ov-text"), "dark"); assert.equal(q.get("ov-surface"), "soft"); assert.equal(q.get("ov-corners"), "square");
  assert.equal(q.get("opt-rows"), "3"); assert.equal(q.get("opt-on"), "1"); assert.equal(q.get("opt-evil"), null, "paramètres réservés du module retirés"); assert.equal(q.has("ov-demo"), false);
  assert.equal(new URL(A.finalAddress(base, { decl, layout, style: { text: "dark", background: "soft", corners: "square" }, options: {}, lang: "fr" }, true), "http://x").searchParams.get("ov-demo"), "1");
  const nostyle = A.finalAddress(base, { decl: { ...decl, followsStyle: false }, layout, style: { text: "dark", background: "soft", corners: "square" }, options: {}, lang: "fr" });
  assert.equal(new URL(nostyle, "http://x").searchParams.has("ov-text"), false, "un élément qui ne suit pas le style ne le reçoit pas");
});

test("jetons --ov-* : valeurs selon le style, vocabulaire distinct des skins de site", () => {
  const v = T.tokenValues({ text: "light", background: "soft", corners: "round" });
  assert.equal(v["--ov-fg"], "#ffffff"); assert.match(v["--ov-surface"], /rgba\(0,0,0/); assert.equal(v["--ov-radius"], "12px");
  assert.equal(T.tokenValues({ text: "dark", background: "transparent", corners: "square" })["--ov-radius"], "0px");
  assert.deepEqual(T.parseStyle({ text: "x", background: 3 }), M.DEFAULT_STYLE);
  assert.ok(T.OV_TOKEN_NAMES.every((n) => n.startsWith("--ov-")) && !T.OV_TOKEN_NAMES.some((n) => n.startsWith("--sk-")));
});

const resolved = (status, extra = {}) => ({ el: { uid: "aaaaaa", instance: "i", element: "clock", x: 100, y: 50, w: 600, h: 200, visible: true, options: {} }, title: "Compte à rebours · Événement à la une", status, layout: L.frameLayout(scale, { w: 600, h: 200 }), src: "/m/i/element/clock?ov-w=600", ...extra });
const pageData = (extra = {}) => ({ id: "p", name: "Principale", width: 3440, height: 1440, active: true, style: M.DEFAULT_STYLE, elements: [], rev: 7, testUntil: null, ...extra });
const view = (over) => R.renderPage({ page: pageData(), elements: [resolved("ok")], t: makeTranslator("fr"), lang: "fr", test: false, now: 0, nonce: "N0NCE", stateUrl: "/overlays/page/S/state", ...over });

test("page de rendu : transparente, résolution de la page, iframe isolé, cadre de test dessiné par le cœur", () => {
  const html = view({});
  assert.match(html, /background:transparent/); assert.match(html, /width:3440px;height:1440px/);
  assert.match(html, /<iframe [^>]*sandbox="allow-scripts allow-same-origin"/);
  assert.doesNotMatch(html, /allow-top-navigation|allow-popups|allow-forms|allow-modals|allow-downloads/);
  assert.match(html, /data-ov-region="page"/); assert.match(html, /data-ov-part="test-frame"/);
  assert.match(html, /Compte à rebours · Événement à la une · 600×200 px/, "module · élément · taille");
  assert.doesNotMatch(html, /<html [^>]*data-test/, "hors mode test, les cadres sont masqués");
  assert.match(view({ test: true, page: pageData({ testUntil: 900_000 }) }), /<html [^>]*data-test="1"/);
  assert.doesNotMatch(html, /--sk-|data-skin|\/skins\/|<link|@import|https?:\/\//, "aucun skin de site, aucune ressource tierce");
  assert.match(html, /nonce="N0NCE"/);
});

test("page de rendu : superposition dans l'ordre, éléments masqués absents, échecs silencieux en direct", () => {
  const a = resolved("ok"), b = { ...resolved("ok"), el: { ...resolved("ok").el, uid: "bbbbbb" } };
  const html = view({ elements: [a, b] });
  assert.match(html, /data-uid="aaaaaa"[^>]*z-index:1"/); assert.match(html, /data-uid="bbbbbb"[^>]*z-index:2"/); assert.ok(html.indexOf('data-uid="aaaaaa"') < html.indexOf('data-uid="bbbbbb"'), "le premier est au fond");
  const failed = view({ elements: [resolved("failed", { reason: "stalled", src: undefined })] });
  assert.doesNotMatch(failed, /<iframe/); assert.match(failed, /n&#39;a pas répondu à temps/, "le détail n'est que dans le cadre de test (masqué hors test)");
  const live = failed.replace(/<div class="tf"[\s\S]*?<\/div>/g, "");
  assert.doesNotMatch(live, /pas répondu/, "rien de visible en direct");
  const gone = view({ elements: [resolved("missing", { reason: "gone", src: undefined })] });
  assert.match(gone, /Cet élément n&#39;est plus disponible/); assert.doesNotMatch(gone, /<iframe/);
  const demo = view({ test: true, elements: [resolved("ok", { demoSrc: "/m/i/element/clock?ov-demo=1" })] });
  assert.match(demo, /<iframe [^>]*src="\/m\/i\/element\/clock\?ov-demo=1"/, "en mode test, le contenu d'exemple est chargé");
  assert.match(demo, /data-live="\/m\/i\/element\/clock\?ov-w=600"/);
});

test("page de rendu : page inactive = « Cet overlay est désactivé » ; texte échappé ; interrogation sans minuteur serveur", () => {
  const off = view({ page: pageData({ active: false }), elements: [] });
  assert.match(off, /Cet overlay est désactivé/); assert.doesNotMatch(off, /<iframe/);
  assert.match(view({ page: pageData({ active: false }), elements: [], t: makeTranslator("en"), lang: "en" }), /This overlay is turned off/);
  const evil = view({ elements: [resolved("ok", { title: '"><script>alert(1)</script>' })] });
  assert.doesNotMatch(evil, /<script>alert/); assert.match(evil, /&lt;script&gt;/);
  assert.match(R.renderPage({ page: pageData({ name: "</title><script>x</script>" }), elements: [], t: makeTranslator("fr"), lang: "fr", test: false, now: 0, nonce: "n", stateUrl: "" }), /&lt;\/title&gt;/);
  const script = fs.readFileSync("src/core/overlays/render.ts", "utf8");
  assert.match(script, /gap=n<6\?5000:n<12\?10000:15000/, "intervalle de 5 s qui ralentit");
  assert.doesNotMatch(script, /setInterval/, "aucun minuteur répété : chaque contrôle programme le suivant");
});

test("en-têtes : CSP limitée aux adresses des éléments, pas de cookie, pas de suivi, adresse secrète protégée", () => {
  const csp = R.contentSecurityPolicy("N", R.frameSources("site.example:8443", ["/m/a/element/x", "/m/a/element/x", "/m/b/e"]));
  assert.match(csp, /default-src 'none'/); assert.match(csp, /frame-src site\.example:8443\/m\/a\/element\/x site\.example:8443\/m\/b\/e(;|$)/);
  assert.match(csp, /script-src 'nonce-N'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /img-src 'none'/); assert.match(csp, /frame-ancestors 'self'/);
  assert.doesNotMatch(csp, /\*|unsafe-eval|https?:\/\/(?!site)/);
  assert.equal(R.frameSources(null, ["/m/a"]), "'self'"); assert.equal(R.frameSources("bad host!", ["/m/a"]), "'self'"); assert.equal(R.frameSources("x.test", []), "'none'");
  const h = R.pageHeaders(csp);
  assert.equal(h["Referrer-Policy"], "no-referrer"); assert.match(h["Cache-Control"], /no-store/); assert.match(h["X-Robots-Tag"], /noindex/);
  assert.equal("Set-Cookie" in h, false);
});

// ── Mode test ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("mode test : 30 minutes constatées à la lecture, prolonger, arrêter", () => {
  const now = 1_000_000;
  const start = M.nextTestUntil("start", null, now);
  assert.equal(start, now + 30 * 60_000);
  assert.equal(M.testActive(start, now + 29 * 60_000), true); assert.equal(M.testActive(start, start), false, "à l'échéance : fini"); assert.equal(M.testActive(null, now), false);
  assert.equal(M.nextTestUntil("extend", start, now + 60_000), start + 30 * 60_000);
  assert.equal(M.nextTestUntil("extend", start, start + 5_000), start + 5_000 + 30 * 60_000, "échéance passée : on repart de maintenant");
  let u = start; for (let i = 0; i < 20; i++) u = M.nextTestUntil("extend", u, now);
  assert.equal(u, now + 240 * 60_000, "plafond de 4 heures");
  assert.equal(M.nextTestUntil("stop", start, now), null);
});

// ── Aperçu de l'éditeur : échelle affichée et placement des libellés ──────────────────────────────────────────────────
const V = await import("@/core/overlays/previewView");

test("aperçu : l'échelle suit la largeur disponible, le zoom, et la hauteur est plafonnée", () => {
  const wide = { width: 3440, height: 1440 };
  const a = V.previewScale(1000, wide);
  assert.equal(a.width, 1000); assert.equal(a.percent, 29); assert.ok(Math.abs(a.height - (1000 * 1440) / 3440) < 1e-9);
  assert.equal(V.previewScale(1000, wide, 2).percent, 58);
  assert.equal(V.previewScale(1500, { width: 3840, height: 2160 }, 1).percent, 30);   // plafonné par la hauteur : 640 × 16/9 = 1138 px
  const portrait = V.previewScale(1500, { width: 1080, height: 1920 });
  assert.ok(portrait.height <= V.PREVIEW_MAX_HEIGHT + 1e-9); assert.equal(portrait.percent, 33);
  assert.deepEqual(V.previewScale(0, wide), { scale: 0, percent: 0, width: 0, height: 0 });
  assert.ok(V.ZOOMS.includes(1) && V.ZOOMS.length >= 3);
});

test("aperçu : des libellés qui se gênent vont dans d'autres coins, un petit cadre porte le sien à l'extérieur", () => {
  const f = (uid, x, y, w, h, text = "Démo · Élément · 600×200 px") => ({ uid, x, y, w, h, text });
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // Un cadre plein écran et un cadre dans son coin haut gauche : le libellé de la page ne couvre pas celui du cadre.
  const bounds = { width: 900, height: 400 };
  const p = V.placeLabels([f("page", 0, 0, 900, 400), f("clock", 0, 0, 200, 80)], bounds);
  assert.equal(p[1].corner, "tl"); assert.notEqual(p[0].corner, "tl"); assert.ok(!hit(p[0], p[1]));
  // Aucun chevauchement sur un lot de cadres, tous les libellés restent dans l'aperçu.
  const many = [f("a", 0, 0, 900, 400), f("b", 20, 20, 300, 120), f("c", 560, 20, 320, 160), f("d", 20, 250, 400, 130), f("e", 440, 190, 90, 40)];
  const q = V.placeLabels(many, bounds);
  for (let i = 0; i < q.length; i++) {
    assert.ok(q[i].x >= -1 && q[i].y >= -1 && q[i].x + q[i].width <= 901 && q[i].y + q[i].height <= 401, q[i].uid);
    for (let j = i + 1; j < q.length; j++) assert.ok(!hit(q[i], q[j]), `${q[i].uid}/${q[j].uid}`);
  }
  // Un cadre trop petit : libellé hors du cadre, à sa taille naturelle (au plus V.OUTSIDE_MAX).
  const small = q[4];
  assert.ok(small.corner === "ot" || small.corner === "ob"); assert.ok(small.width > 90 && small.width <= V.OUTSIDE_MAX);
  // En haut de l'aperçu, pas de place au-dessus : sous le cadre.
  assert.equal(V.placeLabels([f("t", 100, 2, 60, 30)], bounds)[0].corner, "ob");
  // Un grand cadre : libellé plafonné à sa largeur (le texte est alors tronqué avec « … »), jamais plus large.
  assert.ok(V.placeLabels([f("n", 0, 0, 80, 60, "Un titre très très long")], undefined)[0].width <= 280);
  assert.equal(V.labelWidth("x".repeat(100), 120), 120);
  assert.equal(V.isSmallFrame({ w: 100, h: 200 }), true); assert.equal(V.isSmallFrame({ w: 300, h: 200 }), false);
});
