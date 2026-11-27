import type { ReactNode } from "react";

/**
 * BARRE D'ACTION COLLÉE EN BAS de la fenêtre : « Enregistrer » et « Annuler » restent à portée dans une longue page de réglages (rendue à la racine de la page
 * par l'appelant, via un portail, pour rester visible même depuis un onglet masqué). Une seule apparence pour toute l'administration : au-dessus des fenêtres
 * (z-60), jamais plus large que l'écran, ses boutons font au moins 44 px.
 * Le contenu de la page lui laisse la place (`h-20` sous le dernier champ) et `scroll-padding-bottom` empêche qu'un champ qui prend le focus se glisse dessous
 * (WCAG 2.4.11).
 */
export function StickyActionBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} data-testid="floating-bar" data-sticky-bar="" style={{ bottom: "1.25rem" }}
      className="fixed left-1/2 z-[60] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur">
      {children}
    </div>
  );
}
