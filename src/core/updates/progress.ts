/**
 * Présentation de l'état d'une mise à jour pour la page « Mises à jour » : où en est-on (étape de la chaîne, étape technique), quelle part du chemin
 * est faite, et que dire à quelqu'un qui n'est pas technicien. Pur (aucune lecture de fichier) : l'état vient de `readUpdateState()`.
 */

/** Étapes techniques d'une version, dans l'ordre, avec la part du travail déjà faite quand elles commencent. */
const STEP_SHARE: Record<string, number> = { starting: 0, backup: 0.1, download: 0.35, verify: 0.6, swap: 0.8, between: 1, done: 1 };

export type UpdateStateLike = {
  status: "idle" | "running" | "success" | "failed";
  target?: string;
  step?: string;
  chain?: { index: number; total: number; steps: string[] } | null;
  remaining?: string[];
  error?: string | null;
};

export type ChainItem = { tag: string; status: "done" | "current" | "waiting" };
export type Progress = {
  /** Numéro de la version en cours (1 si la mise à jour ne passe que par une version) et nombre de versions à installer. */
  index: number;
  total: number;
  /** Avancement global, 0 à 100. */
  percent: number;
  /** Clé de traduction de l'étape en cours (`updates.step.<nom>`), ou null si inconnue. */
  stepKey: string | null;
  /** Les versions du chemin, avec celle qui est en cours ; vide quand il n'y a qu'une version. */
  chain: ChainItem[];
};

/** Avancement d'une mise à jour en cours. Étape inconnue : on ne prétend pas savoir, la barre reste au début de la version. */
export function describeProgress(state: UpdateStateLike): Progress {
  const total = Math.max(1, state.chain?.total ?? 1);
  const index = Math.min(total, Math.max(1, state.chain?.index ?? 1));
  const step = state.step ?? "starting";
  const share = STEP_SHARE[step] ?? 0;
  const percent = Math.round((((index - 1) + share) / total) * 100);
  const steps = state.chain?.steps ?? [];
  return {
    index, total, percent: Math.min(100, Math.max(0, percent)),
    stepKey: step in STEP_SHARE || step === "rollback" || step === "plan" ? `updates.step.${step}` : null,
    chain: total > 1 ? steps.map((tag, i) => ({ tag, status: i + 1 < index ? "done" : i + 1 === index ? "current" : "waiting" })) : [],
  };
}

/** Raison d'un échec, en clé de traduction courante : le détail technique (étape qui a planté) reste pour le mode avancé. */
export function failureKey(error: string | null | undefined): { key: string; step: string | null } {
  const e = error ?? "";
  if (e === "checksum-mismatch" || e === "bad-archive" || e === "plan-failed") return { key: `updates.failure.${e}`, step: null };
  const m = /^step-failed:(.+)$/.exec(e);
  return { key: "updates.failure.step", step: m?.[1] ?? null };
}

/** Une mise à jour interrompue entre deux versions : reste-t-il des versions à installer à la suite ? */
export function hasRemaining(state: UpdateStateLike): boolean {
  return state.status === "success" && (state.remaining?.length ?? 0) > 0;
}
