/**
 * Onglets communs aux pages « Fonctionnalités » (ce qui est installé) et « Ajouter » (le catalogue, avec les fiches de détail) : pour l'utilisateur
 * c'est un seul endroit, avec une seule entrée dans le menu. Chaque page garde son adresse.
 */
export function FeatureTabs({ current, labels }: { current: "installed" | "add"; labels: { installed: string; add: string } }) {
  const tab = (id: "installed" | "add", href: string, label: string) => (
    <a key={id} href={href} aria-current={current === id ? "page" : undefined}
      className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${current === id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
      {label}
    </a>
  );
  return (
    <nav aria-label={labels.installed} className="flex gap-1 border-b border-line" data-testid="feature-tabs">
      {tab("installed", "/admin/modules", labels.installed)}
      {tab("add", "/admin/catalogue", labels.add)}
    </nav>
  );
}
