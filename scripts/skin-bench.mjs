// BANC D'ESSAI d'un skin (docs/SKINS.md §14, docs/CREER-UN-SKIN.md) : une page de démonstration locale, sans installer un site entier.
//
//   npm run skin:bench -- <dossier-du-skin> [options]
//
//   --port 3560     port du serveur (défaut 3560 ; l'adresse à ouvrir est http://127.0.0.1:<port>/__bench/)
//   --modules <dir> les modules dont les pièces de skin sont montrées (dépôt de modules, son dossier modules/, ou un module ; leur `demo` est utilisé s'il existe)
//   --shots <dir>   écrit les captures PNG (planches en clair et en sombre à 390 / 768 / 1280 / 1920 px, quatre mises en page d'en-tête) puis s'arrête
//   --previews <dir> écrit les aperçus 1280 × 800 (WebP, 150 Ko au plus) pour le dossier previews/ du skin, puis s'arrête
//   --serve         avec --shots ou --previews : sert la page ensuite
//   --lang fr|en    langue des messages
//
// La page montre TOUTES les régions et pièces (fragments produits par les vrais composants du cœur), la bascule clair/sombre, les largeurs d'écran, les quatre mises en page
// d'en-tête et les pièces des modules. Le skin est relu à chaque chargement de page : modifiez un fichier, rechargez la page. Aucun réseau, aucune base de données.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--port", "--modules", "--shots", "--previews", "--lang", "--core-version"]);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const target = args.find((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? ""));
const lang = flag("lang") === "en" || (flag("lang") !== "fr" && /^en/i.test(process.env.LC_ALL || process.env.LANG || "")) ? "en" : "fr";
const T = (fr, en) => (lang === "fr" ? fr : en);
if (!target) {
  console.error(T("Usage : npm run skin:bench -- <dossier-du-skin> [--port 3560] [--modules <dossier>] [--shots <dossier>] [--previews <dossier>] [--serve]", "Usage: npm run skin:bench -- <skin-folder> [--port 3560] [--modules <folder>] [--shots <folder>] [--previews <folder>] [--serve]"));
  process.exit(2);
}
try { await import("../tests/helpers/register.mjs"); } catch {
  console.error(T("Cette commande se lance depuis un dépôt du cœur de Curiosa.", "This command runs from a Curiosa core checkout."));
  process.exit(2);
}
const dir = path.resolve(target);
if (!fs.existsSync(path.join(dir, "skin.json"))) { console.error(T(`Pas de skin.json dans ${dir}.`, `No skin.json in ${dir}.`)); process.exit(2); }

const { staticCheck } = await import("../testsupport/skins/static.mjs");
const { prepareSite, startDemoServer } = await import("../testsupport/skins/bench/site.mjs");
const { defaultCoreVersion } = await import("../testsupport/skins/version.mjs");
const coreVersion = defaultCoreVersion(root, flag("core-version"));

/** Empreinte (chemin, date, taille) de tous les fichiers du dossier : change quand l'auteur modifie quelque chose. */
function signature(d) {
  const out = [];
  const walk = (p) => { for (const e of fs.readdirSync(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(f); } else { const s = fs.statSync(f); out.push(`${f}:${s.mtimeMs}:${s.size}`); } } };
  walk(d);
  return out.join("|");
}

let current = null, currentSig = "";
async function load() {
  const sig = signature(dir) + (flag("modules") ? signature(path.resolve(flag("modules"))) : "");
  if (current && sig === currentSig) return current;
  const check = await staticCheck(dir, { coreVersion, modules: flag("modules") });
  current = await prepareSite(check);
  currentSig = sig;
  const errors = check.issues.filter((i) => i.severity === "error"), warns = check.issues.filter((i) => i.severity === "warning");
  console.log(T(`Skin « ${check.manifest?.id ?? path.basename(dir)} » relu : ${errors.length} erreur(s), ${warns.length} avertissement(s).`, `Skin “${check.manifest?.id ?? path.basename(dir)}” reloaded: ${errors.length} error(s), ${warns.length} warning(s).`));
  for (const i of errors.slice(0, 5)) console.log(`   ❌ ${i.message[lang]} [${i.code}]`);
  if (errors.length) console.log(T("   (la page montre le skin tel que le site le recevrait : les règles refusées en sont absentes ; `npm run skin:check` donne le détail)", "   (the page shows the skin as the site would receive it: refused rules are missing; `npm run skin:check` gives the details)"));
  return current;
}

await load();
const port = Number(flag("port") ?? 3560);
const server = await startDemoServer(load, { port, log: (m) => console.error(m) });
const url = `${server.url}/__bench/`;
const write = has("shots") || has("previews");
try {
  if (has("shots")) {
    const { makeShots } = await import("../testsupport/skins/bench/shots.mjs");
    const files = await makeShots(await load(), server, { dir: path.resolve(flag("shots")), log: () => {} });
    console.log(T(`${files.length} captures écrites dans ${path.resolve(flag("shots"))}`, `${files.length} screenshots written to ${path.resolve(flag("shots"))}`));
  }
  if (has("previews")) {
    const { makePreviews } = await import("../testsupport/skins/bench/shots.mjs");
    const list = await makePreviews(await load(), server, { dir: path.resolve(flag("previews")) });
    for (const p of list) console.log(`${p.file} (${Math.ceil(p.bytes / 1024)} Ko)`);
    console.log(T("À mettre dans `previews` de skin.json :", "To put in `previews` of skin.json:"));
    console.log(JSON.stringify(list.map((p) => ({ file: `previews/${path.basename(p.file)}`, mode: p.mode, width: 1280, alt: { fr: "Page d'accueil", en: "Home page" } })), null, 2));
  }
} catch (e) {
  console.error(T(`Les captures ont échoué : ${e.message}`, `Screenshots failed: ${e.message}`));
  await server.close();
  process.exit(1);
}
if (write && !has("serve")) { await server.close(); process.exit(0); }
console.log(T(`Banc d'essai prêt : ${url}\nCtrl+C pour arrêter.`, `Bench ready: ${url}\nCtrl+C to stop.`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await server.close(); process.exit(0); });
