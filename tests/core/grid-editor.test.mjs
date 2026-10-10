import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { parseGeneratedGrid } = await import("@/core/gridEditor");
const read = (p) => fs.readFileSync(p, "utf8");
const editor = read("src/components/admin/GridEditor.tsx");
const actions = read("src/app/admin/(panel)/instances/module-actions.ts");

test("gridEditor : un tracé généré valide est accepté tel quel", () => {
  const g = { width: 5, height: 5, cells: "1".repeat(25) };
  assert.deepEqual(parseGeneratedGrid(g, { min: 5, max: 41, allowed: ["0", "1"] }), g);
  assert.deepEqual(parseGeneratedGrid(g), g, "sans contraintes, seules la forme et la longueur comptent");
});

test("gridEditor : un tracé généré invalide est refusé (taille, longueur, contenu, type)", () => {
  const ok = { width: 5, height: 5, cells: "1".repeat(25) };
  const o = { min: 5, max: 41, allowed: ["0", "1"] };
  for (const bad of [null, undefined, "x", 3, [], {}, { ...ok, width: "5" }, { ...ok, width: 5.5 }, { ...ok, width: 4, cells: "1".repeat(20) }, { ...ok, width: 42, cells: "1".repeat(42 * 5) },
    { ...ok, cells: "1".repeat(24) }, { ...ok, cells: "1".repeat(26) }, { ...ok, cells: "1".repeat(24) + "9" }, { ...ok, cells: 25 }, { ...ok, height: NaN }]) {
    assert.equal(parseGeneratedGrid(bad, o), null, JSON.stringify(bad));
  }
  assert.equal(parseGeneratedGrid({ width: 101, height: 1, cells: "1".repeat(101) }), null, "plafond de sécurité même sans bornes");
});

test("gridEditor : l'action de génération passe par une action serveur réservée aux administrateurs, ne persiste rien et valide la réponse", () => {
  const fn = actions.slice(actions.indexOf("export async function runModuleGridGenerate"));
  assert.match(fn, /adminCtx\("admin"\)/, "mêmes contrôles d'accès que runModuleAdminAction");
  assert.match(fn, /adminActions\?\.\[action\]/, "uniquement les actions déclarées par le module");
  assert.match(fn, /parseGeneratedGrid\(result\.grid\)/, "réponse invalide refusée");
  assert.ok(!/revalidatePath|redirect\(|audit\(/.test(fn), "génération = lecture : rien n'est persisté ni redirigé");
  assert.match(editor, /runModuleGridGenerate\(instanceId, actionName\)/, "le navigateur n'atteint jamais le stockage : il passe par l'action");
  assert.match(editor, /parseGeneratedGrid\(res\.grid, \{ min, max, allowed: values \}\)/, "l'éditeur revérifie taille et palette");
});

test("gridEditor : mode automatique — enregistre `auto` à la place de la grille ; retoucher, redimensionner ou générer en sort ; Annuler revient à l'état chargé", () => {
  assert.match(editor, /name="auto" value="true"/);
  assert.match(editor, /auto\s*\n?\s*\? <input type="hidden" name="auto"[\s\S]*: <>.*name="width"[\s\S]*name="cells"/, "auto OU grille, jamais les deux");
  assert.match(editor, /useState\(!!block\.autoLabel && !!block\.autoActive\)/, "mode initial fourni par le module, seulement si le bouton existe");
  assert.match(editor, /const edited = \(\) => \{ setAuto\(false\)/);
  assert.match(editor, /if \(auto\) setAuto\(false\);/, "peindre sort du mode");
  assert.match(editor, /setAuto\(false\); setW\(grid\.width\)/, "générer sort du mode");
  assert.match(editor, /const reset = \(\) => \{ setAuto\(!!block\.autoLabel && !!block\.autoActive\)/, "Annuler : mode et grille d'origine");
  assert.match(editor, /opacity-30 grayscale/, "grille atténuée");
  assert.match(editor, /block\.autoNotice/);
});

test("gridEditor : rétrocompatible — boutons et message seulement si le module déclare les options ; enregistrement par la barre flottante commune", () => {
  assert.match(editor, /\(block\.generateAction \|\| block\.autoLabel\) &&/);
  assert.match(editor, /block\.generateAction && <button/);
  assert.match(editor, /block\.autoLabel && <button/);
  assert.match(editor, /auto && block\.autoNotice &&/);
  assert.match(editor, /<ActionForm action=\{runModuleAdminAction\.bind\(null, instanceId, block\.action\)\} floating=\{floating\} hideSubmit/);
  assert.match(read("src/components/site/Blocks.tsx"), /<GridEditor [^>]*floating=\{floatingLabels\(makeTranslator\(locale\)\)\}/);
  // La grille postée reste width / height / cells comme avant.
  for (const name of ["width", "height", "cells"]) assert.match(editor, new RegExp(`name="${name}"`));
  const blocks = read("src/core/blocks.ts");
  for (const k of ["generateAction?", "generateLabel?", "autoLabel?", "autoNotice?", "autoActive?"]) assert.ok(blocks.includes(k), k);
  const docs = read("docs/MODULES.md");
  for (const k of ["generateAction", "generateLabel", "autoLabel", "autoNotice", "autoActive", "generateError"]) assert.ok(docs.includes(k), `docs : ${k}`);
});
