#!/usr/bin/env node
// Test de sensibilité : prouve que le harnais voit un écart d'UN pixel.
//   node scripts/visual/sensitivity.mjs <capture-de-référence> [--widths 390] [--only night/fr/privacy]
// Fabrique une COPIE jetable du cœur construit (le dépôt n'est pas touché), y ajoute une règle CSS d'un pixel (`main{padding-top:calc(2.5rem + 1px)}`), capture la page
// choisie, compare à la référence : le résultat attendu est un ÉCHEC de la comparaison (code 1). Le script répond 0 si l'écart a été vu, 1 sinon.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CORE_DIR, ROOT } from "./config.mjs";

const argv = process.argv.slice(2);
const baseline = path.resolve(argv.find((a) => !a.startsWith("--")) ?? "");
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const widths = opt("widths", "390"), only = opt("only", "night/fr/privacy");
if (!fs.existsSync(path.join(baseline, "manifest.json"))) { console.error("usage : sensitivity.mjs <capture-de-référence>"); process.exit(2); }

const copy = path.join(ROOT, "sensitivity-core");
fs.rmSync(copy, { recursive: true, force: true });
fs.mkdirSync(copy, { recursive: true });
for (const f of [".next", "prisma", "src", "scripts", "package.json", "next.config.mjs", "postcss.config.mjs", "tsconfig.json", "tests"]) if (fs.existsSync(path.join(CORE_DIR, f))) fs.cpSync(path.join(CORE_DIR, f), path.join(copy, f), { recursive: true });
fs.symlinkSync(path.join(CORE_DIR, "node_modules"), path.join(copy, "node_modules"));
if (fs.existsSync(path.join(CORE_DIR, "public"))) fs.cpSync(path.join(CORE_DIR, "public"), path.join(copy, "public"), { recursive: true });

// La règle jetable : dans la feuille de style du site (celle qui contient `.vh-flow`), un pixel de plus au-dessus du contenu.
const dir = path.join(copy, ".next/static");
let patched = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith(".css")) { const css = fs.readFileSync(f, "utf8"); if (css.includes("vh-flow")) { fs.writeFileSync(f, css + "\nmain{padding-top:calc(2.5rem + 1px)}\n"); patched++; } } } };
walk(dir);
if (!patched) { console.error("aucune feuille de style trouvée à modifier"); process.exit(2); }
console.log(`copie jetable : ${copy} (${patched} feuille(s) modifiée(s) d'un pixel)`);

const cand = path.join(ROOT, "sensitivity-capture");
fs.rmSync(cand, { recursive: true, force: true });
const run = (args) => spawnSync("node", args, { cwd: copy, stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "", VISUAL_ALLOW_IN_REPO: "" } });
const c = run([path.join(copy, "scripts/visual/capture.mjs"), cand, "--profiles", "night", "--widths", widths, "--only", only]);
if (c.status !== 0) { console.error("la capture de la copie a échoué"); process.exit(2); }
const r = run([path.join(copy, "scripts/visual/compare.mjs"), baseline, cand, "--only", widths.split(",").map((w) => `night/fr/${w}/${only.split("/").pop()}.png`).join(",")]);
fs.rmSync(copy, { recursive: true, force: true });
if (r.status === 1) { console.log("SENSIBILITÉ : OK — l'écart d'un pixel a été détecté."); process.exit(0); }
console.error(`SENSIBILITÉ : ÉCHEC — la comparaison a répondu ${r.status} (attendu : 1)`);
process.exit(1);
