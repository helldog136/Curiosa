// Tire un PREMIER SITE Curiosa d'une page d'agrégateur de liens (Linktree, Beacons, Bio.link, Linkin.bio, Lnk.Bio, Taplink, Solo.to, Campsite.bio, AllMyLinks, Carrd,
// Milkshake, ou toute page de liens) : une SAUVEGARDE « de base » à restaurer depuis l'assistant d'installation (« J'ai déjà une sauvegarde », voir docs/BACKUP.md).
// Rien n'est écrit sur un site en service. Voir docs/IMPORT-LIENS.md et le skill .claude/skills/migrate-from-link-aggregator.
//
//   node scripts/import-links.mjs <adresse publique | fichier .html/.json enregistré | fiche .json> [--out fichier.tar.gz.enc] [--password <mdp de la sauvegarde>]
//        [--owner-email x@y --owner-name "Nom" [--owner-password …]] [--lang fr] [--adapter linktree|beacons|biolink|linkinbio|lnkbio|taplink|soloto|campsite|allmylinks|carrd|milkshake|generic]
//        [--url https://… (adresse d'origine d'un fichier enregistré)] [--extract-only] [--json] [--no-download] [--keep-in-links] [--resolve-redirects]
//
// 1. lit la page (adresse publique http(s) seulement, taille et durée bornées, aucun cookie) ou le fichier ;
// 2. un petit adaptateur par service en tire nom, présentation, avatar, liens (avec sections) et réseaux ; il se replie sur l'adaptateur générique si la page a changé ;
// 3. écrit la fiche (JSON, relisible et corrigeable à la main : <sauvegarde>.fiche.json), la sauvegarde chiffrée et un rapport (texte et JSON).
// Les modules (liens, un par réseau) sont installés depuis le catalogue (réseau requis, ou CURIOSA_CATALOGUE_REPO vers un dépôt local) : le cœur n'en embarque aucun.
// Usage sur SA PROPRE page uniquement, une page à la fois : cet outil n'est pas fait pour collecter des pages en masse.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADAPTERS } from "./import-links/index.mjs";
import { profileFromSource } from "./import-links/pipeline.mjs";
import { reportJson, reportText } from "./import-links/report.mjs";
import { readSource } from "./import-links/source.mjs";

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["out", "password", "owner-email", "owner-name", "owner-password", "lang", "adapter", "url"]);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const positional = args.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has((args[i - 1] ?? "").replace(/^--/, "")) );
const asJson = has("json");
const here = path.dirname(fileURLToPath(import.meta.url));

function fail(error) {
  const code = error?.code ?? "error";
  if (asJson) console.log(JSON.stringify({ ok: false, error: { code, message: error.message } }, null, 2));
  else console.error(`Échec (${code}) : ${error.message}`);
  process.exit(1);
}

if (has("list-adapters")) {
  const list = [...ADAPTERS.map((a) => ({ id: a.id, name: a.name, hosts: a.hosts })), { id: "generic", name: "Page de liens quelconque", hosts: [] }];
  console.log(asJson ? JSON.stringify(list, null, 2) : list.map((a) => `${a.id.padEnd(11)} ${a.name}${a.hosts.length ? ` (${a.hosts.join(", ")})` : ""}`).join("\n"));
  process.exit(0);
}
if (!positional[0] || has("help")) {
  console.error("Usage : node scripts/import-links.mjs <adresse publique | fichier enregistré | fiche .json> [--out f] [--password p] [--owner-email x@y --owner-name N] [--extract-only] [--json]\n(--list-adapters : les services pris en charge)");
  process.exit(positional[0] ? 0 : 1);
}

// Le code du cœur (alias @/…) se charge par le même point d'entrée que les tests et l'import Grav : on se relance avec lui pour fabriquer la sauvegarde.
if (!has("extract-only") && !process.env.CURIOSA_IMPORT_CHILD) {
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", pathToFileURL(path.join(here, "../tests/helpers/register.mjs")).href, fileURLToPath(import.meta.url), ...args], { stdio: "inherit", env: { ...process.env, CURIOSA_IMPORT_CHILD: "1" } });
  process.exit(r.status ?? 1);
}

let profile;
try {
  profile = await profileFromSource(await readSource(positional[0], { url: flag("url") }), { adapter: flag("adapter"), keepSocialsInLinks: has("keep-in-links"), resolveRedirects: has("resolve-redirects") });
} catch (error) { fail(error); }

if (has("extract-only")) {
  const out = flag("out");
  const text = JSON.stringify(profile, null, 2) + "\n";
  if (out) fs.writeFileSync(out, text);
  console.log(asJson ? JSON.stringify({ ...reportJson(profile, null), ok: true, profile }, null, 2) : reportText(profile, null) + (out ? `\nFiche écrite : ${path.resolve(out)}\n` : ""));
  process.exit(0);
}

let backup;
try {
  const { buildBackup } = await import("./import-links/backup.mjs");
  backup = await buildBackup(profile, {
    out: flag("out") ? path.resolve(flag("out")) : undefined, password: flag("password"), ownerEmail: flag("owner-email"), ownerName: flag("owner-name"), ownerPassword: flag("owner-password"),
    locale: flag("lang") ?? "fr", download: !has("no-download"),
  });
} catch (error) { fail(error); }

const json = reportJson(profile, backup);
fs.writeFileSync(`${backup.file}.rapport.txt`, reportText(profile, backup));
fs.writeFileSync(`${backup.file}.rapport.json`, JSON.stringify(json, null, 2) + "\n");
fs.writeFileSync(`${backup.file}.fiche.json`, JSON.stringify(profile, null, 2) + "\n");
if (asJson) console.log(JSON.stringify({ ...json, secrets: { backupPassword: backup.password, ownerPassword: backup.owner.password } }, null, 2));
else {
  console.log(reportText(profile, backup));
  console.log(`Mot de passe de la sauvegarde : ${backup.password}`);
  console.log(`Compte propriétaire provisoire : ${backup.owner.email} / ${backup.owner.password}`);
}
process.exit(0);
