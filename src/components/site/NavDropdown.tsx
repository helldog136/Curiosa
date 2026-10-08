"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Menu déroulant du menu principal (un groupe de pages). S'ouvre au clic ou au toucher, et au survol de la souris ; se ferme avec Échap, un clic ailleurs
 * ou quand le focus clavier en sort. Le bouton annonce son état aux lecteurs d'écran (aria-expanded).
 */
export function NavDropdown({ label, items }: { label: string; items: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /** Dernier type de pointeur sur le bouton : à la souris le survol a déjà ouvert le menu, le clic ne doit pas le refermer. */
  const pointer = useRef("");
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", away); document.addEventListener("touchstart", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={root} className="relative" onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)} onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button type="button" aria-expanded={open} aria-haspopup="true" onPointerDown={(e) => { pointer.current = e.pointerType; }} onClick={() => { const mouse = pointer.current === "mouse"; pointer.current = ""; setOpen((o) => (mouse ? true : !o)); }}
        className="inline-flex items-center gap-1 py-1.5 text-muted hover:text-fg">
        {label}
        <svg viewBox="0 0 12 12" aria-hidden="true" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <ul data-testid="nav-dropdown" className="absolute left-0 top-full z-40 min-w-48 overflow-hidden text-left rounded-xl border border-line bg-surface py-1 shadow-lg">
          {items.map((it) => (
            <li key={it.href + it.label}><a href={it.href} className="block px-4 py-2.5 text-sm text-fg hover:bg-accent hover:text-accent-fg">{it.label}</a></li>
          ))}
        </ul>
      )}
    </div>
  );
}
