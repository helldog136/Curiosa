import fs from "node:fs";
import { prisma } from "@/core/db";
import { getInstanceByKey } from "@/core/instances";
import { dependentsOf } from "@/core/modules/dependencies";
import { classify, compareVersions } from "@/core/updates/versions";
import { getInstallInfo, readVersion } from "@/core/updates/service";
import { McpToolError } from "@/core/services/mcp/validate";
import { deps } from "./deps";
import { isStableVersion, moduleUpdateRefusal, updateRunning } from "./inspect";
import { notifyOwner } from "./notify";
import { redactSecrets } from "./redact";
import { claimRequest, createRequest, denyRequest, finishRequest, reopenRequest, type Level3Action, type Plan } from "./requests";
import { getApprovalMode } from "./settings";
import { runContentCheck } from "./content/service";
import { executeInstall, prepareInstall, samePlan } from "./install";
import { applyConfigure, parseConfigureArgs } from "./moduleSettings";

/**
 * ACTIONS de maintenance : niveau 2 (sans risque : revérifier, sauvegarder, réinstaller, relancer) et niveau 3 (à risque : mises à jour, désinstallation).
 *
 * Règles qui valent pour TOUTES, qu'elles viennent d'une IA (directement ou après approbation) :
 *  - une seule opération à la fois (verrou) et une cadence limitée par jeton ;
 *  - jamais de version candidate (`-rc.N`) ni d'instantané (`dev-…`), jamais de rétrogradation : le cœur ne vise que la plus haute release STABLE
 *    et seulement si elle est plus récente ; un module ne bouge que s'il suit des étiquettes stables ;
 *  - les conditions sont REVÉRIFIÉES au moment d'exécuter ; une demande approuvée qui ne vise plus la même chose n'est pas exécutée ;
 *  - chaque action est inscrite au journal d'audit (`mcp.maintenance.<outil>`) : nom du jeton, paramètres sans secret, résultat ;
 *  - le propriétaire est averti (voir notify.ts).
 * Les messages renvoyés à l'IA sont en anglais, courts, masqués et jamais techniques.
 */
export type Outcome = { ok: boolean; message: string; details?: unknown; /** L'opération n'a pas commencé (verrou pris) : rien n'a été fait. */ busy?: boolean };
export type Level2Tool = "check_updates" | "backup_run" | "module_reinstall" | "module_restart" | "content_check_run";
export type Params = { module?: string; instance?: string; /** Installation : clé facultative de la première instance. */ instanceKey?: string; /** Contrôle du contenu : reprendre la vérification commencée au lieu d'en commencer une. */ continue?: boolean; /** Désinstallation : garder (défaut) ou effacer les données. */ keepData?: boolean };

/* ───────────── Verrou et cadence ───────────── */

const g = globalThis as unknown as { curiosaMaintenanceBusy?: string | null; curiosaMaintenanceHits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.curiosaMaintenanceHits ??= new Map<string, number[]>());
export const MAX_ACTIONS_PER_HOUR = 12;

/** Tests : vide la cadence et le verrou. */
export function resetMaintenanceState(): void { hits.clear(); g.curiosaMaintenanceBusy = null; }

function takeSlot(tokenId: string | undefined): void {
  const key = tokenId ?? "unknown";
  const now = deps.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= MAX_ACTIONS_PER_HOUR) { hits.set(key, recent); throw new McpToolError(`Too many maintenance actions from this token in the last hour (limit ${MAX_ACTIONS_PER_HOUR}). Wait before trying again.`); }
  recent.push(now);
  hits.set(key, recent);
}

async function withLock<T extends Outcome>(name: string, fn: () => Promise<T>): Promise<T | Outcome> {
  if (g.curiosaMaintenanceBusy) return { ok: false, busy: true, message: `Another maintenance operation is running (${g.curiosaMaintenanceBusy}). Try again in a minute.` };
  g.curiosaMaintenanceBusy = name;
  try { return await fn(); } finally { g.curiosaMaintenanceBusy = null; }
}

/* ───────────── Messages ───────────── */

