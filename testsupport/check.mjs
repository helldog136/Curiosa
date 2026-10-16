#!/usr/bin/env node
// Vérifie qu'un module respecte les exigences du cœur : sans serveur, sans réseau, sans base réelle.
//
//   node testsupport/check.mjs <dossier-du-module> [--json]          (ou : npm run module:check -- <dossier-du-module>)
//
// Options
//   --json              rapport lisible par une machine (une IA qui corrige le module) sur la sortie standard
//   --voisins <dossier> comparer aussi aux modules de ce dossier parent (« un propriétaire par donnée »). Par défaut : les dossiers voisins.
//   --strict            les conseils non suivis font aussi échouer (code de sortie 1)
//   --tableau           (plusieurs dossiers) tableau module × exigence
//   --seulement a,b     ne lancer que ces exigences (identifiants)
//   --liste             liste les exigences et quitte
// Code de sortie : 0 = toutes les exigences obligatoires réussies · 1 = au moins une en échec · 2 = commande mal utilisée.
import fs from "node:fs";
import path from "node:path";

// Le code du cœur est en TypeScript : Node affiche alors un avertissement sans intérêt ici. On relance une fois la commande sans lui.
if (!process.execArgv.some((a) => a.includes("disable-warning")) && !process.env.CURIOSA_CHECK_CHILD) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, CURIOSA_CHECK_CHILD: "1" } });
  process.exit(r.status ?? 1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(["--voisins", "--seulement"]);
const dirs = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));

const { checkModule, formatText, formatMatrix, listModuleDirs, REQUIREMENTS, LEVELS, GROUPS } = await import("./index.mjs");

if (flag("--liste")) {
  for (const [g, title] of Object.entries(GROUPS)) {
    console.log(`\n${title}`);
    for (const r of REQUIREMENTS.filter((x) => x.group === g)) console.log(`  ${r.id.padEnd(22)} ${LEVELS[r.level].padEnd(11)} ${r.title}`);
  }
  process.exit(0);
}
if (!dirs.length || flag("--aide") || flag("--help")) {
  console.error("Usage : node testsupport/check.mjs <dossier-du-module> [--json] [--voisins <dossier>] [--strict]\n        (ou npm run module:check -- <dossier-du-module>)\nExemple : node testsupport/check.mjs testsupport/template");
  process.exit(2);
}
for (const d of dirs) if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) { console.error(`Le dossier « ${d} » n'existe pas.`); process.exit(2); }

const neighbours = value("--voisins");
const only = value("--seulement")?.split(",").filter(Boolean);
const reports = [];
for (const d of dirs) reports.push(await checkModule(d, { siblings: neighbours ? listModuleDirs(path.resolve(neighbours)) : undefined, only }));

if (flag("--json")) console.log(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2));
else if (flag("--tableau") && reports.length > 1) console.log(formatMatrix(reports));
else for (const [i, r] of reports.entries()) console.log((i ? "\n" + "─".repeat(100) + "\n\n" : "") + formatText(r, { color: process.stdout.isTTY }));

const failed = reports.some((r) => !r.summary.ok || (flag("--strict") && r.summary.advice.failed > 0));
process.exit(failed ? 1 : 0);
