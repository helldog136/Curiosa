// Code shared by every way a new version reaches a site: the in-place update of a bare-metal install (update-lib.mjs) and the start of a container
// (runStartup, called by the image entrypoint). Plain Node, no dependency, nothing about processes or ports: the site imports it too.
//
//   plan      planUpdate: which versions to pass through (read from upgrade.json files), compareVersions
//   data      backupDatabase / applyMigrations / restoreBackup, the data-version marker and its gate
//   start-up  runStartup: gate -> backup -> migrations (-> the server starts; its first start runs the module conversions)
import fs from "node:fs";
import path from "node:path";
import { BACKUP_PREFIX, DATA_VERSION_FILE, DOCKER_UPDATE_COMMAND, KEEP_BACKUPS, KEEP_PRE_UPDATE_BACKUPS, KEEP_START_BACKUPS, START_BACKUP_PREFIX, STARTUP_STATE_FILE, VERSION_ENV } from "./install-kind.mjs";

/* ───────────── Plan: the versions to pass through ───────────── */

/** Fichier publié avec chaque release (asset `upgrade.json`) : la plus ancienne version depuis laquelle elle s'installe directement. */
export const UPGRADE_FILE = "upgrade.json";
const PLAIN_VERSION_RE = /^\d+\.\d+\.\d+$/;
const MAX_STEPS = 6;

/** Compare deux versions stables « 1.2.3 » (ou « v1.2.3 ») ; une release candidate compte comme sa stable. */
export function compareVersions(a, b) {
  const n = (v) => String(v).replace(/^v/, "").replace(/-rc\.\d+$/, "").split(".").map(Number);
  const x = n(a), y = n(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export const assetUrl = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

/**
 * Par quelles versions passer pour atteindre `target` depuis `current` ? Chaque release peut déclarer (asset `upgrade.json`, {"minFrom":"0.1.4"})
 * la plus ancienne version depuis laquelle elle s'installe directement — typiquement parce qu'elle a retiré le code qui convertissait les données
 * d'avant. Le chemin se déduit en remontant : la cible exige 0.1.4, qui n'exige rien → [0.1.4, cible]. Rien exigé → [cible].
 * `fetchText(url)` renvoie le texte, null si le fichier n'existe pas (404) et rejette pour toute autre erreur : un réseau en panne ne doit jamais
 * faire croire qu'aucune étape n'est nécessaire.
 */
export async function planUpdate({ current, target, repo, fetchText }) {
  const minFrom = async (tag) => {
    const text = await fetchText(assetUrl(repo, tag, UPGRADE_FILE));
    if (text === null) return null;
    const need = JSON.parse(text)?.minFrom;
    if (need === undefined) return null;
    if (typeof need !== "string" || !PLAIN_VERSION_RE.test(need)) throw new Error("upgrade.json invalide");
    return need;
  };
  const steps = [target];
  let need = await minFrom(target);
  while (need && compareVersions(current, need) < 0) {
    // Une étape est toujours strictement plus ancienne que la suivante, et le chemin reste court : sinon, fichier incohérent.
    if (steps.length >= MAX_STEPS || compareVersions(need, steps[0]) >= 0) throw new Error("chemin de mise à jour incohérent");
    steps.unshift(`v${need}`);
    need = await minFrom(`v${need}`);
  }
  return steps;
}

/** Reads a small text file over https for planUpdate: null when it does not exist (404), an error for anything else. */
export async function fetchTextHttps(url) {
  if (!/^https:\/\//.test(url)) throw new Error("https required");
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "curiosa-updater" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`cannot read (${res.status})`);
  return (await res.text()).slice(0, 10_000);
}

/** Support floor of THIS code: `minFrom` of the `upgrade.json` shipped next to it; null when absent (no floor known). */
export function readFloor(appDir) {
  try {
    const need = JSON.parse(fs.readFileSync(path.join(appDir, UPGRADE_FILE), "utf8"))?.minFrom;
    return typeof need === "string" && PLAIN_VERSION_RE.test(need) ? need : null;
  } catch { return null; }
}

/* ───────────── Database: backup, migrations, restore ───────────── */

/** Chemin du fichier SQLite d'une DATABASE_URL `file:` (relatif = relatif au dossier prisma/, comme Prisma). */
export function resolveSqlitePath(databaseUrl, appDir) {
  const m = /^file:(.+)$/.exec(String(databaseUrl ?? ""));
  if (!m) return null;
  const p = m[1].split("?")[0];
  return path.isAbsolute(p) ? p : path.resolve(appDir, "prisma", p);
}

/**
 * Copies the database file to `<dataDir>/backups/<prefix><label>-<time>.db` (prefix `pre-update-` by default) and keeps the last `keep` (KEEP_BACKUPS) of that prefix. Returns the copy's path, or null when
 * there is no database file yet (fresh install: nothing to protect). Throws when the copy cannot be made: the caller must stop, never migrate without it.
 * @param {{ dbFile: string | null, dataDir: string, label: string, now?: () => number, keep?: number, beforeCopy?: () => void, log?: (line: string) => void }} o
 */
export function backupDatabase({ dbFile, dataDir, label, now = Date.now, keep = KEEP_BACKUPS, prefix = BACKUP_PREFIX, beforeCopy, log }) {
  if (!dbFile || !fs.existsSync(dbFile)) return null;
  beforeCopy?.();
  const backups = path.join(dataDir, "backups");
  fs.mkdirSync(backups, { recursive: true });
  const dbBackup = path.join(backups, `${prefix}${label}-${now()}.db`);
  fs.copyFileSync(dbFile, dbBackup);
  log?.(`sauvegarde : ${dbBackup}`);
  for (const old of fs.readdirSync(backups).filter((f) => f.startsWith(prefix)).sort().slice(0, -keep)) fs.rmSync(path.join(backups, old), { force: true });
  return dbBackup;
}

/** Puts a backup back over the live database (copy beside it, then rename: never a half-written file). */
export function restoreBackup(dbBackup, dbFile) {
  const tmp = `${dbFile}.restore`;
  fs.copyFileSync(dbBackup, tmp);
  fs.renameSync(tmp, dbFile);
}

/**
 * Applies the pending database migrations. `run(cmd, args)` executes a command and rejects on a non-zero exit.
 * Bare metal uses `npx prisma` (unchanged); the container passes `prismaBin` to call Prisma directly with node, without npx.
 */
export function applyMigrations(run, { prismaBin } = {}) {
  return prismaBin ? run("node", [prismaBin, "migrate", "deploy"]) : run("npx", ["prisma", "migrate", "deploy"]);
}

/* ───────────── Data-version marker and its gate ───────────── */

/** Last core version that started successfully on this data folder, or null (no marker, or unreadable). */
export function readDataVersion(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, DATA_VERSION_FILE), "utf8").trim();
    const v = raw.startsWith("{") ? JSON.parse(raw)?.version : raw;
    return typeof v === "string" && PLAIN_VERSION_RE.test(v.replace(/^v/, "").replace(/-rc\.\d+$/, "")) ? v.replace(/^v/, "") : null;
  } catch { return null; }
}

