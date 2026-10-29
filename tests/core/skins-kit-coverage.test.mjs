// Kit de test des skins : le CONSEIL de couverture (pièces et régions que le skin ne cible pas). Jamais une erreur, jamais un échec avec --strict.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { goodSkin } from "../helpers/skin-defects.mjs";
import { copySkin } from "../helpers/skins.mjs";

const { checkOne } = await import("../../testsupport/skins/check.mjs");
const { stripConditions, targetedNames, skinCoverage } = await import("../../testsupport/skins/coverage.mjs");
const { toJson, toText } = await import("../../testsupport/skins/report.mjs");
const { kitCatalog } = await import("../../testsupport/skins/messages.mjs");
const { PARTS, REGIONS } = await import("@/core/skins/allowlist");

const CORE = "0.4.0";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-cov-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("targetedNames : lit les sélecteurs de la feuille ; une mention dans :not() ou :has() ne compte pas", () => {
  const css = `
    :root[data-skin="x"] [data-skin-region="header"] [data-skin-part="nav-link"]:hover { color: red }
    :root[data-skin="x"] :is([data-skin-part="card"], [data-skin-part="chip"]) { color: red }
    :root[data-skin="x"] [data-skin-part="button"]:not([data-skin-part="badge"]) { color: red }
    :root[data-skin="x"] [data-skin-part="list"]:has([data-skin-part="quote"]) { color: red }
    @keyframes k { from { opacity: 1 } to { opacity: .9 } }
    @media (width >= 40rem) { :root[data-skin="x"] [data-skin-region='footer'] { color: red } }`;
  const { regions, parts } = targetedNames(css);
  assert.deepEqual([...regions].sort(), ["footer", "header"]);
  assert.deepEqual([...parts].sort(), ["button", "card", "chip", "list", "nav-link"]);
  assert.equal(stripConditions('a:not(b:not(c)) d:has(e) f'), "a d f");
  assert.deepEqual([...targetedNames("").parts], []);
  assert.deepEqual([...targetedNames("{{{ pas du css").parts], []);
});

test("skinCoverage : cibles, manques, jetons non fixés (les couleurs dérivées ne comptent pas)", async () => {
  const cov = await skinCoverage({ css: '[data-skin-part="card"]{color:red}[data-skin-region="main"]{color:red}', tokens: { common: { "--sk-radius-card": "1rem" }, light: { "--v-bg": "#fff" }, dark: {} } });
  assert.deepEqual(cov.parts.targeted, ["card"]);
  assert.equal(cov.parts.missing.length, PARTS.length - 1);
  assert.deepEqual(cov.regions.targeted, ["main"]);
  assert.equal(cov.regions.total, REGIONS.length);
  assert.ok(cov.tokens.set.includes("--sk-radius-card") && cov.tokens.set.includes("--v-bg"));
  assert.ok(!cov.tokens.missing.includes("--v-muted"), "une couleur dérivée est calculée par le cœur");
  assert.ok(cov.tokens.missing.length > 10);
  // liste donnée : sert aux tests et à la comparaison avec une ancienne version du cœur
  const small = await skinCoverage({ css: '[data-skin-part="a"]{}' }, { regions: ["r"], parts: ["a", "b"] });
  assert.deepEqual([small.parts.missing, small.regions.missing], [["b"], ["r"]]);
});

test("le conseil de couverture : listé, FR et EN, jamais une erreur ni un avertissement ; --coverage donne la liste entière", async () => {
  const dir = goodSkin(tmp, "cov-good");
  const r = await checkOne(dir, { coreVersion: CORE });
  const advice = r.issues.find((i) => i.code === "kit-coverage");
  assert.ok(advice, "le skin de référence ne cible pas toutes les pièces");
  assert.equal(advice.severity, "advice");
  assert.equal(advice.level, "stylesheet");
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues.filter((i) => i.severity === "error"), []);
  assert.match(advice.message.fr, /ne règle pas \d+ pièce\(s\) ou région\(s\)/);
  assert.match(advice.message.en, /does not style \d+ part\(s\) or region\(s\)/);
  assert.match(advice.message.fr, /et \d+ autres/, "liste courte par défaut");
  assert.match(advice.message.en, /and \d+ more/);
  assert.match(advice.hint.fr, /pas un défaut/);
  assert.equal(r.coverage.parts.total, PARTS.length);

  const full = await checkOne(dir, { coreVersion: CORE, coverage: true });
  const fa = full.issues.find((i) => i.code === "kit-coverage");
  assert.doesNotMatch(fa.message.fr, /et \d+ autres/);
  for (const name of full.coverage.parts.missing) assert.ok(fa.message.fr.includes(name), name);
  for (const name of full.coverage.regions.missing) assert.ok(fa.message.fr.includes(`${name} (région)`) && fa.message.en.includes(`${name} (region)`), name);
});

