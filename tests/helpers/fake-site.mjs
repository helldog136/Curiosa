// Faux site Next pour les tests de mise à jour : de VRAIS processus, un vrai port, de vrais signaux — seul « next » est une petite imitation.
//  - bin/next            : serveur HTTP qui lit la version dans package.json AU DÉMARRAGE (comme un vrai serveur qui garde ses fichiers en mémoire) ;
//  - npm-cli.js          : enveloppe `npm exec next …` qui lance `sh -c next …` (l'arborescence à trois processus de l'incident) ;
//  - supervisor.cjs      : joue le rôle de systemd (`Restart=always`, délai réglable) ou de pm2 (délai 0) ; délai négatif = ne relance jamais.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const NEXT = `
const http = require("node:http"), fs = require("node:fs"), crypto = require("node:crypto");
const port = Number(process.argv[process.argv.indexOf("-p") + 1]);
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const hash = crypto.createHash("sha256").update("curiosa:" + version).digest("hex").slice(0, 16);
const server = http.createServer((req, res) => {
  if (req.url === "/api/health") { res.writeHead(200, { "x-curiosa-version": hash }); return res.end("ok"); }
  if (process.env.FAKE_HOME_500 === "1") { res.writeHead(500); return res.end("Internal Server Error"); }
  res.writeHead(200); res.end("home " + version);
});
server.on("error", (e) => { console.error(e.code); process.exit(1); });
setTimeout(() => server.listen(port, "127.0.0.1"), Number(process.env.FAKE_START_MS || 0));
let stopping = false;
process.on("SIGTERM", () => {
  if (stopping) return; stopping = true;
  setTimeout(() => { server.close(); server.closeAllConnections?.(); setTimeout(() => process.exit(0), Number(process.env.FAKE_STOP_MS || 0)); }, Number(process.env.FAKE_IGNORE_TERM_MS || 0));
});
setInterval(() => {}, 1000);
`;
const NPM = `
const { spawn } = require("node:child_process");
const port = process.argv[process.argv.indexOf("-p") + 1];
const unit = process.argv.find((a) => a.startsWith("--unit=")) || "";
const child = spawn("sh", ["-c", "node bin/next start -p " + port + " " + unit + "; exit $?"], { stdio: "inherit" });
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => child.kill(s));
child.on("exit", (code) => process.exit(code ?? 0));
`;
const SUPERVISOR = `
const { spawn } = require("node:child_process");
const [delay, cwd, cmd, ...args] = process.argv.slice(2);
let child, stopping = false;
const start = () => {
  child = spawn(cmd, args, { cwd, stdio: "ignore" });
  child.on("exit", () => { if (stopping) return; if (Number(delay) < 0) process.exit(0); setTimeout(start, Number(delay)); });
};
process.on("SIGTERM", () => { stopping = true; child?.kill("SIGTERM"); setTimeout(() => process.exit(0), 300); });
start();
`;

export const hashVersion = (v) => crypto.createHash("sha256").update(`curiosa:${v}`).digest("hex").slice(0, 16);

export function installFakeSite(appDir) {
  fs.mkdirSync(path.join(appDir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "bin", "next"), NEXT);
  fs.writeFileSync(path.join(appDir, "npm-cli.js"), NPM);
}
const supervisorFile = (dir) => { const f = path.join(dir, "supervisor.cjs"); if (!fs.existsSync(f)) fs.writeFileSync(f, SUPERVISOR); return f; };

export const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/** Lance le site sous un superviseur. tree : "direct" (un processus), "sh" (sh -c + serveur), "npx" (npm exec + sh + serveur). */
export function startSupervised({ rootDir, appDir, port, delay = 1000, tree = "npx", env = {}, unit = "" }) {
  const mark = unit ? [`--unit=${unit}`] : [];
  const cmd = tree === "direct" ? ["node", "bin/next", "start", "-p", String(port), ...mark]
    : tree === "sh" ? ["sh", "-c", `node bin/next start -p ${port} ${mark.join(" ")}; exit $?`]
    : ["node", "npm-cli.js", "exec", "next", "start", "-p", String(port), ...mark];
  // Le superviseur est lancé par un intermédiaire qui disparaît aussitôt : il n'est PAS un descendant du test (comme un vrai systemd n'est pas
  // un descendant de la tâche de mise à jour), sinon le test serait lui-même protégé par la règle « ne jamais toucher à ce que l'outil a lancé ».
  const launcher = `const { spawn } = require("node:child_process"); const c = spawn(process.execPath, JSON.parse(process.env.FAKE_SUP), { cwd: ${JSON.stringify(rootDir)}, stdio: "ignore", detached: true }); console.log(c.pid); c.unref();`;
  const out = execFileSync(process.execPath, ["-e", launcher], { env: { ...process.env, ...env, FAKE_SUP: JSON.stringify([supervisorFile(rootDir), String(delay), appDir, ...cmd]) }, encoding: "utf8" });
  const pid = Number(out.trim());
  return { pid, stop: () => { try { process.kill(pid, "SIGKILL"); } catch { /* déjà parti */ } } };
}

export async function health(port, timeoutMs = 2000) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status, version: res.headers.get("x-curiosa-version") };
  } catch { return null; }
}
export async function until(fn, ms = 40_000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return null;
}

/** Tue TOUT ce que le test a lancé : les processus dont le dossier courant est sous `rootDir` (dossier temporaire du test, jamais autre chose). */
export function killAllUnder(rootDir, procs) {
  const real = fs.realpathSync(rootDir);
  for (const p of procs) if (p.cwd && (p.cwd === real || p.cwd.startsWith(real + path.sep)) && p.pid !== process.pid) { try { process.kill(p.pid, "SIGKILL"); } catch { /* parti */ } }
}
