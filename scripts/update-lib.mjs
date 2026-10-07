// Application d'une mise à jour du framework — exécutable seul (Node, aucune dépendance), appelé en tâche détachée par l'admin.
//
// Étapes : verrou → vérifications → sauvegarde de la base → récupération de la version → dépendances → migrations → build →
// redémarrage. Au moindre échec après la bascule : retour à la version précédente (et à la base sauvegardée si les migrations
// avaient commencé), puis redémarrage si nécessaire. Rien n'est supposé de l'environnement : les commandes passent par `exec`
// (injectable, pour les tests) et le redémarrage par une commande que l'exploitant définit (VITRINE_RESTART_COMMAND).
import fs from "node:fs";
import path from "node:path";

export const TAG_RE = /^v?\d+\.\d+\.\d+$/;
const STALE_LOCK_MS = 60 * 60_000;
const KEEP_BACKUPS = 5;

/** Chemin du fichier SQLite d'une DATABASE_URL `file:` (relatif = relatif au dossier prisma/, comme Prisma). */
export function resolveSqlitePath(databaseUrl, appDir) {
  const m = /^file:(.+)$/.exec(String(databaseUrl ?? ""));
  if (!m) return null;
  const p = m[1].split("?")[0];
  return path.isAbsolute(p) ? p : path.resolve(appDir, "prisma", p);
}

/**
 * Empreinte des dépendances d'un `package.json` / `package-lock.json` : le numéro de version du projet lui-même est ignoré
 * (il change à chaque publication sans que les dépendances changent). Illisible → null (on considère alors que ça a changé).
 */
export function depsFingerprint(packageJson, lockfile) {
  try {
    const pkg = JSON.parse(packageJson);
    const lock = lockfile ? JSON.parse(lockfile) : null;
    if (lock) { delete lock.version; if (lock.packages?.[""]) delete lock.packages[""].version; if (lock.name) delete lock.name; if (lock.packages?.[""]?.name) delete lock.packages[""].name; }
    return JSON.stringify({ d: pkg.dependencies ?? {}, dev: pkg.devDependencies ?? {}, o: pkg.overrides ?? {}, lock });
  } catch { return null; }
}

export function readState(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "update", "state.json"), "utf8")); } catch { return { status: "idle" }; }
}

/**
 * @param {object} o
 * @param {string} o.appDir      racine du dépôt installé
 * @param {string} o.dataDir     dossier de données (état, journal, sauvegardes)
 * @param {string} o.tag         version cible (vX.Y.Z)
 * @param {(cmd:string,args:string[],opts?:{cwd?:string,env?:object})=>Promise<{stdout:string}>} o.exec  exécute une commande (rejette si code ≠ 0)
 * @param {string} [o.databaseUrl]
 * @param {string} [o.remote]            remote git à interroger (défaut « origin »)
 * @param {string} [o.restartCommand]    commande de redémarrage choisie par l'exploitant
 * @param {number} [o.serverPid]         processus à arrêter si l'installation est supervisée
 * @param {boolean} [o.supervised]
 * @param {() => number} [o.now]
 */
