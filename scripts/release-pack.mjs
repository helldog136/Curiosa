// Empaquette une release COMPILÉE — lancé par la CI (.github/workflows/release.yml) après `npm ci`, `npm run build`,
// `npm prune --omit=dev` et `npx prisma generate`. Usage : node scripts/release-pack.mjs <version> [dossier-de-sortie]
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
if (!REPO_RE.test(repo)) { console.error("Dépôt inconnu : GITHUB_REPOSITORY (ou CURIOSA_RELEASE_REPO) doit valoir « propriétaire/nom »."); process.exit(1); }

/** Tout ce que le site lit à l'exécution ; rien d'autre. Les données de l'exploitant n'y sont jamais. */
const PATHS = [
  ".next", "node_modules", "package.json", "package-lock.json", "next.config.mjs", "release.json",
  "prisma/schema.prisma", "prisma/migrations", "scripts", "extras",
  ".env.example", "LICENSE", "THIRD-PARTY-NOTICES.md",
].filter((p) => p === "release.json" || fs.existsSync(p));
if (!PATHS.includes("extras")) { console.error("Pas de modules (extras/) : lancez `node scripts/fetch-extras.mjs` d'abord."); process.exit(1); }
if (!PATHS.includes(".next")) { console.error("Pas de build (.next) : lancez `npm run build` d'abord."); process.exit(1); }
if (!fs.existsSync("node_modules/.prisma/client")) { console.error("Client Prisma absent : lancez `npx prisma generate` après `npm prune --omit=dev`."); process.exit(1); }
for (const engine of ["debian-openssl-1.1.x", "debian-openssl-3.0.x"]) {
  if (!fs.existsSync(`node_modules/.prisma/client/libquery_engine-${engine}.so.node`)) { console.error(`Moteur de base de données « ${engine} » absent : vérifiez binaryTargets dans prisma/schema.prisma, puis relancez \`npx prisma generate\`.`); process.exit(1); }
}
if (!validManifestPaths(PATHS)) { console.error("Liste de chemins invalide."); process.exit(1); }

/**
 * Ce que l'installation de production n'utilise JAMAIS et que l'archive n'embarque donc pas (≈ 270 Mo sur ≈ 880) : elles restent dans le dépôt de développement.
 *   - le compilateur de Next (SWC, un binaire par libc, et son dossier « fallback » que Next remplit tout seul s'il le cherche) : le site est déjà compilé et sa configuration est du JavaScript (next.config.mjs) ;
 *   - `sharp` (@img) : le site n'utilise pas next/image (images.unoptimized) ;
 *   - TypeScript : seulement une dépendance facultative de Prisma, jamais chargée pour appliquer les migrations ;
 *   - les 3 000 fichiers SVG de simple-icons : le paquet porte déjà les tracés dans son index JavaScript ;
 *   - les variantes WebAssembly du client Prisma (PostgreSQL, MySQL, SQL Server… ≈ 66 Mo) : le site utilise le moteur natif SQLite ;
 *   - les copies des moteurs de requête que l'outil Prisma (CLI) garde pour lui : le site utilise celles du client généré (node_modules/.prisma/client), et les migrations n'emploient que le moteur de schéma.
 * scripts/smoke-release.mjs démarre l'archive SANS ces dossiers avant toute publication : si le site en dépend un jour, la release n'est pas publiée.
 */
export const NOT_SHIPPED = ["node_modules/@next/swc-*", "node_modules/next/next-swc-fallback", "node_modules/@img", "node_modules/typescript", "node_modules/simple-icons/icons", "node_modules/@prisma/client/runtime/*wasm*", "node_modules/prisma/libquery_engine-*", "node_modules/@prisma/engines/libquery_engine-*"];

fs.writeFileSync("release.json", JSON.stringify({ name: "curiosa", version, platform: platformId(), repo, node: process.versions.node, builtAt: new Date().toISOString(), paths: PATHS }, null, 2));
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, assetName(`v${version}`));
execFileSync("tar", ["-czf", file, "--exclude=.next/cache", "--exclude=node_modules/.cache", ...NOT_SHIPPED.map((p) => `--exclude=${p}`), ...PATHS], { stdio: "inherit" });
const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.writeFileSync(`${file}.sha256`, `${hash}  ${path.basename(file)}\n`);
// Publié à côté de l'archive : les installations existantes y lisent, AVANT de rien télécharger, depuis quelle version cette release s'installe directement.
const upgrade = JSON.parse(fs.readFileSync("upgrade.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(String(upgrade.minFrom ?? "0.0.0"))) throw new Error("upgrade.json : minFrom doit être une version X.Y.Z");
fs.copyFileSync("upgrade.json", path.join(outDir, "upgrade.json"));
console.log(`${file}\n${hash}  ${(fs.statSync(file).size / 1048576).toFixed(0)} Mo`);
