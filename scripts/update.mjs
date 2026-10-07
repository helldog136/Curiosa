// Lancé en tâche détachée par l'admin (ou à la main : `node scripts/update.mjs v1.2.3`).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { runUpdate } from "./update-lib.mjs";

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

const result = await runUpdate({
  appDir,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(appDir, "data")),
  tag: process.argv[2],
  databaseUrl: process.env.DATABASE_URL,
  repo: process.env.VITRINE_UPDATE_REPO || undefined,
  restartCommand: process.env.VITRINE_RESTART_COMMAND || undefined,
  supervised: process.env.VITRINE_SUPERVISED === "1",
  serverPid: Number(process.env.VITRINE_SERVER_PID) || undefined,
  download,
  exec: (cmd, args, opts = {}) => run(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, maxBuffer: 20 * 1024 * 1024, timeout: 30 * 60_000 }),
});
process.exit(result.ok ? 0 : 1);
