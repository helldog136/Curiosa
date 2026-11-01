// `npm test` : lance la batterie dans un TMPDIR PROPRE À CETTE EXÉCUTION.
//
//  - un dossier racine unique (`curiosa-tests-XXXXXX`, sous le TMPDIR de l'environnement) devient le TMPDIR de tous les processus de test
//    (fichiers de test, serveurs, `git`, archives…) : ce qu'ils créent sans le savoir y atterrit, pas dans /tmp ;
//  - il est supprimé à la fin, même si des tests échouent ou si on interrompt (Ctrl-C) ;
//  - GARDE-FOU : tout ce que les tests y laissent est listé en clair et fait échouer l'exécution. Les tests doivent créer leurs dossiers
//    avec makeTempDir() (tests/helpers/tmp.mjs), qui les supprime. KEEP_TEST_TMP=1 : on garde tout (et on dit où) pour déboguer.
//
//   npm test                         toute la batterie
//   npm test -- tests/core/x.test.mjs   seulement ces fichiers (ou motifs)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Caches que Node lui-même range dans TMPDIR (ce ne sont pas des dossiers de test) : ignorés par le garde-fou, supprimés avec la racine.
const TOOL_CACHES = new Set(["node-compile-cache"]);
const keep = process.env.KEEP_TEST_TMP === "1";
const repo = path.resolve(import.meta.dirname, "..");
const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-tests-"));
const patterns = process.argv.length > 2 ? process.argv.slice(2) : ["tests/**/*.test.mjs"];

const child = spawn(
  process.execPath,
  ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./tests/helpers/register.mjs", "--test", "--test-concurrency=6", ...patterns],
  { cwd: repo, stdio: "inherit", env: { ...process.env, TMPDIR: runRoot, TMP: runRoot, TEMP: runRoot } },
);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

child.on("close", (status, signal) => {
  let leftovers = [];
  try { leftovers = fs.readdirSync(runRoot).filter((n) => !TOOL_CACHES.has(n)); } catch { /* racine déjà supprimée */ }
  let code = status ?? (signal ? 1 : 0);
  if (leftovers.length) {
    const byKind = new Map();
    for (const name of leftovers) { const kind = name.replace(/[A-Za-z0-9]{6}$/, "*"); byKind.set(kind, (byKind.get(kind) ?? 0) + 1); }
    console.error(`\n✖ Garde-fou TMPDIR : ${leftovers.length} dossier(s)/fichier(s) laissé(s) par les tests dans ${runRoot}`);
    for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.error(`    ${String(n).padStart(5)} × ${kind}`);
    console.error("  → créez vos dossiers temporaires avec makeTempDir() (tests/helpers/tmp.mjs), jamais avec fs.mkdtempSync(os.tmpdir()…) ; voir docs/TESTSUPPORT.md.");
    if (code === 0) code = 1;
  }
  if (keep) console.error(`KEEP_TEST_TMP=1 : ${runRoot} conservé (à supprimer à la main quand vous avez fini).`);
  else fs.rmSync(runRoot, { recursive: true, force: true });
  process.exit(code);
});