/** Records that `version` started successfully on this data folder (atomic write). Never throws: a read-only folder must not stop a site that runs. */
export function writeDataVersion(dataDir, version, now = Date.now) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, DATA_VERSION_FILE);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: String(version).replace(/^v/, ""), at: new Date(now()).toISOString() }) + "\n");
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/**
 * May this code start on this data? Refuses (without touching anything) when the data was last used by a version BELOW the floor of this code
 * (the conversions it needs were removed: go through the bridge first) or by a NEWER version (a downgrade: no down-migrations exist).
 * No marker = data from before the marker existed, or a fresh folder: allowed (`unknown` tells the caller there was data but no marker).
 * @returns {{ ok: true, marker: string | null, unknown: boolean } | { ok: false, code: "below-floor" | "newer-than-image", marker: string, floor: string | null, message: string }}
 */
export function checkDataVersion({ dataDir, version, floor, hasData = false }) {
  const marker = readDataVersion(dataDir);
  const v = String(version).replace(/^v/, "");
  if (marker === null) return { ok: true, marker: null, unknown: hasData };
  if (compareVersions(marker, v) > 0) {
    return { ok: false, code: "newer-than-image", marker, floor, message: `This data was last used by Curiosa ${marker}, a newer version than this one (${v}). Starting an older version on newer data could damage it, so nothing was changed. Use image version ${marker} or newer. To go back on purpose, restore the newest pre-update copy from the backups folder over the database, then delete the file ${DATA_VERSION_FILE} in the data folder.` };
  }
  if (floor && compareVersions(marker, floor) < 0) {
    return { ok: false, code: "below-floor", marker, floor, message: `This data was last used by Curiosa ${marker}. Version ${v} can only update data from ${floor} or newer, because the conversions of older data were removed. Nothing was changed. First start version ${floor} (${VERSION_ENV}=${floor} docker compose up -d), wait until the site answers, then come back to ${v} (${DOCKER_UPDATE_COMMAND}).` };
  }
  return { ok: true, marker, unknown: false };
}

/* ───────────── Start-up executor (container) ───────────── */

