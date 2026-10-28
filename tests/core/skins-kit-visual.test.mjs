// Niveau NAVIGATEUR du kit (`skin:check --visual`, lot S8) : chaque défaut volontaire est attrapé dans un vrai Chromium ; les skins valides passent sans erreur.
// Un test par défaut. Sans Chromium (CHROMIUM_PATH ou /opt/pw-browsers/chromium) ni module playwright, ces tests sont sautés AVEC un message (la CI du cœur les exige : SKIN_BROWSER_TESTS=1).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFECTS, dualSkin, goodSkin } from "../helpers/skin-defects.mjs";
import { copySkin } from "../helpers/skins.mjs";

const { checkOne } = await import("../../testsupport/skins/check.mjs");
const pw = await import("../../scripts/visual/lib/playwright.mjs");
let available = true;
try { pw.loadPlaywright(); pw.chromiumPath(); } catch { available = false; }
if (!available && process.env.SKIN_BROWSER_TESTS === "1") throw new Error("SKIN_BROWSER_TESTS=1 mais Chromium ou playwright est introuvable");
const skip = available ? false : "Chromium ou playwright introuvable : niveau navigateur non essayé";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-kit-visual-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Essai rapide : deux largeurs (téléphone, bureau), trois pages ; la régression de basic a son propre test.
const FAST = { coreVersion: "0.4.0", visual: true, widths: [390, 1280], onlyPages: ["home", "blog", "form"], basicRegression: false };
const real = (r) => r.issues.filter((i) => i.severity !== "advice");
const has = (r, prefix, severity = "error") => r.issues.some((i) => i.code.startsWith(prefix) && i.severity === severity);
const T = { timeout: 180000 };

test("skin valide à un mode : le niveau navigateur ne trouve rien (hors aperçu factice des fixtures)", { skip, ...T }, async () => {
  const r = await checkOne(goodSkin(tmp, "kit-good"), FAST);
  assert.deepEqual(real(r).filter((i) => i.code !== "kit-preview-unreadable").map((i) => `${i.code} ${i.message.fr}`), []);
  assert.equal(r.levels.browser.ran, true);
  assert.equal(r.levels.browser.errors, 0);
  assert.deepEqual(r.stats.visual.modes, ["light"]);
  assert.deepEqual(r.stats.visual.widths, [390, 1280]);
});

test("skin valide à deux modes : la bascule clair/sombre est visible, opérable et ne change que les couleurs", { skip, ...T }, async () => {
  const r = await checkOne(dualSkin(tmp, "kit-dual"), FAST);
  assert.deepEqual(real(r).filter((i) => i.code !== "kit-preview-unreadable").map((i) => `${i.code} ${i.message.fr}`), []);
  assert.deepEqual(r.stats.visual.modes, ["light", "dark"]);
});

for (const d of DEFECTS.filter((x) => x.visual?.length)) {
  test(`défaut volontaire « ${d.what} » : le niveau navigateur l'attrape (${d.visual.join(", ")})`, { skip, ...T }, async () => {
    const id = `kit-${d.id}`;
    const dir = path.join(tmp, id);
    d.build(dir, id);
    // une feuille que l'assainisseur refuse n'arrive pas au navigateur : pour prouver que le navigateur l'attraperait aussi, elle est ajoutée après l'assainissement
    const r = await checkOne(dir, { ...FAST, unsafeCss: d.unsafeCss });
    for (const code of d.visual) assert.ok(has(r, code), `${code} attendu ; obtenu : ${real(r).map((i) => i.code).join(", ")}`);
    assert.equal(r.ok, false);
    assert.ok(r.levels[d.visual[0] === "kit-hidden" || d.visual[0] === "kit-covered" || d.visual[0] === "kit-injected-text" ? "principle" : "browser"].errors > 0);
    const issue = r.issues.find((i) => i.code.startsWith(d.visual[0]));
    assert.ok(issue.message.fr && issue.message.en && issue.hint.fr && issue.hint.en, "message simple en FR et EN, avec l'aide");
  });
}

test("un défaut passé par l'assainisseur (recouvrement par un décor, ordre chaotique, cible, focus, police, contraste rendu) passe le contrôle statique tel quel (c'est le vrai chemin d'installation) : seul le navigateur peut l'attraper, et il l'a fait plus haut sans feuille de contournement", { skip, ...T }, async () => {
  for (const id of ["covers-link", "chaotic-tab-order", "tiny-targets", "no-focus", "missing-font", "horizontal-scroll", "rendered-contrast"]) {
    const d = DEFECTS.find((x) => x.id === id);
    assert.equal(d.unsafeCss, undefined, id);
    const dir = path.join(tmp, `s-${id}`);
    d.build(dir, `s-${id}`);
    const staticOnly = await checkOne(dir, { coreVersion: "0.4.0" });
    assert.deepEqual(staticOnly.issues.filter((i) => i.severity === "error"), [], `${id} : doit passer le contrôle statique`);
  }
});

