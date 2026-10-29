// Kit de test des skins (docs/SKINS.md §13, lot S8) : niveaux STATIQUES, rapport, commande. Chaque défaut a un skin de test (tests/helpers/skin-defects.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFECTS, dualSkin, goodSkin } from "../helpers/skin-defects.mjs";
import { copySkin } from "../helpers/skins.mjs";

const { checkOne, checkTargets, skinDirs } = await import("../../testsupport/skins/check.mjs");
const { kitCatalog, kitIssue, KIT_CODES } = await import("../../testsupport/skins/messages.mjs");
const { levelOfCode, LEVELS } = await import("../../testsupport/skins/levels.mjs");
const { toJson, toText } = await import("../../testsupport/skins/report.mjs");
const { imageSize } = await import("../../testsupport/skins/imageinfo.mjs");
const { defaultCoreVersion, SKINS_SINCE } = await import("../../testsupport/skins/version.mjs");
const { ISSUE_CODES } = await import("@/core/skins/messages");

const CORE = "0.4.0";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-kit-"));
const codes = (r, severity) => r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const make = (name, build) => { const dir = path.join(tmp, name); build(dir, name); return dir; };

test("un skin valide passe tous les niveaux statiques sans erreur", async () => {
  const r = await checkOne(goodSkin(tmp, "kit-good"), { coreVersion: CORE });
  assert.deepEqual(codes(r, "error"), []);
  assert.equal(r.ok, true);
  for (const level of LEVELS.filter((l) => l !== "browser")) assert.equal(r.levels[level].errors, 0, level);
  assert.equal(r.levels.browser.ran, false, "le niveau navigateur n'est lancé qu'avec --visual");
  assert.ok(r.stats.fingerprint);
});

for (const d of DEFECTS) {
  test(`défaut « ${d.what} » : le niveau statique ${d.static.length ? `le refuse (${d.static.join(", ")})` : "ne le voit pas (seul le navigateur le voit : voir skins-kit-visual)"}`, async () => {
    const dir = make(`kit-${d.id}`, d.build);
    const r = await checkOne(dir, { coreVersion: CORE });
    for (const code of d.static) assert.ok(codes(r, "error").includes(code), `${code} attendu parmi ${codes(r).join(", ")}`);
    if (!d.static.length) assert.deepEqual(codes(r, "error"), [], "ce défaut doit passer l'assainisseur : c'est le navigateur qui l'attrape");
  });
}

test("chaque code de la bibliothèque du cœur a un niveau connu ; le principe fondateur et la lisibilité ont les leurs", () => {
  for (const code of ISSUE_CODES) assert.ok(LEVELS.includes(levelOfCode(code)), code);
  assert.equal(levelOfCode("hide-forbidden"), "principle");
  assert.equal(levelOfCode("content-not-allowed"), "principle");
  assert.equal(levelOfCode("read-low-1"), "readability");
  assert.equal(levelOfCode("asset-signature"), "resources");
  assert.equal(levelOfCode("tokens-bad-name"), "tokens");
  assert.equal(levelOfCode("manifest-field"), "manifest");
  assert.equal(levelOfCode("url-external"), "stylesheet");
  assert.equal(levelOfCode("kit-hidden"), "principle");
  assert.equal(levelOfCode("kit-focus-missing"), "browser");
  assert.equal(levelOfCode("kit-neutral"), "neutrality");
});

