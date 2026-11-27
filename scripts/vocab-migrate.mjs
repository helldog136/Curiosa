// VOCABULARY MIGRATION (admin redesign C4, ADR 0011, rule R34): one word, « module », for a piece installed from the catalogue.
//
//   node scripts/vocab-migrate.mjs                 dry run: prints the report, writes nothing
//   node scripts/vocab-migrate.mjs --write         rewrites the files
//   node scripts/vocab-migrate.mjs --diff          dry run + the before/after of every changed text
//   node scripts/vocab-migrate.mjs --scope locales,code,docs   (default: locales,code)
//   node scripts/vocab-migrate.mjs --report out.md             also write the report to a file
//
// Re-runnable and idempotent: a text that no longer holds a retired word is never touched, so a second run changes nothing (the report says « 0 changed »).
// Never touched: route paths, translation keys, manifest keys, code identifiers, the CHANGELOG of published versions (history stays as published).
// The rewrite is a rule pipeline (determiner + noun + participle, in French: feminine -> masculine) followed by the per-key table of
// scripts/vocab-migrate.data.mjs for the texts where a pronoun or a longer agreement cannot be fixed by a rule. After a run, retiredLeftovers() must be empty:
// whatever is left is either listed in KEPT (with its reason) or is a gap to fix in the data file. The kit check is tests/core/r34-retired-terms.test.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { retiredTerms } from "../testsupport/ergonomics.mjs";
import { FR_OVERRIDES, EN_OVERRIDES, FR_FOLLOWUPS, CODE_REPLACEMENTS, DOC_RULES, DOC_FILES_SKIP } from "./vocab-migrate.data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ───────────── English ───────────── */

/** Pipeline for English texts. Order matters: articles first, then the nouns. */
const EN_RULES = [
  [/\b(a|A)n (extension)/g, (_, a) => `${a} module`],
  [/\bEXTENSIONS?\b/g, (m) => (m.endsWith("S") ? "MODULES" : "MODULE")],
  [/\bextension(s?)\b/g, (_, s) => `module${s}`],
  [/\bExtension(s?)\b/g, (_, s) => `Module${s}`],
  [/\bfeature(s?)\b/g, (_, s) => `module${s}`],
  [/\bFeature(s?)\b/g, (_, s) => `Module${s}`],
];

/* ───────────── French ───────────── */

const NOUN = "(?:extension|fonctionnalité)";
/** Feminine participles / adjectives that follow the noun directly and become masculine. */
const FEM_AFTER = [
  ["installées", "installés"], ["installée", "installé"], ["retirées", "retirés"], ["retirée", "retiré"], ["ajoutées", "ajoutés"], ["ajoutée", "ajouté"],
  ["proposées", "proposés"], ["proposée", "proposé"], ["suggérées", "suggérés"], ["suggérée", "suggéré"], ["désinstallées", "désinstallés"], ["désinstallée", "désinstallé"],
  ["activées", "activés"], ["activée", "activé"], ["désactivées", "désactivés"], ["désactivée", "désactivé"], ["modifiées", "modifiés"], ["modifiée", "modifié"],
  ["personnelles", "personnels"], ["personnelle", "personnel"], ["éteinte", "éteint"], ["éteintes", "éteints"], ["passée", "passé"], ["passées", "passés"],
  ["mise à jour", "mis à jour"], ["mises à jour", "mis à jour"], ["mise de côté", "mis de côté"], ["mises de côté", "mis de côté"], ["mise en place", "mis en place"],
  ["gardées", "gardés"], ["gardée", "gardé"], ["retrouvée", "retrouvé"], ["retrouvées", "retrouvés"], ["disponibles", "disponibles"], ["manquantes", "manquants"],
];
const SING = (re) => new RegExp(`(?<![\\p{L}])${re}`, "giu");
const keepCase = (from, to) => (from[0] !== from[0].toLowerCase() ? to[0].toUpperCase() + to.slice(1) : to);

