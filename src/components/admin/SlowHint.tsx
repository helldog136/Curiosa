"use client";

import { useEffect, useState } from "react";
import { PREVIEW_SLOW_MS } from "@/core/modules/previewTimings";

/** Après quelques secondes sans fiche, une phrase de progression remplace l'écran muet (annoncée au lecteur d'écran) : la lecture continue, rien n'est perdu. */
export function SlowHint({ text, after = PREVIEW_SLOW_MS }: { text: string; after?: number }) {
  const [late, setLate] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLate(true), after); return () => clearTimeout(t); }, [after]);
  return <p role="status" data-testid="fiche-slow" className={late ? "text-sm font-medium" : "sr-only"}>{late ? text : ""}</p>;
}
