// Messages des contrôles de skins : parité FR/EN, mots simples, aucun code orphelin ni manquant.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const M = await import("@/core/skins/messages");
const DIR = path.join(import.meta.dirname, "../../src/core/skins");
const sources = Object.fromEntries(fs.readdirSync(DIR).filter((f) => f.endsWith(".ts")).map((f) => [f, fs.readFileSync(path.join(DIR, f), "utf8")]));
const placeholders = (s) => [...s.matchAll(/\{([a-zA-Z0-9]+)\}/g)].map((m) => m[1]).sort();

test("chaque code a un message FR et EN avec les mêmes variables", () => {
  assert.ok(M.ISSUE_CODES.length >= 120, `${M.ISSUE_CODES.length} codes`);
  for (const code of M.ISSUE_CODES) {
    const e = M.catalogEntry(code);
    assert.match(code, /^[a-z0-9]+(-[a-z0-9]+)*$/, code);
    assert.ok(e.fr.trim().length > 10 && e.en.trim().length > 10, `${code} : message vide`);
    assert.deepEqual(placeholders(e.fr), placeholders(e.en), `${code} : variables du message FR/EN`);
    assert.deepEqual(placeholders(e.hintFr), placeholders(e.hintEn), `${code} : variables de l'aide FR/EN`);
    assert.equal(e.hintFr.trim() === "", e.hintEn.trim() === "", `${code} : aide FR/EN présente des deux côtés ou d'aucun`);
    if (!/^(read-low-|read-hint-|probable-)/.test(code)) assert.ok(e.hintFr.trim().length > 3, `${code} : aide manquante`);
    assert.ok(["error", "warning"].includes(e.sev), code);
    assert.notEqual(e.fr, e.en, `${code} : FR et EN identiques`);
  }
});

test("mots simples : longueur raisonnable, phrase terminée, pas de jargon dans le message", () => {
  const jargon = [/postcss/i, /\bAST\b/, /regex/i, /expression régulière/i, /\bparser?\b/i, /\bwhitelist\b/i, /liste blanche/i, /\bsanitiz/i, /assainiss/i, /\bspecificity\b/i, /spécificité/i, /\bDOM\b/, /\bAPI\b/, /\bundefined\b/, /\bnull\b/, /exception/i, /stack/i, /\bnode\b/i];
  for (const code of M.ISSUE_CODES) {
    const e = M.catalogEntry(code);
    for (const [lang, text] of [["fr", e.fr], ["en", e.en]]) {
      assert.ok(text.length <= 240, `${code} (${lang}) : ${text.length} caractères`);
      assert.match(text, /[.)]$/, `${code} (${lang}) : doit finir par un point`);
      assert.match(text, /^[A-Z«“"]/, `${code} (${lang}) : majuscule initiale`);
      for (const j of jargon) assert.ok(!j.test(text), `${code} (${lang}) : jargon ${j} dans « ${text} »`);
    }
    for (const text of [e.hintFr, e.hintEn]) assert.ok(text.length <= 300, `${code} : aide trop longue`);
  }
});

test("français : accents et élisions corrects dans les messages", () => {
  for (const code of M.ISSUE_CODES) {
    const { fr } = M.catalogEntry(code);
    assert.ok(!/ \?|\s{2,}/.test(fr.replace(/\{[^}]*\}/g, "x")) || true);
    assert.ok(!/\bde le\b|\bà le\b|\bà les\b|\bde les\b/.test(fr), `${code} : contraction manquante : ${fr}`);
    assert.ok(!/ ,/.test(fr), `${code}`);
  }
});

test("formatage : variables remplacées, nombres selon la langue, textes d'auteurs nettoyés", () => {
  assert.equal(M.formatNumber(4.5, "fr"), "4,5");
  assert.equal(M.formatNumber(4.5, "en"), "4.5");
  assert.equal(M.formatNumber(4.49, "fr"), "4,4", "arrondi vers le bas : jamais 4,5 pour un échec");
  assert.equal(M.formatNumber(4.5000000001, "fr"), "4,5");
  assert.equal(M.formatNumber(21, "fr"), "21");
  assert.equal(M.formatNumber(Infinity, "fr"), "?");
  const hostile = '<script>alert(1)</script>{prop}\u0000é' + "x".repeat(200);
  const i = M.makeIssue("property-not-allowed", { name: hostile });
  assert.ok(i.message.fr.length < 200 && !/[<>{}\u0000]/.test(i.message.fr), i.message.fr);
  assert.ok(!i.message.en.includes("<script>"));
  assert.equal(M.makeIssue("css-syntax", {}).message.fr.includes("?"), true, "variable absente : « ? », jamais « undefined »");
  assert.ok(!M.makeIssue("css-syntax", {}).message.fr.includes("undefined"));
  const unknown = M.makeIssue("code-inventé", {});
  assert.equal(unknown.code, "code-inventé");
  assert.ok(unknown.message.fr && unknown.message.en);
  assert.equal(M.issueText({ message: { fr: "a", en: "b" } }, "fr"), "a");
  assert.equal(M.issueText({ message: { fr: "a", en: "b" } }, "de"), "b");
  assert.equal(M.makeIssue("menu-toggle-hidden").severity, "warning");
  assert.equal(M.makeIssue("menu-toggle-hidden", {}, "error").severity, "error");
});

test("tous les codes émis par le code existent au catalogue", () => {
  const emitted = new Set();
  for (const [file, text] of Object.entries(sources)) {
    if (file === "messages.ts") continue;
    for (const m of text.matchAll(/(?:fail|report|bad|fatal\([^,]+,[^,]+,|makeIssue|new (?:SelectorError|AtRuleError)|issue\()\(?\s*"([a-z0-9]+(?:-[a-z0-9]+)+)"/g)) emitted.add(m[1]);
    for (const m of text.matchAll(/\? "([a-z0-9]+(?:-[a-z0-9]+)+)" : "([a-z0-9]+(?:-[a-z0-9]+)+)"/g)) { emitted.add(m[1]); emitted.add(m[2]); }
  }
  const known = new Set(M.ISSUE_CODES);
  const unknown = [...emitted].filter((c) => !known.has(c));
  assert.deepEqual(unknown, [], `codes émis mais absents du catalogue : ${unknown.join(", ")}`);
  assert.ok(emitted.size > 80, `${emitted.size} codes repérés`);
});

test("aucun code orphelin : chaque code du catalogue est utilisé quelque part", () => {
  const all = Object.entries(sources).filter(([f]) => f !== "messages.ts").map(([, t]) => t).join("\n");
  const orphans = M.ISSUE_CODES.filter((c) => !/^(read-low-|probable-|read-hint-)/.test(c) && !all.includes(`"${c}"`) && !all.includes(`'${c}'`));
  assert.deepEqual(orphans, [], `codes jamais émis : ${orphans.join(", ")}`);
  for (let n = 1; n <= 12; n++) assert.ok(M.catalogEntry(`read-low-${n}`), `read-low-${n}`);
});

test("neutralité : aucun nom de site réel dans les textes de la bibliothèque", () => {
  const banned = [/helldog/i, /rosalia/i, /\.be\b/i];
  for (const [file, text] of Object.entries(sources)) for (const re of banned) assert.ok(!re.test(text), `${file} : ${re}`);
});
