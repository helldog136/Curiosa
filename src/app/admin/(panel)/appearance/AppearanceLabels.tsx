"use client";

import { createContext, useContext } from "react";

type Labels = Record<string, string>;
const Ctx = createContext<Labels>({});

/** Donne aux composants de la page Apparence leurs textes (déjà traduits par le serveur). */
export function AppearanceLabelsProvider({ labels, children }: { labels: Labels; children: React.ReactNode }) {
  return <Ctx.Provider value={labels}>{children}</Ctx.Provider>;
}

export type AL = (key: string, vars?: Record<string, string | number>) => string;

/** `al("appearance.save")` → le texte ; `{n}` remplacés. Clé absente : la clé elle-même (jamais une erreur). */
export function useAL(): AL {
  const labels = useContext(Ctx);
  return (key, vars) => {
    let text = labels[key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  };
}
