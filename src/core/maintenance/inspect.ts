import fs from "node:fs";
import { DATA_DIR } from "@/core/config";
import { prisma } from "@/core/db";
import { classify, isPrerelease } from "@/core/updates/versions";
import { listInstances } from "@/core/instances";
import { dataStatusOf } from "@/core/modules/dataMigrations";
import { requirementGaps } from "@/core/modules/dependencies";
import { listModuleRows, loadModule, moduleDir } from "@/core/modules/registry";
import { readBlockedUpdate, type BlockedUpdate } from "@/core/modules/blockedUpdate";
import { staticImportsWarning } from "@/core/modules/staticImports";
import { languageLabel } from "@/core/i18n/audit.mjs";
import { i18nStatus } from "@/core/i18n/status";
import { moduleI18nReport, readModuleTexts } from "@/core/i18n/moduleStatus";
import { sourceKind } from "@/core/modules/reinstall";
import { getInstallInfo, getUpdateChannel, getUpdateCheck, readUpdateLog, readUpdateState, readVersion } from "@/core/updates/service";
import { compareVersions } from "@/core/updates/versions";
import type { ModulesReport } from "@/core/modules/bulkUpdate";
import { currentLock } from "./background";
import { deps } from "./deps";
import { within } from "./within";
import { contentSummary } from "./content/service";
import { publicRepo, redactSecrets, tailLines } from "./redact";

/**
 * LECTURES de la maintenance (niveau 1) : ce qu'une IA peut savoir de l'état du site. Rien ici ne modifie quoi que ce soit.
 * Chaque texte qui vient d'ailleurs (journal, message d'erreur, adresse de dépôt, notes de version) passe par le masquage des secrets et est borné.
 */
const MAX_MODULES = 100;
const MB = 1024 * 1024;
const BACKUP_RECENT_MS = 7 * 24 * 60 * 60_000;

const appDir = () => deps.appDir ?? process.cwd();
const dataDir = () => deps.dataDir ?? DATA_DIR;

/** Une mise à jour est-elle en cours (même règle que le lancement : « en cours » depuis moins d'une heure) ? */
export function updateRunning(): boolean {
  const s = readUpdateState(dataDir());
  return s.status === "running" && deps.now() - (s.startedAt ?? 0) < 60 * 60_000;
}

/** Une version stable `X.Y.Z` (jamais `-rc.N`, `dev-…` ni un commit). */
export const isStableVersion = (v: string | null | undefined): v is string => !!v && /^v?\d+\.\d+\.\d+$/.test(v);

export async function status() {
  const info = getInstallInfo(appDir());
  const state = readUpdateState(dataDir());
  const rows = await listModuleRows();
  return {
    core: { version: readVersion(appDir()), channel: await getUpdateChannel(), install: info.mode, canUpdateFromAdmin: info.canUpdate, restart: info.restart },
    runtime: { node: process.version, platform: `${process.platform}-${process.arch}`, uptimeSeconds: Math.round(process.uptime()) },
    modules: { installed: rows.length },
    update: {
      state: state.status,
      ...(state.target ? { target: redactSecrets(state.target, 40) } : {}),
      ...(state.step ? { step: redactSecrets(state.step, 60) } : {}),
      ...(state.error ? { error: redactSecrets(state.error, 200) } : {}),
      ...(state.rolledBack ? { rolledBack: true } : {}),
      ...(state.diagnostic ? { blocker: describeBlocker(state.diagnostic) } : {}),
    },
  };
}

