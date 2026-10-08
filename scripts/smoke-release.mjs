// Test de fumée d'une archive de release : on la décompresse ailleurs, on la démarre comme un hébergeur le ferait, et on vérifie ce qu'un
// utilisateur verrait. Lancé par la CI avant toute publication (.github/workflows/release.yml) : une archive qui ne démarre pas n'est jamais publiée.
//   node scripts/smoke-release.mjs dist/curiosa-vX.Y.Z-linux-x64.tar.gz
//
// 1. contenu : les modules livrés sont dans extras/, aucun ancien dossier de modules, l'index du Catalogue est présent ;
// 2. installation neuve : l'assistant répond et propose les modules de départ lus dans extras/ ;
// 3. mise à jour d'un site existant : une base d'avant (modules « intégrés », compte, instance) démarre, le site répond, les modules sont convertis
//    en modules ordinaires et leurs fichiers copiés, l'instance est intacte.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const archive = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(archive)) { console.error("Usage : node scripts/smoke-release.mjs <archive.tar.gz>"); process.exit(2); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-smoke-"));
const app = path.join(root, "app");
fs.mkdirSync(app);
execFileSync("tar", ["-xzf", archive, "-C", app], { stdio: "inherit" });

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed++; };
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

// ── 1. contenu ──
for (const old of ["modules-community", "modules-examples", "src"]) check(!fs.existsSync(path.join(app, old)), `l'archive ne contient pas « ${old} »`);
const index = path.join(app, "extras/catalogue/index.json");
check(fs.existsSync(path.join(app, "extras/modules/blog/module.json")), "extras/modules/blog/module.json présent");
check(fs.existsSync(path.join(app, "extras/SOURCE.json")), "extras/SOURCE.json (d'où vient l'instantané) présent");
check(fs.existsSync(index) && JSON.parse(fs.readFileSync(index, "utf8")).modules.length > 0, "index du Catalogue présent et non vide");

async function boot(name, prepare) {
  const data = path.join(root, name);
  fs.mkdirSync(data, { recursive: true });
  const env = { ...process.env, NODE_ENV: "production", DATA_DIR: data, DATABASE_URL: `file:${path.join(data, "db.sqlite")}`, AUTH_SECRET: "smoke", AUTH_TRUST_HOST: "true", SITE_URL: "http://localhost" };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: app, env, stdio: "pipe" });
  if (prepare) await prepare(env);
  const port = await freePort();
  const child = spawn("npx", ["next", "start", "-p", String(port)], { cwd: app, env, stdio: "pipe", detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  return { base, data, env, log: () => log, stop: () => { try { process.kill(-child.pid); } catch { /* déjà arrêté */ } } };
}
const q = (env, code) => execFileSync(process.execPath, ["-e", code], { cwd: app, env, encoding: "utf8" }).trim();

// ── 2. installation neuve ──
{
  const s = await boot("fresh");
  try {
    const res = await fetch(`${s.base}/admin/setup`);
    const html = await res.text();
    check(res.status === 200, "installation neuve : l'assistant répond (200)");
    for (const id of ["blog", "links", "pages"]) check(html.includes(`value="${id}"`), `installation neuve : le module suggéré « ${id} » est proposé (lu dans extras/)`);
    check(html.includes("sans aucun risque") || html.includes("without any risk"), "installation neuve : l'étape des modules dit qu'on peut la passer sans risque");
    check(!/Application error|Internal Server Error/.test(html), "installation neuve : pas d'erreur côté serveur");
  } finally { s.stop(); }
}

// ── 3. mise à jour d'un site existant (modules « intégrés » d'avant) ──
{
  const ids = ["blog", "links", "hero", "pages"];
  const s = await boot("upgrade", async (env) => {
    q(env, `
      const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient();
      (async () => {
        await p.user.create({ data: { email: "o@example.org", name: "O", role: "owner", passwordHash: "x" } });
        await p.setting.create({ data: { key: "setup.completed", locale: "", value: "true" } });
        await p.setting.create({ data: { key: "site.name", locale: "", value: JSON.stringify("Site d'avant") } });
        for (const id of ${JSON.stringify(ids)}) await p.module.create({ data: { id, source: "builtin", version: "0.1.2", enabled: true } });
        await p.moduleInstance.create({ data: { moduleId: "blog", key: "actus", basePath: "actus" } });
        await p.$disconnect();
      })();`);
  });
  try {
    const res = await fetch(`${s.base}/`);
    const html = await res.text();
    check(res.status === 200, "mise à jour : le site d'avant répond (200)");
    check(html.includes("Site d&#x27;avant") || html.includes("Site d'avant"), "mise à jour : le nom du site est affiché");
    const rows = JSON.parse(q(s.env, `const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient(); p.module.findMany().then((r) => console.log(JSON.stringify(r.map((m) => [m.id, m.source])))).finally(() => p.$disconnect())`));
    check(rows.length === ids.length && rows.every(([, src]) => src === "bundled"), `mise à jour : les ${ids.length} modules intégrés sont devenus des modules ordinaires`);
    check(ids.every((id) => fs.existsSync(path.join(s.data, "modules", id, "module.json"))), "mise à jour : leurs fichiers sont copiés depuis extras/");
    const n = q(s.env, `const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient(); p.moduleInstance.count().then(console.log).finally(() => p.$disconnect())`);
    check(n === "1", "mise à jour : l'instance existante est intacte");
    const blog = await fetch(`${s.base}/actus`);
    check(blog.status === 200, "mise à jour : la page publique du module (/actus) répond");
  } finally { s.stop(); }
}

fs.rmSync(root, { recursive: true, force: true });
if (failed) { console.error(`\n${failed} vérification(s) en échec : l'archive n'est pas publiable.`); process.exit(1); }
console.log("\nArchive validée.");
process.exit(0);