export async function runUpdate(o) {
  const { appDir, dataDir, tag, exec, databaseUrl, remote = "origin", restartCommand, serverPid, supervised = false, now = Date.now } = o;
  const dir = path.join(dataDir, "update");
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, "update.log");
  const log = (line) => fs.appendFileSync(logFile, `[${new Date(now()).toISOString()}] ${line}\n`);
  const state = { status: "running", target: tag, from: null, step: "starting", startedAt: now(), finishedAt: null, error: null, rolledBack: false, restart: "none" };
  const save = (patch = {}) => { Object.assign(state, patch); fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2)); };
  const git = (...args) => exec("git", args, { cwd: appDir });
  const run = async (step, cmd, args, extraEnv) => {
    save({ step });
    log(`$ ${cmd} ${args.join(" ")}`);
    const r = await exec(cmd, args, { cwd: appDir, env: extraEnv });
    if (r?.stdout) log(String(r.stdout).trim().split("\n").slice(-5).join("\n"));
    return r;
  };

  // 1. verrou et vérifications — rien n'est touché tant qu'elles ne passent pas
  const previous = readState(dataDir);
  if (previous.status === "running" && now() - (previous.startedAt ?? 0) < STALE_LOCK_MS) return { ok: false, error: "already-running" };
  if (!TAG_RE.test(String(tag))) { save({ status: "failed", error: "invalid-tag", finishedAt: now() }); return { ok: false, error: "invalid-tag" }; }
  log(`=== mise à jour vers ${tag} ===`);
  save({});

  const fail = async (error, extra = {}) => { log(`✘ ${error}`); save({ status: "failed", error, finishedAt: now(), ...extra }); return { ok: false, error }; };

  let prevCommit, prevRef, dbBackup = null, dbFile = null;
  try {
    save({ step: "preflight" });
    const dirty = (await git("status", "--porcelain")).stdout.trim();
    if (dirty) return fail("local-changes");
    prevCommit = (await git("rev-parse", "HEAD")).stdout.trim();
    prevRef = await git("symbolic-ref", "-q", "--short", "HEAD").then((r) => r.stdout.trim(), () => "");
    save({ from: prevCommit.slice(0, 12) });
  } catch { return fail("not-a-git-install"); }

  // 2. sauvegarde de la base (avant toute migration)
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

  // 3. récupération de la version demandée
  let switched = false, migrated = false, depsChanged = false;
  try {
    await run("fetch", "git", ["fetch", "--tags", "--force", remote]);
    await git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`).catch(() => { throw Object.assign(new Error("unknown-tag"), { code: "unknown-tag" }); });
    await run("checkout", "git", ["-c", "advice.detachedHead=false", "checkout", "--detach", `refs/tags/${tag}`]);
    switched = true;
    // `npm ci` vide node_modules pendant que le site tourne : on ne réinstalle que si les dépendances (ou le schéma de base) ont changé.
    const show = async (ref, file) => (await git("show", `${ref}:${file}`)).stdout;
    const fingerprint = async (ref) => depsFingerprint(await show(ref, "package.json").catch(() => ""), await show(ref, "package-lock.json").catch(() => ""));
    const [before, after] = [await fingerprint(prevCommit), await fingerprint("HEAD")];
    depsChanged = before === null || after === null || before !== after;
    const schemaChanged = (await git("diff", "--name-only", prevCommit, "HEAD", "--", "prisma/schema.prisma")).stdout.trim() !== "";
    log(`dépendances ${depsChanged ? "modifiées : réinstallation" : "inchangées : pas de réinstallation"}`);
    if (depsChanged) await run("install", "npm", ["ci", "--include=dev"]);
    if (depsChanged || schemaChanged) await run("generate", "npx", ["prisma", "generate"]);
    migrated = true;
    await run("migrate", "npx", ["prisma", "migrate", "deploy"]);
    await run("build", "npm", ["run", "build"]);
  } catch (e) {
    const reason = e?.code === "unknown-tag" ? "unknown-tag" : `step-failed:${state.step}`;
    log(`✘ échec à l'étape « ${state.step} » : ${String(e?.message ?? e).split("\n")[0]}`);
    // Retour arrière : code précédent, base précédente si les migrations avaient pu la toucher, build précédent.
    let rollbackOk = true;
    if (switched) {
      try {
        save({ step: "rollback" });
        await git("-c", "advice.detachedHead=false", "checkout", ...(prevRef ? [prevRef] : ["--detach", prevCommit]));
        if (migrated && dbBackup && dbFile) { const tmp = `${dbFile}.restore`; fs.copyFileSync(dbBackup, tmp); fs.renameSync(tmp, dbFile); log("base restaurée"); }
        if (depsChanged) await exec("npm", ["ci", "--include=dev"], { cwd: appDir }).catch((x) => { rollbackOk = false; log(`rollback npm ci : ${x?.message}`); });
        await exec("npx", ["prisma", "generate"], { cwd: appDir }).catch(() => {});
        await exec("npm", ["run", "build"], { cwd: appDir }).catch((x) => { rollbackOk = false; log(`rollback build : ${x?.message}`); });
      } catch (x) { rollbackOk = false; log(`✘ retour arrière impossible : ${x?.message}`); }
    }
    // La base restaurée n'est pas celle que le serveur en cours tient ouverte : il doit redémarrer pour la relire.
    const needsRestart = switched && migrated && !!dbBackup;
    await restart(needsRestart);
    return fail(reason, { rolledBack: switched && rollbackOk });
  }

  // 4. redémarrage
  log(`✔ ${tag} installée`);
  await restart(true);
  save({ status: "success", step: "done", finishedAt: now() });
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
