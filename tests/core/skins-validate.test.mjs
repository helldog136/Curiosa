// Validation d'un dossier de skin (docs/SKINS.md §5-§7, §13) : manifeste, fichiers, ressources, licences, jetons, feuille, lisibilité, empreinte.
// Aucun réseau, aucune base : la même fonction sert à l'installation et à la commande `skin:check`.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { copySkin, FIXTURES, fakeFont, fakePng, SVG_OK, TEST_CORE } from "../helpers/skins.mjs";

const V = await import("@/core/skins/validate");
const M = await import("@/core/skins/messages");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-skinval-"));
let n = 0;
/** Un dossier de skin jetable : la fixture « plain-light » modifiée. */
function mk(over = {}) {
  const dir = path.join(tmp, `s${++n}`, over.id ?? "plain-light");
  copySkin(over.from ?? "plain-light", dir, over);
  return dir;
}
const check = (dir, extra = {}) => V.validateSkinFolder(dir, { coreVersion: TEST_CORE, folderName: path.basename(dir), ...extra });
const codes = (r, sev) => r.issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);
const asset = (file, kind, extra = {}) => ({ file, kind, license: "OFL-1.1", licenseFile: "LICENSES/ofl.txt", author: "Fonderie de test", source: "https://example.org/font", ...extra });
const LIC = { "LICENSES/ofl.txt": "Licence de test." };

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("le skin minimal du §17 est valide, sans aucun problème", () => {
  const r = check(path.join(FIXTURES, "plain-light"));
  assert.deepEqual(r.issues, []);
  assert.equal(r.ok, true);
  assert.equal(r.manifest.id, "plain-light");
  assert.match(r.css, /^:root\[data-skin="plain-light"\] \[data-skin-part="card"\]/m, "feuille réécrite, préfixée");
  assert.equal(r.tokens.light["--v-bg"], "#fafaf7");
  assert.deepEqual(r.files.map((f) => f.path), ["README.md", "previews/home.webp", "skin.css", "skin.json", "tokens.json"]);
  assert.match(r.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(r.readability.length, 0);
});

test("l'empreinte dépend du contenu, pas de l'ordre ni de l'endroit", () => {
  const a = check(mk()), b = check(mk());
  assert.equal(a.fingerprint, b.fingerprint);
  const c = check(mk({ files: { "skin.css": "[data-skin-part=\"card\"] { border-width: 2px; }\n" } }));
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test("skin illisible : REFUS avec les messages simples FR/EN de la bibliothèque (mode concerné, rapport, exemple)", () => {
  const r = check(path.join(FIXTURES, "faded-grey"));
  assert.equal(r.ok, false);
  const low1 = r.issues.find((i) => i.code === "read-low-1");
  assert.ok(low1);
  assert.match(low1.message.fr, /^En mode clair, le texte serait difficile à lire sur le fond de la page \(rapport 1,6 ; il faut au moins 4,5\)\.$/);
  assert.match(low1.message.en, /^In light mode, the text would be hard to read on the page background \(ratio 1\.6; at least 4\.5 is needed\)\.$/);
  assert.match(low1.hint.fr, /#[0-9a-f]{6}/, "exemple de couleur proposé");
  assert.ok(r.readability.every((x) => x.mode === "light"));
  assert.equal(r.installFiles.length, 0, "rien à installer");
});

test("chaque mode déclaré est contrôlé séparément", () => {
  const dir = mk({
    patch: (m) => { m.modes = ["light", "dark"]; },
    files: { "tokens.json": JSON.stringify({ light: { "--v-bg": "#ffffff", "--v-surface": "#fafafa", "--v-fg": "#111111", "--v-accent": "#1d4ed8" }, dark: { "--v-bg": "#101010", "--v-surface": "#181818", "--v-fg": "#2a2a2a", "--v-accent": "#e8a23b" } }) },
  });
  const r = check(dir);
  assert.equal(r.ok, false);
  assert.ok(r.readability.length > 0 && r.readability.every((x) => x.mode === "dark"), "seul le mode sombre est illisible");
  assert.match(r.issues.find((i) => i.severity === "error").message.fr, /En mode sombre/);
});

test("skin hostile : chaque tentative est refusée et dite en mots simples", () => {
  const r = check(path.join(FIXTURES, "hostile-sheet"));
  assert.equal(r.ok, false);
  for (const c of ["import-forbidden", "url-external", "class-selector", "global-selector", "hide-forbidden", "expression-forbidden"]) assert.ok(codes(r).includes(c), `${c} attendu : ${codes(r)}`);
  assert.equal(r.css.includes("evil"), false);
  for (const i of r.issues) { assert.ok(i.message.fr && i.message.en && i.hint.fr && i.hint.en, i.code); assert.ok(!/postcss|undefined/i.test(i.message.fr + i.message.en)); }
});

test("manifeste : absent, illisible, champs manquants, id différent du dossier, id réservé, contrat et cœur trop récents, licence non permise", () => {
  assert.deepEqual(codes(check(path.join(tmp, "n'existe-pas"))), ["manifest-missing"]);
  const bad = mk(); fs.writeFileSync(path.join(bad, "skin.json"), "{ pas du json");
  assert.deepEqual(codes(check(bad)), ["manifest-unreadable"]);
  assert.ok(codes(check(mk({ patch: (m) => { delete m.name.en; } }))).includes("manifest-field"), "nom anglais obligatoire (parité FR/EN)");
  assert.ok(codes(check(mk({ patch: (m) => { delete m.description.fr; } }))).includes("manifest-field"));
  assert.ok(codes(check(mk({ patch: (m) => { m.version = "1.0"; } }))).includes("manifest-field"));
  assert.ok(codes(check(mk({ patch: (m) => { m.modes = []; } }))).includes("manifest-field"));
  const renamed = mk({ id: "autre-nom" });
  assert.ok(codes(V.validateSkinFolder(renamed, { coreVersion: TEST_CORE, folderName: "plain-light" })).includes("manifest-id-folder"));
  assert.ok(codes(check(mk({ id: "basic" }))).includes("bad-skin-id"), "basic est réservé");
  assert.ok(codes(V.validateSkinFolder(mk(), { coreVersion: TEST_CORE, expectId: "autre" })).includes("manifest-id-expected"));
  const newer = check(mk({ patch: (m) => { m.skinContract = 2; } }));
  assert.deepEqual(codes(newer), ["manifest-contract-newer"]);
  assert.match(newer.issues[0].message.fr, /version plus récente de Curiosa/);
  const young = V.validateSkinFolder(mk(), { coreVersion: "0.3.0", folderName: "plain-light" });
  assert.deepEqual(codes(young, "error"), ["manifest-core-newer"]);
  assert.equal(young.manifest.minCore, "0.4.0");
  assert.ok(codes(check(mk({ patch: (m) => { m.license = "GPL-3.0"; } }))).includes("manifest-license-not-allowed"));
});

test("manifeste : avertissements (pas de minCore, pas d'aperçu, clé inconnue, étiquette hors vocabulaire) sans refuser", () => {
  const r = check(mk({ patch: (m) => { delete m.minCore; m.previews = []; m.futur = 1; m.tags = ["light", "inventé"]; }, files: { "previews/home.webp": null } }));
  assert.equal(r.ok, true);
  for (const c of ["manifest-no-mincore", "manifest-no-preview", "manifest-unknown-key"]) assert.ok(codes(r, "warning").includes(c), c);
  assert.deepEqual(r.manifest.tags, ["light"]);
});

test("fichiers : lien symbolique, fichier hors liste, dossier inconnu, trop profond, nom caché ou en majuscules refusés", () => {
  const sym = mk(); fs.symlinkSync("/etc/passwd", path.join(sym, "images-lien")); // lien à la racine
  assert.ok(codes(check(sym)).includes("skin-symlink"));
  const sym2 = mk({ files: { "images/a.png": fakePng() } }); fs.symlinkSync(path.join(sym2, "skin.css"), path.join(sym2, "images", "b.png"));
  assert.ok(codes(check(sym2)).includes("skin-symlink"), "même dans un sous-dossier");
  assert.ok(codes(check(mk({ files: { "extra.txt": "x" } }))).includes("skin-file-unlisted"));
  assert.ok(codes(check(mk({ files: { "scripts/x.js": "alert(1)" } }))).includes("skin-file-unlisted"), "dossier inconnu");
  assert.ok(codes(check(mk({ files: { "images/sous/a.png": fakePng() } }))).includes("skin-too-deep"));
  assert.ok(codes(check(mk({ files: { ".cache": "x" } }))).includes("skin-file-name"));
  assert.ok(codes(check(mk({ files: { "images/Gros.PNG": fakePng() } }))).includes("skin-file-name"));
  const nonDeclared = check(mk({ files: { "fonts/a.woff2": fakeFont() } }));
  assert.ok(codes(nonDeclared).includes("skin-file-unlisted"), "une police non déclarée dans assets est refusée");
});

test("fichiers : les notes de l'auteur à la racine (PROGRESS.md…) sont tolérées, ni installées ni comptées dans l'empreinte ; ailleurs, toujours refusées", () => {
  const plain = check(mk());
  const withNotes = check(mk({ files: { "PROGRESS.md": "# notes", "NOTES.md": "x", "TODO.fr.md": "x", "CHANGELOG.md": "x" } }));
  assert.equal(withNotes.ok, true, JSON.stringify(withNotes.issues.map((i) => i.code)));
  assert.equal(withNotes.fingerprint, plain.fingerprint, "l'empreinte ignore les notes");
  assert.ok(!withNotes.installFiles.some((f) => /PROGRESS|NOTES|TODO|CHANGELOG/.test(f.path)), "rien n'en est installé");
  assert.ok(codes(check(mk({ files: { "previews/PROGRESS.md": "x" } }))).length > 0, "dans un sous-dossier : refusé");
  assert.ok(codes(check(mk({ files: { "SCRIPT.md": "x" } }))).includes("skin-file-unlisted"), "un autre fichier .md reste refusé");
});

test("fichiers : trop de fichiers, trop d'octets en tout", () => {
  const many = {}; for (let i = 0; i < 61; i++) many[`LICENSES/l${i}.txt`] = "x";
  assert.ok(codes(check(mk({ files: many }))).includes("skin-too-many-files"));
  const big = mk(); fs.mkdirSync(path.join(big, "LICENSES"));
  for (let i = 0; i < 24; i++) fs.writeFileSync(path.join(big, "LICENSES", `c${i}.txt`), "x".repeat(90 * 1024));
  assert.ok(codes(check(big)).includes("skin-too-big"));
});

test("ressources : police et image valides, listées avec leur licence, passent", () => {
  const dir = mk({
    patch: (m) => { m.assets = [asset("fonts/corps.woff2", "font", { family: "Corps" }), asset("images/grille.png", "image", { license: "CC0-1.0" }), asset("images/motif.svg", "image")]; },
    files: { ...LIC, "fonts/corps.woff2": fakeFont(), "images/grille.png": fakePng(), "images/motif.svg": SVG_OK },
  });
  const r = check(dir);
  assert.deepEqual(codes(r, "error"), []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.filter((f) => f.kind === "font" || f.kind === "image").map((f) => f.path), ["fonts/corps.woff2", "images/grille.png", "images/motif.svg"]);
});

test("ressources : fausse signature (extension qui ment) refusée pour chaque type", () => {
  for (const [file, kind, bytes] of [["fonts/a.woff2", "font", Buffer.from("<html>pas une police</html>")], ["images/a.png", "image", Buffer.from("GIF89a....................")], ["images/a.jpg", "image", fakePng()], ["images/a.webp", "image", fakePng()], ["images/a.avif", "image", fakePng()]]) {
    const r = check(mk({ patch: (m) => { m.assets = [asset(file, kind)]; }, files: { ...LIC, [file]: bytes } }));
    assert.ok(codes(r).includes("asset-signature"), `${file} : ${codes(r)}`);
  }
  const preview = check(mk({ files: { "previews/home.webp": fakePng() } }));
  assert.ok(codes(preview).includes("asset-signature"), "aperçu");
});

test("ressources : type de fichier non permis (gif, ttf, js) refusé", () => {
  for (const [file, kind] of [["images/a.gif", "image"], ["fonts/a.ttf", "font"], ["images/a.js", "image"], ["fonts/a.woff", "font"]]) {
    const r = check(mk({ patch: (m) => { m.assets = [asset(file, kind)]; }, files: { ...LIC, [file]: "x".repeat(40) } }));
    assert.ok(codes(r).includes("asset-bad-path"), `${file} : ${codes(r)}`);
  }
});

test("ressources : licence absente, fichier de licence introuvable, licence non permise", () => {
  const base = { "fonts/a.woff2": fakeFont(), ...LIC };
  const missing = check(mk({ patch: (m) => { m.assets = [{ file: "fonts/a.woff2", kind: "font" }]; }, files: base }));
  assert.ok(codes(missing).includes("asset-license-missing"));
  const noAuthor = check(mk({ patch: (m) => { m.assets = [asset("fonts/a.woff2", "font", { author: undefined })]; }, files: base }));
  assert.ok(codes(noAuthor).includes("asset-license-missing"), "auteur et source sont exigés aussi");
  const noFile = check(mk({ patch: (m) => { m.assets = [asset("fonts/a.woff2", "font", { licenseFile: "LICENSES/absent.txt" })]; }, files: { "fonts/a.woff2": fakeFont() } }));
  assert.ok(codes(noFile).includes("asset-license-file"));
  const badPath = check(mk({ patch: (m) => { m.assets = [asset("fonts/a.woff2", "font", { licenseFile: "../x.txt" })]; }, files: base }));
  assert.ok(codes(badPath).includes("asset-license-file"));
  const bad = check(mk({ patch: (m) => { m.assets = [asset("fonts/a.woff2", "font", { license: "Proprietary" })]; }, files: base }));
  assert.ok(codes(bad).includes("asset-license-not-allowed"));
});

test("ressources : déclarée mais absente, déclarée deux fois", () => {
  const gone = check(mk({ patch: (m) => { m.assets = [asset("images/absente.png", "image")]; }, files: LIC }));
  assert.ok(codes(gone).includes("asset-missing"));
  const twice = check(mk({ patch: (m) => { m.assets = [asset("images/a.png", "image"), asset("images/a.png", "image")]; }, files: { ...LIC, "images/a.png": fakePng() } }));
  assert.ok(codes(twice).includes("asset-duplicate"));
});

test("ressources : plafonds (police 150 Ko, 4 polices, 400 Ko de polices, image 200 Ko, SVG 30 Ko, 12 images, 1,2 Mo d'images)", () => {
  const fonts = (count, size) => ({ assets: Array.from({ length: count }, (_, i) => asset(`fonts/f${i}.woff2`, "font")), files: Object.fromEntries([["LICENSES/ofl.txt", "x"], ...Array.from({ length: count }, (_, i) => [`fonts/f${i}.woff2`, fakeFont(size)])]) });
  let f = fonts(1, 151 * 1024);
  assert.ok(codes(check(mk({ patch: (m) => { m.assets = f.assets; }, files: f.files }))).includes("file-too-large"), "police trop grosse");
  f = fonts(5, 1024);
  assert.ok(codes(check(mk({ patch: (m) => { m.assets = f.assets; }, files: f.files }))).includes("fonts-too-many"), "5 polices");
  f = fonts(4, 120 * 1024);
  assert.ok(codes(check(mk({ patch: (m) => { m.assets = f.assets; }, files: f.files }))).includes("fonts-total-too-large"), "polices trop lourdes en tout");
  const img = (count, size) => ({ assets: Array.from({ length: count }, (_, i) => asset(`images/i${i}.png`, "image")), files: Object.fromEntries([["LICENSES/ofl.txt", "x"], ...Array.from({ length: count }, (_, i) => [`images/i${i}.png`, fakePng(size)])]) });
  let i = img(1, 201 * 1024);
  assert.ok(codes(check(mk({ patch: (m) => { m.assets = i.assets; }, files: i.files }))).includes("file-too-large"), "image trop grosse");
  i = img(13, 100);
  assert.ok(codes(check(mk({ patch: (m) => { m.assets = i.assets; }, files: i.files }))).includes("images-too-many"));
  i = img(7, 190 * 1024);
  assert.ok(codes(check(mk({ patch: (m) => { m.assets = i.assets; }, files: i.files }))).includes("images-total-too-large"));
  const bigSvg = SVG_OK.replace("</svg>", `<!--${"x".repeat(31 * 1024)}--></svg>`);
  const s = check(mk({ patch: (m) => { m.assets = [asset("images/m.svg", "image")]; }, files: { ...LIC, "images/m.svg": bigSvg } }));
  assert.ok(codes(s).includes("file-too-large"), "SVG > 30 Ko");
  const preview = check(mk({ files: { "previews/home.webp": Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP"), Buffer.alloc(151 * 1024)]) } }));
  assert.ok(codes(preview).includes("file-too-large"), "aperçu > 150 Ko");
});

test("SVG : un dessin sûr est gardé (réécrit), un SVG avec script, lien externe ou foreignObject est refusé", () => {
  const ok = check(mk({ patch: (m) => { m.assets = [asset("images/m.svg", "image")]; }, files: { ...LIC, "images/m.svg": SVG_OK } }));
  assert.equal(ok.ok, true);
  const installed = ok.installFiles.find((f) => f.path === "images/m.svg").content.toString();
  assert.match(installed, /<rect/);
  for (const bad of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.org/x.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
    "pas du tout un svg",
  ]) {
    const r = check(mk({ patch: (m) => { m.assets = [asset("images/m.svg", "image")]; }, files: { ...LIC, "images/m.svg": bad } }));
    assert.ok(codes(r).includes("asset-svg-refused"), bad);
  }
});

test("jetons : fichier absent ou illisible, forme, noms, valeurs non permises, url distante", () => {
  assert.ok(codes(check(mk({ files: { "tokens.json": null } }))).includes("tokens-missing"));
  assert.ok(codes(check(mk({ files: { "tokens.json": "{ non" } }))).includes("tokens-unreadable"));
  assert.ok(codes(check(mk({ files: { "tokens.json": "[1]" } }))).includes("tokens-shape"));
  const tok = (o) => JSON.stringify({ light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, ...o });
  assert.ok(codes(check(mk({ files: { "tokens.json": tok({ common: { color: "red" } }) } }))).includes("tokens-bad-name"));
  assert.ok(codes(check(mk({ files: { "tokens.json": tok({ common: { "--sk-x": "url(https://example.org/a.png)" } }) } }))).includes("url-external"));
  assert.ok(codes(check(mk({ files: { "tokens.json": tok({ common: { "--sk-x": 12 } }) } }))).includes("value-syntax"), "valeurs en texte seulement");
  assert.ok(codes(check(mk({ files: { "tokens.json": tok({ common: { "--sk-x": "expression(alert(1))" } }) } }))).some((c) => c !== "tokens-shape"), "expression refusée");
  assert.ok(codes(check(mk({ files: { "tokens.json": tok({ modules: { events: { "--sk-autre-x": "1px" } } }) } }))).includes("tokens-module-name"));
  const ok = check(mk({ files: { "tokens.json": tok({ modules: { events: { "--sk-m-events-card-radius": "0" } } }) } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.tokens.modules.events["--sk-m-events-card-radius"], "0");
  const undeclared = check(mk({ files: { "tokens.json": tok({ dark: { "--v-bg": "#000000" } }) } }));
  assert.ok(codes(undeclared, "warning").includes("tokens-mode-undeclared"), "mode non déclaré : ignoré avec avertissement");
  const huge = Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`--sk-t${i}`, "1px"]));
  assert.ok(codes(check(mk({ files: { "tokens.json": tok({ common: huge }) } }))).includes("tokens-too-many"));
});

test("jetons : les minimums de l'assainisseur s'appliquent aux valeurs (taille de texte trop petite refusée)", () => {
  const r = check(mk({ files: { "tokens.json": JSON.stringify({ light: { "--v-bg": "#fafaf7", "--v-surface": "#ffffff", "--v-fg": "#1b1b1f", "--v-accent": "#1d4ed8" }, common: { "--sk-text-sm": "0.3rem" } }) } }));
  assert.equal(r.ok, false);
});

test("options : jetons des options contrôlés comme les autres ; valeur par défaut obligatoire dans la liste", () => {
  const option = (tokens, def = "a") => ({ id: "density", label: { fr: "Densité", en: "Density" }, default: def, values: [{ id: "a", label: { fr: "A", en: "A" }, tokens: {} }, { id: "b", label: { fr: "B", en: "B" }, tokens }] });
  assert.equal(check(mk({ patch: (m) => { m.options = [option({ "--sk-space": "0.3125rem" })]; } })).ok, true);
  assert.equal(check(mk({ patch: (m) => { m.options = [option({ "--sk-image": "url(https://example.org/x.png)" })]; } })).ok, false);
  assert.ok(codes(check(mk({ patch: (m) => { m.options = [option({}, "zzz")]; } }))).includes("manifest-field"));
});

test("feuille : plafond de 60 Ko fatal, animation sans reducedMotion refusée", () => {
  const big = "[data-skin-part=\"card\"] { color: red; }\n".repeat(1700);
  const r = check(mk({ files: { "skin.css": big } }));
  assert.ok(codes(r).includes("sheet-too-large"));
  assert.equal(r.css, "");
  const anim = '@media (prefers-reduced-motion: no-preference) { @keyframes pulse { from { opacity: 1; } to { opacity: 0.8; } } [data-skin-part="card"] { animation: pulse 2s ease 2; } }\n';
  const without = check(mk({ patch: (m) => { m.supports = {}; }, files: { "skin.css": anim } }));
  assert.ok(codes(without).includes("manifest-reduced-motion"));
  assert.equal(check(mk({ files: { "skin.css": anim } })).ok, true);
  assert.ok(codes(check(mk({ files: { "skin.css": null } }))).includes("stylesheet-missing"));
});

test("feuille : url(skin:…) vers une ressource déclarée est réécrite vers /skins/<id>/<version>/…", () => {
  const dir = mk({
    patch: (m) => { m.assets = [asset("images/grille.png", "image")]; },
    files: { ...LIC, "images/grille.png": fakePng(), "skin.css": '[data-skin-region="backdrop"] { background-image: url(skin:images/grille.png); }\n' },
  });
  const r = check(dir);
  assert.equal(r.ok, true, JSON.stringify(codes(r)));
  assert.match(r.css, /url\("\/skins\/plain-light\/1\.0\.0\/images\/grille\.png"\)/);
  const unknown = check(mk({ files: { "skin.css": '[data-skin-region="backdrop"] { background-image: url(skin:images/autre.png); }\n' } }));
  assert.equal(unknown.ok, false, "ressource non déclarée");
});

test("polices : @font-face d'une police déclarée, avec sa famille, passe ; une autre famille est refusée", () => {
  const css = (fam) => `@font-face { font-family: "${fam}"; src: url(skin:fonts/corps.woff2) format("woff2"); font-weight: 400; }\n[data-skin-region="main"] { font-family: "${fam}", serif; }\n`;
  const withFont = (fam) => mk({ patch: (m) => { m.assets = [asset("fonts/corps.woff2", "font", { family: "Corps" })]; }, files: { ...LIC, "fonts/corps.woff2": fakeFont(), "skin.css": css(fam) } });
  const ok = check(withFont("Corps"));
  assert.equal(ok.ok, true, JSON.stringify(codes(ok)));
  assert.match(ok.css, /font-display:\s*swap/);
  assert.equal(check(withFont("Inconnue")).ok, false);
});

test("messages : tous les problèmes rendus ont un texte FR et EN et un code connu", () => {
  const all = [check(path.join(FIXTURES, "hostile-sheet")), check(path.join(FIXTURES, "faded-grey")), check(mk({ files: { "extra.txt": "x" } }))];
  for (const r of all) for (const i of r.issues) {
    assert.ok(M.ISSUE_CODES.includes(i.code), i.code);
    assert.ok(i.message.fr.length > 10 && i.message.en.length > 10);
    assert.notEqual(i.message.fr, i.message.en);
  }
});

test("une exception inattendue ne s'échappe jamais : refus propre", () => {
  const r = V.validateSkinFolder(undefined, { coreVersion: TEST_CORE });
  assert.equal(r.ok, false);
  assert.ok(r.issues.length >= 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Commande skin:check

const CLI = path.resolve(import.meta.dirname, "../../scripts/skin-check.mjs");
const cli = (...a) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, ...a, "--core-version", TEST_CORE], { encoding: "utf8", env: { ...process.env, TMPDIR: os.tmpdir() } });

test("skin:check : skin valide → code 0 ; illisible ou hostile → code 1 avec « comment corriger » ; sans dossier → code 2", () => {
  const ok = cli(path.join(FIXTURES, "plain-light"), "--lang", "fr");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /(✅|⚠️ ) plain-light 1\.0\.0 — valide/);
  const bad = cli(path.join(FIXTURES, "faded-grey"), "--lang", "en");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /In light mode, the text would be hard to read/);
  assert.match(bad.stdout, /How to fix/);
  const hostile = cli(path.join(FIXTURES, "hostile-sheet"));
  assert.equal(hostile.status, 1);
  assert.match(hostile.stdout, /@import/);
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: "utf8" }).status, 2);
  const none = cli(tmp);
  assert.equal(none.status, 1);
});

test("skin:check : --json lisible par une machine ; un dépôt de skins (skins/<id>/) est contrôlé en entier ; --strict fait échouer sur un avertissement", () => {
  const json = JSON.parse(cli(path.join(FIXTURES, "faded-grey"), "--json").stdout);
  assert.equal(json.ok, false);
  assert.equal(json.skins[0].issues[0].code, "read-low-1");
  const repo = path.join(tmp, "depot");
  copySkin("plain-light", path.join(repo, "skins", "plain-light"));
  copySkin("plain-light", path.join(repo, "skins", "autre"), { id: "autre" });
  const all = cli(repo, "--lang", "en");
  assert.equal(all.status, 0, all.stdout);
  assert.match(all.stdout, /2 skin\(s\) checked/);
  copySkin("plain-light", path.join(repo, "skins", "sans-apercu"), { id: "sans-apercu", patch: (m) => { m.previews = []; }, files: { "previews/home.webp": null } });
  assert.equal(cli(repo).status, 0, "un avertissement ne fait pas échouer");
  assert.equal(cli(repo, "--strict").status, 1, "…sauf avec --strict");
});

test("la commande skin:check est déclarée dans package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../package.json"), "utf8"));
  assert.match(pkg.scripts["skin:check"], /scripts\/skin-check\.mjs/);
  execFileSync(process.execPath, ["--check", CLI]);
});
