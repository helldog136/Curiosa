import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/core/config";
import { audit } from "@/core/permissions";
import { getSetting, setSetting } from "@/core/settings";
import { classify, compareVersions, isPrerelease, pickLatestRelease, TAG_RC_RE, type UpdateChannel, type UpdateLevel } from "./versions";

/**
 * MISES À JOUR DU FRAMEWORK.
 *
 * Une release est une ARCHIVE DÉJÀ COMPILÉE, publiée par la CI du dépôt (étiquette `vX.Y.Z`) : l'instance la télécharge, vérifie son
 * empreinte, remplace ses dossiers, applique les migrations et revient en arrière toute seule en cas d'échec (scripts/update-lib.mjs).
 * Elle ne compile rien et n'a pas besoin de git. Le redémarrage passe par une commande que l'exploitant définit.
 * La mise à jour AUTOMATIQUE est désactivée par défaut, et ne s'applique jamais à une version majeure.
 */
const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const platformId = () => `${process.platform}-${process.arch}`;
const assetName = (tag: string) => `curiosa-${tag}-${platformId()}.tar.gz`;

export type InstallMode = "release" | "docker" | "manual";
export type InstallInfo = {
  mode: InstallMode;
  /** Peut-on se mettre à jour depuis l'admin ? */
  canUpdate: boolean;
  version: string;
  /** Dépôt qui publie les releases (« propriétaire/nom »). */
  repo: string | null;
  /** Un redémarrage est-il prévu (commande de l'exploitant ou superviseur) ? Sinon l'admin demandera de redémarrer à la main. */
  restart: "command" | "supervised" | "manual";
};

export type UpdateCheck = { channel: UpdateChannel; prerelease: boolean; latest: string | null; level: UpdateLevel | null; available: boolean; checkedAt: number | null; error: string | null };
/** Lit un JSON https (liste des releases). */
export type JsonFetcher = (url: string) => Promise<unknown>;

const defaultFetchJson: JsonFetcher = async (url) => {
  const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "curiosa-updater" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
};

export function readVersion(appDir = process.cwd()): string {
  try { return String(JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version ?? "0.0.0"); } catch { return "0.0.0"; }
}

/** `release.json` : écrit par la CI dans l'archive ; sa présence est ce qui désigne une installation mise à jour par archive. */
function readRelease(appDir: string): { repo?: string } | null {
  try { return JSON.parse(fs.readFileSync(path.join(appDir, "release.json"), "utf8")); } catch { return null; }
}

export function getInstallInfo(appDir = process.cwd()): InstallInfo {
  const release = readRelease(appDir);
  const configured = process.env.CURIOSA_UPDATE_REPO ?? "";
  const repo = REPO_RE.test(configured) ? configured : REPO_RE.test(release?.repo ?? "") ? release!.repo! : null;
  const restart = process.env.CURIOSA_RESTART_COMMAND ? "command" : process.env.CURIOSA_SUPERVISED === "1" ? "supervised" : "manual";
  const base = { version: readVersion(appDir), repo, restart } as const;
  // Image Docker : on la remplace, on ne la met pas à jour en place.
  if (process.env.CURIOSA_INSTALL === "docker") return { ...base, mode: "docker", canUpdate: false };
  if (!release || !repo) return { ...base, mode: "manual", canUpdate: false };
  return { ...base, mode: "release", canUpdate: true };
}

const KEYS = { channel: "updates.channel", auto: "updates.auto", latest: "updates.latest", at: "updates.checkedAt", error: "updates.error" } as const;

/** Canal de mise à jour : « stable » par défaut ; « rc » (release candidates) se choisit en mode avancé, à ses risques et périls. */
export async function getUpdateChannel(): Promise<UpdateChannel> {
  return (await getSetting<string>(KEYS.channel)) === "rc" ? "rc" : "stable";
}
export async function setUpdateChannel(channel: UpdateChannel): Promise<void> {
  await setSetting(KEYS.channel, channel === "rc" ? "rc" : "stable");
}

/** Réglage « mise à jour automatique » — DÉSACTIVÉ tant que l'administrateur ne l'a pas activé. */
export async function isAutoUpdateEnabled(): Promise<boolean> {
  return (await getSetting<boolean>(KEYS.auto)) === true;
}
export async function setAutoUpdate(on: boolean): Promise<void> {
  await setSetting(KEYS.auto, on === true);
}