const REASONS: Record<string, string> = {
  "modules.error.notfound": "unknown module", "modules.error.requiredBy": "other modules need it", "modules.error.core": "it needs a newer core version",
  "modules.error.catalogue": "the module catalogue is unreachable", "modules.error.clone": "the module source could not be downloaded", "modules.error.uptodate": "already up to date",
  "modules.error.pinned": "it is pinned to a fixed commit", "modules.error.reinstallBusy": "an update or reinstall is already running", "modules.error.reinstallNoSource": "it was installed by hand: there is no source to reinstall from",
  "modules.error.reinstallPerms": "the new version asks for new permissions: only a human can accept that", "modules.error.migration": "its data conversion failed", "modules.error.requires": "it lacks a module it needs",
  "modules.error.nomanifest": "the new version has no valid description file", "modules.error.size": "the new version is too large", "modules.error.unknownSource": "its source is unknown", "modules.error.incompatible": "it is not compatible with this version",
  "modules.error.noSpace": "not enough disk space for a safety copy of the database (nothing was updated)", "modules.error.copyFailed": "the safety copy of the database failed (nothing was updated)",
  "modules.error.exists": "it is already installed", "modules.error.nomain": "its main file is missing", "modules.error.idmismatch": "the repository serves another module than announced",
  "error.generic": "the action failed",
};
const reason = (code: string | undefined) => (code && REASONS[code]) || (code && /^[\w.-]{1,60}$/.test(code) ? `failed (${code})` : "the action failed");

const moduleId = (v: unknown): string => {
  if (typeof v !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)) throw new McpToolError('argument "module" must be a module identifier (see maintenance_modules)');
  return v;
};

/* ───────────── Audit ───────────── */

async function record(tokenName: string, tool: string, params: string, outcome: Outcome, via: "direct" | "approved" | "level2"): Promise<void> {
  const target = redactSecrets(`${outcome.ok ? "ok" : "failed"}${via === "approved" ? " (approved)" : ""}${params ? ` [${params}]` : ""} — ${outcome.message}`, 300);
  await prisma.auditLog.create({ data: { actor: `mcp:${redactSecrets(tokenName, 80)}`, action: `mcp.maintenance.${tool}`, target } }).catch(() => {});
}

/* ───────────── Niveau 2 ───────────── */

async function doBackup(): Promise<Outcome> {
  const m = /^file:(.+)$/.exec(process.env.DATABASE_URL ?? "");
  try {
    const dbSize = m ? fs.statSync(m[1]!.split("?")[0]!).size : 0;
    const d = deps.disk();
    if (d && d.freeBytes < dbSize * 2 + 50 * 1024 * 1024) return { ok: false, message: "Not enough free disk space to copy the database safely. Tell the owner." };
  } catch { /* taille ou espace inconnus : la copie décidera */ }
  const file = deps.backup();
  if (!file) return { ok: false, message: "There is no database file to copy on this installation." };
  let sizeBytes = 0;
  try { sizeBytes = fs.statSync(file).size; } catch { /* copie faite, taille inconnue */ }
  return { ok: true, message: "A copy of the database was made on the server (the 5 most recent are kept). It cannot be downloaded: for an encrypted backup file, the owner uses Admin > Backup.", details: { sizeBytes } };
}

async function doReinstall(id: string): Promise<Outcome> {
  const r = await deps.reinstall(id);
  if (!r.ok) return { ok: false, message: `Reinstall of "${id}" failed: ${reason(r.error)}${r.rolledBack ? " (the previous code was put back)" : ""}.` };
  const bad = r.migrations.some((x) => x.status === "failed" || x.status === "newer");
  return { ok: !bad, message: `${r.changed ? `Code of "${id}" renewed (${r.before.version} to ${r.after.version}); data, settings and instances are untouched.` : `"${id}" was already identical to its source; nothing changed.`}${bad ? " A data conversion failed: check maintenance_modules." : ""}${r.restartAdvised ? " A restart of the site may be needed for secondary files." : ""}`, details: { changed: r.changed } };
}

async function doRestart(key: string): Promise<Outcome> {
  const instance = await getInstanceByKey(key);
  if (!instance) return { ok: false, message: `Unknown instance "${redactSecrets(key, 60)}" (see maintenance_modules).` };
  const out = await deps.retryInstance(instance.id);
  if (!out) return { ok: false, message: `Instance "${key}" could not be retried: its module cannot be loaded. Try maintenance_module_reinstall.` };
  if (out.status === "none") return { ok: true, message: `Instance "${key}" was not set aside; nothing to do.` };
  return out.status === "ok" ? { ok: true, message: `Instance "${key}" is running again (data converted from v${out.from} to v${out.to}).` } : { ok: false, message: `Instance "${key}" is still set aside (${out.status}). Reinstall its module or tell the owner.` };
}

