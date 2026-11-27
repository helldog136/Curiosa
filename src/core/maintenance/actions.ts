import { isStrictPersonalToken, ownerOfToken } from "@/core/services/mcp/tokens";
import { requirementMet, requirementOfAction } from "@/core/services/mcp/ownerCeiling";
import { resolveOwner } from "@/core/services/mcp/ownerResolver";
import { getPersonalPolicy } from "@/core/personalAi/policy";
import fs from "node:fs";
import { prisma } from "@/core/db";
import { getInstanceByKey } from "@/core/instances";
import { classify, compareVersions } from "@/core/updates/versions";
import { dockerUpdatePlan, getInstallInfo, readVersion } from "@/core/updates/service";
import { McpToolError } from "@/core/services/mcp/validate";
import { deps } from "./deps";
import { isStableVersion } from "./inspect";
import { personalIndex } from "@/core/modules/personalCatalogues";
import { notifyOwner } from "./notify";
import { redactSecrets } from "./redact";
import { claimRequest, createRequest, denyRequest, getRequest, finishRequest, reopenRequest, setRequestProgress, type Level3Action, type Plan } from "./requests";
import { openRun, resetLock, runInBackground, takeLock, type Outcome, type RecordStore, type RunContext, type RunDone, type Started } from "./background";
import { getApprovalMode } from "./settings";
import { DEFAULT_LIMITS, resetAllSlots, takeSlot, type SlotClass } from "./slots";
import { runContentCheck } from "./content/service";
import { applyConfigure, parseConfigureArgs } from "./moduleSettings";
import { moduleId, reason } from "./common";
import type { Params } from "./level3";
import { ALWAYS_HUMAN, BACKGROUND_LEVEL3, executeLevel3, level3Def, prepareLevel3 } from "./level3Registry";

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
export type { Outcome } from "./background";
export type Level2Tool = "check_updates" | "backup_run" | "module_reinstall" | "module_restart" | "content_check_run";
export type { Params };
export { ALWAYS_HUMAN };

/* ───────────── Verrou et cadence ───────────── */

/** Which counter an action uses (slots.ts): what brings code or changes the whole site is "risky"; the day-to-day setup and content work is "content". */
const LEVEL2_CLASS: Record<Level2Tool, SlotClass> = { check_updates: "content", backup_run: "content", content_check_run: "content", module_reinstall: "risky", module_restart: "risky" };
/** Kept for compatibility: the default limit of the "risky" class (see slots.ts for the two classes). */
export const MAX_ACTIONS_PER_HOUR = DEFAULT_LIMITS.risky;

/** Tests: clears the counters and the lock. */
export function resetMaintenanceState(): void { resetAllSlots(); resetLock(); }

async function withLock<T extends Outcome>(name: string, by: string, fn: () => Promise<T>): Promise<T | Outcome> {
  const lock = takeLock({ name, by });
  if (!lock.ok) return lock.outcome;
  try { return await fn(); } finally { lock.release(); }
}

/**
 * Actions that can take longer than the 60 seconds an AI client waits (downloads, one pass over every repository, data conversions). They are started in the
 * background and answered "started" with a requestId when they are not over within a few seconds: see background.ts. Everything else answers when it is done.
 */
const BACKGROUND_LEVEL2: ReadonlySet<Level2Tool> = new Set(["check_updates", "module_reinstall"]);

/** Where the record of an approved request is kept up to date. */
const requestStore = (id: string): RecordStore => ({ setPlan: async () => {}, setProgress: (p) => setRequestProgress(id, p), finish: (r) => finishRequest(id, r, deps.now()) });

/** Takes the lock, opens the record (the approved request, or a run of its own) and starts `work` in the background. */
async function launch(o: { action: string; actor: { name: string; tokenId?: string }; requestId?: string; work: (ctx: RunContext) => Promise<Outcome>; after: (outcome: Outcome) => Promise<void> }): Promise<Started | RunDone | { busy: true; outcome: Outcome }> {
  const lock = takeLock({ name: o.action, by: o.actor.name, requestId: o.requestId });
  if (!lock.ok) return { busy: true, outcome: lock.outcome };
  let id: string;
  let store: RecordStore;
  try {
    if (o.requestId) { id = o.requestId; store = requestStore(id); } else {
      const run = await openRun({ action: o.action, tokenId: o.actor.tokenId ?? "unknown", tokenName: o.actor.name });
      id = run.id; store = run.store; lock.tag(id);
    }
  } catch (error) { lock.release(); throw error; }
  return runInBackground({ id, store, lock, work: o.work, after: o.after });
}

