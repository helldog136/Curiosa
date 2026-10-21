"use client";

import { useState } from "react";
import { DONE_MS, isBusy, runAtLeast, shownPhase, sleep, type Phase } from "./animatedAction";
import { LabelStack, Spinner } from "./ActionKit";
import { askConfirm } from "./confirmDialog";
import { OperationProgress } from "./OperationProgress";
import { useProgressText } from "./ProgressLabels";
import type { OpSnapshotLike } from "./operationClient";
import { useTrackedRun } from "./useTrackedRun";
import { ui } from "./ui";

export type ActionLabels = { idle: string; working: string; done: string; failed: string };
export type ActionResult = { ok: boolean; error?: string };

type Props = {
  /** Lance l'action ; `ok: false` affiche l'erreur (le message `error` s'il est fourni, sinon `labels.failed`). `opId` : identifiant à passer à l'action serveur pour suivre l'avancement. */
  run: (opId: string) => Promise<ActionResult>;
  /** Contrôle fait avant tout (champs obligatoires…) ; `false` annule en silence, sans animation. */
  beforeRun?: () => boolean;
  /** Appelé après « ✓ » (navigation, rafraîchissement…) ; reçoit le résultat. */
  onDone?: (result: ActionResult) => void | Promise<void>;
  /** Appelé après l'affichage de l'erreur. */
  onFail?: (result: ActionResult | null) => void | Promise<void>;
  labels: ActionLabels;
  /** Pictogramme au repos. */
  icon: string;
  /** Variante : grand bouton plein (fiche, mise à jour) ou petit bouton de liste. */
  look?: "hero" | "primary" | "secondary" | "danger";
  /** Demande confirmation (boîte dans la page) avant de lancer. */
  confirm?: string;
  /** Le serveur travaille déjà (mise à jour en cours au chargement de la page) : bouton occupé et inactif. */
  running?: boolean;
  /**
   * Type d'opération suivie (`install`, `modules-update`, `restore`…) : l'action serveur annonce ses étapes et une barre de progression RÉELLE s'affiche sous le bouton.
   * Sans lui (action sans étapes connues), le bouton montre seulement qu'il travaille : rouet et bande qui défile, jamais un faux pourcentage.
   */
  track?: string;
  /** Avec `track` : clé qui retrouve l'opération si la page est rechargée en cours de route (par exemple `install:monmodule`). */
  trackKey?: string;
  testid?: string;
  className?: string;
};

const LOOKS = {
  hero: "min-h-12 min-w-48 rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-fg shadow-lg transition-transform enabled:hover:-translate-y-0.5",
  primary: `${ui.btnPrimary} min-h-11 min-w-40`,
  secondary: `${ui.btn} min-h-11 min-w-32`,
  danger: `${ui.btnDanger} min-h-11 min-w-40`,
} as const;
/** Bande qui défile quand on ne connaît pas l'avancement : claire sur un bouton plein, teintée sur un bouton clair. */
const SWEEP = { hero: "bg-white/25", primary: "bg-white/25", secondary: "bg-accent/15", danger: "bg-red-500/15" } as const;

/**
 * Bouton d'action « qui travaille » : au clic il devient inactif (pas de double lancement), un rouet tourne et le libellé dit ce qui se passe, puis « ✓ » ;
 * en cas d'échec, un message clair et le bouton redevient normal. Avec `track`, une vraie barre d'étapes s'affiche en dessous. Avec `prefers-reduced-motion`, rien ne tourne ni ne défile.
 */
export function AnimatedActionButton({ run, beforeRun, onDone, onFail, labels, icon, look = "primary", confirm: confirmMessage, running = false, track, trackKey, testid, className = "" }: Props) {
  const p = useProgressText();
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const tracker = useTrackedRun(track ? trackKey : undefined, (op: OpSnapshotLike | null) => {
    // Une opération reprise après rechargement vient de se terminer : on rafraîchit comme après un clic.
    const result: ActionResult = op?.state === "done" ? { ok: true } : { ok: false, error: p("failedAdopted") };
    void (result.ok ? onDone?.(result) : onFail?.(result));
  });
  const external = running || tracker.adopted;
  const shown = shownPhase(phase, external);
  const busy = isBusy(phase, external);

  async function click() {
    if (busy) return;
    if (beforeRun && !beforeRun()) return;
    if (confirmMessage && !(await askConfirm(confirmMessage))) return;
    setMessage(null);
    setPhase("working");
    const opId = track ? tracker.begin() : "";
    const result = await runAtLeast(() => run(opId));
    tracker.end();
    if (!result || !result.ok) {
      setMessage(result?.error ?? labels.failed);
      setPhase("error");
      await onFail?.(result);
      return;
    }
    setPhase("done");
    await sleep(DONE_MS);
    try { await onDone?.(result); } catch { /* la navigation ne doit jamais défaire le « ✓ » */ }
    // La page est déjà passée à la suite (ou s'est rechargée) : le bouton, s'il est toujours là, revient au repos.
    await sleep(DONE_MS);
    setPhase("idle");
  }

  const working = shown === "working";
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <button type="button" onClick={click} disabled={busy} data-phase={shown} data-testid={testid} aria-busy={working}
        className={`relative inline-flex items-center justify-center gap-2 overflow-hidden disabled:cursor-progress disabled:opacity-100 ${LOOKS[look]}`}>
        {working && !track && <span aria-hidden="true" data-testid="action-bar" className={`curiosa-indeterminate absolute inset-y-0 left-0 w-2/5 ${SWEEP[look]}`} />}
        <span className="relative flex items-center gap-2">
          {shown === "done" ? <span aria-hidden="true">✓</span> : working ? <Spinner /> : <span aria-hidden="true">{icon}</span>}
          <LabelStack labels={[labels.idle, labels.working, labels.done]} shown={shown === "done" ? 2 : working ? 1 : 0} />
        </span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">{working ? labels.working : shown === "done" ? labels.done : ""}</span>
      {track && working && <OperationProgress kind={track} snap={tracker.snap} lost={tracker.lost} unreachable={tracker.unreachable} className="max-w-sm" />}
      {phase === "error" && message && <p role="alert" className="max-w-xs rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1 text-center text-sm text-red-700">{message}</p>}
    </div>
  );
}