/** Ce qui empêche le nouveau serveur de démarrer, en anglais pour l'assistant ; la phrase française complète est dans le journal de la mise à jour. */
export function describeBlocker(d: NonNullable<ReturnType<typeof readUpdateState>["diagnostic"]>): string {
  const who = d.manager === "pm2" ? `pm2${d.unit ? ` (${d.unit})` : ""}` : d.unit ?? "another service";
  const pid = d.pid ? `, process ${d.pid}` : "";
  const text = d.code === "other-manager" ? `Port ${d.port} is held by another process manager (${who}${pid}) that restarts the site before the new version. The owner must stop it (pm2 stop / systemctl disable --now), then restart the service. The new version is already installed.`
    : d.code === "other-site" ? `Port ${d.port} is held by another site on this server (${d.cwd}${pid}). The owner must change the port of one site, then restart the service.`
    : d.code === "other-program" ? `Port ${d.port} is held by another program on this server${pid}. The owner must stop it or change the site's port, then restart the service.`
    : d.code === "stuck" ? `The old server${pid} does not stop and still holds port ${d.port}. The owner must restart the service.`
    : `Port ${d.port} is held by a process that could not be inspected (probably another user). The owner must find it with "ss -ltnp", stop it, then restart the service.`;
  return redactSecrets(text, 400);
}

type DbCheck = { ok: boolean; sizeBytes: number | null; detail?: string };
async function checkDatabase(): Promise<DbCheck> {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    const rows = (await prisma.$queryRawUnsafe("PRAGMA quick_check(1)")) as { quick_check?: string }[];
    const verdict = String(rows?.[0]?.quick_check ?? "ok");
    let sizeBytes: number | null = null;
    const m = /^file:(.+)$/.exec(process.env.DATABASE_URL ?? "");
    if (m) { try { sizeBytes = fs.statSync(m[1]!.split("?")[0]!).size; } catch { /* chemin relatif à prisma/ : taille inconnue */ } }
    return verdict === "ok" ? { ok: true, sizeBytes } : { ok: false, sizeBytes, detail: redactSecrets(verdict, 200) };
  } catch (error) {
    return { ok: false, sizeBytes: null, detail: redactSecrets(error, 200) };
  }
}

function diskSpace(): { freeBytes: number; totalBytes: number; freePercent: number; level: "ok" | "low" | "critical" } | null {
  const d = deps.disk();
  if (!d) return null;
  const free = d.freeBytes, total = d.totalBytes;
  const freePercent = total ? Math.round((free / total) * 1000) / 10 : 0;
  return { freeBytes: free, totalBytes: total, freePercent, level: free < 300 * MB || (freePercent < 2 && free < 2048 * MB) ? "critical" : free < 1536 * MB || (freePercent < 8 && free < 10240 * MB) ? "low" : "ok" };
}

