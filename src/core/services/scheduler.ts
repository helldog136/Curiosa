import { buildContext } from "@/core/modules/context";
import { getActiveInstances } from "@/core/modules/registry";
import { getSetting, setSetting } from "@/core/settings";

/**
 * TÂCHES PLANIFIÉES — service du cœur. Un module déclare `tasks: { nom: { everyMinutes, run(ctx) } }` ; le cœur les exécute en arrière-plan,
 * pour chaque instance active, sans chevauchement (une tâche encore en cours n'est pas relancée), avec les erreurs isolées (une tâche qui
 * plante n'arrête ni les autres ni le serveur) et le dernier résultat mémorisé (`instance.<id>.__task.<nom>`, visible dans l'admin).
 * Une tâche jamais exécutée l'est au premier passage. Aucun cron système : un minuteur dans le processus du serveur (comme les mises à jour).
 */
export type TaskState = { lastRun: string; status: "ok" | "failed"; error?: string; durationMs: number };
export type TaskOutcome = { instanceId: string; key: string; task: string; status: "ok" | "failed" | "skipped"; error?: string };

const TICK = 60_000;
const FIRST = 30_000;
const TIMEOUT = 5 * 60_000;
const NAME_RE = /^[a-z][a-z0-9-]{0,40}$/;
const g = globalThis as unknown as { curiosaTaskScheduler?: boolean; curiosaTasksRunning?: Set<string> };
const running = (g.curiosaTasksRunning ??= new Set<string>());

export const taskKey = (instanceId: string, task: string) => `instance.${instanceId}.__task.${task}`;
export const taskStateOf = (instanceId: string, task: string) => getSetting<TaskState>(taskKey(instanceId, task));

async function runOne(a: Awaited<ReturnType<typeof getActiveInstances>>[number], name: string, run: (ctx: never) => unknown): Promise<TaskOutcome> {
  const guard = `${a.instance.id}:${name}`;
  const base = { instanceId: a.instance.id, key: a.instance.key, task: name };
  running.add(guard);
  const started = Date.now();
  let state: TaskState;
  let settled: Promise<unknown> = Promise.resolve();
  try {
    const work = Promise.resolve().then(async () => (run as (c: unknown) => unknown)(await buildContext(a.mod, a.instance)));
    settled = work.catch(() => {});
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("timeout")), TIMEOUT); timer.unref?.(); })]).finally(() => clearTimeout(timer));
    state = { lastRun: new Date().toISOString(), status: "ok", durationMs: Date.now() - started };
  } catch (error) {
    const message = String((error as Error)?.message ?? error).slice(0, 300);
    console.error(`[tasks] ${a.instance.key}/${name} failed:`, message);
    state = { lastRun: new Date().toISOString(), status: "failed", error: message, durationMs: Date.now() - started };
  } finally {
    // Même après un délai dépassé, la tâche n'est relancée qu'une fois réellement terminée.
    void settled.then(() => running.delete(guard));
  }
  await setSetting(taskKey(a.instance.id, name), state).catch(() => {});
  return { ...base, status: state.status, ...(state.error ? { error: state.error } : {}) };
}

/** Exécute les tâches dues. `only` restreint à une instance (« Exécuter maintenant »). Ne lève jamais. */
export async function runDueTasks(opts: { now?: number; instanceId?: string; force?: boolean } = {}): Promise<TaskOutcome[]> {
  const now = opts.now ?? Date.now();
  const out: TaskOutcome[] = [];
  const pending: Promise<TaskOutcome>[] = [];
  let active: Awaited<ReturnType<typeof getActiveInstances>> = [];
  try { active = await getActiveInstances(); } catch (error) { console.error("[tasks] cannot list instances:", (error as Error)?.message); return out; }
  for (const a of active) {
    if (opts.instanceId && a.instance.id !== opts.instanceId) continue;
    for (const [name, task] of Object.entries(a.mod.def.tasks ?? {})) {
      if (!NAME_RE.test(name) || typeof task?.run !== "function" || !(task.everyMinutes >= 1)) continue;
      if (running.has(`${a.instance.id}:${name}`)) { out.push({ instanceId: a.instance.id, key: a.instance.key, task: name, status: "skipped" }); continue; }
      const last = await taskStateOf(a.instance.id, name).catch(() => null);
      // Un peu de marge : le minuteur dérive de quelques centaines de ms, on ne veut pas manquer un passage.
      const due = !last || now - Date.parse(last.lastRun) >= task.everyMinutes * 60_000 - 5_000;
      if (!opts.force && !due) continue;
      pending.push(runOne(a, name, task.run as never));   // en parallèle : une tâche lente ne retarde pas les autres
    }
  }
  return [...out, ...(await Promise.all(pending))];
}

/** Un seul minuteur par processus ; ne retient jamais l'arrêt du serveur. */
export function startTaskScheduler(): void {
  if (g.curiosaTaskScheduler) return;
  g.curiosaTaskScheduler = true;
  const tick = () => runDueTasks().catch((error) => console.error("[tasks] tick failed:", error?.message));
  setTimeout(() => { void tick(); setInterval(() => void tick(), TICK).unref(); }, FIRST).unref();
}
