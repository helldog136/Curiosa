"use client";

import { useState } from "react";

/** Bouton « copier » pour un texte (le texte lui-même est affiché ailleurs). */
export function CopyText({ text, copyLabel, copiedLabel }: { text: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le texte reste affiché et sélectionnable.
    }
  }
  return (
    <button type="button" onClick={copy} className="rounded-full border border-accent/50 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/10">
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}
