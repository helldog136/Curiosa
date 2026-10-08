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
  ".next", "node_modules", "package.json", "package-lock.json", "next.config.ts", "release.json",
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

fs.writeFileSync("release.json", JSON.stringify({ name: "curiosa", version, platform: platformId(), repo, node: process.versions.node, builtAt: new Date().toISOString(), paths: PATHS }, null, 2));
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, assetName(`v${version}`));
execFileSync("tar", ["-czf", file, "--exclude=.next/cache", "--exclude=node_modules/.cache", ...PATHS], { stdio: "inherit" });
const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.writeFileSync(`${file}.sha256`, `${hash}  ${path.basename(file)}\n`);
console.log(`${file}\n${hash}  ${(fs.statSync(file).size / 1048576).toFixed(0)} Mo`);
