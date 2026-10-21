import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

/**
 * SUIVI D'OPÉRATION. Une opération longue (installer un module, tout mettre à jour, sauvegarder, restaurer…) tourne CÔTÉ SERVEUR, même si l'onglet se ferme.
 * Ce petit registre en mémoire du processus en garde l'avancement (étapes nommées, n/m, état, erreur) pour que le navigateur qui l'a lancée puisse le lire.
 *
 *  - Honnête : seules des étapes que le code annonce vraiment (`opStep`) font avancer la barre ; sans étapes connues (`steps: null`), pas de fraction.
 *  - Borné : au plus MAX_OPS opérations, 12 étapes, textes courts ; une opération finie est oubliée après FINISHED_TTL_MS, une opération « en cours »
 *    depuis plus de MAX_RUN_MS est déclarée perdue. Aucun minuteur : le ménage se fait à chaque appel.
 *  - Un seul lancement à la fois par clé (`install:monmodule`) : un second appel REJOINT l'opération en cours au lieu d'en lancer une autre.
 *  - Aucune donnée sensible : jamais de secret, de jeton ni de chemin disque (les textes d'erreur sont nettoyés par `safeText`).
 *  - L'état est rangé sur `globalThis` : les actions serveur et les routes de Next.js n'ont pas toujours le même exemplaire de ce module.
 */

export type OpKind = "core-update" | "install" | "module-update" | "modules-update" | "module-reinstall" | "backup" | "restore";
export type OpState = "running" | "done" | "failed";

/** Étapes annoncées par type d'opération (identifiants ; le texte en mots simples est `progress.step.<id>`). `null` = étapes inconnues : barre indéterminée. */
export const OP_STEPS: Record<OpKind, readonly string[] | null> = {
  /** La mise à jour du site n'est pas suivie en mémoire (voir coreUpdate.ts). */
  "core-update": null,
  install: ["download", "verify", "deps", "activate", "data"],
  "module-update": ["download", "verify", "deps", "data", "activate"],
  "modules-update": ["download", "verify", "deps", "data", "activate"],
  "module-reinstall": ["download", "verify", "activate"],
  backup: ["collect", "readable", "files", "seal"],
  restore: ["modules", "safety", "replace", "files", "finish"],
};

export const MAX_OPS = 40;
export const FINISHED_TTL_MS = 10 * 60_000;
export const MAX_RUN_MS = 2 * 3600_000;
/** Combien de temps un appel qui REJOINT une opération l'attend, au plus. */
export const JOIN_WAIT_MS = 30 * 60_000;
const MAX_TEXT = 300;
const MAX_NAME = 80;
export const OP_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type OpSnapshot = {
  id: string; kind: OpKind; state: OpState;
  /** Étapes connues, dans l'ordre ; null = inconnues. */
  steps: string[] | null;
  /** Étape en cours (identifiant) et sa position 1..n ; 0 tant qu'aucune n'a commencé. */
  step: string | null; stepIndex: number;
  /** « Module 2 sur 5 » : élément en cours quand l'opération en traite plusieurs à la suite. */
  unit: { index: number; total: number; name: string } | null;
  /** Avancement 0..1, ou null (inconnu : barre indéterminée). */
  fraction: number | null;
  /** Texte d'erreur déjà lisible et nettoyé, ou null. */
  error: string | null;
  startedAt: number; updatedAt: number;
};

type Op = OpSnapshot & { owner: string; key: string; promise: Promise<unknown>; aliases: Set<string> };
type Store = { ops: Map<string, Op>; alias: Map<string, string>; als: AsyncLocalStorage<{ id: string }> };
const slot = globalThis as unknown as { curiosaOperations?: Store };
const store = (): Store => (slot.curiosaOperations ??= { ops: new Map(), alias: new Map(), als: new AsyncLocalStorage() });

export class OperationBusy extends Error { constructor() { super("operations-busy"); } }
export class OperationWaitTimeout extends Error { constructor() { super("operation-wait-timeout"); } }

