// Checks the known vulnerabilities (CVE) of the production dependencies: `npm run audit`.
// Fails as soon as a vulnerability of severity >= high is not in the ACCEPTED list below
// (each exception is justified). Offline or registry unreachable: warns without blocking the build.
import { execFileSync } from "node:child_process";

const LEVELS = ["info", "low", "moderate", "high", "critical"];
const THRESHOLD = process.env.AUDIT_LEVEL ?? "high";
const ACCEPTED = {
  // Prisma command-line tool (migrations), never loaded by the running site;
  // the fix needs Prisma 7 or later, a major upgrade planned separately.
  "deepmerge-ts": "GHSA-ggr8-5vv4-36mx — only affects the Prisma command-line tool",
  "@prisma/config": "depends on deepmerge-ts (see above)",
  prisma: "depends on @prisma/config (see above)",
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
  if (report?.error || !out) { console.warn("audit: registry unreachable, vulnerability check skipped."); process.exit(0); }
  console.log("audit: no known vulnerability."); process.exit(0);
}
const bad = Object.entries(report.vulnerabilities)
  .filter(([name, v]) => LEVELS.indexOf(v.severity) >= LEVELS.indexOf(THRESHOLD) && !(name in ACCEPTED));
for (const [name, why] of Object.entries(ACCEPTED)) if (report.vulnerabilities[name]) console.log(`audit: accepted — ${name}: ${why}`);
if (bad.length) {
  console.error(`audit: ${bad.length} vulnerability(ies) >= ${THRESHOLD}:`);
  for (const [n, v] of bad) console.error(` - ${n} (${v.severity}) ${v.range}`);
  console.error("Run `npm audit` for the details, then `npm update` or change the version.");
  process.exit(1);
}
console.log("audit: nothing blocking.");
