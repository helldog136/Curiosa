// Entrypoint of the Docker image (see Dockerfile). Plain Node: it runs before anything else exists.
//   1. started as root: give the data folder to PUID:PGID (default 1000:1000) and drop to that user; the site never runs as root.
//      started unprivileged (`user:` in compose): only check that the data folder is writable.
//   2. the SAME start-up executor as every other path (scripts/shared-lib.mjs, runStartup): data-version gate, database copy, migrations.
//   3. start the site (next start) and pass signals on, so `docker stop` is a clean shutdown.
// A refusal (data too old, or newer than the image) prints a plain explanation and exits non-zero without touching the data.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runStartup } from "./shared-lib.mjs";

const DEFAULT_ID = 1000;
const run = promisify(execFile);

/** PUID/PGID: whole numbers from 1 to 65534. 0 (root) is refused: the site must not run as root. Returns { uid, gid } or { error }. */
export function resolveIds(env = process.env) {
  const read = (name) => {
    const raw = String(env[name] ?? "").trim();
    if (raw === "") return DEFAULT_ID;
    return /^\d{1,5}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 65534 ? Number(raw) : null;
  };
  const uid = read("PUID"), gid = read("PGID");
  if (uid === null || gid === null) return { error: `PUID and PGID must be whole numbers from 1 to 65534 (got PUID=${env.PUID ?? ""} PGID=${env.PGID ?? ""}). Root (0) is not allowed: the site never runs as root.` };
  return { uid, gid };
}

/**
 * Makes the data folder usable by uid:gid. Only the top folder is checked first: when it already belongs to them nothing is walked
 * (a large uploads folder must not slow every start); otherwise everything below is handed over once.
 * `fsApi` is injectable for tests.
 */
export function prepareDataDir(dataDir, { uid, gid }, fsApi = fs) {
  fsApi.mkdirSync(dataDir, { recursive: true });
  const top = fsApi.statSync(dataDir);
  if (top.uid === uid && top.gid === gid) return { changed: 0 };
  let changed = 0;
  const walk = (p) => {
    fsApi.lchownSync(p, uid, gid); changed++;
    let st; try { st = fsApi.lstatSync(p); } catch { return; }
    if (st.isDirectory()) for (const name of fsApi.readdirSync(p)) walk(path.join(p, name));
  };
  walk(dataDir);
  return { changed };
}

/** Plain-words message when an unprivileged container cannot write to the data folder. */
export function notWritableMessage(dataDir, uid, gid) {
  return `The data folder ${dataDir} is not writable by user ${uid}:${gid}. Either start the container without \`user:\` (it then gives the folder to PUID:PGID itself), or run \`chown -R ${uid}:${gid}\` on the folder you mounted.`;
}

export function dropPrivileges({ uid, gid }, proc = process) {
  proc.setgroups?.([gid]);
  proc.setgid(gid);
  proc.setuid(uid);
}

function versionHere(appDir) {
  for (const f of ["release.json", "package.json"]) {
    try { const v = JSON.parse(fs.readFileSync(path.join(appDir, f), "utf8")).version; if (typeof v === "string") return v; } catch { /* next */ }
  }
  return "0.0.0";
}

/**
 * @param {{ env?: object, appDir?: string, getuid?: () => number, startup?: Function, spawnServer?: Function, drop?: Function, prepare?: Function, out?: (s: string) => void, err?: (s: string) => void, sleep?: (ms: number) => Promise<void> }} [o]
 * @returns {Promise<number>} the exit code (the server's, once it stops)
 */
export async function main(o = {}) {
  const env = o.env ?? process.env;
  const appDir = o.appDir ?? "/app";
  const dataDir = path.resolve(env.DATA_DIR || path.join(appDir, "data"));
  const err = o.err ?? ((s) => process.stderr.write(`${s}\n`));
  const uid0 = (o.getuid ?? (() => process.getuid?.() ?? 0))();
  let ids = { uid: uid0, gid: (o.getgid ?? (() => process.getgid?.() ?? 0))() };

  if (uid0 === 0) {
    const r = resolveIds(env);
    if (r.error) { err(r.error); return 1; }
    ids = r;
    try { (o.prepare ?? prepareDataDir)(dataDir, ids); (o.drop ?? dropPrivileges)(ids); }
    catch (e) { err(`Cannot give the data folder ${dataDir} to ${ids.uid}:${ids.gid} (${e?.code ?? e?.message}). If it is a network share, mount it with an owner that matches PUID/PGID.`); return 1; }
  } else {
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.accessSync(dataDir, fs.constants.W_OK); }
    catch { err(notWritableMessage(dataDir, ids.uid, ids.gid)); return 1; }
  }

  const version = versionHere(appDir);
  const result = await (o.startup ?? runStartup)({
    appDir, dataDir, version, databaseUrl: env.DATABASE_URL,
    prismaBin: "node_modules/prisma/build/index.js",
    exec: (cmd, args, opts) => run(cmd, args, { cwd: opts?.cwd ?? appDir, env, maxBuffer: 20 * 1024 * 1024, timeout: 30 * 60_000 }),
    // Refusals and failures (lines starting with ✘) go to stderr, the rest to stdout; each line once.
    log: (line) => (line.startsWith("✘") ? err : (o.out ?? ((s) => process.stdout.write(`${s}\n`))))(`[curiosa] ${line}`),
  });
  if (!result.ok) {
    // A restart policy would relaunch at once: wait a little so the log stays readable and the host is not hammered.
    await (o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(Number(env.CURIOSA_REFUSE_DELAY_SECONDS ?? 10) * 1000);
    return 1;
  }
  return (o.spawnServer ?? spawnServer)({ appDir, env });
}

/** `next start` as a child; SIGTERM/SIGINT are passed on and its exit code is ours. */
export function spawnServer({ appDir, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(appDir, "node_modules/next/dist/bin/next"), "start", "-H", "0.0.0.0", "-p", String(env.PORT || 3000)], { cwd: appDir, env, stdio: "inherit" });
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => child.kill(sig));
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 143 : 1)));
    child.on("error", () => resolve(1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
