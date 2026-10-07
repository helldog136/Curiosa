import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DATA_DIR } from "@/core/config";
import { audit } from "@/core/permissions";
import { getSetting, setSetting } from "@/core/settings";
import { classify, compareVersions, pickLatestTag, TAG_RE, type UpdateLevel } from "./versions";

/**
 * MISES À JOUR DU FRAMEWORK.
 *
 * Une installation est un dépôt git cloné sur le serveur. Une mise à jour = passer à la plus haute version stable (étiquette
 * `vX.Y.Z`) du dépôt d'où elle a été clonée, avec sauvegarde de la base, migrations et retour arrière automatique en cas d'échec
 * (scripts/update-lib.mjs). Rien n'est supposé du serveur : le redémarrage passe par une commande que l'exploitant définit.
 * La mise à jour AUTOMATIQUE est désactivée par défaut, et ne s'applique jamais à une version majeure.
 */
const run = promisify(execFile);
const REMOTE_RE = /^[A-Za-z0-9._-]{1,60}$/;

export type InstallMode = "git" | "docker" | "manual";
export type InstallInfo = {
  mode: InstallMode;
  /** Peut-on se mettre à jour depuis l'admin ? */
  canUpdate: boolean;
  version: string;
  commit: string | null;
  remote: string;
  /** Un redémarrage est-il prévu (commande de l'exploitant ou superviseur) ? Sinon l'admin demandera de redémarrer à la main. */
  restart: "command" | "supervised" | "manual";
};

export type UpdateCheck = { latest: string | null; level: UpdateLevel | null; available: boolean; checkedAt: number | null; error: string | null };
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

const defaultGit: GitRunner = async (args, cwd) => (await run("git", args, { cwd, timeout: 30_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, maxBuffer: 1024 * 1024 })).stdout;

export function readVersion(appDir = process.cwd()): string {
  try { return String(JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version ?? "0.0.0"); } catch { return "0.0.0"; }
}

export async function getInstallInfo(appDir = process.cwd(), git: GitRunner = defaultGit): Promise<InstallInfo> {
  const remote = REMOTE_RE.test(process.env.VITRINE_UPDATE_REMOTE ?? "") ? process.env.VITRINE_UPDATE_REMOTE! : "origin";
  const restart = process.env.VITRINE_RESTART_COMMAND ? "command" : process.env.VITRINE_SUPERVISED === "1" ? "supervised" : "manual";
  const base = { version: readVersion(appDir), remote, restart } as const;
  // Image Docker : on la remplace, on ne la met pas à jour en place.
  if (process.env.VITRINE_INSTALL === "docker") return { ...base, mode: "docker", canUpdate: false, commit: null };
  if (!fs.existsSync(path.join(appDir, ".git"))) return { ...base, mode: "manual", canUpdate: false, commit: null };
  try {
    const commit = (await git(["rev-parse", "--short=12", "HEAD"], appDir)).trim();
    await git(["remote", "get-url", remote], appDir);
    return { ...base, mode: "git", canUpdate: true, commit };
  } catch {
    return { ...base, mode: "manual", canUpdate: false, commit: null };
  }
}

const KEYS = { auto: "updates.auto", latest: "updates.latest", at: "updates.checkedAt", error: "updates.error" } as const;

/** Réglage « mise à jour automatique » — DÉSACTIVÉ tant que l'administrateur ne l'a pas activé. */
export async function isAutoUpdateEnabled(): Promise<boolean> {
  return (await getSetting<boolean>(KEYS.auto)) === true;
}
export async function setAutoUpdate(on: boolean): Promise<void> {
  await setSetting(KEYS.auto, on === true);
}

/** Dernier résultat de vérification (mémorisé : l'admin n'interroge pas le dépôt à chaque affichage). */
export async function getUpdateCheck(appDir = process.cwd()): Promise<UpdateCheck> {
  const latest = (await getSetting<string>(KEYS.latest)) || null;
  const current = readVersion(appDir);
  const level = latest ? classify(current, latest) : null;
  return { latest, level, available: level !== null, checkedAt: (await getSetting<number>(KEYS.at)) ?? null, error: (await getSetting<string>(KEYS.error)) || null };
}