/**
 * Contrôle du contenu (niveau 2) : lit le site puis visite UN paquet de liens externes (voir content/run.ts pour tous les garde-fous : 200 liens, 25 par site, jamais deux visites de suite
 * sur le même site, adresses internes refusées…). Rien n'est modifié sur le site ; le résultat se lit avec `maintenance_content_check`.
 */
async function doContentCheck(resume: boolean): Promise<Outcome> {
  const r = await runContentCheck({ resume });
  if (r.busy) return { ok: false, busy: true, message: r.message };
  return { ok: r.ok, message: r.message, details: { finished: r.finished ?? false, ...(r.progress ? { linksVisited: r.progress.done, linksToVisit: r.progress.total } : {}), ...(r.counts ? { counts: r.counts } : {}) } };
}

/** Exécute une action de niveau 2 (droit déjà vérifié par le serveur MCP). */
export async function runLevel2(tool: Level2Tool, args: Params, actor: { name: string; tokenId?: string }): Promise<Outcome> {
  const id = tool === "module_reinstall" ? moduleId(args.module) : undefined;
  const key = tool === "module_restart" ? String(args.instance ?? "") : undefined;
  if (tool === "module_restart" && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key!)) throw new McpToolError('argument "instance" must be an instance key (see maintenance_modules)');
  takeSlot(actor.tokenId);
  const outcome = await withLock(tool, async () => {
    try {
      if (tool === "check_updates") {
        await deps.recheckCore().catch(() => {});
        const report = await deps.modulesReport(true);
        return { ok: true, message: "Caches cleared and versions checked again.", details: { moduleUpdates: report.outdated.length, notChecked: report.unchecked } } as Outcome;
      }
      if (tool === "backup_run") return await doBackup();
      if (tool === "content_check_run") return await doContentCheck(args.continue === true);
      if (tool === "module_reinstall") return await doReinstall(id!);
      return await doRestart(key!);
    } catch (error) {
      console.error(`[maintenance] ${tool} failed:`, (error as Error)?.message);
      return { ok: false, message: "The action failed unexpectedly. Check maintenance_health." } as Outcome;
    }
  });
  if (outcome.busy) return outcome;
  const param = id ?? key ?? (tool === "content_check_run" && args.continue === true ? "continue" : "");
  await record(actor.name, tool, param, outcome, "level2");
  await notifyOwner({ kind: "executed", tokenName: actor.name, actionKey: tool, detail: param, ok: outcome.ok });
  return outcome;
}

/**
 * Réglages d'une instance (niveau 2) : `module_configure`, ou `module_configure_advanced` (même code ; ce second outil est celui que le propriétaire accorde
 * EN PLUS pour les réglages « avancés »). Cadence, verrou, audit (ancien → nouveau, jamais un secret) et avertissement comme toute action de niveau 2.
 */
export async function runConfigure(advanced: boolean, rawArgs: Record<string, unknown>, actor: { name: string; tokenId?: string }): Promise<unknown> {
  const input = parseConfigureArgs(rawArgs);
  const tool = advanced ? "module_configure_advanced" : "module_configure";
  takeSlot(actor.tokenId);
  let reply: Record<string, unknown> = {};
  let params = input.instance;
  const outcome = await withLock(tool, async () => {
    try {
      const r = await applyConfigure(input, advanced);
      reply = r.reply; params = r.auditParams;
      return r.outcome;
    } catch (error) {
      if (error instanceof McpToolError) return { ok: false, message: error.message } as Outcome;
      console.error(`[maintenance] ${tool} failed:`, (error as Error)?.message);
      return { ok: false, message: "The action failed unexpectedly. Check maintenance_health." } as Outcome;
    }
  });
  if (outcome.busy) throw new McpToolError(outcome.message);
  await record(actor.name, tool, params, outcome, "level2");
  if (outcome.ok) await notifyOwner({ kind: "executed", tokenName: actor.name, actionKey: tool, detail: params, ok: true });
  // Une erreur de l'appel (instance inconnue…) est dite telle quelle ; un refus de valeurs revient avec la liste de tous les problèmes.
  if (!Object.keys(reply).length) throw new McpToolError(outcome.message);
  return reply;
}

