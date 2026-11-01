"use client";

import { useState, useTransition } from "react";

/**
 * Interrupteur d'accès d'une action pour un jeton. Appliqué immédiatement (sans bouton « enregistrer ») :
 * le serveur MCP relit les accès à chaque requête.
 */
export function GrantToggle({ label, checked, disabled, confirmMessage, onToggle }: {
  label: string; checked: boolean; disabled?: boolean; confirmMessage?: string;
  onToggle: (enabled: boolean) => Promise<{ ok: boolean }>;
}) {
  const [on, setOn] = useState(checked);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  function change(next: boolean) {
    // Une action irréversible demande confirmation avant d'être accordée.
    if (next && confirmMessage && !window.confirm(confirmMessage)) return;
    setOn(next);
    setFailed(false);
    start(async () => {
      const res = await onToggle(next);
      if (!res.ok) {
        setOn(!next);
        setFailed(true);
      }
    });
  }

  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}>
      <input type="checkbox" role="switch" aria-label={label} checked={on} disabled={disabled || pending} onChange={(e) => change(e.target.checked)}
        className="h-4 w-4 accent-[var(--v-accent)]" />
      {failed && <span role="alert" className="text-xs text-red-600">!</span>}
    </label>
  );
}