/** Determiner + noun rules, in this order (longest first). Each returns the masculine determiner + « module(s) ». */
function frDeterminers(text) {
  let t = text;
  const swap = (re, fn) => { t = t.replace(re, (...a) => fn(...a)); };
  // plural nouns: only « toutes … confondues » and « Certaines / Aucune / quelques » change the determiner
  swap(SING(`toutes\\s+(extensions|fonctionnalités)\\s+confondues`), () => "tous modules confondus");
  swap(SING(`toutes\\s+les\\s+(extensions|fonctionnalités)`), (m) => keepCase(m, "tous les modules"));
  swap(SING(`certaines\\s+(extensions|fonctionnalités)`), (m) => keepCase(m, "certains modules"));
  swap(SING(`aucune\\s+(extension|fonctionnalité)`), (m) => keepCase(m, "aucun module"));
  swap(SING(`d'une\\s+${NOUN}`), (m) => keepCase(m, "d'un module"));
  swap(SING(`de\\s+(?:l'|la\\s+)${NOUN}`), (m) => keepCase(m, "du module"));
  swap(SING(`de\\s+cette\\s+${NOUN}`), (m) => keepCase(m, "de ce module"));
  swap(SING(`(?:à|a)\\s+(?:l'|la\\s+)${NOUN}`), (m) => keepCase(m, "au module"));
  swap(SING(`cette\\s+${NOUN}`), (m) => keepCase(m, "ce module"));
  swap(SING(`une\\s+${NOUN}`), (m) => keepCase(m, "un module"));
  swap(SING(`(?:l'|la\\s+)${NOUN}`), (m) => keepCase(m, "le module"));
  swap(SING(`sa\\s+${NOUN}`), (m) => keepCase(m, "son module"));
  swap(SING(`ancienne\\s+${NOUN}`), (m) => keepCase(m, "ancien module"));
  swap(SING(`première\\s+${NOUN}`), (m) => keepCase(m, "premier module"));
  // the bare noun, singular then plural (« Extensions » as a menu name is « Modules »)
  swap(SING(`(?:extension|fonctionnalité)(s?)(?![\\p{L}])`), (m, s) => keepCase(m, `module${s}`));
  return t;
}

/** After the noun became « module », the participle that followed it agrees in the masculine. */
function frAgreement(text) {
  let t = text;
  for (const [fem, masc] of FEM_AFTER) {
    if (fem === masc) continue;
    t = t.replace(new RegExp(`(\\b[Mm]odules?)(\\s+)${fem}(?![\\p{L}])`, "gu"), (m, n, sp) => `${n}${sp}${masc}`);
  }
  return t;
}

/** Rewrites one French text through the pipeline. */
export function frRewrite(text) {
  return frAgreement(frDeterminers(text));
}
/** Rewrites one English text through the pipeline. */
export function enRewrite(text) {
  let t = text;
  for (const [re, to] of EN_RULES) t = t.replace(re, to);
  return t;
}

/* ───────────── locales ───────────── */

/** Keys whose text keeps a retired word on purpose (and why). Empty: every text was rewritten. */
export const KEPT = {};

function migrateLocale(lang, file, write, changes) {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  const overrides = lang === "fr" ? FR_OVERRIDES : EN_OVERRIDES;
  let changed = 0;
  for (const [key, before] of Object.entries(data)) {
    if (typeof before !== "string" || !retiredTerms(before, lang).length) continue;
    if (key in KEPT) continue;
    let after = lang === "fr" ? frRewrite(before) : enRewrite(before);
    // a table entry is either the final text (string) or a list of [from, to] fixes applied to the pipeline result (for agreement the rules cannot see)
    const o = overrides[key];
    if (typeof o === "string") after = o;
    else if (Array.isArray(o)) for (const [from, to] of o) {
      if (!after.includes(from)) throw new Error(`${lang}:${key}: the fix « ${from} » does not apply to « ${after} »`);
      after = after.split(from).join(to);
    }
    if (after === before) continue;
    data[key] = after;
    changes.push({ file: path.relative(ROOT, file), lang, key, before, after, byOverride: key in overrides });
    changed += 1;
  }
  // texts that never held a retired word but agreed with one (a pronoun, an old word such as « fonction »): fixed when the old wording is still there
  if (lang === "fr") for (const [key, fixes] of Object.entries(FR_FOLLOWUPS)) {
    const before = data[key];
    if (typeof before !== "string") throw new Error(`fr:${key} (FR_FOLLOWUPS) does not exist`);
    let after = before;
    for (const [from, to] of fixes) after = after.split(from).join(to);
    if (after === before) continue;
    data[key] = after;
    changes.push({ file: path.relative(ROOT, file), lang, key, before, after, byOverride: true });
    changed += 1;
  }
  if (write && changed) fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return changed;
}

