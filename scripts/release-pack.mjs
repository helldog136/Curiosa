// Empaquette une release COMPILÉE — lancé par la CI (.github/workflows/release.yml) après `npm ci`, `npm run build`,
// `npm prune --omit=dev` et `npx prisma generate` (and `npm rebuild better-sqlite3` after `npm ci --ignore-scripts`). Usage : node scripts/release-pack.mjs <version> [dossier-de-sortie]
// Produit `curiosa-v<version>-<plateforme>.tar.gz` et son empreinte `.sha256`, que l'admin des instances télécharge.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assetName, platformId, REPO_RE, validManifestPaths } from "./update-lib.mjs";

const version = String(process.argv[2] ?? "").replace(/^v/, "");
const outDir = path.resolve(process.argv[3] ?? "dist");
if (!/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(version)) { console.error("Usage : node scripts/release-pack.mjs <X.Y.Z[-rc.N]> [sortie]"); process.exit(1); }
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (pkg.version !== version) { console.error(`package.json est en ${pkg.version}, pas en ${version} : corrigez la version avant d'étiqueter.`); process.exit(1); }
const repo = process.env.GITHUB_REPOSITORY ?? process.env.CURIOSA_RELEASE_REPO ?? "";
if (!REPO_RE.test(repo)) { console.error("Dépôt inconnu : GITHUB_REPOSITORY (ou CURIOSA_RELEASE_REPO) doit valoir « compte/nom »."); process.exit(1); }

/** `upgrade.json` : le plancher de support de CETTE version (aussi publié comme asset) ; la barrière de démarrage Docker le lit dans l'image (scripts/shared-lib.mjs, readFloor). Tout ce que le site lit à l'exécution ; rien d'autre. `fonts` : les polices libres livrées avec le cœur (inventaire, fichiers, licences), servies par le site lui-même (docs/POLICES.md). Les données de l'exploitant n'y sont jamais, ni AUCUN module : Curiosa s'installe seul, ses modules viennent du catalogue. */
const PATHS = [
  ".next", "node_modules", "package.json", "package-lock.json", "next.config.mjs", "release.json",
  "prisma.config.ts", "prisma/schema.prisma", "prisma/migrations", "scripts", "fonts",
  ".env.example", "LICENSE", "THIRD-PARTY-NOTICES.md",
  "upgrade.json",
].filter((p) => p === "release.json" || fs.existsSync(p));
if (!PATHS.includes(".next")) { console.error("Pas de build (.next) : lancez `npm run build` d'abord."); process.exit(1); }
if (!fs.existsSync("node_modules/.prisma/client")) { console.error("Client Prisma absent : lancez `npx prisma generate` après `npm prune --omit=dev`."); process.exit(1); }
if (!["x64", "arm64"].includes(process.arch)) { console.error(`Architecture ${process.arch} non prise en charge (x64 et arm64).`); process.exit(1); }
// Prisma 7 has no query engine binary any more: the site talks to SQLite through better-sqlite3, a native module compiled for ONE Node.js ABI.
// An archive is built with one Node.js and installed on servers that run another major version (existing sites run Node.js 20; images run 22):
// it carries the driver compiled for each supported Node.js major, and src/core/dbFile.ts (sqliteNativeBinding) picks the one of the running Node.js.
// better-sqlite3 is pinned in package.json to the last version that publishes a driver for every major listed here (Node.js 20 included).
export const SQLITE_NODE_TARGETS = [{ node: "20.19.0", abi: 115 }, { node: "22.12.0", abi: 127 }, { node: "24.11.0", abi: 137 }];
export const sqlitePrebuildDir = (abi, arch = process.arch) => `node_modules/better-sqlite3/prebuilds/node-v${abi}-linux-${arch}`;
{
  const pkgDir = "node_modules/better-sqlite3";
  const own = path.join(pkgDir, "build/Release/better_sqlite3.node");
  if (!fs.existsSync(own)) { console.error("Pilote SQLite absent (better-sqlite3) : lancez `npm rebuild better-sqlite3` après `npm ci --ignore-scripts`."); process.exit(1); }
  const keep = fs.readFileSync(own);
  fs.rmSync(path.join(pkgDir, "prebuilds"), { recursive: true, force: true });
  // CURIOSA_SQLITE_PREBUILDS_FROM: a folder that already holds node-v<abi>-linux-<arch>/better_sqlite3.node (offline build, tests): copied instead of downloaded.
  const from = process.env.CURIOSA_SQLITE_PREBUILDS_FROM;
  try {
    for (const { node, abi } of SQLITE_NODE_TARGETS) {
      if (from) { fs.mkdirSync(sqlitePrebuildDir(abi), { recursive: true }); fs.copyFileSync(path.join(from, `node-v${abi}-linux-${process.arch}`, "better_sqlite3.node"), path.join(sqlitePrebuildDir(abi), "better_sqlite3.node")); continue; }
      // prebuild-install (a dependency of better-sqlite3) downloads the published driver of that Node.js into build/Release/; it is then kept aside.
      execFileSync(process.execPath, [path.resolve("node_modules/prebuild-install/bin.js"), "--runtime", "node", "--target", node, "--arch", process.arch, "--platform", "linux", "--force"], { cwd: pkgDir, stdio: "inherit" });
      fs.mkdirSync(sqlitePrebuildDir(abi), { recursive: true });
      fs.copyFileSync(own, path.join(sqlitePrebuildDir(abi), "better_sqlite3.node"));
    }
  } finally { fs.writeFileSync(own, keep); }
  const sizes = SQLITE_NODE_TARGETS.map(({ abi }) => fs.statSync(path.join(sqlitePrebuildDir(abi), "better_sqlite3.node")).size);
  if (sizes.some((n) => n < 100_000)) { console.error("Un pilote SQLite téléchargé est vide ou tronqué."); process.exit(1); }
}
if (!validManifestPaths(PATHS)) { console.error("Liste de chemins invalide."); process.exit(1); }

