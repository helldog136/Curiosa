"use client";

import { useEffect, useRef } from "react";

/**
 * Petit menu « ⋯ » d'une ligne : un bouton natif (<details>), donc au clavier et au toucher sans rien de plus ; Échap ou un clic ailleurs le referme
 * (le focus revient alors sur le bouton). Le contenu (formulaires, liens) est préparé côté serveur.
 */
export function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = box.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") { el.open = false; el.querySelector("summary")?.focus(); } }
      else if (!el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("pointerdown", close); };
  }, []);
  return (
    <details ref={box} className="relative" data-testid="row-menu">
      <summary aria-label={label} title={label} className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl border border-line bg-surface text-lg leading-none text-muted transition-colors hover:border-accent hover:text-accent [&::-webkit-details-marker]:hidden"><span aria-hidden>⋯</span></summary>
      <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">{children}</div>
    </details>
  );
}
