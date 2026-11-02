"use client";

import { useState, useTransition } from "react";

/** Une tâche à cocher dont la coche est MÉMORISÉE par le serveur (« Après le changement ») : revient en arrière avec un message si l'enregistrement échoue. */
export function TaskTick({ id, done, title, failed, action, children }: {
  id: string; done: boolean; title: string; failed: string;
  action: (id: string, done: boolean) => Promise<{ ok: boolean }>;
  children?: React.ReactNode;
}) {
  const [checked, setChecked] = useState(done);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  function change(next: boolean) {
    setChecked(next); setError(false);
    start(async () => {
      let ok = false;
      try { ok = (await action(id, next)).ok; } catch { ok = false; }
      if (!ok) { setChecked(!next); setError(true); }
    });
  }
  return (
    <li className="flex gap-3 px-5 py-4 sm:px-6" data-testid={`task-${id}`}>
      <input id={`tick-${id}`} type="checkbox" checked={checked} disabled={pending} onChange={(e) => change(e.currentTarget.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[var(--v-accent)]" />
      <div className="min-w-0 flex-1 space-y-2">
        <label htmlFor={`tick-${id}`} className={`block cursor-pointer font-medium ${checked ? "text-muted line-through" : ""}`}>{title}</label>
        {children}
        {error && <p role="alert" className="text-sm text-red-700">{failed}</p>}
      </div>
    </li>
  );
}