/* ───────────── Messages ───────────── */

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
  // A module of a personal catalogue is renewed from its repository (private, with the owner's access code): only the owner does that. The origin is written on the module
  // itself (it stays when the catalogue is removed); if it cannot be read, the module is treated as personal.
  const row = await prisma.module.findUnique({ where: { id }, select: { id: true, repoUrl: true } });
  const personal = await personalIndex();
  if (row && (!personal || personal.has(row))) return { ok: false, message: `"${id}" comes from a personal catalogue of the owner: only a human can reinstall it (Admin > Modules).` };
  const r = await deps.reinstall(id);
  if (!r.ok) return { ok: false, message: `Reinstall of "${id}" failed: ${reason(r.error)}${r.rolledBack ? " (the previous code was put back)" : ""}.${r.loadError ? ` Cause: ${redactSecrets(r.loadError, 200)}.` : ""}` };
  const bad = r.migrations.some((x) => x.status === "failed" || x.status === "newer");
  return { ok: !bad, message: `${r.changed ? `Code of "${id}" renewed (${r.before.version} to ${r.after.version}); data, settings and instances are untouched.` : `"${id}" was already identical to its source; nothing changed.`}${bad ? " A data conversion failed: check maintenance_modules." : ""}`, details: { changed: r.changed } };
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
export async function runLevel2(tool: Level2Tool, args: Params, actor: { name: string; tokenId?: string }): Promise<Outcome | { ok: true; status: "started"; requestId: string; message: string }> {
  const id = tool === "module_reinstall" ? moduleId(args.module) : undefined;
  const key = tool === "module_restart" ? String(args.instance ?? "") : undefined;
  if (tool === "module_restart" && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key!)) throw new McpToolError('argument "instance" must be an instance key (see maintenance_modules)');
  await takeSlot(actor.tokenId, LEVEL2_CLASS[tool]);
  const param = id ?? key ?? (tool === "content_check_run" && args.continue === true ? "continue" : "");
  const work = async (): Promise<Outcome> => {
    try {
      if (tool === "check_updates") {
        await deps.recheckCore().catch(() => {});
        const report = await deps.modulesReport(true);
        return { ok: true, message: "Caches cleared and versions checked again.", details: { moduleUpdates: report.outdated.length, notChecked: report.unchecked } };
      }
      if (tool === "backup_run") return await doBackup();
      if (tool === "content_check_run") return await doContentCheck(args.continue === true);
      if (tool === "module_reinstall") return await doReinstall(id!);
      return await doRestart(key!);
    } catch (error) {
      console.error(`[maintenance] ${tool} failed:`, (error as Error)?.message);
      return { ok: false, message: "The action failed unexpectedly. Check maintenance_health." };
    }
  };
  const after = async (outcome: Outcome) => {
    await record(actor.name, tool, param, outcome, "level2");
    await notifyOwner({ kind: "executed", tokenName: actor.name, actionKey: tool, detail: param, ok: outcome.ok });
  };
  if (BACKGROUND_LEVEL2.has(tool)) {
    const run = await launch({ action: tool, actor, work, after });
    if ("busy" in run) return run.outcome;
    if (run.started) return { ok: true, status: "started", requestId: run.requestId, message: run.message };
    return run.outcome;
  }
  const outcome = await withLock(tool, actor.name, work);
  if (outcome.busy) return outcome;
  await after(outcome);
  return outcome;
}

/**
 * Réglages d'une instance (niveau 2) : `module_configure`, ou `module_configure_advanced` (même code ; ce second outil est celui que le propriétaire accorde
 * EN PLUS pour les réglages « avancés »). Cadence, verrou, audit (ancien → nouveau, jamais un secret) et avertissement comme toute action de niveau 2.
 */
