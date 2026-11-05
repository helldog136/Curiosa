import crypto from "node:crypto";
import { prisma } from "@/core/db";
import { deps } from "./deps";
import { redactDeep, redactSecrets } from "./redact";
import type { Plan } from "./requests";

/**
 * LONG ACTIONS RUN IN THE BACKGROUND, like the core update does.
 *
 * An AI client gives up on a tool call after about 60 seconds. Updating thirty modules, reinstalling a module or checking every repository for updates can take longer,
 * and the client then reports a failure although the work goes on (and finishes) on the server. So a long action:
 *   1. takes the maintenance lock (one operation at a time, as before) and writes a RECORD (a "run", or the owner-approved request it belongs to);
 *   2. starts the work, and waits for it for a short time only (`deps.quickWaitMs`, 8 s by default, never more than `MAX_QUICK_WAIT_MS`);
 *   3. if the work is over by then the caller gets the result at once, exactly as before; otherwise it gets `{ status: "started", requestId }` and reads the progress and
 *      the result with `maintenance_request_status`.
 * The work does NOT depend on the connection of the caller: a client that goes away changes nothing. The lock is released when the work ends, whatever happens; the audit
 * line and the owner's notice are written by the work itself when it ends, not by the caller. A site that restarts in the middle forgets its in-memory lock, and the record
 * of the interrupted work is closed as "failed: interrupted" the next time it is read (`closeInterrupted`).
 */
export const MAX_QUICK_WAIT_MS = 20_000;
/** A lock older than this is a bug, not an operation: it is ignored (and logged) so that the site never stays blocked. */
export const LOCK_STALE_MS = 30 * 60_000;
/** Direct runs (no owner approval involved) kept in the settings. */
const KEEP_RUNS = 30;
const RUNS_KEY = "maintenance.runs";
/** A "running" record that no work of this process stands behind, older than this, is closed as interrupted. */
export const INTERRUPTED_AFTER_MS = 2 * 60_000;

export type Outcome = { ok: boolean; message: string; details?: unknown; /** The operation did not begin (lock taken): nothing was done. */ busy?: boolean; /** The request was refused before any work (nothing to update…): a tool error, not an action. */ refused?: boolean };

/* ───────────── The lock ───────────── */

export type LockInfo = { name: string; since: number; by?: string; requestId?: string };
const g = globalThis as unknown as { curiosaMaintenanceBusy?: LockInfo | null; curiosaMaintenanceActive?: Set<string> };
const active = (): Set<string> => (g.curiosaMaintenanceActive ??= new Set());

/** The operation holding the lock, or null. A lock older than `LOCK_STALE_MS` does not count. */
export function currentLock(): LockInfo | null {
  const lock = g.curiosaMaintenanceBusy ?? null;
  if (lock && deps.now() - lock.since > LOCK_STALE_MS) { console.error(`[maintenance] ignoring a stale lock held by ${lock.name}`); g.curiosaMaintenanceBusy = null; return null; }
  return lock;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** Says who holds the lock and since when, so that the caller knows what to wait for. */
export function busyMessage(lock: LockInfo): string {
  const who = lock.by ? ` by "${redactSecrets(lock.by, 60)}"` : "";
  const follow = lock.requestId ? ` Follow it with maintenance_request_status (requestId ${lock.requestId}), or try again in a minute.` : " Try again in a minute.";
  return `Another maintenance operation is running (${lock.name}, started${who} ${ago(deps.now() - lock.since)} ago).${follow}`;
}

/** Takes the lock, or says why not. The returned function gives it back (only once, and only if it is still ours). */
export function takeLock(info: Omit<LockInfo, "since">): { ok: true; release: () => void; tag: (requestId: string) => void } | { ok: false; outcome: Outcome } {
  const held = currentLock();
  if (held) return { ok: false, outcome: { ok: false, busy: true, message: busyMessage(held) } };
  const mine: LockInfo = { ...info, since: deps.now() };
  g.curiosaMaintenanceBusy = mine;
  return { ok: true, release: () => { if (g.curiosaMaintenanceBusy === mine) g.curiosaMaintenanceBusy = null; }, tag: (requestId) => { mine.requestId = requestId; } };
}

/** Tests: forgets the lock and the running work. */
export function resetLock(): void { g.curiosaMaintenanceBusy = null; active().clear(); }

/* ───────────── Records of direct runs ───────────── */

export type RunProgress = {
  total: number; done: number;
  items: { id: string; status: "updated" | "failed" | "skipped"; reason?: string }[];
};
export type RunResult = { ok: boolean; message: string; details?: unknown };
export type MaintenanceRun = {
  id: string; action: string; tokenId: string; tokenName: string;
  createdAt: number; status: "running" | "done" | "failed";
  plan?: Plan; progress?: RunProgress; result?: RunResult; finishedAt?: number;
};

let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
async function loadRuns(): Promise<MaintenanceRun[]> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: RUNS_KEY, locale: "" } } });
  if (!row) return [];
  try { const v = JSON.parse(row.value); return Array.isArray(v) ? (v as MaintenanceRun[]).filter((r) => r && typeof r.id === "string") : []; } catch { return []; }
}
async function saveRuns(list: MaintenanceRun[]): Promise<void> {
  const json = JSON.stringify(list.slice(-KEEP_RUNS));
  await prisma.setting.upsert({ where: { key_locale: { key: RUNS_KEY, locale: "" } }, create: { key: RUNS_KEY, locale: "", value: json }, update: { value: json } });
}

/** Shortens what the result keeps: a few thousand characters at most, with secrets masked. */
export function boundResult(r: RunResult): RunResult {
  const details = r.details === undefined ? undefined : redactDeep(r.details);
  const json = details === undefined ? "" : JSON.stringify(details);
  return { ok: r.ok, message: redactSecrets(r.message, 400), ...(details !== undefined && json.length <= 4000 ? { details } : {}) };
}