/* ───────────── Niveau 3 : préparation (lecture seule, ne change rien) ───────────── */

export async function prepare(action: Level3Action, args: Params): Promise<Plan> {
  const refuse = (m: string): never => { throw new McpToolError(m); };
  if (action !== "module_uninstall" && updateRunning()) refuse("A core update is running. Wait for it to finish (maintenance_status).");

  if (action === "core_update") {
    const info = getInstallInfo(deps.appDir ?? process.cwd());
    if (!info.canUpdate) refuse("This installation cannot be updated from the admin (container image or manual install). Tell the owner.");
    const latest = await deps.latestStable().catch(() => null);
    if (!latest) refuse("No stable release was found (the release list may be unreachable). Try again later.");
    const tag = latest!.tag;
    const current = readVersion(deps.appDir ?? process.cwd());
    if (!isStableVersion(tag)) refuse("Only a stable release can be installed by an AI.");
    if (compareVersions(tag, current) <= 0) refuse(`Nothing to do: the site is on ${current} and the highest stable release is ${tag.replace(/^v/, "")}. Release candidates and snapshots are never installed by an AI, and the core is never downgraded.`);
    return { from: current, to: tag.replace(/^v/, ""), level: classify(current, tag) ?? undefined };
  }

  if (action === "module_install") return prepareInstall({ module: args.module, instanceKey: args.instanceKey });

  if (action === "module_update" || action === "module_uninstall") {
    const id = moduleId(args.module);
    const row = await prisma.module.findUnique({ where: { id } });
    if (!row) return refuse(`Unknown module "${id}" (see maintenance_modules).`);
    if (action === "module_uninstall") {
      const need = await dependentsOf(id).catch(() => []);
      if (need.length) refuse(`Module "${id}" is needed by: ${need.join(", ")}. It cannot be uninstalled.`);
      // Garder les données (non destructif) est le défaut ; les effacer doit être demandé en toutes lettres.
      return { module: id, from: row.version, keepData: args.keepData !== false };
    }
    const { check, failed } = await deps.checkModule(id);
    if (failed) refuse(`The update of "${id}" could not be checked (network or repository unreachable). Try again later.`);
    if (!check.available || !check.target) refuse(`Module "${id}" is already up to date.`);
    const why = moduleUpdateRefusal({ ref: row.ref, source: row.source, target: check.target!, needsCore: check.needsCore });
    if (why) refuse(`Module "${id}" cannot be updated by an AI: ${why}.`);
    return { module: id, from: row.version, to: check.target!.replace(/^v/, ""), level: check.level };
  }

  // modules_update_all
  const report = await deps.modulesReport(false);
  const rows = new Map((await prisma.module.findMany()).map((r) => [r.id, r]));
  const modules: NonNullable<Plan["modules"]> = [];
  for (const o of report.outdated) {
    const row = rows.get(o.id);
    if (!row || moduleUpdateRefusal({ ref: row.ref, source: row.source, target: o.target, needsCore: o.needsCore })) continue;
    modules.push({ id: o.id, from: o.current, to: o.target.replace(/^v/, "") });
  }
  if (!modules.length) refuse("No module can be updated by an AI right now (everything is up to date, or the remaining updates need a human or a newer core).");
  return { modules };
}

/* ───────────── Niveau 3 : exécution (revérifie tout) ───────────── */