/** Timestamped journal shared with the in-place updater: `<dataDir>/update/update.log`. */
export function makeLog(dataDir, now = Date.now, echo) {
  const file = path.join(dataDir, "update", "update.log");
  return (line) => {
    echo?.(line);
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, `[${new Date(now()).toISOString()}] ${line}\n`); } catch { /* journal unavailable */ }
  };
}

/**
 * What a container does before the server starts: check the data-version marker, ALWAYS copy the database (even when no migration is pending; see the two kinds of copy below),
 * apply the migrations, and record the result in `data/update/startup.json`. The server itself runs the module conversions on its first start
 * (register() in src/instrumentation.ts) and writes the marker once they are done. A failed migration puts the copy back.
 * @param {{ appDir: string, dataDir: string, version: string, databaseUrl?: string, exec: (cmd: string, args: string[], opts?: object) => Promise<{ stdout?: string }>, prismaBin?: string, now?: () => number, log?: (line: string) => void }} o
 * @returns {Promise<{ ok: true, backup: string | null, marker: string | null } | { ok: false, error: "below-floor" | "newer-than-image" | "backup-failed" | "migrate-failed", message: string, backup?: string | null, restored?: boolean }>}
 */
export async function runStartup(o) {
  const { appDir, dataDir, version, databaseUrl, exec, prismaBin, now = Date.now } = o;
  const log = o.log ?? makeLog(dataDir, now);
  const stateFile = path.join(dataDir, "update", STARTUP_STATE_FILE);
  const record = (patch) => { try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ version, at: now(), ...patch }, null, 2)); } catch { /* state unavailable */ } };
  const refuse = (error, message, extra = {}) => { log(`✘ ${message}`); record({ status: "refused", error, message, ...extra }); return { ok: false, error, message, ...extra }; };

  log(`=== container start, version ${version} ===`);
  const dbFile = resolveSqlitePath(databaseUrl, appDir);
  const gate = checkDataVersion({ dataDir, version, floor: readFloor(appDir), hasData: !!dbFile && fs.existsSync(dbFile) });
  if (!gate.ok) return refuse(gate.code, gate.message);
  if (gate.unknown) log("data without a version marker (created before markers existed): starting anyway; the marker is written after a good start");

  // A copy is ALWAYS made, but not all copies are equal. When the data version changes (an update, so migrations may be pending) or is unknown, it is the
  // `pre-update-` copy: the last 3 are kept. A plain restart of the same version makes a `start-` copy: only the last 2 are kept. A restart loop can
  // therefore never push the copy taken before an update out of the folder.
  const pending = gate.marker === null || compareVersions(gate.marker, version) !== 0;
  const backupKind = pending ? "pre-update" : "start";
  let backup = null;
  try { backup = backupDatabase({ dbFile, dataDir, label: `v${version}`, now, log, prefix: pending ? BACKUP_PREFIX : START_BACKUP_PREFIX, keep: pending ? KEEP_PRE_UPDATE_BACKUPS : KEEP_START_BACKUPS }); }
  catch { return refuse("backup-failed", "The database copy could not be made (is the data folder full or read-only?). Nothing was changed."); }

  try {
    log(`$ ${prismaBin ? `node ${prismaBin}` : "npx prisma"} migrate deploy`);
    const r = await applyMigrations((cmd, args) => exec(cmd, args, { cwd: appDir }), { prismaBin });
    if (r?.stdout) log(String(r.stdout).trim().split("\n").slice(-5).join("\n"));
  } catch (e) {
    log(`✘ migration failed: ${String(e?.message ?? e).split("\n")[0]}`);
    // What the command printed is the only clue to WHY (permissions, a missing engine, a locked file…): keep its last lines in the journal.
    for (const part of [e?.stderr, e?.stdout]) { const tail = String(part ?? "").trim().split("\n").slice(-12).join("\n"); if (tail) log(tail); }
    let restored = false;
    if (backup && dbFile) { try { restoreBackup(backup, dbFile); restored = true; log("database restored from the copy made just before"); } catch (x) { log(`✘ could not restore the copy: ${x?.message}`); } }
    return refuse("migrate-failed", `The database could not be updated${restored ? " and was put back as it was" : ""}. ${backup ? `A copy is in ${backup}.` : ""}`.trim(), { backup, restored });
  }
  record({ status: "ok", backup, backupKind: backup ? backupKind : null, marker: gate.marker });
  log(`✔ migrations applied${backup ? `, copy kept in ${backup}` : ""}`);
  return { ok: true, backup, backupKind: backup ? backupKind : null, marker: gate.marker };
}
