// Les skins OFFICIELS contre le cœur COURANT (docs/SKINS.md « Un nouvel élément est-il habillable ? »). À lancer AVANT de publier une version du cœur.
//
//   npm run skin:official -- [options]
//
// Récupère le catalogue officiel (git fetch --depth 1 du dépôt de skins, comme le fait le cœur), fait passer le kit à chaque skin à son étiquette épinglée (niveaux statiques,
// couverture, et niveau navigateur si Chromium est là), puis imprime un tableau : skin → valide ? → pièces et régions NOUVELLES non habillées.
//
//   --lang fr|en          langue des messages
//   --json                sortie lisible par une machine
//   --strict              les avertissements du kit font aussi refuser un skin
//   --fail-on-uncovered   des pièces nouvelles non habillées font échouer la commande (sinon : avertissement visible)
//   --no-visual           saute le niveau navigateur (sinon : lancé si Chromium et Playwright sont disponibles)
//   --only id1,id2        ne contrôle que ces skins du catalogue
//   --repo <adresse>      dépôt du catalogue (défaut : CURIOSA_SKINS_REPO, sinon le dépôt officiel) ; --ref <réf> : branche ou étiquette lue (défaut : CURIOSA_SKINS_REF, sinon HEAD)
//   --baseline <fichier>  référence des pièces déjà publiées (défaut : docs/skins-parts-baseline.json)
//   --since <réf-git>     compare plutôt à la liste de pièces d'une étiquette ou d'un commit du cœur (il faut l'avoir dans le clone)
//   --update-baseline     réécrit la référence avec les pièces ACTUELLES (à faire à la publication du cœur), sans réseau, puis s'arrête
//   --core-version X.Y.Z  version du cœur qui juge `requires.core` (défaut : celle de ce dépôt)
//   --neutrality <fichier>  --widths 390,1280  --only-pages home,blog  --lock <fichier>   comme skin:check
//
// Code de sortie : 0 tous les skins sont valides · 1 un skin est refusé (ou, avec --fail-on-uncovered, des nouveautés ne sont pas habillées) · 2 mauvais usage ou catalogue illisible.
// Réseau : seulement la lecture du dépôt de skins (GitHub). Rien n'est installé ni écrit hors d'un dossier temporaire.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--lang", "--core-version", "--only", "--repo", "--ref", "--baseline", "--since", "--neutrality", "--widths", "--only-pages", "--lock"]);
const KNOWN = new Set([...VALUE_FLAGS, "--json", "--strict", "--fail-on-uncovered", "--no-visual", "--update-baseline"]);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const envLang = /^en/i.test(process.env.LC_ALL || process.env.LANG || "") ? "en" : "fr";
const lang = flag("lang") === "en" ? "en" : flag("lang") === "fr" ? "fr" : envLang;
const T = (fr, en) => (lang === "fr" ? fr : en);
const unknown = args.filter((a, i) => a.startsWith("--") ? !KNOWN.has(a) : !VALUE_FLAGS.has(args[i - 1] ?? ""));
if (unknown.length || [...VALUE_FLAGS].some((f) => args.includes(f) && (args[args.indexOf(f) + 1] ?? "--").startsWith("--"))) {
  console.error(T("Usage : npm run skin:official -- [--json] [--strict] [--fail-on-uncovered] [--no-visual] [--only id1,id2] [--repo <adresse>] [--ref <réf>] [--baseline <fichier> | --since <réf-git>] [--update-baseline] [--lang fr|en]",
    "Usage: npm run skin:official -- [--json] [--strict] [--fail-on-uncovered] [--no-visual] [--only id1,id2] [--repo <address>] [--ref <ref>] [--baseline <file> | --since <git-ref>] [--update-baseline] [--lang fr|en]"));
  process.exit(2);
}

// Le niveau navigateur lance Chromium : sous verrou (`flock`), une seule instance à la fois.
if (!has("no-visual") && !has("update-baseline") && flag("lock") && !process.env.SKIN_OFFICIAL_LOCKED) {
  const r = spawnSync("flock", [flag("lock"), process.execPath, ...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, SKIN_OFFICIAL_LOCKED: "1" } });
  process.exit(r.status ?? 2);
}

// Les skins sont récupérés dans un dossier temporaire (DATA_DIR) : on ne touche jamais aux données d'un site.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-official-"));
process.env.DATA_DIR = work;
const done = (code) => { fs.rmSync(work, { recursive: true, force: true }); process.exit(code); };

try { await import("../tests/helpers/register.mjs"); } catch {
  console.error(T("Cette commande se lance depuis un dépôt du cœur de Curiosa (il manque tests/helpers/register.mjs).", "This command runs from a Curiosa core checkout (tests/helpers/register.mjs is missing)."));
  done(2);
}
const official = await import("../testsupport/skins/official.mjs");
const { defaultCoreVersion } = await import("../testsupport/skins/version.mjs");
const pkgVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

if (has("update-baseline")) {
  const { REGIONS, PARTS } = await import("../src/core/skins/allowlist.ts");
  const file = path.resolve(root, flag("baseline") ?? official.BASELINE_FILE);
  fs.writeFileSync(file, JSON.stringify(official.snapshot(pkgVersion, REGIONS, PARTS), null, 2) + "\n");
  console.log(T(`Référence réécrite : ${path.relative(root, file)} (cœur ${pkgVersion}, ${REGIONS.length} régions, ${PARTS.length} pièces).`, `Reference rewritten: ${path.relative(root, file)} (core ${pkgVersion}, ${REGIONS.length} regions, ${PARTS.length} parts).`));
  done(0);
}

let report;
try {
  report = await official.runOfficial({
    root, coreVersion: defaultCoreVersion(root, flag("core-version")), repo: flag("repo"), ref: flag("ref"), baseline: flag("baseline"), since: flag("since"),
    visual: has("no-visual") ? false : "auto", strict: has("strict"), failOnUncovered: has("fail-on-uncovered"), only: flag("only")?.split(",").filter(Boolean), neutrality: flag("neutrality"),
    widths: flag("widths")?.split(",").map(Number).filter((n) => n >= 280 && n <= 3000), onlyPages: flag("only-pages")?.split(","),
  });
} catch (e) {
  console.error(T(`Impossible de lire le catalogue officiel : ${String(e?.message ?? e).split("\n")[0]}`, `Could not read the official catalogue: ${String(e?.message ?? e).split("\n")[0]}`));
  console.error(T("Vérifiez le réseau (GitHub) et la référence des pièces (docs/skins-parts-baseline.json).", "Check the network (GitHub) and the parts reference (docs/skins-parts-baseline.json)."));
  done(2);
}
console.log(has("json") ? official.toJson(report) : official.toText(report, lang));
done(report.exitCode);
