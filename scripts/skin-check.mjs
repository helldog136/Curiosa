// Contrôle un dossier de skin LOCAL avec les mêmes fonctions que l'installation (docs/SKINS.md §13) : manifeste, fichiers, ressources et licences,
// jetons, feuille de style, lisibilité (clair et sombre). Sert aux auteurs de skins et à la CI du dépôt de skins : ce qui passe ici passe à l'installation.
//
//   npm run skin:check -- <dossier-du-skin | dossier-d-un-dépôt-de-skins> [--lang fr|en] [--json] [--strict] [--advice] [--core-version 0.4.0]
//
//   <dossier>     un skin (il contient skin.json) ou un dépôt de skins (il contient skins/<id>/skin.json : tous sont contrôlés)
//   --lang        langue des messages (défaut : celle de l'environnement, sinon fr)
//   --json        sortie lisible par une machine
//   --strict      les avertissements font aussi échouer la commande
//   --advice      ajoute les conseils « confort » de lisibilité (niveau AAA)
//   --core-version  version du cœur qui juge `minCore` (défaut : celle de ce dépôt)
//
// Code de sortie : 0 tout va bien · 1 au moins un skin refusé (ou avertissement avec --strict) · 2 mauvais usage.
// Aucune écriture, aucun réseau : on lit le dossier et on rend un verdict.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const valueFlags = new Set(["--lang", "--core-version"]);
const targets = args.filter((a, i) => !a.startsWith("--") && !valueFlags.has(args[i - 1] ?? ""));
const envLang = /^en/i.test(process.env.LC_ALL || process.env.LANG || "") ? "en" : "fr";
const lang = flag("lang") === "en" ? "en" : flag("lang") === "fr" ? "fr" : envLang;
const T = (fr, en) => (lang === "fr" ? fr : en);

if (!targets.length) {
  console.error(T("Usage : npm run skin:check -- <dossier-du-skin> [--lang fr|en] [--json] [--strict] [--advice] [--core-version X.Y.Z]", "Usage: npm run skin:check -- <skin-folder> [--lang fr|en] [--json] [--strict] [--advice] [--core-version X.Y.Z]"));
  process.exit(2);
}

// Le code du cœur est écrit en TypeScript : on charge les mêmes résolveurs que les tests.
try { await import("../tests/helpers/register.mjs"); } catch {
  console.error(T("Cette commande se lance depuis un dépôt du cœur de Curiosa (il manque tests/helpers/register.mjs).", "This command runs from a Curiosa core checkout (tests/helpers/register.mjs is missing)."));
  process.exit(2);
}
const { validateSkinFolder } = await import("../src/core/skins/validate.ts");
const coreVersion = flag("core-version") ?? JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

/** Les dossiers de skins à contrôler : le dossier lui-même, ou chaque `skins/<id>` d'un dépôt. */
function skinDirs(dir) {
  if (fs.existsSync(path.join(dir, "skin.json"))) return [dir];
  const base = path.join(dir, "skins");
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(base, e.name)).filter((d) => fs.existsSync(path.join(d, "skin.json"))).sort();
}

const results = [];
for (const t of targets) {
  const dir = path.resolve(t);
  const list = skinDirs(dir);
  if (!list.length) { results.push({ dir, name: path.basename(dir), noSkin: true, issues: [], ok: false }); continue; }
  for (const d of list) {
    const v = validateSkinFolder(d, { coreVersion, folderName: path.basename(d), advice: has("advice") });
    results.push({ dir: d, name: v.manifest?.id ?? path.basename(d), version: v.manifest?.version, ok: v.ok, issues: v.issues, files: v.files.length, bytes: v.totalBytes, fingerprint: v.fingerprint });
  }
}

const strict = has("strict");
const failed = results.filter((r) => !r.ok || (strict && r.issues.some((i) => i.severity === "warning")));

if (has("json")) {
  console.log(JSON.stringify({ coreVersion, ok: failed.length === 0, skins: results.map((r) => ({ ...r, issues: r.issues.map((i) => ({ code: i.code, severity: i.severity, message: i.message, hint: i.hint })) })) }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

for (const r of results) {
  if (r.noSkin) { console.log(`❌ ${r.name} — ${T("aucun skin.json ici (ni dans skins/<id>/).", "no skin.json here (nor in skins/<id>/).")}\n`); continue; }
  const errors = r.issues.filter((i) => i.severity === "error");
  const warnings = r.issues.filter((i) => i.severity === "warning");
  const head = r.ok ? (warnings.length && strict ? "❌" : "✅") : "❌";
  console.log(`${head} ${r.name}${r.version ? ` ${r.version}` : ""} — ${r.ok ? T(`valide (${r.files} fichiers, ${Math.ceil(r.bytes / 1024)} Ko)`, `valid (${r.files} files, ${Math.ceil(r.bytes / 1024)} KB)`) : T("refusé : il ne serait pas installé", "refused: it would not be installed")}`);
  for (const i of errors) console.log(`   ❌ ${i.message[lang]}\n      ${T("Comment corriger", "How to fix")} : ${i.hint[lang]}   [${i.code}]`);
  for (const i of warnings) console.log(`   ⚠️  ${i.message[lang]}${i.hint[lang] ? `\n      ${i.hint[lang]}` : ""}   [${i.code}]`);
  console.log("");
}
console.log(failed.length
  ? T(`${failed.length} skin(s) sur ${results.length} à corriger.`, `${failed.length} of ${results.length} skin(s) to fix.`)
  : T(`Tout va bien : ${results.length} skin(s) contrôlé(s).`, `All good: ${results.length} skin(s) checked.`));
process.exit(failed.length ? 1 : 0);
