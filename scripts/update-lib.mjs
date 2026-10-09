// Application d'une mise à jour du framework — exécutable seul (Node, aucune dépendance), appelé en tâche détachée par l'admin.
//
// Une release est une ARCHIVE DÉJÀ COMPILÉE (voir scripts/release-pack.mjs et .github/workflows/release.yml) : l'instance ne compile
// rien. Étapes : verrou → vérifications → sauvegarde de la base → téléchargement → empreinte → extraction → bascule des dossiers
// → migrations → redémarrage. Au moindre échec après la bascule : retour à la version précédente (et à la base sauvegardée si les
// migrations avaient commencé). Le téléchargement et les commandes passent par `download` et `exec` (injectables, pour les tests).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TAG_RE = /^v?\d+\.\d+\.\d+(-rc\.\d+)?$/; // stable ou release candidate (le choix du canal se fait côté admin)
export const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const STALE_LOCK_MS = 60 * 60_000;
const KEEP_BACKUPS = 5;
const STAGING = ".curiosa-staging";
const PREVIOUS = ".curiosa-previous";
/** Ce que l'archive n'a jamais le droit de remplacer : les données de l'exploitant. */
const PROTECTED = new Set(["data", ".env", ".git", STAGING, PREVIOUS]);

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

export const platformId = () => `${process.platform}-${process.arch}`;
export const assetName = (tag, platform = platformId()) => `curiosa-${tag}-${platform}.tar.gz`;
export const assetUrl = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

/** Chemin du fichier SQLite d'une DATABASE_URL `file:` (relatif = relatif au dossier prisma/, comme Prisma). */
export function resolveSqlitePath(databaseUrl, appDir) {
  const m = /^file:(.+)$/.exec(String(databaseUrl ?? ""));
  if (!m) return null;
  const p = m[1].split("?")[0];
  return path.isAbsolute(p) ? p : path.resolve(appDir, "prisma", p);
}

export function readState(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "update", "state.json"), "utf8")); } catch { return { status: "idle" }; }
}

/** `release.json` d'une installation ou d'une archive ; null si absent ou illisible (= pas une installation par archive). */
export function readRelease(dir) {
  try { const r = JSON.parse(fs.readFileSync(path.join(dir, "release.json"), "utf8")); return r && typeof r === "object" ? r : null; } catch { return null; }
}

/** Les chemins que l'archive déclare remplacer : relatifs, sans `..`, hors données de l'exploitant. */
export function validManifestPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 50) return null;
  for (const p of paths) {
    if (typeof p !== "string" || !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(p)) return null;
    const parts = p.split("/");
    if (parts.some((s) => s === ".." || s === ".")) return null;
    if (PROTECTED.has(parts[0]) || p === "prisma/data" || p.startsWith("prisma/data/")) return null;
  }
  return paths.includes("release.json") ? paths : null;
}

