"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Fenêtre par-dessus la page : on la ferme avec Échap, un clic à côté ou la croix (retour à la page précédente, le catalogue garde sa recherche
 * et sa position). Le fond de la page ne défile plus tant qu'elle est ouverte.
 */
export function CatalogueModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") router.back(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", key); };
  }, [router]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-8" data-testid="catalogue-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) router.back(); }}>
      <div ref={panel} role="dialog" aria-modal="true" tabIndex={-1}
        className="relative max-h-full w-full max-w-3xl overflow-y-auto overscroll-contain rounded-3xl border border-line bg-surface p-6 shadow-2xl outline-none sm:p-8">
        <button type="button" onClick={() => router.back()} aria-label="✕" data-testid="modal-close"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-lg text-muted transition-colors hover:text-fg">✕</button>
        {children}
      </div>
    </div>
  );
}