test("messages du kit : FR et EN en parité (mêmes {paramètres}), aide toujours donnée, codes stables, tous documentés", () => {
  const doc = fs.readFileSync("docs/CREER-UN-SKIN.md", "utf8");
  const cat = kitCatalog();
  assert.ok(KIT_CODES.length >= 45);
  for (const [code, e] of Object.entries(cat)) {
    assert.match(code, /^kit-[a-z-]+$/);
    assert.ok(["error", "warning", "advice"].includes(e.severity), code);
    for (const k of ["fr", "en", "hintFr", "hintEn"]) assert.ok(e[k].length > 10, `${code} ${k}`);
    const ph = (s) => [...s.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(ph(e.fr), ph(e.en), `${code} : paramètres du message`);
    assert.equal(ph(e.hintFr), ph(e.hintEn), `${code} : paramètres de l'aide`);
    assert.ok(doc.includes(`\`${code}\``), `${code} n'est pas dans docs/CREER-UN-SKIN.md`);
    assert.doesNotMatch(e.fr + e.en, /\{\{|undefined/);
  }
  const i = kitIssue("kit-target-size", { what: "a:x", size: 20, min: 24, page: { fr: "Accueil", en: "Home" }, width: "390" });
  assert.match(i.message.fr, /a:x fait 20 px/);
  assert.match(i.message.en, /\(Home, 390px\)/);
  assert.equal(i.level, "browser");
  assert.throws(() => kitIssue("kit-inconnu"));
});

test("jetons : un jeton inconnu est signalé, une valeur au mauvais type aussi, les jetons de modules se vérifient avec --modules", async () => {
  const bad = make("kit-tokens", (dir, id) => copySkin("plain-light", dir, { id, files: { "tokens.json": JSON.stringify({ light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, dark: {}, common: { "--sk-inconnu": "1rem", "--sk-radius-card": "pas-une-longueur", "--sk-space": "0.25rem" }, modules: { demo: { "--sk-m-demo-card-radius": "0.5rem", "--sk-m-demo-nope": "1rem" } } }) } }));
  const mods = path.join(tmp, "mods");
  fs.mkdirSync(path.join(mods, "demo"), { recursive: true });
  fs.writeFileSync(path.join(mods, "demo/module.json"), JSON.stringify({ apiVersion: 2, id: "demo", skin: { since: 1, parts: [{ id: "demo.card", kind: "card", name: { fr: "Carte", en: "Card" }, description: { fr: "Une carte.", en: "A card." }, tokens: [{ name: "--sk-m-demo-card-radius", type: "length", default: "var(--sk-radius-card)" }] }] } }));
  const without = await checkOne(bad, { coreVersion: CORE });
  assert.ok(codes(without).includes("kit-token-unknown"));
  assert.ok(codes(without).includes("kit-module-tokens-unverified"), "sans --modules : conseil");
  assert.ok(codes(without, "error").includes("value-syntax") || codes(without).some((c) => /value|token/.test(c)), `valeur au mauvais type : ${codes(without).join(",")}`);
  const withMods = await checkOne(bad, { coreVersion: CORE, modules: mods });
  assert.ok(codes(withMods).includes("kit-module-token-unknown"), "jeton que le module ne déclare pas");
  assert.ok(!codes(withMods).includes("kit-module-tokens-unverified"));
  const missing = await checkOne(bad, { coreVersion: CORE, modules: path.join(tmp, "mods-vide") });
  assert.ok(codes(missing).includes("kit-module-tokens-unverified"));
});

test("ressources : aperçu qui n'est ni 1280 × 800 (ordinateur) ni 390 × 844 (téléphone), police et image inutilisées", async () => {
  const small = await sharp({ create: { width: 100, height: 60, channels: 3, background: "#888" } }).webp().toBuffer();
  const exact = await sharp({ create: { width: 1280, height: 800, channels: 3, background: "#888" } }).webp().toBuffer();
  assert.deepEqual(imageSize(small), { width: 100, height: 60 });
  assert.deepEqual(imageSize(exact), { width: 1280, height: 800 });
  const phone = await sharp({ create: { width: 390, height: 844, channels: 3, background: "#888" } }).webp().toBuffer();
  assert.deepEqual(imageSize(phone), { width: 390, height: 844 });
  const dir = make("kit-resources", (d, id) => {
    copySkin("plain-light", d, { id, patch: (m) => { m.previews = [{ file: "previews/a.webp", mode: "light", width: 1280, alt: { fr: "a", en: "a" } }, { file: "previews/b.webp", mode: "light", width: 1280, alt: { fr: "b", en: "b" } }, { file: "previews/c.webp", mode: "light", width: 390, alt: { fr: "c", en: "c" } }]; m.assets = [{ file: "fonts/x.woff2", kind: "font", license: "OFL-1.1", licenseFile: "LICENSES/x.txt", author: "A", source: "https://example.org", family: "Skin X" }, { file: "images/p.svg", kind: "image", license: "CC0-1.0", licenseFile: "LICENSES/x.txt", author: "A", source: "https://example.org" }]; }, files: { "previews/home.webp": null, "previews/a.webp": small, "previews/b.webp": exact, "previews/c.webp": phone, "fonts/x.woff2": Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(64)]), "images/p.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>', "LICENSES/x.txt": "licence\n" } });
  });
  const r = await checkOne(dir, { coreVersion: CORE });
  assert.deepEqual(codes(r, "error"), []);
  const sizes = r.issues.filter((i) => i.code === "kit-preview-size");
  assert.equal(sizes.length, 1);
  assert.match(sizes[0].message.fr, /100 × 60/);
  assert.ok(codes(r).includes("kit-font-unused"));
  assert.ok(codes(r).includes("kit-image-unused"));
});

test("feuille : points de rupture non déclarés, cibles et interligne réglés trop bas", async () => {
  const dir = make("kit-sheet", (d, id) => copySkin("plain-light", d, { id, files: { "skin.css": '@media (min-width: 52rem) { [data-skin-region="header"] { display: flex; } }\n[data-skin-part="nav-link"] { min-height: 1.5rem; }\n[data-skin-part="prose"] { line-height: 1.1; font-size: 0.8125rem; }\n' } }));
  const r = await checkOne(dir, { coreVersion: CORE });
  assert.deepEqual(codes(r, "error"), []);
  assert.ok(codes(r).includes("kit-breakpoint-undeclared"));
  assert.ok(codes(r, "warning").includes("kit-target-small"));
  assert.ok(codes(r, "warning").includes("kit-leading-low"));
  assert.ok(codes(r, "warning").includes("kit-text-small"));
  const ok = await checkOne(make("kit-sheet-ok", (d, id) => copySkin("plain-light", d, { id, patch: (m) => { m.breakpoints = [832]; }, files: { "skin.css": '@media (min-width: 52rem) { [data-skin-region="header"] { display: flex; } }\n' } })), { coreVersion: CORE });
  assert.ok(!codes(ok).includes("kit-breakpoint-undeclared"), "déclaré : plus de conseil");
});

test("neutralité : un terme de la liste locale dans le manifeste, le README ou la feuille est une erreur ; sans liste, le contrôle est sauté", async () => {
  const list = path.join(tmp, "termes.txt");
  fs.writeFileSync(list, "# termes de test\nmonsiteréel\nautre-nom => README.md\n");
  const dir = make("kit-neutral", (d, id) => copySkin("plain-light", d, { id, patch: (m) => { m.description.fr = "Fait pour MonSiteRéel et ses amis."; }, files: { "README.md": "autre-nom est toléré ici\n", "skin.css": "/* autre-nom interdit ici */\n[data-skin-part=\"card\"] { color: inherit; }\n" } }));
  const r = await checkOne(dir, { coreVersion: CORE, neutrality: list });
  const bad = r.issues.filter((i) => i.code === "kit-neutral");
  assert.equal(bad.length, 2);
  assert.ok(bad.some((i) => /skin\.json/.test(i.message.fr)) && bad.some((i) => /skin\.css/.test(i.message.fr)));
  assert.ok(!bad.some((i) => /README/.test(i.message.fr)), "toléré dans README.md");
  const none = await checkOne(goodSkin(tmp, "kit-good2"), { coreVersion: CORE, neutrality: path.join(tmp, "absent.txt") });
  assert.ok(codes(none).includes("kit-neutral-skipped"));
});

test("dépôt de skins : tous les skins de skins/<id> sont contrôlés ; un dossier sans skin.json est une erreur", async () => {
  const repo = path.join(tmp, "repo");
  goodSkin(path.join(repo, "skins"), "un"); dualSkin(path.join(repo, "skins"), "deux");
  for (const id of ["un", "deux"]) { const f = path.join(repo, "skins", id, "skin.json"); const m = JSON.parse(fs.readFileSync(f, "utf8")); m.id = id; fs.writeFileSync(f, JSON.stringify(m)); }
  assert.equal(skinDirs(repo).length, 2);
  const report = await checkTargets([repo, path.join(tmp, "n-existe-pas")], { coreVersion: CORE });
  assert.equal(report.skins.length, 3);
  assert.equal(report.skins.at(-1).noSkin, true);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  const only = await checkTargets([repo], { coreVersion: CORE });
  assert.equal(only.ok, true);
  assert.equal(only.exitCode, 0);
});

test("rapport : texte (FR et EN, codes, « comment corriger ») et JSON ; --strict fait échouer les avertissements", async () => {
  const dir = make("kit-unreadable", DEFECTS.find((d) => d.id === "unreadable").build);
  const report = await checkTargets([dir], { coreVersion: CORE });
  const fr = toText(report, "fr"), en = toText(report, "en");
  assert.match(fr, /Comment corriger/);
  assert.match(fr, /\[read-low-1\]/);
  assert.match(fr, /Lisibilité \(WCAG AA\)/);
  assert.match(en, /How to fix/);
  assert.match(en, /Readability \(WCAG AA\)/);
  assert.match(fr, /Navigateur \(--visual\) — non lancé/);
  const json = JSON.parse(toJson(report));
  assert.equal(json.tool, "skin:check");
  assert.equal(json.ok, false);
  assert.equal(json.exitCode, 1);
  const s = json.skins[0];
  assert.ok(s.issues.every((i) => i.code && i.level && ["error", "warning", "advice"].includes(i.severity) && i.message.fr && i.message.en && i.hint.fr && i.hint.en));
  assert.ok(s.levels.readability.errors > 0);
  // --strict
  const warnOnly = await checkTargets([make("kit-warn", (d, id) => copySkin("plain-light", d, { id, files: { "skin.css": '[data-skin-part="prose"] { font-size: 0.8125rem; }\n' } }))], { coreVersion: CORE });
  assert.equal(warnOnly.exitCode, 0);
  const strict = await checkTargets([warnOnly.skins[0].dir], { coreVersion: CORE, strict: true });
  assert.equal(strict.exitCode, 1);
});

test("commande : code de sortie 0 / 1 / 2, --json, --lang, --strict", () => {
  const run = (...args) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/skin-check.mjs", ...args], { encoding: "utf8" });
  const good = path.join(tmp, "kit-good");
  const ok = run(good, "--core-version", CORE, "--lang", "en");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /All good: 1 skin\(s\) checked/);
  const bad = run(path.join(tmp, "kit-unreadable"), "--core-version", CORE);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /Tout est à corriger|à corriger/);
  const usage = run();
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage/);
  const json = run(good, "--json", "--core-version", CORE);
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).skins[0].id, "kit-good");
  assert.equal(run(path.join(tmp, "n-existe-pas")).status, 1);
  const strict = run(path.join(tmp, "kit-warn"), "--strict", "--core-version", CORE);
  assert.equal(strict.status, 1);
});

test("version de cœur par défaut : celle du dépôt, au moins 0.4.0 (la version qui apporte les skins) ; --core-version l'emporte", () => {
  assert.equal(SKINS_SINCE, "0.4.0");
  assert.equal(defaultCoreVersion(".", "9.9.9"), "9.9.9");
  assert.match(defaultCoreVersion("."), /^\d+\.\d+\.\d+/);
  const dir = fs.mkdtempSync(path.join(tmp, "v-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.3.1" }));
  assert.equal(defaultCoreVersion(dir), "0.4.0");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "0.12.0" }));
  assert.equal(defaultCoreVersion(dir), "0.12.0");
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
