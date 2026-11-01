#!/usr/bin/env node
// Recensement des valeurs « en dur » du CSS PUBLIC des modules, pour estimer la conversion aux pièces de skin (lot S9, docs/SKINS.md §8.3, docs/MODULES.md « Rendre un module stylable »).
//
//   node scripts/skin-module-census.mjs <dossier-du-depot-de-modules> [--json] [--all]
//
// Pour chaque module qui met en forme une page publique (CSS en ligne dans le code du module) : fichiers de CSS, taille, et le NOMBRE DE DÉCLARATIONS dont la valeur est une valeur
// littérale (à passer par un jeton, avec la valeur actuelle en repli) : couleurs, rayons, espaces (padding, margin, gap), tailles de texte, ombres, durées. Une valeur déjà
// lue par `var(--v-…, repli)` n'est PAS en dur : le repli d'une variable de palette est déjà un jeton. Les règles `[data-accent2]` sont comptées à part : elles ne se convertissent
// pas en jeton (la valeur par défaut d'un jeton est toujours émise, elle masquerait la règle ; docs/MODULES.md, piège n°2).
//
// Lecture seule, sans exécuter le code des modules. Les fichiers d'administration, d'overlay, de dock et de télécommande ne sont pas du CSS public (hors portée V1 des skins).
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const asJson = args.includes("--json");
const all = args.includes("--all");
if (!root) { console.error("usage : node scripts/skin-module-census.mjs <dossier-du-depot-de-modules> [--json] [--all]"); process.exit(2); }
const modulesDir = fs.existsSync(path.join(root, "modules")) ? path.join(root, "modules") : root;

/** Les 19 modules à CSS public du recensement de docs/ideas/skins-exploration.md (le reste : blocs du cœur, overlays, pages autonomes). */
const PUBLIC_CSS_MODULES = ["events", "gallery", "planning", "map", "polls", "faq", "directory", "videos", "daily-game", "mascot", "countdown", "thanks-wall", "supporters", "testimonials", "live-status", "commissions", "content-planner", "twitch-raid", "audience"];
/** Fichiers qui ne sont pas du CSS public : administration, overlays OBS, docks, télécommandes, tests, scripts. */
const NOT_PUBLIC = /(^|\/)(admin|overlay|dock|featured-dock|remote|pairing|mcp|tests?|scripts|locales|node_modules)([-./]|$)|(^|\/)(admin|overlay|dock|remote)[A-Za-z-]*\.(mjs|js)$/i;

const walk = (dir, base = dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full);
    if (e.isDirectory()) { if (!/^(node_modules|\.git)$/.test(e.name)) walk(full, base, out); }
    else if (/\.(mjs|js|css)$/.test(e.name) && !NOT_PUBLIC.test(rel)) out.push({ rel, full });
  }
  return out;
};

