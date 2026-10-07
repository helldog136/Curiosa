// Prépare une installation : .env, base de données, client Prisma.
// Utilisation : npm install && npm run bootstrap && npm run build && npm start
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("• .env créé à partir de .env.example — pensez à régler SITE_URL.");
}
mkdirSync("data", { recursive: true });
execSync("npx prisma generate", { stdio: "inherit" });
execSync("npx prisma migrate deploy", { stdio: "inherit" });
console.log("\n✓ Prêt. Lancez `npm run build && npm start`, puis ouvrez le site : l'assistant de configuration démarre à la première visite.");