async function execute(action: Level3Action, plan: Plan, actorLabel: string): Promise<Outcome> {
  // Les conditions sont relues maintenant : la demande a pu attendre des heures.
  let fresh: Plan;
  try { fresh = await prepare(action, { module: plan.module, keepData: plan.keepData, instanceKey: plan.instanceKey }); } catch (error) {
    if (error instanceof McpToolError) return { ok: false, message: `Not done: ${error.message}` };
    throw error;
  }
  if (action === "core_update" && fresh.to !== plan.to) return { ok: false, message: `Not done: the highest stable release changed since the request (was ${plan.to}, now ${fresh.to}). Ask again.` };
  if (action === "module_update" && fresh.to !== plan.to) return { ok: false, message: `Not done: the available version of "${plan.module}" changed since the request (was ${plan.to}, now ${fresh.to}). Ask again.` };

  if (action === "module_install") {
    // Le plan relu doit être celui qui a été demandé : même version, mêmes fournisseurs (la propriétaire a approuvé CETTE liste, pas une autre).
    if (!samePlan(plan, fresh)) return { ok: false, message: `Not done: what the installation of "${plan.module}" would do changed since the request (version, or the modules that come with it). Ask again.` };
    return executeInstall(plan, actorLabel);
  }
  if (action === "core_update") {
    const started = await deps.startCoreUpdate(`v${plan.to}`, actorLabel);
    return started.ok ? { ok: true, message: `Update to ${plan.to} started in the background; the site will restart. Check maintenance_status in a few minutes.` } : { ok: false, message: `Update not started: ${started.error === "running" ? "an update is already running" : started.error === "not-newer" ? "no newer stable release" : started.error === "unsupported" ? "this installation cannot be updated from the admin" : "invalid version"}.` };
  }
  if (action === "module_uninstall") {
    const keepData = plan.keepData !== false;
    const r = await deps.uninstall(plan.module!, { keepData });
    return r.ok
      ? { ok: true, message: keepData ? `Module "${plan.module}" was uninstalled. Its settings and data were kept aside: reinstalling the module brings them back.` : `Module "${plan.module}" was uninstalled and ALL its instances and data were erased.` }
      : { ok: false, message: `Uninstall of "${plan.module}" failed: ${reason(r.error)}.` };
  }
  // module_update, modules_update_all
  const wanted = action === "module_update" ? [{ id: plan.module!, to: plan.to! }] : (plan.modules ?? []);
  const still = new Map((action === "module_update" ? [{ id: plan.module!, to: fresh.to! }] : (fresh.modules ?? [])).map((m) => [m.id, m.to]));
  const ids = wanted.filter((m) => still.get(m.id) === m.to).map((m) => m.id);
  const changed = wanted.filter((m) => still.get(m.id) !== m.to).map((m) => m.id);
  if (!ids.length) return { ok: false, message: "Not done: the available versions changed since the request. Ask again." };
  const s = await deps.updateModules(ids);
  const parts = [s.updated.length ? `updated: ${s.updated.join(", ")}` : "", s.failed.length ? `failed: ${s.failed.map((f) => `${f.id} (${reason(f.error)})`).join(", ")}` : "", s.incompatible?.length ? `needs a newer core: ${s.incompatible.map((i) => i.id).join(", ")}` : "", s.skipped.length ? `not tried: ${s.skipped.join(", ")}` : "", changed.length ? `skipped (changed since the request): ${changed.join(", ")}` : ""].filter(Boolean);
  return { ok: s.failed.length === 0 && !s.stoppedOn && s.updated.length > 0, message: parts.join("; ") || "Nothing was updated.", details: { updated: s.updated } };
}

const paramsText = (plan: Plan) => (plan.adds ? `${plan.module} ${plan.to}${plan.instanceKey ? ` key=${plan.instanceKey}` : ""}${plan.adds.length ? ` + ${plan.adds.map((a) => a.id).join(", ")}` : ""}` : plan.module ? (plan.keepData === undefined ? plan.module : `${plan.module}${plan.keepData ? " keepData" : " erase"}`) : null) ?? (plan.modules ? plan.modules.map((m) => `${m.id} ${m.from}>${m.to}`).join(", ") : plan.to ? `${plan.from}>${plan.to}` : "");

/** Verrou + audit + avertissement autour d'une exécution de niveau 3. */
async function runGuarded(action: Level3Action, plan: Plan, who: { tokenName: string; tokenId?: string; via: "direct" | "approved" }): Promise<Outcome> {
  const outcome = await withLock(action, async () => {
    try { return await execute(action, plan, `mcp:${who.tokenName}`); } catch (error) {
      console.error(`[maintenance] ${action} failed:`, (error as Error)?.message);
      return { ok: false, message: "The action failed unexpectedly. Check maintenance_health." } as Outcome;
    }
  });
  if (outcome.busy) return outcome;
  await record(who.tokenName, action, paramsText(plan), outcome, who.via);
  await notifyOwner({ kind: "executed", tokenName: who.tokenName, actionKey: action, detail: paramsText(plan), ok: outcome.ok });
  return outcome;
}