/** Entrée d'archive acceptable : relative, sans `..`. */
export function safeEntry(name) {
  const n = String(name).replace(/^\.\//, "");
  return n !== "" && !n.startsWith("/") && !n.split("/").includes("..") && !/[\0\n]/.test(n);
}

async function sha256(file) {
  const h = crypto.createHash("sha256");
  await new Promise((res, rej) => fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", res).on("error", rej));
  return h.digest("hex");
}

/**
 * @param {object} o
 * @param {string} o.appDir      racine de l'installation
 * @param {string} o.dataDir     dossier de données (état, journal, sauvegardes)
 * @param {string} o.tag         version cible (vX.Y.Z)
 * @param {(cmd:string,args:string[],opts?:{cwd?:string,env?:object})=>Promise<{stdout:string}>} o.exec  exécute une commande (rejette si code ≠ 0)
 * @param {(url:string,dest:string)=>Promise<void>} o.download  télécharge une URL https vers un fichier (rejette en cas d'erreur)
 * @param {string} [o.repo]              dépôt des releases « propriétaire/nom » (défaut : celui de release.json)
 * @param {string} [o.platform]
 * @param {string} [o.databaseUrl]
 * @param {string} [o.restartCommand]    commande de redémarrage choisie par l'exploitant
 * @param {number} [o.serverPid]         processus à arrêter si l'installation est supervisée
 * @param {boolean} [o.supervised]
 * @param {() => number} [o.now]
 * @param {{index:number,total:number,steps:string[]}} [o.chain]  étape d'une mise à jour en plusieurs versions (voir runUpdateChain)
 * @param {boolean} [o.last]     faux : une étape suit, le statut reste « en cours » après celle-ci
 * @param {boolean} [o.resume]   étape suivante d'une même mise à jour : le verrou posé par l'étape précédente n'est pas un conflit
 */
export async function runUpdate(o) {
  const { appDir, dataDir, tag, exec, download, databaseUrl, platform = platformId(), restartCommand, serverPid, supervised = false, now = Date.now } = o;
  const dir = path.join(dataDir, "update");
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, "update.log");
  const log = (line) => fs.appendFileSync(logFile, `[${new Date(now()).toISOString()}] ${line}\n`);
  const state = { status: "running", target: tag, chain: o.chain ?? null, from: null, step: "starting", startedAt: now(), finishedAt: null, error: null, rolledBack: false, restart: "none" };
  const save = (patch = {}) => { Object.assign(state, patch); fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2)); };
  const run = async (step, cmd, args, extraEnv) => {
    save({ step });
    log(`$ ${cmd} ${args.join(" ")}`);
    const r = await exec(cmd, args, { cwd: appDir, env: extraEnv });
    if (r?.stdout) log(String(r.stdout).trim().split("\n").slice(-5).join("\n"));
    return r;
  };

  // 1. verrou et vérifications — rien n'est touché tant qu'elles ne passent pas
  const previous = readState(dataDir);
  if (!o.resume && previous.status === "running" && now() - (previous.startedAt ?? 0) < STALE_LOCK_MS) return { ok: false, error: "already-running" };
  if (!TAG_RE.test(String(tag))) { save({ status: "failed", error: "invalid-tag", finishedAt: now() }); return { ok: false, error: "invalid-tag" }; }
  log(`=== mise à jour vers ${tag} ===`);
  save({});
  const fail = async (error, extra = {}) => { log(`✘ ${error}`); save({ status: "failed", error, finishedAt: now(), ...extra }); return { ok: false, error }; };

  const current = readRelease(appDir);
  if (!current) return fail("not-a-release-install");
  const repo = o.repo ?? current.repo;
  if (!REPO_RE.test(String(repo ?? ""))) return fail("no-release-source");
  save({ from: `v${String(current.version ?? "")}` });

  // 2. sauvegarde de la base (avant toute migration)
  let dbBackup = null, dbFile = null;
  try {
    dbFile = resolveSqlitePath(databaseUrl, appDir);
    if (dbFile && fs.existsSync(dbFile)) {
      save({ step: "backup" });
      const backups = path.join(dataDir, "backups");
      fs.mkdirSync(backups, { recursive: true });
      dbBackup = path.join(backups, `pre-update-${tag}-${now()}.db`);
      fs.copyFileSync(dbFile, dbBackup);
      log(`sauvegarde : ${dbBackup}`);
      for (const old of fs.readdirSync(backups).filter((f) => f.startsWith("pre-update-")).sort().slice(0, -KEEP_BACKUPS)) fs.rmSync(path.join(backups, old), { force: true });
    }
  } catch { return fail("backup-failed"); }

  // 3. téléchargement, vérification, extraction, bascule, migrations
  const staging = path.join(appDir, STAGING);
  const previousDir = path.join(appDir, PREVIOUS);
  const moved = []; // chemins basculés, pour pouvoir revenir en arrière
  let migrated = false;
  const cleanup = () => { fs.rmSync(staging, { recursive: true, force: true }); };
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(previousDir, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const name = assetName(tag, platform);
    const archive = path.join(staging, name);
    save({ step: "download" });
    log(`téléchargement : ${assetUrl(repo, tag, name)}`);
    await download(assetUrl(repo, tag, name), archive);
    await download(assetUrl(repo, tag, `${name}.sha256`), `${archive}.sha256`);

    save({ step: "verify" });
    const expected = /^[0-9a-f]{64}/i.exec(fs.readFileSync(`${archive}.sha256`, "utf8").trim())?.[0]?.toLowerCase();
    const actual = await sha256(archive);
    if (!expected || expected !== actual) throw Object.assign(new Error("empreinte différente de celle publiée"), { code: "checksum-mismatch" });
    const listing = (await exec("tar", ["-tzf", archive], { cwd: staging })).stdout.split("\n").filter(Boolean);
    if (listing.length === 0 || !listing.every(safeEntry)) throw Object.assign(new Error("archive contenant des chemins dangereux"), { code: "bad-archive" });

    const unpacked = path.join(staging, "release");
    fs.mkdirSync(unpacked);
    await run("extract", "tar", ["-xzf", archive, "-C", unpacked, "--no-same-owner"]);
    const next = readRelease(unpacked);
    const paths = validManifestPaths(next?.paths);
    if (!next || !paths || next.version !== tag.replace(/^v/, "") || next.platform !== platform) throw Object.assign(new Error("archive de la mauvaise version ou plateforme"), { code: "bad-archive" });
    for (const p of paths) if (!fs.existsSync(path.join(unpacked, p))) throw Object.assign(new Error(`absent de l'archive : ${p}`), { code: "bad-archive" });

    save({ step: "swap" });
    for (const p of paths) {
      const from = path.join(appDir, p), keep = path.join(previousDir, p), to = path.join(unpacked, p);
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      const had = fs.existsSync(from);
      if (had) fs.renameSync(from, keep);
      moved.push({ p, had });
      fs.mkdirSync(path.dirname(from), { recursive: true });
      fs.renameSync(to, from);
    }
    log(`${paths.length} éléments remplacés`);
    migrated = true;
    await run("migrate", "npx", ["prisma", "migrate", "deploy"]);
  } catch (e) {
    const reason = e?.code === "checksum-mismatch" || e?.code === "bad-archive" ? e.code : `step-failed:${state.step}`;
    log(`✘ échec à l'étape « ${state.step} » : ${String(e?.message ?? e).split("\n")[0]}`);
    let rollbackOk = true;
    if (moved.length) {
      try {
        save({ step: "rollback" });
        for (const { p, had } of moved.reverse()) {
          fs.rmSync(path.join(appDir, p), { recursive: true, force: true });
          if (had) fs.renameSync(path.join(previousDir, p), path.join(appDir, p));
        }
        if (migrated && dbBackup && dbFile) { const tmp = `${dbFile}.restore`; fs.copyFileSync(dbBackup, tmp); fs.renameSync(tmp, dbFile); log("base restaurée"); }
      } catch (x) { rollbackOk = false; log(`✘ retour arrière impossible : ${x?.message}`); }
    }
    cleanup();
    if (rollbackOk) fs.rmSync(previousDir, { recursive: true, force: true });
    // La base restaurée n'est pas celle que le serveur en cours tient ouverte : il doit redémarrer pour la relire.
    await restart(moved.length > 0 && migrated && !!dbBackup);
    return fail(reason, { rolledBack: moved.length > 0 && rollbackOk });
  }

  // 4. nettoyage et redémarrage
  cleanup();
  fs.rmSync(previousDir, { recursive: true, force: true });
  log(`✔ ${tag} installée`);
  await restart(true);
  if (o.last === false) save({ step: "between" }); // l'étape suivante reprend le même état « en cours »
  else save({ status: "success", step: "done", finishedAt: now() });
  return { ok: true };

  async function restart(wanted) {
    if (!wanted) return;
    if (restartCommand) {
      try { save({ restart: "command" }); await exec("sh", ["-c", restartCommand], { cwd: appDir }); log("redémarrage demandé (commande de l'exploitant)"); }
      catch (e) { save({ restart: "needed" }); log(`✘ commande de redémarrage en échec : ${e?.message}`); }
    } else if (supervised && serverPid) {
      try { process.kill(serverPid, "SIGTERM"); save({ restart: "signal" }); log("serveur arrêté : le superviseur le relance"); }
      catch (e) { save({ restart: "needed" }); log(`arrêt du serveur impossible : ${e?.message}`); }
    } else {
      save({ restart: "needed" });
      log("redémarrage manuel nécessaire (aucune commande de redémarrage configurée)");
    }
  }
}

