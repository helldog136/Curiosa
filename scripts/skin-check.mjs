// Contrôle un dossier de skin LOCAL (docs/SKINS.md §13, docs/CREER-UN-SKIN.md) avec les mêmes fonctions que l'installation, plus ce que seul le kit vérifie.
//
//   npm run skin:check -- <dossier-du-skin | dossier-d-un-dépôt-de-skins> [options]
//
//   <dossier>       un skin (il contient skin.json) ou un dépôt de skins (il contient skins/<id>/skin.json : tous sont contrôlés)
//   --visual        ajoute le niveau NAVIGATEUR : un site de démonstration minimal avec le skin, dans Chromium (masquage, ordre de tabulation, cibles, focus,
//                   contraste rendu, défilement horizontal, menu mobile, mouvement réduit, requêtes externes, polices, bascule clair/sombre, régression de basic)
//   --shots <dir>   avec --visual : garde les captures (PNG) des pages-types, en clair et en sombre, à 390 / 768 / 1280 / 1920 px
//   --modules <dir> les modules dont les pièces de skin sont vérifiées (dépôt de modules, son dossier modules/, ou un module)
//   --lang fr|en    langue des messages (défaut : celle de l'environnement, sinon fr)
//   --json          sortie lisible par une machine (même code de sortie)
//   --strict        les avertissements font aussi échouer la commande
//   --advice        ajoute les conseils « confort » de lisibilité (niveau AAA) et les conseils du kit
//   --core-version X.Y.Z   version du cœur qui juge `minCore` (défaut : celle de ce dépôt, au moins 0.4.0 : la version qui apporte les skins)
//   --neutrality <fichier> liste de termes interdits (sinon NEUTRALITY_TERMS ou .neutrality-terms)
//   --lock <fichier> attend ce verrou (flock) avant le niveau navigateur, pour ne pas lancer deux Chromium à la fois
//   --widths 390,1280  --only-pages home,blog   restreignent le niveau navigateur (essais rapides)
//
// Code de sortie : 0 tout va bien · 1 au moins un skin refusé (ou avertissement avec --strict) · 2 mauvais usage.
// Aucune écriture hors de --shots, aucun réseau : le site de démonstration est local.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--lang", "--core-version", "--shots", "--modules", "--neutrality", "--lock", "--widths", "--only-pages"]);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const targets = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
const envLang = /^en/i.test(process.env.LC_ALL || process.env.LANG || "") ? "en" : "fr";
const lang = flag("lang") === "en" ? "en" : flag("lang") === "fr" ? "fr" : envLang;
const T = (fr, en) => (lang === "fr" ? fr : en);

if (!targets.length) {
  console.error(T(
    "Usage : npm run skin:check -- <dossier-du-skin> [--visual] [--shots <dossier>] [--modules <dossier>] [--lang fr|en] [--json] [--strict] [--advice] [--core-version X.Y.Z]",
    "Usage: npm run skin:check -- <skin-folder> [--visual] [--shots <folder>] [--modules <folder>] [--lang fr|en] [--json] [--strict] [--advice] [--core-version X.Y.Z]"));
  process.exit(2);
}

// Verrou des commandes lourdes : le niveau navigateur relance cette commande sous `flock` (une seule instance à la fois).
if (has("visual") && flag("lock") && !process.env.SKIN_CHECK_LOCKED) {
  const r = spawnSync("flock", [flag("lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, SKIN_CHECK_LOCKED: "1" } });
  process.exit(r.status ?? 2);
}

// Le code du cœur est écrit en TypeScript : on charge les mêmes résolveurs que les tests.
try { await import("../tests/helpers/register.mjs"); } catch {
  console.error(T("Cette commande se lance depuis un dépôt du cœur de Curiosa (il manque tests/helpers/register.mjs).", "This command runs from a Curiosa core checkout (tests/helpers/register.mjs is missing)."));
  process.exit(2);
}
const { checkTargets } = await import("../testsupport/skins/check.mjs");
const { toJson, toText } = await import("../testsupport/skins/report.mjs");
const { defaultCoreVersion } = await import("../testsupport/skins/version.mjs");
const coreVersion = defaultCoreVersion(root, flag("core-version"));

const widths = flag("widths")?.split(",").map(Number).filter((n) => n >= 280 && n <= 3000);
const report = await checkTargets(targets, {
  coreVersion, strict: has("strict"), advice: has("advice"), visual: has("visual"), modules: flag("modules"), neutrality: flag("neutrality"),
  shots: flag("shots"), lang, widths, onlyPages: flag("only-pages")?.split(","),
});
report.advice = has("advice");
if (has("json")) console.log(toJson(report));
else console.log(toText(report, lang));
process.exit(report.exitCode);
