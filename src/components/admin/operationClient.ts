/**
 * Côté navigateur du suivi d'opération (voir src/core/operations) : logique pure, sans React ni DOM, donc testable telle quelle.
 *
 * Règles : on ne lit l'avancement QUE pendant une opération que CE navigateur a lancée ; on s'arrête dès qu'elle est finie, introuvable ou trop longue ;
 * on se met en pause quand l'onglet est caché (aucun minuteur de fond) ; l'attente grandit (700 ms → 3 s) au lieu de marteler le serveur.
 */

export type OpSnapshotLike = {
  id: string; kind: string; state: "running" | "done" | "failed";
  steps: string[] | null; step: string | null; stepIndex: number;
  unit: { index: number; total: number; name: string } | null;
  fraction: number | null; error: string | null;
  /** Mise à jour du site seulement. */
  restarting?: boolean; expectedVersion?: string | null; rolledBack?: boolean;
};

export const OPERATIONS_URL = "/api/admin/operations";
/** Avant la première lecture : une action rapide n'a jamais besoin du suivi. */
export const POLL_FIRST_MS = 500;
export const POLL_MAX_MS = 3000;
/** Au-delà, on arrête de lire (l'opération continue sur le serveur ; la page la montrera au rechargement). */
export const POLL_GIVE_UP_MS = 45 * 60_000;
/** Lectures ratées de suite avant de dire « je ne peux plus suivre » (le site redémarre peut-être). */
export const POLL_FAILS_BEFORE_LOST = 3;

export function nextPollDelay(attempt: number): number {
  return Math.min(POLL_MAX_MS, Math.round(700 * 1.5 ** Math.max(0, attempt)));
}

const OP_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const isOpId = (v: unknown): v is string => typeof v === "string" && OP_ID_RE.test(v);