/**
 * Appel d'une action de niveau 3 par une IA. « Validation humaine » (défaut) : seule une DEMANDE est créée. « Exécution directe » (choix explicite de l'administrateur
 * pour ce jeton) : exécutée tout de suite.
 */
export async function callLevel3(action: Level3Action, args: Params, actor: { name: string; tokenId?: string }): Promise<unknown> {
  takeSlot(actor.tokenId);
  const plan = await prepare(action, args);
  // Installer du code sur le site n'est JAMAIS exécuté sans l'accord de la propriétaire, même pour un jeton en « exécution directe » : le réglage vaut pour
  // les mises à jour et désinstallations, et rien dans le modèle ne dit quel module est « sans danger ».
  if (action !== "module_install" && (await getApprovalMode(actor.tokenId)) === "direct") {
    const outcome = await runGuarded(action, plan, { tokenName: actor.name, tokenId: actor.tokenId, via: "direct" });
    if (outcome.busy) throw new McpToolError(outcome.message);
    return { status: outcome.ok ? "done" : "failed", message: outcome.message };
  }
  const created = await createRequest({ action, plan, tokenId: actor.tokenId ?? "unknown", tokenName: actor.name });
  if (!created.ok) throw new McpToolError(created.error);
  if (!created.existing) {
    await prisma.auditLog.create({ data: { actor: `mcp:${redactSecrets(actor.name, 80)}`, action: "mcp.maintenance.request", target: redactSecrets(`${created.request.id} ${action} [${paramsText(plan)}]`, 300) } }).catch(() => {});
    await notifyOwner({ kind: "pending", tokenName: actor.name, actionKey: action, detail: paramsText(plan) });
  }
  return {
    status: "pending_approval", requestId: created.request.id, action, plan, expiresAt: new Date(created.request.expiresAt).toISOString(),
    message: "Nothing was done. The owner must approve this request in Admin > AI maintenance. Poll maintenance_request_status with this requestId; do not ask again.",
  };
}

/* ───────────── Décision humaine ───────────── */

/** Qui décide : `owner` vient de `isOwner(user)` (personne relue en base), jamais d'un formulaire. */
export type Decider = { email: string; owner: boolean };
export type DecisionResult = { ok: boolean; message: string; reason?: "forbidden" | "unknown" | "not-pending" | "expired" | "busy" | "failed" };

/** Le propriétaire approuve : la demande est exécutée UNE fois, avec les mêmes fonctions que l'admin et les mêmes vérifications. */
export async function approveRequest(id: string, by: Decider): Promise<DecisionResult> {
  if (by?.owner !== true) return { ok: false, reason: "forbidden", message: "Only the owner can approve a request." };
  const claim = await claimRequest(id, deps.now());
  if (!claim.ok) return { ok: false, reason: claim.reason, message: `Request ${claim.reason === "expired" ? "expired" : claim.reason === "unknown" ? "not found" : "already answered"}.` };
  const r = claim.request;
  await prisma.auditLog.create({ data: { actor: by.email, action: "mcp.maintenance.approve", target: redactSecrets(`${r.id} ${r.action}`, 200) } }).catch(() => {});
  const outcome = await runGuarded(r.action, r.plan, { tokenName: r.tokenName, tokenId: r.tokenId, via: "approved" });
  if (outcome.busy) { await reopenRequest(r.id); return { ok: false, reason: "busy", message: outcome.message }; }
  await finishRequest(r.id, outcome, deps.now());
  return { ok: outcome.ok, reason: outcome.ok ? undefined : "failed", message: outcome.message };
}

export async function denyRequestBy(id: string, by: Decider): Promise<DecisionResult> {
  if (by?.owner !== true) return { ok: false, reason: "forbidden", message: "Only the owner can refuse a request." };
  const r = await denyRequest(id, deps.now());
  if (!r.ok) return { ok: false, reason: r.reason, message: `Request ${r.reason === "expired" ? "expired" : r.reason === "unknown" ? "not found" : "already answered"}.` };
  await prisma.auditLog.create({ data: { actor: by.email, action: "mcp.maintenance.deny", target: redactSecrets(`${r.request.id} ${r.request.action}`, 200) } }).catch(() => {});
  return { ok: true, message: "Request refused. It will never run." };
}
