import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { makeTranslator, UI_LOCALES } = await import("@/core/i18n/dictionary");
const { KNOWN_LOCALES, RTL_LOCALES, isKnownLocale, localeName } = await import("@/core/i18n/locales");
const { withLocale } = await import("@/core/links");
const { RESERVED_PATHS } = await import("@/core/config");

test("traducteur : langue demandée, repli sur l'anglais, puis sur la clé", () => {
  assert.equal(makeTranslator("fr")("action.save"), "Enregistrer");
  assert.equal(makeTranslator("en")("action.save"), "Save");
  assert.equal(makeTranslator("nl")("action.save"), "Save", "langue sans dictionnaire → anglais");
  assert.equal(makeTranslator("fr")("cle.inexistante"), "cle.inexistante", "clé inconnue → la clé, jamais une erreur");
});

test("traducteur : variables {nom} remplacées partout, valeurs converties en texte", () => {
  const t = makeTranslator("en");
  assert.equal(t("dashboard.title", { name: "Rosaliax" }), "Welcome to Rosaliax");
  assert.equal(t("mcp.allowedCount", { n: 3, total: 10 }), "3 of 10 actions allowed");
  assert.equal(t("site.expiresOn", { date: "x" }).includes("{date}"), false);
});

test("traducteur : une variable absente reste visible plutôt que de disparaître", () => {
  assert.match(makeTranslator("en")("dashboard.title"), /\{name\}/);
});

test("dictionnaires : mêmes clés en français et en anglais, aucune valeur vide", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const [k, v] of [...Object.entries(fr), ...Object.entries(en)]) assert.ok(String(v).trim(), `valeur vide pour ${k}`);
  assert.deepEqual([...UI_LOCALES].sort(), ["en", "fr"]);
});

test("dictionnaires : les variables {x} sont les mêmes dans les deux langues", () => {
  const fr = JSON.parse(fs.readFileSync("src/locales/fr.json", "utf8"));
  const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(fr)) assert.deepEqual(vars(fr[k]), vars(en[k]), `variables différentes pour ${k}`);
});

test("langues connues : noms natifs, droite-à-gauche, détection", () => {
  assert.ok(isKnownLocale("fr") && isKnownLocale("ja") && !isKnownLocale("xx") && !isKnownLocale(""));
  assert.equal(localeName("fr"), "Français");
  assert.equal(localeName("zz"), "zz", "inconnue → le code");
  assert.ok(RTL_LOCALES.has("ar") && !RTL_LOCALES.has("fr"));
  assert.ok(Object.keys(KNOWN_LOCALES).every((c) => /^[a-z]{2}$/.test(c)), "préfixes d'URL à deux lettres");
});

test("aucun code de langue ne peut être confondu avec un chemin réservé", () => {
  for (const code of Object.keys(KNOWN_LOCALES)) assert.ok(!RESERVED_PATHS.has(code), code);
});

test("withLocale : préfixe les liens internes, jamais les externes ni la langue par défaut", () => {
  assert.equal(withLocale("/blog", "en", "fr"), "/en/blog");
  assert.equal(withLocale("/", "en", "fr"), "/en");
  assert.equal(withLocale("/blog", "fr", "fr"), "/blog");
  assert.equal(withLocale("https://twitch.tv/x", "en", "fr"), "https://twitch.tv/x");
  assert.equal(withLocale("mailto:a@b.c", "en", "fr"), "mailto:a@b.c");
  assert.equal(withLocale("//evil.example", "en", "fr"), "//evil.example", "URL protocole-relative laissée telle quelle");
  assert.equal(withLocale("page", "en", "fr"), "page", "lien relatif laissé tel quel");
});
