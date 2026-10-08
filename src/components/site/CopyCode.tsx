"use client";

import { useState } from "react";

export function CopyCode({ code, copyLabel, copiedLabel }: { code: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le code reste affiché et sélectionnable.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-full border border-accent/50 px-3 py-1 text-xs text-accent transition-colors hover:bg-accent/10"
      aria-label={`${copyLabel} ${code}`}
    >
      <span className="font-mono">{code}</span>
      <span className="text-muted">{copied ? copiedLabel : copyLabel}</span>
    </button>
  );
}
