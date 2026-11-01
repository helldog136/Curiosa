"use client";

import { createContext, useContext } from "react";

type Labels = Record<string, string>;
const Ctx = createContext<Labels>({});

/** Donne à tous les boutons d'action et barres de progression de l'admin leurs textes (déjà traduits), sans les repasser un à un. */
export function ProgressLabelsProvider({ labels, children }: { labels: Labels; children: React.ReactNode }) {
  return <Ctx.Provider value={labels}>{children}</Ctx.Provider>;
}

export type ProgressText = (key: string, vars?: Record<string, string | number>) => string;

/** `p("working")` → « Je m'en occupe… » ; `{n}` remplacés. Clé absente : la clé elle-même (jamais une erreur). */
export function useProgressText(): ProgressText {
  const labels = useContext(Ctx);
  return (key, vars) => {
    let text = labels[key] ?? `progress.${key}`;
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  };
}

/** Texte d'une étape : propre au type d'opération s'il existe, sinon commun. */
export function stepText(labels: Labels, kind: string, stepId: string, core = false): string | null {
  const keys = core ? [`step.core.${stepId}`] : [`step.${kind}.${stepId}`, `step.${stepId}`];
  for (const k of keys) if (labels[k]) return labels[k]!;
  return null;
}

export function useStepText(): (kind: string, stepId: string | null, core?: boolean) => string | null {
  const labels = useContext(Ctx);
  return (kind, stepId, core = false) => (stepId ? stepText(labels, kind, stepId, core) : null);
}