/** Texte sans chemin disque, adresse locale, jeton ni long identifiant, sur une ligne, borné. */
export function safeText(input: unknown, max = MAX_TEXT): string {
  return String(input ?? "")
    .replace(/(?:[A-Za-z]:\\|\/)(?:[\w.@~+-]+[\\/])+[\w.@~+-]*/g, "…")
    .replace(/[A-Za-z0-9_+=-]{32,}/g, "…")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

function fractionOf(op: Pick<OpSnapshot, "steps" | "stepIndex" | "unit" | "state">): number | null {
  if (op.state === "done") return 1;
  if (!op.steps?.length) return null;
  const within = Math.max(0, op.stepIndex - 1) / op.steps.length;
  const f = op.unit && op.unit.total > 0 ? (op.unit.index - 1 + within) / op.unit.total : within;
  return Math.min(0.99, Math.max(0, f));
}

function sweep(now = Date.now()): void {
  const { ops, alias } = store();
  for (const op of ops.values()) {
    if (op.state === "running" && now - op.startedAt > MAX_RUN_MS) { op.state = "failed"; op.error = "lost"; op.updatedAt = now; op.fraction = null; }
    if (op.state !== "running" && now - op.updatedAt > FINISHED_TTL_MS) {
      ops.delete(op.id);
      for (const a of op.aliases) alias.delete(a);
    }
  }
  for (const [a, id] of alias) if (!ops.has(id)) alias.delete(a);
}

function snapshotOf(op: Op): OpSnapshot {
  const { owner: _o, key: _k, promise: _p, aliases: _a, ...snap } = op;
  void _o; void _k; void _p; void _a;
  return { ...snap, steps: snap.steps ? [...snap.steps] : null, unit: snap.unit ? { ...snap.unit } : null, fraction: fractionOf(snap) };
}

/** Une opération en cours pour cette clé (pour montrer « en cours » à l'ouverture d'une page) : son identifiant, si `viewer` y a droit. */
export function runningOperation(key: string, viewer: { email: string; owner: boolean }): OpSnapshot | null {
  sweep();
  for (const op of store().ops.values()) if (op.key === key && op.state === "running" && (op.owner === viewer.email || viewer.owner)) return snapshotOf(op);
  return null;
}

/**
 * Lance `fn` comme opération suivie. Une opération déjà en cours pour la même `key` est REJOINTE (son résultat est rendu, `joined: true`).
 * `opId` : identifiant choisi par le navigateur (pour lire l'avancement avant même la fin de l'action) ; ignoré s'il est invalide ou déjà pris.
 * `judge` dit si le résultat est un échec (état « failed » et texte d'erreur), sinon l'opération est « done ».
 */
export async function runOperation<R>(
  spec: { kind: OpKind; key: string; owner: string; opId?: string | null; unitTotal?: number },
  fn: () => Promise<R>,
  judge?: (result: R) => { ok: boolean; error?: string },
): Promise<{ joined: boolean; id: string; result: R }> {
  const st = store();
  sweep();
  const wanted = typeof spec.opId === "string" && OP_ID_RE.test(spec.opId) && !st.ops.has(spec.opId) && !st.alias.has(spec.opId) ? spec.opId : null;
  const running = [...st.ops.values()].find((o) => o.key === spec.key && o.state === "running");
  if (running) {
    if (wanted) { st.alias.set(wanted, running.id); running.aliases.add(wanted); }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new OperationWaitTimeout()), JOIN_WAIT_MS); });
    try { return { joined: true, id: running.id, result: (await Promise.race([running.promise, timeout])) as R }; } finally { clearTimeout(timer); }
  }
  if (st.ops.size >= MAX_OPS) {
    const oldest = [...st.ops.values()].filter((o) => o.state !== "running").sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!oldest) throw new OperationBusy();
    st.ops.delete(oldest.id);
    for (const a of oldest.aliases) st.alias.delete(a);
  }
  const id = wanted ?? crypto.randomBytes(16).toString("base64url");
  const now = Date.now();
  const steps = OP_STEPS[spec.kind];
  const op = {
    id, kind: spec.kind, state: "running", steps: steps ? [...steps] : null, step: null, stepIndex: 0,
    unit: spec.unitTotal ? { index: 0, total: Math.max(1, Math.min(500, Math.floor(spec.unitTotal))), name: "" } : null,
    fraction: null, error: null, startedAt: now, updatedAt: now, owner: spec.owner, key: spec.key, aliases: new Set<string>(), promise: Promise.resolve(),
  } as Op;
  st.ops.set(id, op);
  const finish = (state: OpState, error: string | null) => { op.state = state; op.error = error; op.updatedAt = Date.now(); if (state === "failed") op.fraction = null; };
  op.promise = st.als.run({ id }, fn).then(
    (result) => {
      const verdict = judge ? judge(result) : { ok: true };
      finish(verdict.ok ? "done" : "failed", verdict.ok ? null : safeText(verdict.error ?? "failed"));
      return result;
    },
    (error) => { finish("failed", "failed"); throw error; },
  );
  // L'opération continue même si plus personne ne l'attend : une erreur non attendue ne doit pas faire tomber le processus.
  op.promise.catch(() => {});
  return { joined: false, id, result: (await op.promise) as R };
}

/** Annonce qu'une étape commence. Sans effet hors d'une opération suivie, ou si l'étape n'est pas dans la liste du type d'opération (jamais de fausse étape). */
export function opStep(stepId: string): void {
  const st = store();
  const ctx = st.als.getStore();
  const op = ctx ? st.ops.get(ctx.id) : undefined;
  if (!op || op.state !== "running" || !op.steps) return;
  const i = op.steps.indexOf(stepId);
  if (i === -1) return;
  op.step = stepId; op.stepIndex = i + 1; op.updatedAt = Date.now();
}

/** Annonce l'élément en cours quand l'opération en traite plusieurs (« module 2 sur 5 »). Repart de la première étape. */
export function opUnit(index: number, total: number, name: string): void {
  const st = store();
  const ctx = st.als.getStore();
  const op = ctx ? st.ops.get(ctx.id) : undefined;
  if (!op || op.state !== "running") return;
  op.unit = { index: Math.max(1, Math.min(500, Math.floor(index))), total: Math.max(1, Math.min(500, Math.floor(total))), name: safeText(name, MAX_NAME) };
  op.step = null; op.stepIndex = 0; op.updatedAt = Date.now();
}

/** Ce que `viewer` a le droit de lire : le suivi de ses propres opérations, ou tout pour un propriétaire. `null` si inconnu (jamais lancée, oubliée, redémarrage du site) ou interdit : même réponse. */
export function readOperation(id: string, viewer: { email: string; owner: boolean }): OpSnapshot | null {
  if (!OP_ID_RE.test(id)) return null;
  sweep();
  const st = store();
  const op = st.ops.get(st.alias.get(id) ?? id);
  if (!op || (op.owner !== viewer.email && !viewer.owner)) return null;
  return snapshotOf(op);
}

/** Pour les tests. */
export function resetOperations(): void { const st = store(); st.ops.clear(); st.alias.clear(); }
export function operationCount(): number { return store().ops.size; }
