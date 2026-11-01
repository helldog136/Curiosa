"use client";

import { useState } from "react";
import { ui } from "./ui";

/**
 * Bouton « Copier l'adresse » : l'adresse est copiée dans le presse-papiers SANS être affichée (c'est un secret). Si le navigateur refuse de copier (page non sécurisée),
 * l'adresse apparaît alors dans un champ à sélectionner, pour un Ctrl+C manuel.
 */
export function CopyAddress({ text, label, copied, manual }: { text: string; label: string; copied: string; manual: string }) {
  const [state, setState] = useState<"idle" | "done" | "manual">("idle");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setState("done"); window.setTimeout(() => setState("idle"), 2500); } catch { setState("manual"); }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={copy} className={ui.btn} aria-live="polite">{state === "done" ? `✓ ${copied}` : label}</button>
      {state === "manual" && <input readOnly value={text} aria-label={manual} onFocus={(e) => e.currentTarget.select()} className={`${ui.input} font-mono text-xs`} />}
    </span>
  );
}
