"use client";

import { useState } from "react";
import { DONE_MS, fillStyle, isBusy, runAtLeast, shownPhase, sleep, type Phase } from "./animatedAction";
import { ui } from "./ui";

export type ActionLabels = { idle: string; working: string; done: string; failed: string };
export type ActionResult = { ok: boolean; error?: string };

type Props = {
  /** Lance l'action ; `ok: false` affiche l'erreur (le message `error` s'il est fourni, sinon `labels.failed`). */
  run: () => Promise<ActionResult>;
  /** Appelé après « ✓ » (navigation, rafraîchissement…) ; reçoit le résultat. */
  onDone?: (result: ActionResult) => void | Promise<void>;
  /** Appelé après l'affichage de l'erreur. */
  onFail?: (result: ActionResult | null) => void | Promise<void>;
  labels: ActionLabels;
  /** Pictogramme au repos (et qui rebondit pendant l'action). */
  icon: string;
  /** « fill » : une barre se remplit en MIN_MS ; « continuous » : une barre défile en continu tant que ça dure. */
  progress?: "fill" | "continuous";
  /** Variante : grand bouton plein (fiche, mise à jour) ou petit bouton de liste. */
  look?: "hero" | "primary" | "secondary";
  /** Demande confirmation (boîte du navigateur) avant de lancer. */
  confirm?: string;
  /** Le serveur travaille déjà (mise à jour en cours au chargement de la page) : bouton animé et désactivé. */
  running?: boolean;
  testid?: string;
  className?: string;
};

/** Couleur de la barre : claire sur un bouton plein, teintée sur un bouton clair. */
const BARS = { hero: "bg-white/30", primary: "bg-white/30", secondary: "bg-accent/20" } as const;
const LOOKS = {
  hero: "min-w-48 rounded-full bg-accent px-8 py-3 text-base font-semibold text-accent-fg shadow-lg transition-transform enabled:hover:-translate-y-0.5",
  primary: `${ui.btnPrimary} min-w-40`,
  secondary: `${ui.btn} min-w-32`,
} as const;

/**
 * Bouton d'action « qui travaille » : au clic une barre se remplit (ou défile) et la flèche rebondit, puis « ✓ » ; en cas d'échec un message clair.
 * Partagé par l'installation, la mise à jour du site et celles des modules. Avec `prefers-reduced-motion`, rien ne bouge : seuls le libellé
 * et l'état (barre statique) changent.
 */
export function AnimatedActionButton({ run, onDone, onFail, labels, icon, progress = "fill", look = "primary", confirm: confirmMessage, running = false, testid, className = "" }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const shown = shownPhase(phase, running);
  const busy = isBusy(phase, running);

  async function click() {
    if (busy) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setMessage(null);
    setPhase("working");
    const result = await runAtLeast(run);
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

  const continuous = progress === "continuous";
  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <button type="button" onClick={click} disabled={busy} data-phase={shown} data-testid={testid} aria-live="polite" aria-busy={shown === "working"}
        className={`relative inline-flex items-center justify-center gap-2 overflow-hidden disabled:cursor-default disabled:opacity-100 ${LOOKS[look]}`}>
        {continuous && shown === "working" ? (
          <span aria-hidden="true" data-testid="action-bar" className={`curiosa-indeterminate absolute inset-y-0 left-0 w-2/5 ${BARS[look]}`} />
        ) : (
          <span aria-hidden="true" data-testid="action-bar" className={`absolute inset-y-0 left-0 ease-out ${BARS[look]}`} style={{ ...fillStyle(shown), transitionProperty: "width" }} />
        )}
        <span className="relative flex items-center gap-2">
          {shown === "done" ? <span aria-hidden="true">✓</span> : <span aria-hidden="true" className={shown === "working" ? "inline-block motion-safe:animate-bounce" : undefined}>{icon}</span>}
          {shown === "done" ? labels.done : shown === "working" ? labels.working : labels.idle}
        </span>
      </button>
      {phase === "error" && message && <p role="alert" className="max-w-xs rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1 text-center text-sm text-red-700">{message}</p>}
    </div>
  );
}