/** Dernier résultat de vérification (mémorisé : l'admin n'interroge pas le dépôt à chaque affichage). */
export async function getUpdateCheck(appDir = process.cwd()): Promise<UpdateCheck> {
  const channel = await getUpdateChannel();
  let latest = (await getSetting<string>(KEYS.latest)) || null;
  // Dernière version connue à l'époque du canal « rc », alors qu'on est revenu sur « stable » : on ne la propose plus.
  if (latest && channel === "stable" && isPrerelease(latest)) latest = null;
  const current = readVersion(appDir);
  const level = latest ? classify(current, latest) : null;
  return { channel, prerelease: !!latest && isPrerelease(latest), latest, level, available: level !== null, checkedAt: (await getSetting<number>(KEYS.at)) ?? null, error: (await getSetting<string>(KEYS.error)) || null };
}

/** Interroge la liste des releases du dépôt (rien n'est téléchargé) et mémorise la plus haute version stable qui a son archive. */
export async function checkForUpdate(opts: { appDir?: string; fetchJson?: JsonFetcher; now?: () => number } = {}): Promise<UpdateCheck> {
  const { appDir = process.cwd(), fetchJson = defaultFetchJson, now = Date.now } = opts;
  const info = getInstallInfo(appDir);
  if (!info.canUpdate) return getUpdateCheck(appDir);
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${info.repo}/releases?per_page=30`);
    const latest = pickLatestRelease(releases, assetName, await getUpdateChannel()) ?? ((await getSetting<string>(KEYS.latest)) || null);
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

/** Faut-il appliquer d'office ? Seulement si l'administrateur a activé l'automatique, jamais pour une version majeure ni une release candidate, jamais pendant une autre mise à jour. */
export function shouldAutoApply(p: { auto: boolean; level: UpdateLevel | null; running: boolean; canUpdate: boolean; prerelease?: boolean }): boolean {
  return p.auto === true && p.prerelease !== true && p.canUpdate && !p.running && (p.level === "minor" || p.level === "patch");
}

export type Spawner = (tag: string) => void;
const defaultSpawner: Spawner = (tag) => {
  const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "update.mjs"), tag], {
    cwd: process.cwd(), detached: true, stdio: "ignore",
    env: { ...process.env, CURIOSA_SERVER_PID: String(process.pid) },
  });
  child.unref();
};

/** Lance la mise à jour en tâche détachée (elle survit à l'arrêt du serveur qu'elle provoque). */
export async function startUpdate(tag: string, actor: string, opts: { appDir?: string; fetchJson?: JsonFetcher; spawner?: Spawner; dataDir?: string } = {}): Promise<{ ok: true } | { ok: false; error: "invalid-tag" | "not-newer" | "unsupported" | "running" }> {
  const { appDir = process.cwd(), spawner = defaultSpawner, dataDir = DATA_DIR } = opts;
  if (!TAG_RC_RE.test(tag)) return { ok: false, error: "invalid-tag" };
  if (isPrerelease(tag) && (await getUpdateChannel()) !== "rc") return { ok: false, error: "invalid-tag" };
  const info = getInstallInfo(appDir);
  if (!info.canUpdate) return { ok: false, error: "unsupported" };
  if (compareVersions(tag, info.version) <= 0) return { ok: false, error: "not-newer" };
  const state = readUpdateState(dataDir);
  if (state.status === "running" && Date.now() - (state.startedAt ?? 0) < 60 * 60_000) return { ok: false, error: "running" };
  await audit(actor, "update.start", tag);
  spawner(tag);
  return { ok: true };
}

/** Vérification périodique : met à jour la connaissance de la dernière version et, si l'automatique est activé, l'applique. */
export async function runScheduledCheck(opts: { appDir?: string; fetchJson?: JsonFetcher; spawner?: Spawner; dataDir?: string } = {}): Promise<"disabled" | "none" | "available" | "started"> {
  const { appDir = process.cwd() } = opts;
  const check = await checkForUpdate(opts);
  if (!check.available || !check.latest) return "none";
  const info = getInstallInfo(appDir);
  const running = readUpdateState(opts.dataDir).status === "running";
  if (!shouldAutoApply({ auto: await isAutoUpdateEnabled(), level: check.level, running, canUpdate: info.canUpdate, prerelease: check.prerelease })) return (await isAutoUpdateEnabled()) ? "available" : "disabled";
  return (await startUpdate(check.latest, "auto-update", opts)).ok ? "started" : "available";
}