export async function runConfigure(advanced: boolean, rawArgs: Record<string, unknown>, actor: { name: string; tokenId?: string }): Promise<unknown> {
  const input = parseConfigureArgs(rawArgs);
  const tool = advanced ? "module_configure_advanced" : "module_configure";
  await takeSlot(actor.tokenId, "content");
  let reply: Record<string, unknown> = {};
  let params = input.instance;
  const outcome = await withLock(tool, actor.name, async () => {
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

/* ───────────── Niveau 3 : préparation (lecture seule, ne change rien) et exécution (revérifie tout) ───────────── */

/**
 * Prepares a level 3 action (read only, changes nothing): the definition of the action does the work (level3.ts, level3Registry.ts).
 * `patient`: wait for the real check of every module (the work runs in the background, nobody is waiting). Otherwise (the plan of a request, built while the AI
 * waits) the check has `2 x checkTimeoutMs`; past that the last report saved is used (it is re-verified when the request is executed), or the AI is told to ask again.
 */
export function prepare(action: Level3Action, args: Params, opts: { patient?: boolean } = {}): Promise<Plan> {
  return prepareLevel3(action, args, opts);
}

/** Les conditions sont relues maintenant (la demande a pu attendre des heures) : `executeLevel3` revérifie le plan, puis seulement exécute. */
const execute = (action: Level3Action, plan: Plan, actorLabel: string, ctx?: RunContext): Promise<Outcome> => executeLevel3(action, plan, actorLabel, ctx);

/** What the journal and the owner's notice keep of a plan: short, no secret (defined by the action). */
const paramsText = (action: Level3Action, plan: Plan): string => level3Def(action).audit(plan);

const executedBy = (who: { tokenName: string }) => `mcp:${who.tokenName}`;

/**
 * Verrou + audit + avertissement autour d'une exécution de niveau 3. Une action longue (voir BACKGROUND_LEVEL3) est lancée en arrière-plan : si elle n'est pas finie
 * au bout de quelques secondes, la réponse est `Started` et son audit, son avertissement et le résultat de la demande sont écrits quand elle se termine.
 * `requestId` : la demande approuvée à laquelle le résultat est rendu.
 */
async function runGuarded(action: Level3Action, plan: Plan, who: { tokenName: string; tokenId?: string; via: "direct" | "approved"; requestId?: string }): Promise<Outcome | Started> {
  const after = async (outcome: Outcome) => {
    await record(who.tokenName, action, paramsText(action, plan), outcome, who.via);
    await notifyOwner({ kind: "executed", tokenName: who.tokenName, actionKey: action, detail: paramsText(action, plan), ok: outcome.ok });
  };
  const work = async (ctx?: RunContext): Promise<Outcome> => {
    try { return await execute(action, plan, executedBy(who), ctx); } catch (error) {
      console.error(`[maintenance] ${action} failed:`, (error as Error)?.message);
      return { ok: false, message: "The action failed unexpectedly. Check maintenance_health." };
    }
  };
  if (BACKGROUND_LEVEL3.has(action) && who.requestId) {
    const run = await launch({ action, actor: { name: who.tokenName, tokenId: who.tokenId }, requestId: who.requestId, work, after });
    if ("busy" in run) return run.outcome;
    return run.started ? run : run.outcome;
  }
  const outcome = await withLock(action, who.tokenName, () => work());
  if (outcome.busy) return outcome;
  await after(outcome);
  if (who.requestId) await finishRequest(who.requestId, outcome, deps.now());
  return outcome;
}

/**
 * Exécution directe d'une action longue : la préparation (qui peut interroger tous les dépôts) ET l'exécution tournent en arrière-plan, sous le verrou. Une demande
 * refusée avant tout travail (rien à mettre à jour…) répond comme avant, par une erreur d'outil.
 */
async function callDirectInBackground(action: Level3Action, args: Params, actor: { name: string; tokenId?: string }): Promise<unknown> {
  let plan: Plan | null = null;
  const run = await launch({
    action, actor,
    work: async (ctx) => {
      try { plan = await prepare(action, args, { patient: true }); } catch (error) {
        if (error instanceof McpToolError) return { ok: false, refused: true, message: error.message };
        throw error;
      }
      ctx.setPlan(plan);
      try { return await execute(action, plan, executedBy({ tokenName: actor.name }), ctx); } catch (error) {
        console.error(`[maintenance] ${action} failed:`, (error as Error)?.message);
        return { ok: false, message: "The action failed unexpectedly. Check maintenance_health." };
      }
    },
    after: async (outcome) => {
      if (!plan) return;
      await record(actor.name, action, paramsText(action, plan), outcome, "direct");
      await notifyOwner({ kind: "executed", tokenName: actor.name, actionKey: action, detail: paramsText(action, plan), ok: outcome.ok });
    },
  });
  if ("busy" in run) throw new McpToolError(run.outcome.message);
  if (run.started) return { status: "started", requestId: run.requestId, action, message: run.message };
  if (run.outcome.refused) throw new McpToolError(run.outcome.message);
  return { status: run.outcome.ok ? "done" : "failed", message: run.outcome.message };
}

/**
 * Appel d'une action de niveau 3 par une IA. « Validation humaine » (défaut) : seule une DEMANDE est créée. « Exécution directe » (choix explicite de l'administrateur
 * pour ce jeton) : exécutée tout de suite.
 */
/**
 * `core_update` on a Docker install: nothing can be executed (the image is replaced by the owner), so no request is created and no approval is asked.
 * The answer is the plan: the target, the image tags to pass through in order (several below the support floor) and the exact commands.
 */
async function dockerCoreUpdateGuide(): Promise<unknown> {
  const appDir = deps.appDir ?? process.cwd();
  const latest = await deps.latestStable().catch(() => null);
  if (!latest) throw new McpToolError("No stable release was found (the release list may be unreachable). Try again later.");
  const current = readVersion(appDir);
  const tag = latest.tag;
  if (!isStableVersion(tag)) throw new McpToolError("Only a stable release can be proposed by an AI.");
  if (compareVersions(tag, current) <= 0) return { status: "up_to_date", install: "docker", current, message: `Nothing to do: the site is on ${current} and the highest stable release is ${tag.replace(/^v/, "")}.` };
  const plan = await dockerUpdatePlan(tag, { appDir, fetchText: deps.fetchText });
  return {
    status: "manual_update_required", install: "docker", from: current, to: tag.replace(/^v/, ""), level: classify(current, tag) ?? undefined,
    steps: plan.tags, commands: plan.commands, stepsComputed: plan.planned,
    message: "Nothing was done and nothing can be done from here: this site runs in a container image, so the owner updates it by running these commands on the host, in this order, waiting for the site to answer between steps. A copy of the database is made automatically at each start.",
  };
}

export async function callLevel3(action: Level3Action, args: Params, actor: { name: string; tokenId?: string }): Promise<unknown> {
  if (action === "core_update" && getInstallInfo(deps.appDir ?? process.cwd()).kind === "docker") return dockerCoreUpdateGuide();
  await takeSlot(actor.tokenId, level3Def(action).slot);
  // Installer du code sur le site n'est JAMAIS exécuté sans l'accord de la personne propriétaire, même pour un jeton en « exécution directe » : le réglage vaut pour
  // les mises à jour et désinstallations, et rien dans le modèle ne dit quel module est « sans danger ».
  // Same for a new instance (it may get a public page).
  // A personal AI (0.46.0) may act without asking only when the site policy allows it (`allowDirect`, off by default); otherwise its requests always wait for a human.
  // An access that predates the owners (coarse) keeps its stored mode exactly as before; only a newer personal access follows the policy.
  const personalAccess = !!actor.tokenId && (await isStrictPersonalToken(actor.tokenId));
  const direct = !ALWAYS_HUMAN.includes(action) && (await getApprovalMode(actor.tokenId)) === "direct" && (!personalAccess || (await getPersonalPolicy()).allowDirect);
  if (direct && BACKGROUND_LEVEL3.has(action)) return callDirectInBackground(action, args, actor);
  const plan = await prepare(action, args);
  if (direct) {
    const outcome = await runGuarded(action, plan, { tokenName: actor.name, tokenId: actor.tokenId, via: "direct" });
    if ("started" in outcome) return { status: "started", requestId: outcome.requestId, message: outcome.message };
    if (outcome.busy) throw new McpToolError(outcome.message);
    return { status: outcome.ok ? "done" : "failed", message: outcome.message };
  }
  const ownerId = actor.tokenId ? await ownerOfToken(actor.tokenId) : null;
  const created = await createRequest({ action, plan, tokenId: actor.tokenId ?? "unknown", tokenName: actor.name, ...(ownerId ? { ownerId } : {}) });
  if (!created.ok) throw new McpToolError(created.error);
  if (!created.existing) {
    await prisma.auditLog.create({ data: { actor: `mcp:${redactSecrets(actor.name, 80)}`, action: "mcp.maintenance.request", target: redactSecrets(`${created.request.id} ${action} [${paramsText(action, plan)}]`, 300) } }).catch(() => {});
    await notifyOwner({ kind: "pending", tokenName: actor.name, actionKey: action, detail: paramsText(action, plan) });
  }
  return {
    status: "pending_approval", requestId: created.request.id, action, plan, expiresAt: new Date(created.request.expiresAt).toISOString(),
    message: "Nothing was done. The owner must approve this request in Admin > AI maintenance. Poll maintenance_request_status with this requestId; do not ask again.",
  };
}

/* ───────────── Décision humaine ───────────── */

/** Qui décide : `owner` vient de `can(user, "core:mcp.tokens")` (personne relue en base), jamais d'un formulaire. */
export type Decider = { email: string; owner: boolean; /** (0.46.0) The signed-in user (read from the session, never from a form): lets the OWNER of a personal AI decide that AI's requests. */ userId?: string };
export type DecisionResult = { ok: boolean; message: string; reason?: "forbidden" | "unknown" | "not-pending" | "expired" | "busy" | "failed" | "running" };

/**
 * Who decides a request (0.46.0): a holder of `core:mcp.tokens` (`by.owner`), or the user who OWNS the personal AI that made it. Returns a refusal, or null when allowed.
 * For an approval of a personal AI's request, the owner's CURRENT rights are checked again here, before anything runs: an approval given after a demotion never executes
 * (the request is closed as refused). Independent accesses: exactly the old rule.
 */
async function mayDecide(id: string, by: Decider, verb: "approve" | "refuse"): Promise<DecisionResult | null> {
  const r = await getRequest(id, deps.now());
  const ownsIt = !!r?.ownerId && !!by?.userId && by.userId === r.ownerId;
  if (by?.owner !== true && !ownsIt) return { ok: false, reason: "forbidden", message: `Only the owner can ${verb} a request.` };
  if (verb === "approve" && r?.ownerId && r.status === "pending" && !(await ownerStillMayRun(r.ownerId, r.action))) {
    await denyRequest(r.id, deps.now());
    await prisma.auditLog.create({ data: { actor: by.email, action: "mcp.personal.inert", target: redactSecrets(`${r.id} ${r.action}: above the owner's rights now`, 200) } }).catch(() => {});
    return { ok: false, reason: "forbidden", message: "This request is above what its owner may do now. It was refused and will never run." };
  }
  return null;
}

/** The owner of the personal AI may still do what the request does, right now (and the AI is still allowed to exist). */
async function ownerStillMayRun(ownerId: string, action: string): Promise<boolean> {
  const owner = await resolveOwner(ownerId);
  return owner.active && requirementMet(requirementOfAction(action), owner);
}

/** Le propriétaire approuve : la demande est exécutée UNE fois, avec les mêmes fonctions que l'admin et les mêmes vérifications. */
export async function approveRequest(id: string, by: Decider): Promise<DecisionResult> {
  const gate = await mayDecide(id, by, "approve");
  if (gate) return gate;
  const claim = await claimRequest(id, deps.now());
  if (!claim.ok) return { ok: false, reason: claim.reason, message: `Request ${claim.reason === "expired" ? "expired" : claim.reason === "unknown" ? "not found" : "already answered"}.` };
  const r = claim.request;
  await prisma.auditLog.create({ data: { actor: by.email, action: "mcp.maintenance.approve", target: redactSecrets(`${r.id} ${r.action}`, 200) } }).catch(() => {});
  const outcome = await runGuarded(r.action, r.plan, { tokenName: r.tokenName, tokenId: r.tokenId, via: "approved", requestId: r.id });
  // A long action still running: the approval is done, the work goes on and the request shows its progress and result (the page and the AI read them there).
  if ("started" in outcome) return { ok: true, reason: "running", message: "The action runs in the background; its result will appear on this request." };
  if (outcome.busy) { await reopenRequest(r.id); return { ok: false, reason: "busy", message: outcome.message }; }
  return { ok: outcome.ok, reason: outcome.ok ? undefined : "failed", message: outcome.message };
}

export async function denyRequestBy(id: string, by: Decider): Promise<DecisionResult> {
  const gate = await mayDecide(id, by, "refuse");
  if (gate) return gate;
  const r = await denyRequest(id, deps.now());
  if (!r.ok) return { ok: false, reason: r.reason, message: `Request ${r.reason === "expired" ? "expired" : r.reason === "unknown" ? "not found" : "already answered"}.` };
  await prisma.auditLog.create({ data: { actor: by.email, action: "mcp.maintenance.deny", target: redactSecrets(`${r.request.id} ${r.request.action}`, 200) } }).catch(() => {});
  return { ok: true, message: "Request refused. It will never run." };
}
