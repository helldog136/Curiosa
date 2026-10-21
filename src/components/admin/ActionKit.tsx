/** Petites pièces communes aux boutons d'action (présentation seulement, aucun état) : le rouet sobre et la pile de libellés à largeur stable. */

/** Rouet discret : un arc qui tourne. Sous `prefers-reduced-motion` (voir globals.css) l'arc reste immobile : le libellé « en cours » suffit. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true" data-testid="spinner" className={`h-4 w-4 shrink-0 motion-safe:animate-spin ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Tous les libellés possibles sont superposés dans la même case, un seul visible : le bouton garde la largeur du plus long, il ne « saute » pas
 * quand « Installer » devient « Installation… » puis « Installé ».
 */
export function LabelStack({ labels, shown }: { labels: React.ReactNode[]; shown: number }) {
  return (
    <span className="inline-grid">
      {labels.map((text, i) => (
        <span key={i} aria-hidden={i === shown ? undefined : true} className={`col-start-1 row-start-1 text-center ${i === shown ? "" : "invisible"}`}>{text}</span>
      ))}
    </span>
  );
}
