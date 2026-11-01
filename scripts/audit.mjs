// Vérifie les failles connues (CVE) des dépendances de production : `npm run audit`.
// Échoue dès qu'une faille de gravité >= high n'est pas dans la liste « acceptées » ci-dessous
// (chaque exception est justifiée). Hors ligne ou registre injoignable : avertit sans bloquer le build.
import { execFileSync } from "node:child_process";

const LEVELS = ["info", "low", "moderate", "high", "critical"];
const THRESHOLD = process.env.AUDIT_LEVEL ?? "high";
const ACCEPTED = {
  // Outil en ligne de commande de Prisma (migrations), jamais chargé par le site en production ;
  // le correctif n'existe que dans Prisma 8 (version préliminaire).
  "deepmerge-ts": "GHSA-ggr8-5vv4-36mx — n'affecte que la CLI Prisma",
  "@prisma/config": "dépend de deepmerge-ts (voir ci-dessus)",
  prisma: "dépend de @prisma/config (voir ci-dessus)",
};

let out;
try {
  out = execFileSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
} catch (e) {
  out = e.stdout?.toString() ?? "";
}
let report;
try { report = JSON.parse(out); } catch { report = null; }
if (!report?.vulnerabilities) {
  if (report?.error || !out) { console.warn("audit : registre injoignable, vérification des failles ignorée."); process.exit(0); }
  console.log("audit : aucune faille connue."); process.exit(0);
}
const bad = Object.entries(report.vulnerabilities)
  .filter(([name, v]) => LEVELS.indexOf(v.severity) >= LEVELS.indexOf(THRESHOLD) && !(name in ACCEPTED));
for (const [name, why] of Object.entries(ACCEPTED)) if (report.vulnerabilities[name]) console.log(`audit : acceptée — ${name} : ${why}`);
if (bad.length) {
  console.error(`audit : ${bad.length} faille(s) >= ${THRESHOLD} :`);
  for (const [n, v] of bad) console.error(` - ${n} (${v.severity}) ${v.range}`);
  console.error("Lancez `npm audit` pour le détail, puis `npm update` ou changez de version.");
  process.exit(1);
}
console.log("audit : rien de bloquant.");