/** Le serveur répond-il (de nouveau) ? Attend d'abord qu'il s'arrête (l'ancien peut répondre encore un instant), puis qu'il revienne. */
export async function waitForSite(url, { timeoutMs = 5 * 60_000, intervalMs = 2000, fetchImpl = fetch } = {}) {
  const up = async () => { try { return (await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) })).status < 500; } catch { return false; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const limit = Date.now() + timeoutMs;
  for (let i = 0; i < 10 && (await up()); i++) await sleep(intervalMs);
  while (Date.now() < limit) { if (await up()) return true; await sleep(intervalMs); }
  return false;
}

/**
 * Mise à jour vers `o.tag` en passant, si nécessaire, par les versions intermédiaires qu'elle exige (planUpdate) : chacune est téléchargée,
 * installée, puis le serveur redémarre et se relance AVANT l'étape suivante — c'est ce premier démarrage qui convertit les données d'avant.
 * Sans redémarrage automatique, on s'arrête après l'étape et le prochain « Installer » reprend (le chemin est recalculé depuis la nouvelle version).
 * Mêmes options que runUpdate, plus : `fetchText`, `waitForSite()` (booléen), `findServerPid()` (serveur actuel, pour un redémarrage supervisé).
 */
export async function runUpdateChain(o) {
  const { appDir, dataDir, tag, fetchText, waitForSite: wait, findServerPid, now = Date.now } = o;
  const current = readRelease(appDir);
  const repo = o.repo ?? current?.repo;
  let steps = [tag];
  if (current?.version && REPO_RE.test(String(repo ?? "")) && TAG_RE.test(String(tag))) {
    try { steps = await planUpdate({ current: current.version, target: tag, repo, fetchText }); }
    catch (e) {
      const dir = path.join(dataDir, "update");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "update.log"), `[${new Date(now()).toISOString()}] ✘ chemin de mise à jour introuvable : ${String(e?.message ?? e)}\n`);
      fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ status: "failed", target: tag, from: `v${current.version}`, step: "plan", error: "plan-failed", rolledBack: false, startedAt: now(), finishedAt: now() }, null, 2));
      return { ok: false, error: "plan-failed" };
    }
  }
  for (let i = 0; i < steps.length; i++) {
    const last = i === steps.length - 1;
    const r = await runUpdate({ ...o, tag: steps[i], last, resume: i > 0, chain: steps.length > 1 ? { index: i + 1, total: steps.length, steps } : null,
      // Après la première étape, le serveur n'est plus celui qui a lancé la mise à jour : on retrouve le nouveau.
      serverPid: i > 0 ? findServerPid?.() : o.serverPid });
    if (!r.ok || last) return r;
    const st = readState(dataDir);
    const file = path.join(dataDir, "update", "state.json");
    if (st.restart === "needed") {
      fs.writeFileSync(file, JSON.stringify({ ...st, status: "success", step: "done", target: steps[i], remaining: steps.slice(i + 1), finishedAt: now() }, null, 2));
      return { ok: true, partial: true, remaining: steps.slice(i + 1) };
    }
    if (!(await wait())) {
      fs.writeFileSync(file, JSON.stringify({ ...st, status: "failed", error: "site-not-back", finishedAt: now() }, null, 2));
      return { ok: false, error: "site-not-back" };
    }
  }
}
