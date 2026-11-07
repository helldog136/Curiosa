/**
 * Barre d'onglets faite de liens, pour les pages qui gardent chacune leur adresse (Entretien, Réglages…) : composant serveur, sans script.
 * L'onglet ouvert est en évidence (couleur, trait ET `aria-current`), chaque cible mesure au moins 44 px, et sur téléphone les onglets passent à la ligne
 * au lieu de faire défiler la page (aucun défilement horizontal, aucun libellé coupé).
 */
export type LinkTab = { id: string; href: string; label: string; /** Pastille de nombre (à faire, en retard…). */ count?: number; countLabel?: string };

export function LinkTabs({ tabs, current, label, testid = "link-tabs" }: { tabs: readonly LinkTab[]; current: string; label: string; testid?: string }) {
  return (
    <nav aria-label={label} data-testid={testid} className="flex flex-wrap gap-x-1 border-b border-line">
      {tabs.map((tab) => {
        const here = tab.id === current;
        return (
          <a key={tab.id} href={tab.href} aria-current={here ? "page" : undefined} data-tab={tab.id}
            className={`-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${here ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
            {tab.label}
            {!!tab.count && tab.count > 0 && <span data-testid="tab-badge" title={tab.countLabel} className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{tab.count}<span className="sr-only"> {tab.countLabel}</span></span>}
          </a>
        );
      })}
    </nav>
  );
}
