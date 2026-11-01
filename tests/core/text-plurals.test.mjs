import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { makeTranslator, isSingular } = await import("@/core/i18n/dictionary");
const T = await import("@/core/modules/adminTransfer");

const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8")), en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));

test("pluriels : « 1 personne » / « 2 personnes », « 1 person » / « 2 people » (variantes .one)", () => {
  const f = makeTranslator("fr"), e = makeTranslator("en");
  assert.equal(f("roles.members", { n: 1 }), "1 personne");
  assert.equal(f("roles.members", { n: 2 }), "2 personnes");
  assert.equal(f("roles.members", { n: 0 }), "0 personne", "français : zéro au singulier");
  assert.equal(e("roles.members", { n: 1 }), "1 person");
  assert.equal(e("roles.members", { n: 2 }), "2 people");
  assert.equal(e("roles.members", { n: 0 }), "0 people", "anglais : zéro au pluriel");
  assert.equal(f("roles.replacement", { n: 1 }), "1 personne a ce rôle : quel rôle lui donner à la place ?");
  assert.equal(f("roles.replacement", { n: 3 }), "3 personnes ont ce rôle : quel rôle leur donner à la place ?");
  assert.equal(e("roles.replacement", { n: 1 }), "1 person has this role: which role should they get instead?");
  assert.equal(f("audit.count", { n: 1 }), "1 événement");
  assert.equal(e("audit.count", { n: 12 }), "12 events");
  assert.equal(f("catalogue.sources.added", { count: 1 }), "Dépôt ajouté : 1 module trouvé.", "variable « count » aussi");
  assert.equal(f("roles.members", { n: "1" }), "1 personne", "nombre écrit en chaîne");
  assert.equal(f("roles.members", { n: "beaucoup" }), "beaucoup personnes", "pas un nombre : le texte pluriel, jamais d'erreur");
  assert.equal(f("choice.none"), "Rien à choisir pour l'instant.", "sans variables : inchangé");
  assert.equal(makeTranslator("de")("roles.members", { n: 1 }), "1 person", "langue inconnue : repli sur l'anglais, règle anglaise");
  assert.ok(isSingular("fr", 1) && isSingular("fr", 0) && !isSingular("fr", 2) && isSingular("en", 1) && !isSingular("en", 0));
});

test("textes : plus aucun « (s) » à compléter à la main, une variante .one dans les deux langues, mêmes clés en français et en anglais", () => {
  for (const [name, d] of [["fr", fr], ["en", en]]) {
    for (const [k, v] of Object.entries(d)) if (/\w\((s|es)\)/.test(v)) assert.fail(`${name} ${k} : pluriel « (s) » → « ${v} »`);
  }
  for (const k of Object.keys(fr).filter((x) => x.endsWith(".one"))) assert.ok(en[k], `${k} sans anglais`);
  for (const k of Object.keys(en).filter((x) => x.endsWith(".one"))) assert.ok(fr[k], `${k} sans français`);
  for (const k of Object.keys(fr).filter((x) => x.endsWith(".one") && fr[x.slice(0, -4)] !== undefined)) {
    for (const d of [fr, en]) assert.equal(/\{(n|count)\}/.test(d[k]), /\{(n|count)\}/.test(d[k.slice(0, -4)]), `${k} : mêmes variables que le texte pluriel`);
  }
});

test("jargon : « Reprises pas encore faites », « Takeovers not done yet », « Données à vider après reprise » ont disparu, FR et EN", () => {
  for (const d of [fr, en]) for (const [k, v] of Object.entries(d)) {
    assert.doesNotMatch(v, /Reprises pas encore faites|Takeovers? not done|Données à vider après reprise|Data to empty after takeover/i, k);
    if (k.startsWith("legacy.")) assert.doesNotMatch(v, /\breprise\b|\btakeover\b/i, k);
  }
});

test("bouton « Télécharger » d'un panneau : montré seulement à une personne qui en a le droit (même décision que la route) ; le bloc passe par ce contrôle", () => {
  const spec = (right) => ({ x: { right, filename: () => "f", contentType: "text/csv", generate: async function* () {} } });
  const me = (rights, level = "admin") => ({ id: "u", email: "u@example.org", name: "U", level, roles: [], rights: new Set(rights), locale: null, advanced: false, totp: false, passkeys: 0, twoFactor: false, needsTwoFactor: false, mustChangePassword: false });
  assert.equal(T.canShowDownload(me(["monsite:open", "monsite:export"]), "monsite", spec("export"), "x"), true);
  assert.equal(T.canShowDownload(me(["monsite:open"]), "monsite", spec("export"), "x"), false, "sans le droit : pas de bouton");
  assert.equal(T.canShowDownload(me(["monsite:export"]), "monsite", spec("export"), "x"), false, "sans l'accès au module");
  assert.equal(T.canShowDownload(me(["autresite:export", "monsite:open"]), "monsite", spec("autresite:export"), "x"), false);
  assert.equal(T.canShowDownload(me([], "owner"), "monsite", spec("export"), "x"), true);
  assert.equal(T.canShowDownload(null, "monsite", spec("export"), "x"), false);
  assert.equal(T.canShowDownload(me(["monsite:open", "monsite:export"]), "monsite", spec("export"), "inconnu"), false, "pas de téléchargement de ce nom : pas de bouton");
  const blocks = fs.readFileSync("src/components/site/Blocks.tsx", "utf8");
  assert.match(blocks, /case "download":[^]*?await mayShowDownload\(panelInstanceId, block\.name\)/);
  assert.match(fs.readFileSync("src/core/modules/downloadAccess.ts", "utf8"), /canShowDownload\(user,/);
});
