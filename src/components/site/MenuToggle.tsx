"use client";

import { useEffect, useRef, useState } from "react";

/** Bouton « menu » de l'en-tête sobre : ouvre un panneau avec tout le contenu de l'en-tête (menu, réseaux, bouton). Échap et un clic ailleurs le ferment. */
export function MenuToggle({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-accent">
        <span aria-hidden="true">{open ? "✕" : "☰"}</span> {label}
      </button>
      {open && <div id="site-menu" data-testid="site-menu" className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-lg">{children}</div>}
    </div>
  );
}
