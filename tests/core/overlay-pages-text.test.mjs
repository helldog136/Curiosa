// Pages d'overlay (0.5.0) : textes FR/EN à parité exacte, vocabulaire du document de conception, vouvoiement, aucune clé manquante, aucun skin de site.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const mine = (d) => Object.keys(d).filter((k) => /^(ovp\.|overlay\.page\.|audit\.action\.overlay\.|nav\.overlayPages$)/.test(k));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sources = [...walk("src/app/admin/(panel)/overlay-pages"), ...walk("src/core/overlays"), "src/components/admin/OverlayEditor.tsx", "src/components/admin/CopyAddress.tsx"].filter((f) => /\.(ts|tsx)$/.test(f));

test("parité exacte FR/EN des textes des pages d'overlay, mêmes variables, aucune valeur vide", () => {
  assert.deepEqual(mine(fr).sort(), mine(en).sort());
  assert.ok(mine(fr).length > 150);
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of mine(fr)) { assert.ok(fr[k].trim() && en[k].trim(), k); assert.deepEqual(vars(fr[k]), vars(en[k]), k); }
});

test("chaque clé de texte citée dans le code existe, et chaque clé écrite sert", () => {
  const code = sources.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const used = new Set();
  for (const m of code.matchAll(/\bt\(\s*[`"']((?:ovp|overlay\.page|nav)\.[\w.]+)[`"']/g)) used.add(m[1]);
  for (const m of code.matchAll(/"((?:ovp\.)[\w.]+)"/g)) used.add(m[1]);
  for (const k of used) assert.ok(k in fr && k in en, `clé manquante : ${k}`);
  // Clés construites : ovp.flash.<code>, ovp.err.option.<code>, ovp.ed.<clé de la liste STRINGS>, overlay.page.failed.<raison>, ovp.ed.fit.<comportement>.
  const strings = fs.readFileSync("src/app/admin/(panel)/overlay-pages/[id]/page.tsx", "utf8").match(/const STRINGS = \[([\s\S]*?)\] as const/)[1].match(/"[\w.]+"/g).map((x) => x.slice(1, -1));
  for (const k of strings) assert.ok(`ovp.ed.${k}` in fr, `ovp.ed.${k}`);
  const edKeys = [...code.matchAll(/\bs\(\s*[`"']ed\.([\w.]+)[`"']/g)].map((m) => m[1]);
  for (const k of edKeys) assert.ok(strings.includes(k), `l'éditeur demande « ed.${k} » mais le serveur ne l'envoie pas`);
  for (const code_ of ["limitPages", "limitActive", "name", "resolution", "notFound", "duplicated", "renamed", "activated", "deactivated", "deleted", "secret"]) assert.ok(`ovp.flash.${code_}` in fr, code_);
  for (const code_ of ["number", "integer", "range", "rangeMin", "rangeMax", "choice", "boolean", "text", "length"]) assert.ok(`ovp.err.option.${code_}` in fr, code_);
  for (const r of ["stalled", "error", "address", "empty"]) assert.ok(`overlay.page.failed.${r}` in fr, r);
  for (const a of ["tl", "tc", "tr", "ml", "c", "mr", "bl", "bc", "br"]) assert.ok(`ovp.ed.anchor.${a}` in fr && `ovp.ed.anchor.${a}` in en);
  const unused = mine(fr).filter((k) => !used.has(k) && k !== "nav.overlayPages" && k !== "overlay.page.gone" && !/^ovp\.(ed|flash|err\.option)\./.test(k) && !/^overlay\.page\.failed\./.test(k) && !k.startsWith("audit.action.") && !/\.one$/.test(k));
  assert.deepEqual(unused, [], "clés écrites mais jamais utilisées");
});

test("vocabulaire du document de conception : « page d'overlay », « élément », « Résolution », « Mode test », « Aperçu en direct », « Changer l'adresse secrète », vouvoiement", () => {
  assert.equal(fr["ovp.title"], "Overlays"); assert.equal(fr["ovp.intro"], "Composez vos pages pour OBS.");
  assert.equal(fr["ovp.new"], "Nouvelle page d'overlay"); assert.equal(fr["ovp.ed.add"], "Ajouter un élément"); assert.equal(fr["ovp.ed.remove"], "Retirer l'élément");
  assert.equal(fr["ovp.resolution"], "Résolution"); assert.equal(fr["ovp.test"], "Mode test"); assert.equal(fr["ovp.ed.live"], "Aperçu en direct"); assert.equal(fr["ovp.reset"], "Changer l'adresse secrète");
  assert.equal(fr["ovp.testOn"], "Mode test actif, s'arrête à {time}"); assert.equal(fr["ovp.testStop"], "Arrêter maintenant"); assert.equal(fr["ovp.testExtend"], "Prolonger de 30 minutes");
  assert.equal(fr["overlay.page.disabled"], "Cet overlay est désactivé"); assert.equal(fr["overlay.page.gone"], "Cet élément n'est plus disponible");
  const all = mine(fr).filter((k) => !k.startsWith("audit.")).map((k) => fr[k]).join("\n");
  assert.doesNotMatch(all, /\b(tu|ton|ta|tes|toi)\b/i, "vouvoiement");
  assert.doesNotMatch(all, /\b(scale|ratio verrouillé|fluid|canevas|fragment)\b/i, "les noms techniques ne s'affichent jamais");
  for (const k of ["ovp.ed.fit.scale", "ovp.ed.fit.ratio", "ovp.ed.fit.fluid"]) assert.doesNotMatch(fr[k], /scale|fluid/i);
  assert.match(fr["ovp.ed.fit.scale"], /garde ses proportions/); assert.match(fr["ovp.ed.fit.fluid"], /s'adapte à la taille choisie/);
  assert.doesNotMatch(mine(en).map((k) => en[k]).join("\n"), /\b(scale|fluid|canvas|fragment)\b/i);
});

test("étanchéité : le code des pages d'overlay n'emploie jamais le vocabulaire des skins de site", () => {
  for (const f of sources) {
    const text = fs.readFileSync(f, "utf8");
    // Le seul endroit qui NOMME ce vocabulaire est le commentaire qui l'interdit (tokens.ts, render.ts) ; aucun chargement ni usage.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /--sk-|data-skin|skins\/render|core\/skins|getActiveSkin|skinCss/, f);
  }
});