const LEN = String.raw`-?\d*\.?\d+(?:px|rem|em|%|vw|vh|ch)?`;
const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|hwb)\([^)]*\)/g;
const DECL = /(?:^|[;{}\s"'`])(border-radius|border-(?:top|bottom)-(?:left|right)-radius|padding(?:-(?:top|right|bottom|left|inline|block))?|margin(?:-(?:top|right|bottom|left|inline|block))?|gap|row-gap|column-gap|font-size|box-shadow|text-shadow|transition(?:-duration)?|animation(?:-duration)?|background(?:-color)?|color|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline(?:-color)?|fill|stroke)\s*:\s*([^;{}\n"'`]*)/g;

/** Retire les `var(--x, repli)` (le repli est déjà un jeton de palette) pour ne garder que ce qui est écrit en dur. */
function withoutVars(value) {
  let out = value;
  for (let guard = 0; guard < 50; guard++) {
    const at = out.search(/var\(/);
    if (at < 0) return out;
    let depth = 0, end = out.length - 1;
    for (let i = at + 3; i < out.length; i++) { if (out[i] === "(") depth++; else if (out[i] === ")") { depth--; if (depth === 0) { end = i; break; } } }
    out = `${out.slice(0, at)} ${out.slice(end + 1)}`;
  }
  return out;
}

function analyse(text) {
  const c = { colors: 0, radii: 0, gaps: 0, spacing: 0, fontSize: 0, shadows: 0, durations: 0, total: 0, varFallbacks: 0, tokensRead: 0, accent2Rules: 0, mediaQueries: 0, rules: 0, declarations: 0 };
  c.accent2Rules = (text.match(/\[data-accent2\]/g) ?? []).length;
  c.mediaQueries = (text.match(/@media\b/g) ?? []).length;
  c.rules = (text.match(/[.#\[][^{};\n`]{1,120}\{[^{}]*\}/g) ?? []).length;
  c.varFallbacks = (text.match(/var\(--v-[a-z0-9-]+\s*,/g) ?? []).length;
  c.tokensRead = (text.match(/var\(--(?:sk|v)-/g) ?? []).length;
  for (const m of text.matchAll(DECL)) {
    const prop = m[1], value = m[2];
    c.declarations++;
    const hard = withoutVars(value);
    if (/^(?:border-.*radius|border-radius)$/.test(prop)) { if (new RegExp(LEN).test(hard) && /\d/.test(hard)) { c.radii++; c.total++; } continue; }
    if (/^(?:padding|margin|gap|row-gap|column-gap)/.test(prop)) { if (/\d/.test(hard) && !/^\s*0\s*$/.test(hard)) { c.spacing++; c.total++; if (/gap$/.test(prop)) c.gaps++; } continue; }
    if (prop === "font-size") { if (/\d/.test(hard)) { c.fontSize++; c.total++; } continue; }
    if (/shadow$/.test(prop)) { if (/\d/.test(hard) && !/^\s*none\s*$/.test(hard)) { c.shadows++; c.total++; } continue; }
    if (/^(transition|animation)/.test(prop)) { if (/\d+(\.\d+)?m?s/.test(hard)) { c.durations++; c.total++; } continue; }
    // couleurs : une couleur écrite en dur (hors repli de var())
    const colors = hard.match(COLOR) ?? [];
    if (colors.length) { c.colors += colors.length; c.total += colors.length; }
  }
  return c;
}

const sum = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]]));

/** Valeurs que les skins changent vraiment : couleurs, rayons, ombres, durées, écarts de grille. Les marges intérieures et les tailles de texte suivent l'échelle du module. */
const priorityOf = (c) => c.colors + c.radii + c.shadows + c.durations + c.gaps;
/** Taille de conversion : S (≤ 40 valeurs en dur, 2 fichiers au plus), M (≤ 150, 4 fichiers), L au-delà. */
const sizeOf = (total, files) => (total <= 40 && files <= 2 ? "S" : total <= 150 && files <= 4 ? "M" : "L");
/** Jours-agent indicatifs : 0,5 de base (lecture, jetons, test), 0,01 par valeur en dur, 0,25 par fichier de CSS de plus, 0,1 par règle [data-accent2] (à traiter à part). */
const daysOf = (c, files) => Math.round((0.5 + 0.01 * c.total + 0.25 * Math.max(0, files - 1) + 0.1 * c.accent2Rules) * 10) / 10;

const rows = [];
const present = fs.readdirSync(modulesDir).filter((d) => fs.existsSync(path.join(modulesDir, d, "module.json"))).sort();
for (const id of all ? present : PUBLIC_CSS_MODULES) {
  if (!present.includes(id)) { rows.push({ id, missing: true }); continue; }
  const dir = path.join(modulesDir, id);
  let acc = null;
  const files = [];
  for (const f of walk(dir)) {
    const text = fs.readFileSync(f.full, "utf8");
    // un fichier de CSS public : au moins 3 règles « .classe{…} » ou une balise <style>
    const looksCss = /\.css$/.test(f.rel) || (text.match(/\.[a-z][\w-]*\s*\{[^{}]*:[^{}]*\}/g) ?? []).length >= 3 || /<style/.test(text);
    if (!looksCss) continue;
    const c = analyse(text);
    if (c.rules < 3 && c.declarations < 8) continue;
    files.push({ file: f.rel, bytes: Buffer.byteLength(text), ...c });
    acc = acc ? sum(acc, c) : c;
  }
  if (!acc) { rows.push({ id, files: 0, total: 0, size: "-" }); continue; }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8"));
  rows.push({ id, version: manifest.version, skin: manifest.skin !== undefined, files: files.length, ...acc, priority: priorityOf(acc), size: sizeOf(acc.total, files.length), days: daysOf(acc, files.length), detail: files });
}

if (asJson) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
const pad = (v, n) => String(v).padStart(n);
console.log(`${"module".padEnd(18)} ${pad("fich.", 5)} ${pad("en dur", 6)} ${pad("prior.", 6)} ${pad("coul.", 5)} ${pad("rayons", 6)} ${pad("espaces", 7)} ${pad("texte", 5)} ${pad("ombres", 6)} ${pad("durées", 6)} ${pad("accent2", 7)} ${pad("règles", 6)}  taille ${pad("jours", 5)}  version`);
let total = 0, converted = 0, days = 0;
for (const r of rows) {
  if (r.missing) { console.log(`${r.id.padEnd(18)} (absent du dépôt)`); continue; }
  total += r.total ?? 0;
  days += r.skin ? 0 : (r.days ?? 0);
  if (r.skin) converted++;
  console.log(`${r.id.padEnd(18)} ${pad(r.files, 5)} ${pad(r.total, 6)} ${pad(r.priority ?? 0, 6)} ${pad(r.colors ?? 0, 5)} ${pad(r.radii ?? 0, 6)} ${pad(r.spacing ?? 0, 7)} ${pad(r.fontSize ?? 0, 5)} ${pad(r.shadows ?? 0, 6)} ${pad(r.durations ?? 0, 6)} ${pad(r.accent2Rules ?? 0, 7)} ${pad(r.rules ?? 0, 6)}  ${String(r.size).padEnd(6)} ${pad(r.days ?? "", 5)}  ${r.version ?? ""}${r.skin ? " (pièces déclarées)" : ""}`);
}
console.log(`\n${rows.filter((r) => !r.missing).length} modules, ${total} valeurs en dur au total, ${converted} déjà converti(s) ; reste à convertir : ${Math.round(days * 10) / 10} jours-agent (indicatif).`);
