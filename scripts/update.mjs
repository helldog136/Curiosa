// Lancé en tâche détachée par l'admin (ou à la main : `node scripts/update.mjs v1.2.3`).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { makeSiteWaiter, runUpdateChain } from "./update-lib.mjs";
import { detectHosting, explainHosting, findServerPid, resolveSitePort, systemProc, timeouts } from "./update-proc.mjs";

const run = promisify(execFile);
const appDir = process.cwd();
const MAX_BYTES = 700 * 1024 * 1024;

/** https uniquement, taille bornée, un seul chemin d'écriture : le fichier demandé. */
async function download(url, dest) {
  if (!/^https:\/\//.test(url)) throw new Error("https requis");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`téléchargement impossible (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("archive trop volumineuse");
  let size = 0;
  const limit = async function* (src) { for await (const c of src) { size += c.length; if (size > MAX_BYTES) throw new Error("archive trop volumineuse"); yield c; } };
  await pipeline(Readable.fromWeb(res.body), limit, fs.createWriteStream(dest));
}

/** Texte d'un fichier publié avec une release ; null s'il n'existe pas (404), erreur pour tout autre échec. */
async function fetchText(url) {
  if (!/^https:\/\//.test(url)) throw new Error("https requis");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lecture impossible (${res.status})`);
  return (await res.text()).slice(0, 10_000);
}

const sys = systemProc();
const serverPid = Number(process.env.CURIOSA_SERVER_PID) || undefined;
// Le port RÉEL du site (PORT, adresse de contrôle, ou port sur lequel le serveur écoute) : jamais un 3000 supposé quand deux sites partagent la machine.
const port = resolveSitePort({ env: process.env, sys, serverPid });
const readyUrl = process.env.CURIOSA_READY_URL || `http://127.0.0.1:${port}/`;
const tm = timeouts(process.env, sys.load());
const dataDir = path.resolve(process.env.DATA_DIR || path.join(appDir, "data"));
const supervised = process.env.CURIOSA_SUPERVISED === "1";
const waiter = makeSiteWaiter({ appDir, dataDir, readyUrl, port, sys, timeouts: tm });
const warnings = supervised ? detectHosting({ appDir, port, procs: sys.procs(), selfPid: process.pid, serverPid }).map(explainHosting) : [];

// Sous `KillMode=control-group`, systemd arrête aussi cette tâche quand l'ancien serveur s'arrête : on le note et on s'efface. Le nouveau serveur
// constate lui-même, à son démarrage, qu'il tourne sur la bonne version (voir reconcileInterruptedUpdate dans src/core/updates/service.ts).
for (const signal of ["SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    try { fs.appendFileSync(path.join(dataDir, "update", "update.log"), `[${new Date().toISOString()}] la tâche de mise à jour a été arrêtée avec le service (${signal}) : le nouveau serveur vérifiera lui-même sa version au démarrage\n`); } catch { /* journal indisponible */ }
    process.exit(0);
  });
}

const result = await runUpdateChain({
  fetchText, findServerPid: () => findServerPid({ appDir, port, sys }),
  waitForSite: waiter, confirmServer: waiter, sys, port, timeouts: tm, warnings,
  appDir, dataDir,
  tag: process.argv[2],
  databaseUrl: process.env.DATABASE_URL,
  repo: process.env.CURIOSA_UPDATE_REPO || undefined,
  restartCommand: process.env.CURIOSA_RESTART_COMMAND || undefined,
  supervised, serverPid,
  download,
  exec: (cmd, args, opts = {}) => run(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, maxBuffer: 20 * 1024 * 1024, timeout: 30 * 60_000 }),
});
process.exit(result.ok ? 0 : 1);
