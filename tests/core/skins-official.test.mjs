// `npm run skin:official` : les skins du catalogue contre le cœur courant, avec la liste des pièces NOUVELLES non habillées. Aucun réseau : un vrai dépôt git local
// jetable tient lieu de dépôt curiosa-skins (comme tests/core/skins-install.test.mjs).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useTestDb } from "../helpers/db.mjs";
import { createSkinsRepo, TEST_CORE } from "../helpers/skins.mjs";
import { makeTempDir } from "../helpers/tmp.mjs";

// eslint-disable-next-line react-hooks/rules-of-hooks -- useTestDb n'est pas un hook React
const db = await useTestDb();
const O = await import("../../testsupport/skins/official.mjs");
const { PARTS, REGIONS } = await import("@/core/skins/allowlist");
const cat = createSkinsRepo();
const tmp = makeTempDir("curiosa-official-test-");
after(() => { cat.close(); db.close(); });

const current = { regions: [...REGIONS], parts: [...PARTS] };
const baselineWithout = (file, { regions = [], parts = [] }) => {
  const f = path.join(tmp, file);
  fs.writeFileSync(f, JSON.stringify(O.snapshot("0.4.0", current.regions.filter((r) => !regions.includes(r)), current.parts.filter((p) => !parts.includes(p)))));
  return f;
};
const run = (options) => O.runOfficial({ root: process.cwd(), coreVersion: TEST_CORE, repo: cat.url, visual: false, ...options });

test("la référence versionnée existe, est lisible, ne contient que des éléments connus (jamais un retrait silencieux) et n'est pas plus récente que le cœur", () => {
  const base = O.readBaseline(O.BASELINE_FILE);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const num = (v) => v.split(/[.-]/).slice(0, 3).map(Number);
  const [a, b] = [num(base.version), num(pkg)];
  const newer = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
  assert.equal(newer, false, `référence ${base.version} plus récente que le cœur ${pkg}`);
  assert.deepEqual(O.removedNames(current, base), { regions: [], parts: [] }, "une région ou une pièce publiée ne se retire pas (changement cassant : nouveau skinContract)");
  assert.ok(base.parts.length > 0 && base.regions.length > 0);
});

