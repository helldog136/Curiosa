// Fige les migrations Prisma existantes : à lancer à la sortie d'une version (avant d'étiqueter vX.Y.Z).
// Une migration figée ne doit plus JAMAIS être modifiée (elle a pu être appliquée chez des gens) ; le test `migrations-frozen` le vérifie.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const dir = path.join(process.cwd(), "prisma", "migrations");
const file = path.join(dir, "frozen.json");
const frozen = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
let added = 0;
for (const name of fs.readdirSync(dir).filter((d) => /^\d{8,}_/.test(d)).sort()) {
  if (frozen[name]) continue;
  frozen[name] = createHash("sha256").update(fs.readFileSync(path.join(dir, name, "migration.sql"))).digest("hex");
  added++;
  console.log(`figée : ${name}`);
}
fs.writeFileSync(file, JSON.stringify(frozen, null, 2) + "\n");
console.log(added ? `${added} migration(s) figée(s).` : "Rien de nouveau à figer.");
