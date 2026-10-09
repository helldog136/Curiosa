// Miroir de la documentation du dépôt vers le wiki GitHub.
//   node scripts/wiki-sync.mjs <dossier-du-wiki> <propriétaire/dépôt>
// Le dépôt reste la SOURCE DE VÉRITÉ (la doc est versionnée avec le code, relue, testée) ; le wiki n'en est que le reflet : chaque page porte un bandeau
// qui renvoie vers le fichier du dépôt, et ce script réécrit tout le contenu du wiki à chaque publication (ne modifiez pas le wiki à la main).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Fichier du dépôt → titre de page du wiki (le titre est le nom de la page et de son adresse). */
export const PAGES = [
  { file: "docs/INSTALL.md", page: "Installer", blurb: "installer, mettre à jour, publier une release, logos, en-tête et menu" },
  { file: "docs/AGENT-INSTALL.md", page: "Installation-par-un-assistant-IA", blurb: "installation menée par un assistant IA" },
  { file: "docs/CREATE-A-MODULE.md", page: "Créer-un-module", blurb: "créer un module, pas à pas" },
  { file: "docs/MODULES.md", page: "Référence-des-modules", blurb: "référence complète des modules" },
  { file: "docs/PLATFORM.md", page: "Le-cœur-et-ses-services", blurb: "ce que fait le cœur, ce que font les modules" },
  { file: "docs/ARCHITECTURE.md", page: "Architecture", blurb: "les choix de conception" },
  { file: "docs/BACKUP.md", page: "Sauvegarde", blurb: "sauvegarde chiffrée, lisible sans le framework" },
  { file: "docs/BACKGROUND.md", page: "Fond-de-page", blurb: "décrire le fond de page" },
  { file: "docs/IMPORT-GRAV.md", page: "Importer-depuis-Grav", blurb: "convertir un site Grav" },
  { file: "docs/PRIVACY.md", page: "Vie-privée-et-cookies", blurb: "cookies, statistiques, politique de confidentialité" },
  { file: "docs/SECURITE.md", page: "Sécurité-de-la-connexion", blurb: "blocages progressifs, sessions, dépannage en SSH" },
  { file: "docs/MESURES.md", page: "Mesures", blurb: "les chiffres mesurés, leur méthode, et ce qui n'est pas mesuré" },
  { file: "CHANGELOG.md", page: "Changelog", blurb: "ce qui change à chaque version" },
];

/** Adresse relative d'un fichier du dépôt → page du wiki, ou lien absolu vers le fichier sur GitHub si ce n'est pas une page du wiki. */
export function rewriteLinks(markdown, fromFile, repo) {
  const byFile = new Map(PAGES.map((p) => [p.file, p.page]));
  const fromDir = path.posix.dirname(fromFile);
  return markdown.replace(/(\]\()([^)\s]+)(\))/g, (whole, open, target, close) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return whole; // adresse absolue, ancre de la même page
    const [file, anchor] = target.split("#");
    const resolved = path.posix.normalize(path.posix.join(fromDir, file));
    if (resolved.startsWith("..")) return whole;
    const page = byFile.get(resolved);
    if (page) return `${open}${page}${anchor ? `#${anchor}` : ""}${close}`;
    return `${open}https://github.com/${repo}/blob/master/${resolved}${anchor ? `#${anchor}` : ""}${close}`;
  });
}

const banner = (file, repo) =>
  `> 📌 Cette page est un **reflet** de [\`${file}\`](https://github.com/${repo}/blob/master/${file}), publié à chaque release. Pour la corriger, modifiez le fichier du dépôt (une modification faite ici serait écrasée).\n\n`;

/** Tout le contenu du wiki : { nom du fichier → texte }. */
export function buildWiki(repo, read = (f) => fs.readFileSync(path.join(root, f), "utf8")) {
  const out = {};
  for (const p of PAGES) out[`${p.page}.md`] = banner(p.file, repo) + rewriteLinks(read(p.file), p.file, repo);
  const list = PAGES.map((p) => `- [${p.page.replaceAll("-", " ")}](${p.page}) — ${p.blurb}`).join("\n");
  out["Home.md"] = `# Curiosa — documentation\n\nCuriosa est un framework de site personnel pour créateurs : un site complet qu'on installe une fois et qu'on gère seul. Cette documentation est le reflet de celle du dépôt, publié à chaque release.\n\n## Pages\n\n${list}\n\n## Écrire son propre module\n\nCommencez par [Créer un module](Créer-un-module), puis gardez la [Référence des modules](Référence-des-modules) sous la main.\n\n[Dépôt](https://github.com/${repo}) · [Releases](https://github.com/${repo}/releases)\n`;
  out["_Sidebar.md"] = `**[Accueil](Home)**\n\n${PAGES.map((p) => `- [${p.page.replaceAll("-", " ")}](${p.page})`).join("\n")}\n`;
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, repo] = process.argv.slice(2);
  if (!dir || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) { console.error("usage : node scripts/wiki-sync.mjs <dossier> <propriétaire/dépôt>"); process.exit(2); }
  // Le wiki est un miroir : on remplace tout son contenu (sauf .git).
  for (const f of fs.readdirSync(dir)) if (f !== ".git") fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const pages = buildWiki(repo);
  for (const [name, text] of Object.entries(pages)) fs.writeFileSync(path.join(dir, name), text);
  console.log(`${Object.keys(pages).length} pages écrites dans ${dir}`);
}