test("lire une liste de pièces dans le texte d'un ancien allowlist.ts, et comparer", () => {
  const parsed = O.parseAllowlistText(fs.readFileSync("src/core/skins/allowlist.ts", "utf8"));
  assert.deepEqual(parsed, current, "l'analyse du texte donne exactement la liste exécutée");
  assert.deepEqual(O.newNames(current, { regions: ["shell"], parts: ["card"] }).parts.includes("card"), false);
  assert.equal(O.newNames(current, { regions: [], parts: [] }).regions.length, REGIONS.length);
  assert.deepEqual(O.removedNames({ regions: ["a"], parts: [] }, { regions: ["a", "b"], parts: ["c"] }), { regions: ["b"], parts: ["c"] });
  assert.throws(() => O.parseAllowlistText("export const REGIONS = [\"a\"] as const;"), /PARTS introuvable/);
  assert.throws(() => O.allowlistAtRef(process.cwd(), "pas-une-ref-git"), /n'est pas dans ce dépôt/);
  assert.throws(() => O.allowlistAtRef(process.cwd(), "--option"), /invalide/);
});

test("la référence est vérifiée : fichier absent, JSON abîmé, format inconnu, nom douteux", () => {
  const bad = (name, content) => { const f = path.join(tmp, name); fs.writeFileSync(f, content); return f; };
  assert.throws(() => O.readBaseline(path.join(tmp, "absent.json")), /fichier absent/);
  assert.throws(() => O.readBaseline(bad("a.json", "{pas du json")), /illisible/);
  assert.throws(() => O.readBaseline(bad("b.json", JSON.stringify({ format: 2, version: "1.0.0", regions: [], parts: [] }))), /invalide/);
  assert.throws(() => O.readBaseline(bad("c.json", JSON.stringify({ format: 1, version: "1.0.0", regions: [], parts: ["Card"] }))), /invalide/);
  assert.throws(() => O.readBaseline(bad("d.json", JSON.stringify({ format: 1, version: "1.0.0", regions: [], parts: ["a", "a"] }))), /invalide/);
  const ok = O.readBaseline(bad("e.json", JSON.stringify(O.snapshot("0.4.0", ["shell"], ["card"]))));
  assert.deepEqual([ok.regions, ok.parts], [["shell"], ["card"]]);
});

test("skins officiels : valides, pièces nouvelles non habillées signalées (avertissement), --fail-on-uncovered les durcit", async () => {
  await cat.clear();
  await cat.publish("plain-light");
  await cat.publish("duo", { from: "duo" });
  // le skin plain-light cible `card` et `header` ; ni `pagination` ni `tray`
  const baseline = baselineWithout("b1.json", { regions: ["tray", "header"], parts: ["card", "pagination"] });
  const r = await run({ baseline });
  assert.deepEqual(r.newNames, { regions: ["tray", "header"], parts: ["card", "pagination"] });
  assert.equal(r.skins.length, 2);
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0, "des nouveautés non habillées sont un avertissement, pas un échec");
  const plain = r.skins.find((s) => s.id === "plain-light");
  assert.equal(plain.ok, true);
  assert.deepEqual(plain.uncovered, { regions: ["tray"], parts: ["pagination"] }, "card et header sont ciblés par la feuille du skin");
  assert.equal(plain.visual, "skipped");
  assert.ok(plain.coverage.parts.targeted.includes("card"));

  const text = O.toText(r, "fr");
  assert.match(text, /Skin\s+\| Version \| Valide \?/);
  assert.match(text, /plain-light\s+\| 1\.0\.0\s+\| oui/);
  assert.match(text, /AVERTISSEMENT : des éléments nouveaux/);
  assert.match(text, /plain-light : tray \(région\), pagination/);
  assert.match(text, /version corrective ou mineure du skin, `requires\.core` à jour/);
  assert.match(text, /SAUTÉ/);
  const en = O.toText(r, "en");
  assert.match(en, /WARNING: new elements are not dressed/);
  assert.match(en, /patch or minor version of the skin, `requires\.core` up to date/);
  assert.match(en, /SKIPPED/);
  assert.doesNotMatch(en + text, /undefined|\[object/);
  const json = JSON.parse(O.toJson(r));
  assert.deepEqual(json.skins.find((s) => s.id === "plain-light").uncoveredNew, { regions: ["tray"], parts: ["pagination"] });

  const hard = await run({ baseline, failOnUncovered: true });
  assert.equal(hard.ok, true);
  assert.equal(hard.exitCode, 1);
  assert.match(O.toText(hard, "fr"), /--fail-on-uncovered/);
});

test("sans nouveauté : rien à signaler ; --only restreint ; le catalogue vide donne un tableau vide", async () => {
  const none = await run({ baseline: baselineWithout("b2.json", {}) });
  assert.equal(none.exitCode, 0);
  assert.ok(none.skins.every((s) => s.uncovered.parts.length + s.uncovered.regions.length === 0));
  assert.match(O.toText(none, "fr"), /Aucun élément nouveau/);
  assert.match(O.toText(none, "fr"), /aucune nouveauté/);
  const one = await run({ baseline: baselineWithout("b2.json", {}), only: ["duo"] });
  assert.deepEqual(one.skins.map((s) => s.id), ["duo"]);
});

test("un skin refusé par le kit, ou introuvable à son étiquette : code 1, avec « comment corriger »", async () => {
  await cat.clear();
  await cat.publish("plain-light");
  await cat.publish("hostile-sheet", { from: "hostile-sheet" });
  await cat.publish("sans-etiquette", { tag: false, entry: { ref: "sans-etiquette-v9.9.9" } });
  const r = await run({ baseline: baselineWithout("b3.json", { parts: ["card"] }) });
  assert.equal(r.exitCode, 1);
  assert.equal(r.ok, false);
  const bySkin = Object.fromEntries(r.skins.map((s) => [s.id, s]));
  assert.equal(bySkin["plain-light"].ok, true);
  assert.equal(bySkin["hostile-sheet"].ok, false);
  assert.ok(bySkin["hostile-sheet"].issues.some((i) => i.severity === "error"));
  assert.equal(bySkin["sans-etiquette"].ok, false);
  assert.ok(bySkin["sans-etiquette"].fetchError);
  const text = O.toText(r, "fr");
  assert.match(text, /❌ hostile-sheet/);
  assert.match(text, /Comment corriger/);
  assert.match(text, /❌ sans-etiquette — récupération impossible/);
  assert.match(text, /2 skin\(s\) sur 3 à corriger/);
});

test("le cœur trop ancien pour un skin (requires.core) est vu comme un skin à corriger", async () => {
  await cat.clear();
  await cat.publish("plain-light", { patch: (m) => { m.minCore = "9.0.0"; }, entry: { requires: { core: "9.0.0" } } });
  const r = await run({ baseline: baselineWithout("b4.json", {}) });
  assert.equal(r.skins[0].ok, false);
  assert.equal(r.exitCode, 1);
});

test("la commande : tableau, codes de sortie 0 / 1 / 2, --json, --update-baseline, usage", async () => {
  await cat.clear();
  await cat.publish("plain-light");
  const env = { ...process.env, CURIOSA_SKINS_REPO: cat.url, CURIOSA_ALLOW_LOCAL_MODULES: "1" };
  const cli = (args, extra = {}) => spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/skin-official.mjs", "--no-visual", ...args], { encoding: "utf8", env: { ...env, ...extra } });
  const b = baselineWithout("b5.json", { parts: ["pagination"] });
  const ok = cli(["--baseline", b, "--lang", "en"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /plain-light\s+\| 1\.0\.0\s+\| yes/);
  assert.match(ok.stdout, /WARNING: new elements are not dressed/);
  assert.equal(cli(["--baseline", b, "--fail-on-uncovered"]).status, 1);
  const json = JSON.parse(cli(["--baseline", b, "--json"]).stdout);
  assert.equal(json.tool, "skin:official");
  assert.equal(json.skins[0].uncoveredNew.parts[0], "pagination");
  // catalogue injoignable : 2, message simple
  const down = cli(["--baseline", b], { CURIOSA_SKINS_REPO: "file:///nonexistent/curiosa-skins" });
  assert.equal(down.status, 2);
  assert.match(down.stderr, /Impossible de lire le catalogue officiel/);
  // référence absente : 2
  assert.equal(cli(["--baseline", path.join(tmp, "nope.json")]).status, 2);
  // usage
  assert.equal(cli(["--inconnue"]).status, 2);
  assert.equal(cli(["--only"]).status, 2);
  // --update-baseline : réécrit sans réseau, la référence relue est exactement la liste actuelle
  const out = path.join(tmp, "regen.json");
  const regen = cli(["--update-baseline", "--baseline", out], { CURIOSA_SKINS_REPO: "file:///nonexistent" });
  assert.equal(regen.status, 0, regen.stderr);
  const read = O.readBaseline(out);
  assert.deepEqual([read.regions, read.parts], [current.regions, current.parts]);
  assert.equal(read.version, JSON.parse(fs.readFileSync("package.json", "utf8")).version);
});

test("le niveau navigateur est dit « sauté » quand on le saute, et la détection ne lève jamais", async () => {
  const b = await O.browserAvailable();
  assert.equal(typeof b.ok, "boolean");
  if (!b.ok) assert.ok(b.reason);
});