const INTERRUPTED: RunResult = { ok: false, message: "Interrupted: the site restarted while this was running. Check maintenance_modules, then ask again if something is left." };

/** Closes the records that say "running" although nothing of this process works on them any more (the site restarted). */
export function closeInterrupted<T extends { id: string; status: string; startedAt?: number; createdAt: number; decidedAt?: number; result?: unknown }>(list: T[], now: number): boolean {
  let changed = false;
  for (const r of list) {
    if (r.status !== "running" || active().has(r.id)) continue;
    if (now - (r.startedAt ?? r.decidedAt ?? r.createdAt) < INTERRUPTED_AFTER_MS) continue;
    r.status = "failed"; r.result = INTERRUPTED; changed = true;
  }
  return changed;
}

export async function getRun(id: string, now = deps.now()): Promise<MaintenanceRun | null> {
  return exclusive(async () => {
    const list = await loadRuns();
    if (closeInterrupted(list, now)) await saveRuns(list);
    return list.find((r) => r.id === id) ?? null;
  });
}
export async function listRuns(now = deps.now()): Promise<MaintenanceRun[]> {
  return exclusive(async () => {
    const list = await loadRuns();
    if (closeInterrupted(list, now)) await saveRuns(list);
    return list.slice().reverse();
  });
}

async function createRun(run: MaintenanceRun): Promise<void> {
  await exclusive(async () => { const list = await loadRuns(); list.push(run); await saveRuns(list); });
}
async function updateRun(id: string, change: (r: MaintenanceRun) => void): Promise<void> {
  await exclusive(async () => {
    const list = await loadRuns();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    change(r);
    await saveRuns(list);
  });
}

/* ───────────── The runner ───────────── */

/** What the work can tell while it runs. */
export type RunContext = {
  /** The plan, once it is known (a direct run prepares its plan inside the work). */
  setPlan(plan: Plan): void;
  /** One more module (or step) done. */
  step(total: number, item: RunProgress["items"][number]): void;
};

/** Where the record lives: a direct run of its own, or the request an owner approved. */
export type RecordStore = {
  setPlan(plan: Plan): Promise<void>;
  setProgress(progress: RunProgress): Promise<void>;
  finish(result: RunResult): Promise<void>;
};

export type Started = { started: true; requestId: string; message: string };
export type RunDone = { started: false; requestId: string; outcome: Outcome };

/** The record of a new direct run. */
export async function openRun(input: { action: string; tokenId: string; tokenName: string }): Promise<{ id: string; store: RecordStore }> {
  const id = `run_${crypto.randomBytes(9).toString("base64url")}`;
  await createRun({ id, action: input.action, tokenId: input.tokenId, tokenName: redactSecrets(input.tokenName, 80), createdAt: deps.now(), status: "running" });
  return {
    id,
    store: {
      setPlan: (plan) => updateRun(id, (r) => { r.plan = plan; }),
      setProgress: (progress) => updateRun(id, (r) => { r.progress = progress; }),
      finish: (result) => updateRun(id, (r) => { r.status = result.ok ? "done" : "failed"; r.result = boundResult(result); r.finishedAt = deps.now(); }),
    },
  };
}

/**
 * Runs `work` under the lock and waits for it `deps.quickWaitMs`. Returns the outcome if it was over in time, otherwise `Started`. The caller has already checked
 * the rights, taken the rate-limit slot and (for an approved request) claimed the request.
 */
export async function runInBackground(opts: {
  id: string; store: RecordStore; lock: { release: () => void };
  work: (ctx: RunContext) => Promise<Outcome>;
  /** Audit line and owner's notice; skipped when the work was refused before doing anything. */
  after: (outcome: Outcome) => Promise<void>;
}): Promise<Started | RunDone> {
  const { id, store } = opts;
  active().add(id);
  let progress: RunProgress = { total: 0, done: 0, items: [] };
  let writing: Promise<void> = Promise.resolve();
  const ctx: RunContext = {
    setPlan: (plan) => { writing = writing.then(() => store.setPlan(plan)).catch(() => {}); },
    step: (total, item) => {
      progress = { total, done: progress.done + 1, items: [...progress.items, item].slice(-200) };
      const snapshot = progress;
      writing = writing.then(() => store.setProgress(snapshot)).catch(() => {});
    },
  };
  const finished = (async (): Promise<Outcome> => {
    let outcome: Outcome;
    try { outcome = await opts.work(ctx); } catch (error) {
      console.error("[maintenance] background work failed:", (error as Error)?.message);
      outcome = { ok: false, message: "The action failed unexpectedly. Check maintenance_health." };
    } finally { opts.lock.release(); }
    try {
      await writing;
      const result: RunResult = { ok: outcome.ok, message: outcome.message, ...(outcome.details !== undefined ? { details: outcome.details } : {}) };
      await store.finish(result);
      if (!outcome.refused) await opts.after(outcome);
    } catch (error) {
      console.error("[maintenance] could not close the record:", (error as Error)?.message);
    } finally { active().delete(id); }
    return outcome;
  })();

  const wait = Math.min(MAX_QUICK_WAIT_MS, Math.max(0, deps.quickWaitMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"running">((resolve) => { timer = setTimeout(() => resolve("running"), wait); });
  try {
    const first = await Promise.race([finished, timeout]);
    if (first === "running") return { started: true, requestId: id, message: "Started in the background. It does not depend on this connection: follow it with maintenance_request_status (requestId) until its status is done or failed. Do not start it again." };
    return { started: false, requestId: id, outcome: first };
  } finally { clearTimeout(timer); }
}
