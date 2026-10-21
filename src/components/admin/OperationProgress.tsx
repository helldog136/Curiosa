"use client";

import { Spinner } from "./ActionKit";
import { viewOf, type OpSnapshotLike } from "./operationClient";
import { useProgressText, useStepText } from "./ProgressLabels";

type Props = {
  /** Type d'opération (pour le texte propre à chaque étape). */
  kind: string;
  snap: OpSnapshotLike | null;
  /** Le suivi est perdu ou le site ne répond plus : on le dit, la barre redevient indéterminée. */
  lost?: boolean;
  unreachable?: boolean;
  /** Étapes de la mise à jour du site (textes `step.core.*`). */
  core?: boolean;
  /** Texte de la ligne « élément n sur m » quand il ne s'agit pas de modules (par exemple « Version 2 sur 3 »). */
  unitText?: (u: { index: number; total: number; name: string }) => string;
  className?: string;
};

/**
 * Barre de progression d'une opération. Honnête : la part « faite » ne compte que des étapes terminées ; l'étape en cours est un segment qui pulse (on ne sait pas
 * combien elle durera) ; sans étapes connues (ou suivi perdu), la barre est indéterminée. Jamais un pourcentage inventé.
 */
export function OperationProgress({ kind, snap, lost = false, unreachable = false, core = false, unitText, className = "" }: Props) {
  const p = useProgressText();
  const stepText = useStepText();
  const v = viewOf(snap);
  const known = !lost && !unreachable && v.percent !== null;
  const step = stepText(kind, v.stepId, core) ?? (v.preparing ? p("preparing") : p("starting"));
  const unit = v.unit ? (unitText ? unitText(v.unit) : v.unit.name ? p("unitNamed", { index: v.unit.index, total: v.unit.total, name: v.unit.name }) : p("unit", { index: v.unit.index, total: v.unit.total })) : null;
  const count = !v.unit && v.stepNumber > 0 && v.stepTotal > 1 ? p("stepCount", { n: v.stepNumber, total: v.stepTotal }) : null;
  // Largeur d'une étape dans la barre (le segment qui pulse), au moins 6 % pour rester visible.
  const unitsTotal = v.unit?.total ?? 1;
  const segment = v.stepTotal > 0 ? Math.max(6, 100 / (v.stepTotal * unitsTotal)) : 0;
  const done = known ? v.percent! : 0;
  return (
    <div className={`w-full space-y-1.5 ${className}`} data-testid="operation-progress" data-known={known ? "true" : "false"}>
      {unit && <p className="truncate text-sm font-medium" data-testid="operation-unit">{unit}</p>}
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p aria-live="polite" className="min-w-0 text-muted" data-testid="operation-step">{lost ? p("lost") : unreachable ? p("restarting") : step}</p>
        {count && <p className="shrink-0 text-xs text-muted" data-testid="operation-count">{count}</p>}
      </div>
      <div role="progressbar" aria-label={p("aria")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={known ? done : undefined} aria-valuetext={known ? `${step} (${p("percent", { n: done })})` : step}
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-line" data-testid="operation-bar">
        {known ? (
          <>
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${done}%` }} data-testid="operation-fill" />
            {done < 100 && <div className="absolute inset-y-0 rounded-full bg-accent/40 motion-safe:animate-pulse" style={{ left: `${done}%`, width: `${Math.min(segment, 100 - done)}%` }} aria-hidden="true" />}
          </>
        ) : (
          <div className="curiosa-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-accent/70" aria-hidden="true" data-testid="operation-indeterminate" />
        )}
      </div>
      {unreachable && !lost && <p className="flex items-center gap-2 text-xs text-muted"><Spinner className="h-3 w-3" />{p("restartingHelp")}</p>}
    </div>
  );
}