/* ───────────── code strings (user-visible, English: MCP and maintenance messages) ───────────── */

function migrateCode(write, changes) {
  let changed = 0;
  for (const { file, from, to } of CODE_REPLACEMENTS) {
    const full = path.join(ROOT, file);
    const src = fs.readFileSync(full, "utf8");
    if (!src.includes(from)) continue; // already migrated (idempotent)
    const n = src.split(from).length - 1;
    if (write) fs.writeFileSync(full, src.split(from).join(to));
    changes.push({ file, lang: "code", key: `${n} x`, before: from, after: to, byOverride: false });
    changed += n;
  }
  return changed;
}

/* ───────────── docs ───────────── */

function listMarkdown(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".git", ".next"].includes(e.name)) listMarkdown(p, out); } else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}
function migrateDocs(write, changes) {
  let changed = 0;
  const files = [...listMarkdown(path.join(ROOT, "docs")), ...fs.readdirSync(ROOT).filter((f) => f.endsWith(".md")).map((f) => path.join(ROOT, f))];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (DOC_FILES_SKIP.some((s) => (s instanceof RegExp ? s.test(rel) : s === rel))) continue;
    const src = fs.readFileSync(file, "utf8");
    let out = src;
    for (const [re, to] of DOC_RULES) out = out.replace(re, to);
    if (out === src) continue;
    if (write) fs.writeFileSync(file, out);
    changes.push({ file: rel, lang: "docs", key: "-", before: `${(src.match(/extension|fonctionnalit/gi) ?? []).length} mentions`, after: `${(out.match(/extension|fonctionnalit/gi) ?? []).length} mentions`, byOverride: false });
    changed += 1;
  }
  return changed;
}

/* ───────────── leftovers ───────────── */

/** Retired words still in the locales after the run, minus KEPT: must be empty. */
export function retiredLeftovers() {
  const left = [];
  for (const lang of ["en", "fr"]) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "src/locales", `${lang}.json`), "utf8"));
    for (const [key, text] of Object.entries(data)) if (typeof text === "string" && !(key in KEPT) && retiredTerms(text, lang).length) left.push(`${lang}:${key}`);
  }
  return left;
}

/* ───────────── main ───────────── */

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const diff = args.includes("--diff");
  const scope = (args.includes("--scope") ? args[args.indexOf("--scope") + 1] : "locales,code").split(",");
  const reportFile = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
  const changes = [];
  const counts = {};
  if (scope.includes("locales")) {
    counts["locales en"] = migrateLocale("en", path.join(ROOT, "src/locales/en.json"), write, changes);
    counts["locales fr"] = migrateLocale("fr", path.join(ROOT, "src/locales/fr.json"), write, changes);
  }
  if (scope.includes("code")) counts.code = migrateCode(write, changes);
  if (scope.includes("docs")) counts.docs = migrateDocs(write, changes);
  const lines = [`vocab-migrate (${write ? "WRITE" : "dry run"}), scope ${scope.join(",")}`, ...Object.entries(counts).map(([k, v]) => `  ${k}: ${v} changed`)];
  const byOverride = changes.filter((c) => c.byOverride).length;
  if (scope.includes("locales")) lines.push(`  of which by the per-key table: ${byOverride}`, `  retired words left in the locales (should be 0 once written): ${retiredLeftovers().length}`);
  if (diff) for (const c of changes) lines.push("", `[${c.lang}] ${c.file} ${c.key}${c.byOverride ? " (table)" : ""}`, `  - ${c.before}`, `  + ${c.after}`);
  const out = lines.join("\n");
  console.log(out);
  if (reportFile) fs.writeFileSync(reportFile, `${out}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