/** Interroge le dépôt d'origine (étiquettes seulement : rien n'est téléchargé) et mémorise la plus haute version stable. */
export async function checkForUpdate(opts: { appDir?: string; git?: GitRunner; now?: () => number } = {}): Promise<UpdateCheck> {
  const { appDir = process.cwd(), git = defaultGit, now = Date.now } = opts;
  const info = await getInstallInfo(appDir, git);
  if (!info.canUpdate) return getUpdateCheck(appDir);
  try {
    const latest = pickLatestTag(await git(["ls-remote", "--tags", "--refs", info.remote], appDir)) ?? ((await getSetting<string>(KEYS.latest)) || null);
    await setSetting(KEYS.latest, latest ?? "");
    await setSetting(KEYS.error, "");
  } catch {
    await setSetting(KEYS.error, "unreachable");
  }
  await setSetting(KEYS.at, now());
  return getUpdateCheck(appDir);
}

export function readUpdateState(dataDir = DATA_DIR): { status: "idle" | "running" | "success" | "failed"; target?: string; from?: string; step?: string; error?: string | null; rolledBack?: boolean; restart?: string; startedAt?: number; finishedAt?: number | null } {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, "update", "state.json"), "utf8")); } catch { return { status: "idle" }; }
}

/** Fin du journal de la dernière mise à jour. */
export function readUpdateLog(lines = 40, dataDir = DATA_DIR): string {
  try { return fs.readFileSync(path.join(dataDir, "update", "update.log"), "utf8").trim().split("\n").slice(-lines).join("\n"); } catch { return ""; }
}

/** Faut-il appliquer d'office ? Seulement si l'administrateur a activé l'automatique, jamais pour une version majeure, jamais pendant une autre mise à jour. */
export function shouldAutoApply(p: { auto: boolean; level: UpdateLevel | null; running: boolean; canUpdate: boolean }): boolean {
  return p.auto === true && p.canUpdate && !p.running && (p.level === "minor" || p.level === "patch");
}

export type Spawner = (tag: string) => void;
const defaultSpawner: Spawner = (tag) => {
  const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "update.mjs"), tag], {
    cwd: process.cwd(), detached: true, stdio: "ignore",
    env: { ...process.env, VITRINE_SERVER_PID: String(process.pid) },
  });
  child.unref();
};

/** Lance la mise à jour en tâche détachée (elle survit à l'arrêt du serveur qu'elle provoque). */
export async function startUpdate(tag: string, actor: string, opts: { appDir?: string; git?: GitRunner; spawner?: Spawner; dataDir?: string } = {}): Promise<{ ok: true } | { ok: false; error: "invalid-tag" | "not-newer" | "unsupported" | "running" }> {
  const { appDir = process.cwd(), git = defaultGit, spawner = defaultSpawner, dataDir = DATA_DIR } = opts;
  if (!TAG_RE.test(tag)) return { ok: false, error: "invalid-tag" };
  const info = await getInstallInfo(appDir, git);
  if (!info.canUpdate) return { ok: false, error: "unsupported" };
  if (compareVersions(tag, info.version) <= 0) return { ok: false, error: "not-newer" };
  const state = readUpdateState(dataDir);
  if (state.status === "running" && Date.now() - (state.startedAt ?? 0) < 60 * 60_000) return { ok: false, error: "running" };
  await audit(actor, "update.start", tag);
  spawner(tag);
  return { ok: true };
}

/** Vérification périodique : met à jour la connaissance de la dernière version et, si l'automatique est activé, l'applique. */
export async function runScheduledCheck(opts: { appDir?: string; git?: GitRunner; spawner?: Spawner; dataDir?: string } = {}): Promise<"disabled" | "none" | "available" | "started"> {
  const { appDir = process.cwd() } = opts;
  const check = await checkForUpdate(opts);
  if (!check.available || !check.latest) return "none";
  const info = await getInstallInfo(appDir, opts.git);
  const running = readUpdateState(opts.dataDir).status === "running";
  if (!shouldAutoApply({ auto: await isAutoUpdateEnabled(), level: check.level, running, canUpdate: info.canUpdate })) return (await isAutoUpdateEnabled()) ? "available" : "disabled";
  return (await startUpdate(check.latest, "auto-update", opts)).ok ? "started" : "available";
}
