"use client";

import { createContext, useContext } from "react";

type Labels = Record<string, string>;
const Ctx = createContext<{ labels: Labels; advanced: boolean }>({ labels: {}, advanced: false });

/** Donne à tous les champs image de l'admin les textes (déjà traduits) de l'éditeur de recadrage, sans les repasser champ par champ. */
export function CropLabelsProvider({ labels, advanced, children }: { labels: Labels; advanced: boolean; children: React.ReactNode }) {
  return <Ctx.Provider value={{ labels, advanced }}>{children}</Ctx.Provider>;
}

/** Mode avancé du panneau : l'éditeur n'y ajoute que le sélecteur de couleur libre (les couleurs usuelles suffisent en mode simple). */
export const useAdvancedMode = (): boolean => useContext(Ctx).advanced;

/** `crop("apply")` → « Appliquer » ; `{n}` remplacés. Clé absente : la clé elle-même (jamais une erreur). */
export function useCropLabels(): (key: string, vars?: Record<string, string | number>) => string {
  const { labels } = useContext(Ctx);
  return (key, vars) => {
    let text = labels[key] ?? `crop.${key}`;
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  };
}