test("un skin qui cible tout n'a pas de conseil de couverture", async () => {
  const all = [...REGIONS.map((n) => `[data-skin-region="${n}"]{color:inherit}`), ...PARTS.map((n) => `[data-skin-part="${n}"]{color:inherit}`)].join("\n");
  const dir = path.join(tmp, "cov-all");
  copySkin("plain-light", dir, { id: "cov-all", patch: (m) => { m.minCore = "0.4.0"; }, files: { "skin.css": all } });
  const r = await checkOne(dir, { coreVersion: CORE });
  assert.equal(r.issues.some((i) => i.code === "kit-coverage"), false, JSON.stringify(r.issues.filter((i) => i.code === "kit-coverage")));
  assert.deepEqual([r.coverage.parts.missing, r.coverage.regions.missing], [[], []]);
});

test("rapport : le texte n'affiche le conseil qu'avec --advice, la section de couverture qu'avec --coverage ; le JSON porte toujours la couverture", async () => {
  const r = await checkOne(goodSkin(tmp, "cov-report"), { coreVersion: CORE, coverage: true });
  const report = { tool: "skin:check", coreVersion: CORE, strict: false, ok: true, exitCode: 0, skins: [r] };
  assert.doesNotMatch(toText(report, "fr"), /Couverture|ne règle pas/);
  assert.match(toText({ ...report, advice: true }, "fr"), /ne règle pas \d+ pièce\(s\)/);
  const text = toText({ ...report, coverage: true }, "fr");
  assert.match(text, /Couverture \(conseil/);
  assert.match(text, /Pièces réglées : \d+ \/ \d+\n\s+laissé\(es\) au skin de base : /);
  assert.match(toText({ ...report, coverage: true }, "en"), /Parts styled: \d+ \/ \d+/);
  const json = JSON.parse(toJson(report));
  assert.equal(json.skins[0].coverage.parts.total, PARTS.length);
  assert.ok(json.skins[0].coverage.regions.missing.length > 0);
});

test("--strict n'échoue pas à cause du conseil ; la commande accepte --coverage", async () => {
  const { buildReport } = await import("../../testsupport/skins/report.mjs");
  const r = await checkOne(goodSkin(tmp, "cov-strict"), { coreVersion: CORE });
  // seul le conseil de couverture reste : même en mode strict, rien n'échoue
  const only = { ...r, issues: r.issues.filter((i) => i.code === "kit-coverage") };
  assert.equal(only.issues.length, 1);
  assert.equal(buildReport({ coreVersion: CORE, skins: [only], strict: true }).exitCode, 0);
  const dir = path.join(tmp, "cov-strict");
  const run = (...a) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/skin-check.mjs", dir, "--core-version", CORE, ...a], { encoding: "utf8" });
  const out = run("--strict", "--coverage", "--lang", "en");
  assert.match(out.stdout, /Coverage \(advice/);
  assert.match(out.stdout, /Parts styled: \d+ \/ \d+/);
  assert.doesNotMatch(out.stdout, /\[kit-coverage\]/, "le conseil n'est pas un avertissement");
  const json = JSON.parse(run("--json").stdout);
  assert.ok(json.skins[0].issues.some((i) => i.code === "kit-coverage" && i.severity === "advice"));
});

test("le message du conseil est documenté dans le guide et en parité FR/EN", () => {
  const e = kitCatalog()["kit-coverage"];
  assert.equal(e.severity, "advice");
  assert.ok(fs.readFileSync("docs/CREER-UN-SKIN.md", "utf8").includes("`kit-coverage`"));
});
