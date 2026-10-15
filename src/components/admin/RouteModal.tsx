"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Fenêtre par-dessus la page (route interceptée : catalogue, réglages d'une extension). On la ferme avec Échap, un clic à côté ou le bouton « Fermer » (retour à la
 * page d'avant : la liste garde sa recherche, son filtre et sa position). Le fond ne défile plus tant qu'elle est ouverte. Au clavier : le focus entre dans la fenêtre,
 * Tab y reste (il ne part pas dans la page cachée derrière) et, à la fermeture, revient sur le lien qui l'avait ouverte. Sur mobile, elle prend tout l'écran ;
 * jamais de défilement horizontal. Une boîte de confirmation ouverte par-dessus se ferme seule avec Échap (la fenêtre reste).
 */
export function RouteModal({ children, label, closeLabel, testid = "route-modal" }: { children: React.ReactNode; /** Nom de la fenêtre pour les lecteurs d'écran. */ label: string; closeLabel: string; testid?: string }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const key = (e: KeyboardEvent) => {
      const el = panel.current;
      if (!el) return;
      // Une boîte de confirmation est ouverte par-dessus : c'est elle qui répond à Échap et à Tab.
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") { e.preventDefault(); router.back(); return; }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) { e.preventDefault(); el.focus(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (!el.contains(active)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", key);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [router]);
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-start sm:p-8" data-testid={testid}
      onMouseDown={(e) => { if (e.target === e.currentTarget) router.back(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} data-testid={`${testid}-panel`}
        className="relative h-full w-full max-w-3xl overflow-y-auto overflow-x-hidden overscroll-contain bg-surface px-4 pb-8 outline-none sm:h-auto sm:max-h-full sm:rounded-3xl sm:border sm:border-line sm:px-8 sm:shadow-2xl">
        {/* Le bouton reste visible quand on fait défiler la fenêtre. */}
        <div className="pointer-events-none sticky top-0 z-10 -mx-4 flex justify-end px-3 pb-1 pt-3 sm:-mx-8 sm:px-5">
          <button type="button" onClick={() => router.back()} data-testid="modal-close"
            className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium text-fg shadow-sm transition-colors hover:border-accent hover:text-accent">
            <span aria-hidden>✕</span>{closeLabel}
          </button>
        </div>
        <div className="min-w-0 pt-1 [overflow-wrap:anywhere]">{children}</div>
      </div>
    </div>
  );
}