/** Dernière sauvegarde connue : un téléchargement de l'admin (`backup.create`) ou une copie faite par la maintenance. */
export async function lastBackup(): Promise<{ at: string | null; recent: boolean; by: "owner" | "ai" | null }> {
  const row = await prisma.auditLog.findFirst({
    where: { OR: [{ action: "backup.create" }, { action: "mcp.maintenance.backup_run", target: { startsWith: "ok" } }] },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return { at: null, recent: false, by: null };
  return { at: row.createdAt.toISOString(), recent: deps.now() - row.createdAt.getTime() < BACKUP_RECENT_MS, by: row.action === "backup.create" ? "owner" : "ai" };
}

/** Pannes connues, sans fichier arbitraire : l'échec de la dernière mise à jour, la fin de son journal, les instances mises à l'écart. */
export async function recentErrors(setAside?: SetAside[]): Promise<{ source: string; message: string }[]> {
  const out: { source: string; message: string }[] = [];
  const state = readUpdateState(dataDir());
  if (state.status === "failed") out.push({ source: "update", message: redactSecrets(`The last core update failed${state.step ? ` at step "${state.step}"` : ""}${state.error ? ` (${state.error})` : ""}${state.rolledBack ? "; the previous version was restored" : ""}.${state.diagnostic ? ` ${describeBlocker(state.diagnostic)}` : ""}`, 600) });
  for (const line of tailLines(readUpdateLog(60, dataDir()), { lines: 10, maxLine: 300, filter: /(error|fail|erreur|échec|✘|rollback)/i })) out.push({ source: "update-log", message: line });
  for (const i of setAside ?? (await instancesInError())) out.push({ source: `instance:${i.key}`, message: redactSecrets(`Set aside (${i.status})${i.error ? `: ${i.error}` : ""}`, 300) });
  return out.slice(0, 25);
}

type SetAside = { key: string; moduleId: string; status: string; error?: string };
async function instancesInError(): Promise<SetAside[]> {
  const all = await listInstances();
  const statuses = await Promise.all(all.map((i) => dataStatusOf(i.id)));
  const out: SetAside[] = [];
  all.forEach((i, n) => { const s = statuses[n]; if (s) out.push({ key: i.key, moduleId: i.moduleId, status: s.status, ...(s.error ? { error: redactSecrets(s.error, 200) } : {}) }); });
  return out;
}

export async function health() {
  const setAside = instancesInError();
  const [database, backup, errors, instances] = await Promise.all([checkDatabase(), lastBackup(), setAside.then((i) => recentErrors(i)), setAside]);
  return {
    disk: diskSpace() ?? { unknown: true },
    database,
    lastBackup: backup,
    instancesSetAside: instances.length,
    recentErrors: errors,
    updateRunning: updateRunning(),
  };
}

/**
 * Le coup d'œil du TABLEAU DE BORD : la base répond, le disque, les instances mises à l'écart, la dernière mise à jour. Aucun réseau, aucun module chargé, aucun fichier lu au-delà de la taille du disque ;
 * c'est `health()` sans la liste des erreurs récentes. Ne lève jamais.
 */
export async function glance(): Promise<{ databaseOk: boolean; disk: "ok" | "low" | "critical" | "unknown"; instancesSetAside: number; updateFailed: boolean; backup: { at: string | null; recent: boolean } }> {
  const [database, setAside, backup] = await Promise.all([checkDatabase(), instancesInError().catch(() => []), lastBackup().catch(() => ({ at: null, recent: false }))]);
  const disk = diskSpace();
  return { databaseOk: database.ok, disk: disk ? disk.level : "unknown", instancesSetAside: setAside.length, updateFailed: readUpdateState(dataDir()).status === "failed", backup: { at: backup.at, recent: backup.recent } };
}

/**
 * What is known about the module updates, WITHOUT letting a slow network hold the answer: the real check of every repository has `waitMs`; if it is not over, the last
 * report that was saved is used (marked `stale`, with the time it was made) while the check goes on in the background. No report at all: `report` is null.
 */
export type UpdateReport = { report: ModulesReport | null; stale: boolean };
export async function updateReport(waitMs: number): Promise<UpdateReport> {
  const got = await within(waitMs, () => deps.modulesReport(false));
  if (got.ok) return { report: got.value, stale: false };
  return { report: await deps.savedModulesReport().catch(() => null), stale: true };
}

/** `fn` on every item, `limit` at a time, in order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]!); }
  }));
  return out;
}

export type ModuleLine = {
  id: string; version: string; source: string; repository: string | null; ref: string | null;
  loadable: boolean;
  instances: { key: string; error?: string }[];
  missingDependencies: { service: string; neededVersion: number; availableVersion: number | null }[];
  update: { available: boolean; target?: string; level?: string; needsCore?: string; followsStableTag: boolean };
  /** Une mise à jour de ce module a été refusée par le contrôle de chargement : l'ancienne version tourne toujours (blockedUpdate.ts). */
  lastRefusedUpdate?: { at: string; stayedOn: string; refusedVersion: string; cause: string };
  /** Fichiers qui importent un voisin de façon statique (fragile sur un cœur avant 0.2.13 ; sans effet ici : chaque chargement part d'une copie neuve). */
  staticNeighbourImports?: string[];
  /** Translations: texts missing in English or French (0 = complete) and, per language, the share of the module's texts that exist. Other languages may be partial. */
  translations?: { missing: number; languages: Record<string, number>; examples?: string[] };
};

const refused = (b: BlockedUpdate | null, row: { version: string }): ModuleLine["lastRefusedUpdate"] =>
  b && b.to !== row.version ? { at: b.at, stayedOn: row.version, refusedVersion: b.to, cause: redactSecrets(b.reason, 200) } : undefined;

const isStableTagRef = (ref: string | null | undefined) => !!ref && /^v?\d+\.\d+\.\d+$/.test(ref);

/** Languages as the assistant reads them: status ("official" or "community"), coverage of the interface ("complete" or "partial: 82%") and of the installed modules. */
export type LanguageLine = { code: string; name: string; status: string; enabled: boolean; interface: string; modules: string };

export async function modules(opts: { updates?: UpdateReport } = {}): Promise<{ modules: ModuleLine[]; truncated: boolean; languages: LanguageLine[]; updatesCheckedAt: string | null; updatesStale?: true }> {
  const rows = await listModuleRows();
  const instances = await listInstances();
  const { report, stale } = opts.updates ?? (await updateReport(deps.checkTimeoutMs * 2));
  const lines: ModuleLine[] = await mapLimit(rows.slice(0, MAX_MODULES), 8, async (row) => {
    const mod = await loadModule(row).catch(() => null);
    const gaps = mod ? await requirementGaps(mod.manifest).catch(() => []) : [];
    const outdated = report?.outdated.find((o) => o.id === row.id);
    const mine = instances.filter((i) => i.moduleId === row.id);
    const lineInstances: ModuleLine["instances"] = [];
    for (const i of mine) { const s = await dataStatusOf(i.id); lineInstances.push({ key: i.key, ...(s ? { error: `${s.status}${s.error ? `: ${redactSecrets(s.error, 160)}` : ""}` } : {}) }); }
    const lastRefused = refused(await readBlockedUpdate(row.id), row);
    const neighbours = staticImportsWarning(moduleDir(row.id));
    const texts = readModuleTexts(moduleDir(row.id));
    const i18n = texts ? moduleI18nReport(texts.manifest, texts.locales) : null;
    return {
      ...(i18n ? { translations: { missing: i18n.errors, languages: i18n.languages, ...(i18n.errors ? { examples: i18n.gaps.slice(0, 5).map((g) => `${g.where} [${g.lang}] ${g.problem}`) } : {}) } } : {}),
      ...(lastRefused ? { lastRefusedUpdate: lastRefused } : {}), ...(neighbours ? { staticNeighbourImports: neighbours.files } : {}),
      id: row.id, version: row.version, source: sourceKind(row), repository: publicRepo(row.repoUrl), ref: row.ref ? redactSecrets(row.ref, 60) : null,
      loadable: !!mod, instances: lineInstances,
      missingDependencies: gaps.map((g) => ({ service: g.service, neededVersion: g.min, availableVersion: g.have })),
      update: { available: !!outdated, ...(outdated ? { target: outdated.target, level: outdated.level, ...(outdated.needsCore ? { needsCore: outdated.needsCore } : {}) } : {}), followsStableTag: row.source !== "git" || isStableTagRef(row.ref) },
    } satisfies ModuleLine;
  });
  const status = await i18nStatus().catch(() => null);
  const languages = (status?.languages ?? []).map((l): LanguageLine => ({ code: l.code, name: l.name, status: l.status, enabled: l.enabled, interface: l.interface.label, modules: languageLabel({ status: l.status, percent: l.modules.percent }).coverage }));
  return { modules: lines, truncated: rows.length > MAX_MODULES, languages, updatesCheckedAt: report ? new Date(report.checkedAt).toISOString() : null, ...(stale ? { updatesStale: true as const } : {}) };
}

export type UpdatesView = {
  core: { current: string; channel: string; canUpdateFromAdmin: boolean; latestStable: string | null; available: boolean; level?: string; notes?: string; note?: string };
  modules: { id: string; current: string; target: string; level?: string; needsCore?: string; aiCanUpdate: boolean; reason?: string; /** Cette version précise a déjà été essayée et refusée (elle ne se charge pas). */ alreadyRefused?: { at: string; cause: string } }[];
  unchecked: string[];
  checkedAt: string | null;
  /** The module data above comes from an older check (the new one was not over in time and goes on in the background). */
  stale?: true;
};

/** Pourquoi une IA ne peut pas mettre ce module à jour elle-même (undefined : elle peut, avec l'accord prévu). */
export function moduleUpdateRefusal(o: { ref: string | null | undefined; source: string; target: string; needsCore?: string }): string | undefined {
  if (o.needsCore) return `needs core ${o.needsCore} or newer: update the core first`;
  if (o.source === "git" && !isStableTagRef(o.ref)) return "this module follows a branch or a fixed commit, not stable release tags: only a human can update it";
  if (!isStableVersion(o.target) || isPrerelease(o.target)) return "the target is not a stable release (pre-releases and snapshots are never installed by an AI)";
  return undefined;
}

export async function updates(opts: { updates?: UpdateReport; waitMs?: number } = {}): Promise<UpdatesView> {
  const waitMs = opts.waitMs ?? deps.checkTimeoutMs * 2;
  const current = readVersion(appDir());
  const info = getInstallInfo(appDir());
  let core: UpdatesView["core"] = { current, channel: await getUpdateChannel(), canUpdateFromAdmin: info.canUpdate, latestStable: null, available: false };
  try {
    // The release list is a network read of up to 20 s: it has the same limit as the module check, and falls back to the last result the site saved.
    let latest: { tag: string; notes: string } | null = null;
    if (info.canUpdate) {
      const got = await within(waitMs, () => deps.latestStable());
      if (got.ok) latest = got.value;
      else if (got.reason === "timeout") {
        const saved = await getUpdateCheck(appDir()).catch(() => null);
        if (saved?.latest && isStableVersion(saved.latest)) latest = { tag: saved.latest, notes: saved.notes ?? "" };
        core.note = `the release list did not answer in time${latest ? ` (last known result from ${saved?.checkedAt ? new Date(saved.checkedAt).toISOString().slice(0, 16).replace("T", " ") : "an earlier check"})` : ""}`;
      } else throw got.error;
    }
    if (!info.canUpdate) core.note = "this installation cannot be updated from the admin (container image or manual install)";
    else if (!latest) core.note ??= "no stable release found (the release list may be unreachable)";
    else {
      const level = classify(current, latest.tag);
      core = { ...core, latestStable: latest.tag.replace(/^v/, ""), available: level !== null, ...(level ? { level, notes: redactSecrets(latest.notes.replace(/\s+/g, " "), 600) } : {}) };
      if (!level && compareVersions(latest.tag, current) <= 0) core.note = "already on the latest stable release (or newer: release candidates are never offered)";
    }
  } catch { core.note = "the release list could not be reached"; }

  const rows = new Map((await listModuleRows()).map((r) => [r.id, r]));
  const { report, stale } = opts.updates ?? (await updateReport(waitMs));
  const blocked = new Map<string, BlockedUpdate>();
  for (const o of report?.outdated ?? []) { const b = await readBlockedUpdate(o.id); if (b) blocked.set(o.id, b); }
  return {
    core,
    modules: (report?.outdated ?? []).map((o) => {
      const row = rows.get(o.id);
      const base = moduleUpdateRefusal({ ref: row?.ref, source: row?.source ?? "git", target: o.target, needsCore: o.needsCore });
      // Cette version précise a déjà été refusée (elle ne se charge pas) : la réessayer ne sert à rien tant que l'auteur n'en a pas publié une autre.
      const again = blocked.get(o.id);
      const alreadyRefused = again && again.to === o.target ? { at: again.at, cause: redactSecrets(again.reason, 200) } : undefined;
      const reason = base ?? (alreadyRefused ? `version ${o.target} was already tried on ${alreadyRefused.at.slice(0, 10)} and refused because it does not load on this site (${alreadyRefused.cause}): wait for a fixed version` : undefined);
      return { id: o.id, current: o.current, target: o.target, ...(o.level ? { level: o.level } : {}), ...(o.needsCore ? { needsCore: o.needsCore } : {}), aiCanUpdate: !reason, ...(reason ? { reason } : {}), ...(alreadyRefused ? { alreadyRefused } : {}) };
    }),
    unchecked: report?.unchecked ?? [],
    checkedAt: report ? new Date(report.checkedAt).toISOString() : null,
    ...(stale ? { stale: true as const } : {}),
  };
}

export type Problem = { severity: "critical" | "warning" | "info"; problem: string; probableCause: string; proposedAction: string; tool: string | null; needsHuman: boolean };

export type UnknownCheck = { check: string; reason: string };
const reasonOf = (r: { reason: "timeout" | "error" }, budget: number) => (r.reason === "timeout" ? `no answer within ${Math.round(budget / 1000)} s` : "the check failed");

/**
 * Rapport guidé : ce qui ne va pas, la cause probable, l'action proposée et l'outil qui la fait.
 * The independent checks run AT THE SAME TIME and each has `deps.checkTimeoutMs`: one that does not answer in time (a network read) is listed in `unknown` with the reason
 * and the others are still reported, so the call answers in about that time even right after a restart. The module updates come from the last saved check when the new one
 * is not over (`notes` says so); the new one goes on in the background.
 */
export async function diagnose() {
  const budget = deps.checkTimeoutMs;
  const unknown: UnknownCheck[] = [];
  const notes: string[] = [];
  const reportP = updateReport(budget);
  const [hr, mr, ur, cr] = await Promise.all([
    within(budget, () => health()),
    // These two wait for the report (which has its own `budget`, started at the same time) and then assemble their answer: they get the budget twice.
    within(budget * 2, async () => modules({ updates: await reportP })),
    within(budget * 2, async () => updates({ updates: await reportP, waitMs: budget })),
    within(budget, () => contentSummary()),
  ]);
  const h = hr.ok ? hr.value : null, mods = mr.ok ? mr.value : null, up = ur.ok ? ur.value : null, content = cr.ok ? cr.value : null;
  if (!hr.ok) unknown.push({ check: "health (database, disk, backups, recent errors)", reason: reasonOf(hr, budget) });
  if (!mr.ok) unknown.push({ check: "modules (loading, dependencies, set-aside instances)", reason: reasonOf(mr, budget) });
  if (!ur.ok) unknown.push({ check: "updates (core and modules)", reason: reasonOf(ur, budget) });
  if (!cr.ok) unknown.push({ check: "content check summary", reason: reasonOf(cr, budget) });
  if (up?.stale && up.checkedAt) notes.push(`Module updates come from the check of ${up.checkedAt.slice(0, 16).replace("T", " ")} UTC; a new check is running in the background (call maintenance_updates later).`);
  if (up?.stale && !up.checkedAt) unknown.push({ check: "module updates", reason: "no check has finished yet; it is running in the background (call maintenance_updates in a minute)" });
  if (up?.core.note?.startsWith("the release list did not answer")) notes.push(`Core release list: ${up.core.note}.`);

  const problems: Problem[] = [];
  const add = (p: Problem) => problems.push(p);

  if (h) {
    if (!h.database.ok) add({ severity: "critical", problem: "The database does not answer correctly.", probableCause: h.database.detail ?? "database file damaged or unreachable", proposedAction: "Tell the owner now. They can restore a backup from Admin > Backup (this needs their backup password: never ask for it).", tool: null, needsHuman: true });
    if ("level" in h.disk && h.disk.level !== "ok") add({ severity: h.disk.level === "critical" ? "critical" : "warning", problem: `Disk space is ${h.disk.level === "critical" ? "almost exhausted" : "running low"} (${Math.round(h.disk.freeBytes / 1048576)} MB free, ${h.disk.freePercent}%).`, probableCause: "uploads, old backups or logs are filling the disk", proposedAction: "Tell the owner: files must be cleaned on the server (you cannot delete files).", tool: null, needsHuman: true });
    if (!h.lastBackup.at) add({ severity: "warning", problem: "No backup has ever been made.", probableCause: "backups are manual", proposedAction: "Make a server-side copy of the database now.", tool: "maintenance_backup_run", needsHuman: false });
    else if (!h.lastBackup.recent) add({ severity: "warning", problem: `The last backup is old (${h.lastBackup.at.slice(0, 10)}).`, probableCause: "backups are manual", proposedAction: "Make a fresh copy of the database before any update.", tool: "maintenance_backup_run", needsHuman: false });
    if (h.updateRunning) add({ severity: "info", problem: "A core update is running.", probableCause: "an update was started recently", proposedAction: "Wait a few minutes, then call maintenance_status again. Do not start anything else meanwhile.", tool: "maintenance_status", needsHuman: false });
  }
  const state = readUpdateState(dataDir());
  if (state.status === "failed") add({ severity: "critical", problem: state.diagnostic ? "The last core update installed the new version but the site could not restart: its port is busy." : "The last core update failed.", probableCause: state.diagnostic ? describeBlocker(state.diagnostic) : redactSecrets(state.error ?? "unknown", 120), proposedAction: "Read the recent errors with maintenance_health, then tell the owner. Do not retry blindly.", tool: "maintenance_health", needsHuman: true });
  const lock = currentLock();
  if (lock) add({ severity: "info", problem: `A maintenance operation is running (${lock.name}).`, probableCause: "a long action was started and is still working", proposedAction: lock.requestId ? `Follow it with maintenance_request_status (requestId ${lock.requestId}); do not start another action meanwhile.` : "Wait a minute before starting another action.", tool: lock.requestId ? "maintenance_request_status" : null, needsHuman: false });

  for (const m of mods?.modules ?? []) {
    if (!m.loadable) add({ severity: "critical", problem: `Module "${m.id}" cannot be loaded.`, probableCause: "its files are damaged or incompatible with this version", proposedAction: "Reinstall it: code is renewed, data and settings are kept.", tool: "maintenance_module_reinstall", needsHuman: false });
    for (const i of m.instances) if (i.error) add({ severity: "critical", problem: `Instance "${i.key}" (module "${m.id}") was set aside: ${i.error}`, probableCause: "a data conversion failed after an update", proposedAction: "Try to bring it back; if it fails again, reinstall the module or tell the owner.", tool: "maintenance_module_restart", needsHuman: false });
    if (m.lastRefusedUpdate) add({ severity: "warning", problem: `The update of module "${m.id}" to ${m.lastRefusedUpdate.refusedVersion} was refused on ${m.lastRefusedUpdate.at.slice(0, 10)}: the new code does not load on this site.`, probableCause: `a fault in the module's new version (${m.lastRefusedUpdate.cause})`, proposedAction: `Nothing is broken: the module still runs ${m.lastRefusedUpdate.stayedOn}, as before, and its data did not change. Tell the owner in simple words that the update was refused for their safety and that the module's author must publish a fixed version. Do not try this version again.`, tool: null, needsHuman: true });
    if (m.missingDependencies.length) add({ severity: "warning", problem: `Module "${m.id}" lacks what it needs: ${m.missingDependencies.map((d) => d.service).join(", ")}.`, probableCause: "the module providing that service is not installed, or has nothing set up yet", proposedAction: "Tell the owner to install the missing module, or set it up, in Admin > Extensions.", tool: null, needsHuman: true });
  }
  if (up) {
    if (up.core.available) add({ severity: up.core.level === "major" ? "warning" : "info", problem: `A new stable core version is available (${up.core.current} to ${up.core.latestStable}, ${up.core.level}).`, probableCause: "a release was published", proposedAction: "Make a backup, then ask for the core update (the owner approves it unless they chose direct execution).", tool: "maintenance_core_update", needsHuman: false });
    const eligible = up.modules.filter((u) => u.aiCanUpdate);
    if (eligible.length) add({ severity: "info", problem: `${eligible.length} module update(s) available: ${eligible.map((u) => `${u.id} ${u.current} to ${u.target}`).join(", ")}.`, probableCause: "new versions were published", proposedAction: eligible.length > 1 ? "Make a backup, then ask for all updates." : "Make a backup, then ask for this update.", tool: eligible.length > 1 ? "maintenance_modules_update_all" : "maintenance_module_update", needsHuman: false });
    for (const u of up.modules.filter((x) => !x.aiCanUpdate)) add({ severity: "info", problem: `Module "${u.id}" has an update (${u.current} to ${u.target}) that you cannot apply: ${u.reason}.`, probableCause: "safety rule", proposedAction: u.needsCore ? "Update the core first." : "Tell the owner; only they can do it from Admin > Updates.", tool: u.needsCore ? "maintenance_core_update" : null, needsHuman: !u.needsCore });
    if (up.unchecked.length) add({ severity: "info", problem: `Updates could not be checked for: ${up.unchecked.join(", ")}.`, probableCause: "network or repository unreachable", proposedAction: "Check again later.", tool: "maintenance_check_updates", needsHuman: false });
  }

  // Contrôle du contenu : toujours en « info », jamais en alarme (une image sans texte n'est pas une panne). Lecture du petit résumé gardé, aucun site contacté.
  if (content && content.finished && content.counts.important + content.counts.advised > 0) {
    const c = content.counts;
    add({
      severity: "info", problem: `The last content check (${content.at.slice(0, 10)}) found things worth a look: ${c.important} important, ${c.advised} advised, ${c.info} for information.`,
      probableCause: "images without text, titles or descriptions missing, translations missing, menu entries or links that lead nowhere",
      proposedAction: "Read the details with maintenance_content_check and tell the owner in simple words; they fix each remark from Admin > Site health (nothing here is urgent).", tool: "maintenance_content_check", needsHuman: true,
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 } as const;
  problems.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const worst = problems[0]?.severity;
  const verdict = worst === "critical" ? "needs attention now" : worst === "warning" ? "needs attention soon" : problems.length ? "healthy, with updates or notes" : "healthy";
  return {
    verdict: unknown.length && (!worst || worst === "info") ? "nothing wrong found so far, but some checks did not finish" : verdict,
    problems,
    ...(unknown.length ? { unknown } : {}),
    ...(notes.length ? { notes } : {}),
    summary: { core: up?.core.current ?? readVersion(appDir()), modules: mods ? mods.modules.length : null, problems: problems.length, complete: unknown.length === 0 },
  };
}

const AUDIT_ACTIONS = ["mcp.maintenance.", "content.check", "update.start", "update.auto", "update.channel", "module.update", "module.reinstall", "module.uninstall", "module.install", "module.enable", "module.disable", "backup.create", "backup.restore"];

/** Dernières actions de maintenance, faites par l'IA ou par un humain. L'adresse e-mail d'un humain n'est jamais donnée ; aucun secret. */
export async function auditTrail(limit = 20) {
  const n = Math.min(50, Math.max(1, Math.trunc(limit) || 20));
  const rows = await prisma.auditLog.findMany({ where: { OR: AUDIT_ACTIONS.map((a) => ({ action: { startsWith: a } })) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: n });
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    by: r.actor.startsWith("mcp:") ? `ai:${redactSecrets(r.actor.slice(4), 60)}` : r.actor === "auto-update" ? "scheduler" : "human",
    action: r.action,
    detail: redactSecrets(r.target, 200),
  }));
}