/**
 * Ce que l'installation de production n'utilise JAMAIS et que l'archive n'embarque donc pas (≈ 270 Mo sur ≈ 880) : elles restent dans le dépôt de développement.
 *   - le compilateur de Next (SWC, un binaire par libc, et son dossier « fallback » que Next remplit tout seul s'il le cherche) : le site est déjà compilé et sa configuration est du JavaScript (next.config.mjs) ;
 *   - les variantes WebAssembly de `sharp` (@img/sharp-*wasm32, ≈ 9 Mo) : `sharp` lui-même, avec son moteur natif pour la machine de la release, est LIVRÉ (≈ 20 Mo) car le recadrage des images en dépend ;
 *   - TypeScript : seulement une dépendance facultative de Prisma, jamais chargée pour appliquer les migrations ;
 *   - les 3 000 fichiers SVG de simple-icons : le paquet porte déjà les tracés dans son index JavaScript ;
 *   - les variantes WebAssembly du client Prisma (PostgreSQL, MySQL, SQL Server… ≈ 66 Mo) : le client généré (node_modules/.prisma/client) porte sa propre copie, celle de SQLite ;
 *   - les anciens moteurs de requête de Prisma 6 (libquery_engine-*), s'il en reste : Prisma 7 n'en a plus, et les migrations n'emploient que le moteur de schéma.
 * scripts/smoke-release.mjs démarre l'archive SANS ces dossiers avant toute publication : si le site en dépend un jour, la release n'est pas publiée.
 */
export const NOT_SHIPPED = ["node_modules/@next/swc-*", "node_modules/next/next-swc-fallback", "node_modules/@img/sharp-*wasm32", "node_modules/typescript", "node_modules/simple-icons/icons", "node_modules/@prisma/client/runtime/*wasm*", "node_modules/prisma/libquery_engine-*", "node_modules/@prisma/engines/libquery_engine-*"];

// `languages`: the archive has no src/, and next.config.mjs needs the language codes at startup (URL prefixes /fr, /de...).
function languageCodes() {
  try { return Object.keys(JSON.parse(fs.readFileSync("src/locales/languages.json", "utf8"))); } catch { return undefined; }
}
fs.writeFileSync("release.json", JSON.stringify({ name: "curiosa", version, platform: platformId(), repo, node: process.versions.node, builtAt: new Date().toISOString(), paths: PATHS, languages: languageCodes() }, null, 2));
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, assetName(`v${version}`));
execFileSync("tar", ["-czf", file, "--exclude=.next/cache", "--exclude=node_modules/.cache", ...NOT_SHIPPED.map((p) => `--exclude=${p}`), ...PATHS], { stdio: "inherit" });
const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.writeFileSync(`${file}.sha256`, `${hash}  ${path.basename(file)}\n`);
// Publié à côté de l'archive : les installations existantes y lisent, AVANT de rien télécharger, depuis quelle version cette release s'installe directement.
const upgrade = JSON.parse(fs.readFileSync("upgrade.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(String(upgrade.minFrom ?? "0.0.0"))) throw new Error("upgrade.json : minFrom doit être une version X.Y.Z");
fs.copyFileSync("upgrade.json", path.join(outDir, "upgrade.json"));
// Le script d'installation est aussi publié SEUL à côté de l'archive : on le télécharge (et on peut le relire) avant que l'archive existe sur le serveur — .../releases/latest/download/install.sh
fs.copyFileSync("scripts/install.sh", path.join(outDir, "install.sh"));
console.log(`${file}\n${hash}  ${(fs.statSync(file).size / 1048576).toFixed(0)} Mo`);
