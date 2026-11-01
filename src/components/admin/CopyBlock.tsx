"use client";

import { useId, useState } from "react";
import { ui } from "./ui";

/** Un bloc de texte prêt à copier (commande, adresse, extrait de configuration) avec son bouton « Copier ». */
export function CopyBlock({ text, copyLabel, copiedLabel, label }: { text: string; copyLabel: string; copiedLabel: string; label?: string }) {
  const [done, setDone] = useState(false);
  const id = useId();
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Navigateur sans presse-papiers (page non sécurisée) : on sélectionne le texte pour que Ctrl+C suffise.
      const range = document.createRange();
      const node = document.getElementById(id);
      if (node) { range.selectNodeContents(node); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); }
      return;
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 2000);
  }
  return (
    <div className="space-y-1.5">
      {label && <p className="text-[13px] font-medium text-muted">{label}</p>}
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg p-3 sm:flex-row sm:items-start">
        <pre id={id} className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[13px] leading-5">{text}</pre>
        <button type="button" onClick={copy} className={`${ui.btn} shrink-0 self-start`} aria-live="polite">{done ? `✓ ${copiedLabel}` : copyLabel}</button>
      </div>
    </div>
  );
}