test("seuils de l'ordre de tabulation, validés sur de vraies mises en page : colonne latérale et colonnes CSS passent, menu à l'envers et en-tête sous le contenu échouent", { skip, ...T }, async () => {
  const layouts = {
    "side": { files: { "skin.css": '@media (min-width: 40rem) {\n  [data-skin-region="shell"] { display: grid; grid-template-columns: 14rem minmax(0, 1fr); grid-template-areas: "header main" "header footer"; }\n  [data-skin-region="header"] { align-self: start; }\n  [data-skin-region="nav"] [data-skin-part="nav-list"] { flex-direction: column; }\n}\n' }, ok: true },
    "columns": { files: { "skin.css": '[data-skin-part="list"][data-kind="cards"] { display: block; columns: 2; column-gap: 1rem; }\n[data-skin-part="list"][data-kind="cards"] > li { break-inside: avoid; margin-bottom: 1rem; }\n' }, ok: true },
    "reverse-menu": { files: { "skin.css": '[data-skin-part="nav-list"] { flex-direction: row-reverse; }\n' }, ok: false },
    "header-below": { files: { "skin.css": '[data-skin-region="shell"] { display: grid; grid-template-areas: "banner" "main" "header" "footer"; }\n' }, ok: false },
  };
  for (const [name, l] of Object.entries(layouts)) {
    const dir = path.join(tmp, `o-${name}`);
    copySkin("plain-light", dir, { id: `o-${name}`, files: l.files });
    const r = await checkOne(dir, { ...FAST, widths: [1280], onlyPages: ["home", "blog"] });
    const bad = r.issues.filter((i) => /^kit-tab-order/.test(i.code) && i.severity !== "advice");
    assert.equal(bad.length === 0, l.ok, `${name} : ${bad.map((i) => i.message.fr).join(" | ")}`);
  }
});

test("régression de basic : la page de basic est identique, au pixel, à l'apparence d'origine (0 pixel) sur les six pages-types aux quatre largeurs", { skip, timeout: 300000 }, async () => {
  const r = await checkOne(goodSkin(tmp, "kit-good-regression"), { coreVersion: "0.4.0", visual: true, widths: [390], onlyPages: ["home"] });
  assert.deepEqual(r.issues.filter((i) => i.code === "kit-basic-regression"), []);
});

test("commande : --visual --json donne un rapport lisible par une machine avec le niveau navigateur ; --shots garde les captures PNG", { skip, ...T }, () => {
  const dir = goodSkin(tmp, "kit-cli");
  const shots = path.join(tmp, "captures");
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/skin-check.mjs", dir, "--visual", "--json", "--widths", "390", "--only-pages", "home", "--shots", shots], { encoding: "utf8", env: { ...process.env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.visual, true);
  assert.equal(json.skins[0].levels.browser.ran, true);
  assert.ok(fs.existsSync(path.join(shots, "kit-cli-home-390-light.png")));
});

test("banc d'essai : --previews écrit des WebP 1280 × 800 de 150 Ko au plus, --shots les planches en clair et en sombre", { skip, ...T }, async () => {
  const { imageSize } = await import("../../testsupport/skins/imageinfo.mjs");
  const dir = dualSkin(tmp, "kit-bench");
  const out = path.join(tmp, "bench-out");
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/skin-bench.mjs", dir, "--previews", path.join(out, "previews"), "--shots", path.join(out, "shots"), "--port", "3568"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ["home-light.webp", "home-dark.webp"]) { const b = fs.readFileSync(path.join(out, "previews", f)); assert.deepEqual(imageSize(b), { width: 1280, height: 800 }); assert.ok(b.length <= 150 * 1024); }
  const shots = fs.readdirSync(path.join(out, "shots"));
  for (const mode of ["light", "dark"]) for (const w of [390, 768, 1280, 1920]) assert.ok(shots.includes(`board-${mode}-${w}.png`), `board-${mode}-${w}.png`);
  assert.ok(shots.includes("header-twoRows-dark-390.png"));
  assert.match(r.stdout, /"file": "previews\/home-light.webp"/);
});
