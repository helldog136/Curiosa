/**
 * Lien discret « Signaler un bug » : s'ouvre dans un nouvel onglet, sans transmettre l'origine ni donner accès à la page de l'admin (rel="noopener noreferrer").
 * `href` vient de adminBugReportUrl() (core/bugReport.ts) ou de /admin/bug-report quand l'adresse ne peut pas être calculée sur place (page d'erreur).
 */
export function BugReportLink({ href, children, className = "text-xs text-muted underline-offset-2 hover:text-accent hover:underline" }: { href: string; children: React.ReactNode; className?: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className} data-testid="bug-report-link">{children}</a>;
}