/** Identifiant d'opération choisi par le navigateur (le serveur le valide et ne s'y fie pas pour les droits). */
export function newOpId(c: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined = typeof crypto === "undefined" ? undefined : crypto): string {
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type FetchedOp = { status: number; operation?: OpSnapshotLike } | null;
export type PollerDeps = {
  /** Lit l'opération ; `null` = le réseau a échoué. */
  fetchOp: (id: string) => Promise<FetchedOp>;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  isHidden: () => boolean;
  onSnapshot: (op: OpSnapshotLike) => void;
  /** Le serveur ne connaît pas (ou plus) cette opération : redémarrage du site, oubli, droits. */
  onUnknown: () => void;
  /** Plusieurs lectures ratées de suite : le site est peut-être en train de redémarrer. */
  onUnreachable: () => void;
  onGiveUp: () => void;
};

export type Poller = {
  start: (id: string) => void;
  stop: () => void;
  /** L'onglet redevient visible : une lecture tout de suite. */
  visibilityChanged: () => void;
  readonly active: boolean;
};

export function createPoller(deps: PollerDeps): Poller {
  let id: string | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let fails = 0;
  let startedAt = 0;
  let paused = false;
  let busy = false;

  const clear = () => { if (timer !== null) { deps.clearTimer(timer); timer = null; } };
  const schedule = (ms: number) => { clear(); timer = deps.setTimer(() => { timer = null; void tick(); }, ms); };
  const stop = () => { clear(); id = null; paused = false; };

  async function tick(): Promise<void> {
    const mine = id;
    if (!mine || busy) return;
    if (deps.now() - startedAt > POLL_GIVE_UP_MS) { stop(); deps.onGiveUp(); return; }
    if (deps.isHidden()) { paused = true; return; }   // pas de minuteur de fond : on reprendra à la réapparition de l'onglet
    busy = true;
    let res: FetchedOp;
    try { res = await deps.fetchOp(mine); } catch { res = null; } finally { busy = false; }
    if (id !== mine) return;   // arrêtée pendant la lecture
    if (!res || res.status >= 500 || res.status === 401) {
      fails++;
      if (fails === POLL_FAILS_BEFORE_LOST) deps.onUnreachable();
    } else if (res.status === 404 || !res.operation) {
      stop(); deps.onUnknown(); return;
    } else {
      fails = 0;
      deps.onSnapshot(res.operation);
      if (res.operation.state !== "running") { stop(); return; }
    }
    schedule(nextPollDelay(attempt++));
  }

  return {
    start(next) { stop(); id = next; attempt = 0; fails = 0; startedAt = deps.now(); schedule(POLL_FIRST_MS); },
    stop,
    visibilityChanged() { if (id && paused && !deps.isHidden()) { paused = false; clear(); void tick(); } },
    get active() { return id !== null; },
  };
}

/** Lecture réelle de l'opération (navigateur). Ne lève jamais. */
export async function fetchOperation(id: string, doFetch: typeof fetch = fetch): Promise<FetchedOp> {
  try {
    const res = await doFetch(`${OPERATIONS_URL}/${encodeURIComponent(id)}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { status: res.status };
    const json = (await res.json()) as { operation?: OpSnapshotLike };
    return { status: 200, operation: json.operation };
  } catch { return null; }
}

/** Ce que la barre doit dire : étape en cours, « n sur m » et part faite (null = indéterminée). Jamais de pourcentage inventé. */
export type OpView = { stepId: string | null; stepNumber: number; stepTotal: number; unit: { index: number; total: number; name: string } | null; percent: number | null; preparing: boolean };
export function viewOf(op: OpSnapshotLike | null): OpView {
  if (!op) return { stepId: null, stepNumber: 0, stepTotal: 0, unit: null, percent: null, preparing: false };
  const unit = op.unit && op.unit.total > 1 && op.unit.index >= 1 ? op.unit : null;
  const preparing = !!op.unit && op.unit.total > 1 && op.unit.index === 0;
  const percent = op.fraction === null || !Number.isFinite(op.fraction) ? null : Math.round(Math.min(1, Math.max(0, op.fraction)) * 100);
  return { stepId: op.step, stepNumber: op.stepIndex, stepTotal: op.steps?.length ?? 0, unit, percent, preparing };
}

/* ── Attente du redémarrage du site (mise à jour du site) ─────────────────────────────────────────────────────────────────────────────── */

export const RESTART_WATCH_MAX_MS = 5 * 60_000;
export const HEALTH_URL = "/api/health";

/** Délai avant la prochaine tentative pendant que le site redémarre : 1,5 s puis jusqu'à 5 s. */
export const restartDelay = (attempt: number): number => Math.min(5000, Math.round(1500 * 1.25 ** Math.max(0, attempt)));

export type RestartDeps = {
  health: () => Promise<{ ok: boolean; versionHash: string | null } | null>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  aborted: () => boolean;
};

/** Attend (au plus RESTART_WATCH_MAX_MS) que le site réponde de nouveau. `fresh` : l'empreinte de version n'est plus celle d'avant. */
export async function waitForSite(deps: RestartDeps, before: string | null): Promise<{ state: "back"; fresh: boolean } | { state: "timeout" } | { state: "aborted" }> {
  const t0 = deps.now();
  for (let attempt = 0; ; attempt++) {
    if (deps.aborted()) return { state: "aborted" };
    if (deps.now() - t0 > RESTART_WATCH_MAX_MS) return { state: "timeout" };
    let h: Awaited<ReturnType<RestartDeps["health"]>> = null;
    try { h = await deps.health(); } catch { h = null; }
    if (h?.ok) return { state: "back", fresh: !!h.versionHash && !!before && h.versionHash !== before };
    await deps.sleep(restartDelay(attempt));
  }
}

export async function readHealth(doFetch: typeof fetch = fetch): Promise<{ ok: boolean; versionHash: string | null } | null> {
  try {
    const res = await doFetch(HEALTH_URL, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return { ok: res.ok, versionHash: res.headers.get("x-curiosa-version") };
  } catch { return null; }
}
