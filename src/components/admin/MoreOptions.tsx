import { ui } from "./ui";

/**
 * « PLUS D'OPTIONS » : un groupe replié pour ce qui sert dans 5 % des cas (règles R2 et R7). Fermé, il tient sur UNE ligne qui RÉSUME ce qui y est réglé
 * (« Plus d'options · Fin le 30 novembre · Message personnalisé ») pour qu'on n'ait pas à l'ouvrir pour savoir ; il s'ouvre d'office quand une valeur y est déjà
 * (`defaultOpen`) ou quand un champ y est en erreur (le cœur ouvre les <details> avant de donner le focus). Un <details> natif : clavier, toucher et lecteur
 * d'écran sans rien de plus, et le contenu reste dans le formulaire (les champs repliés partent avec lui).
 */
export function MoreOptions({ title, summary, count, defaultOpen, children, className = "" }: {
  title: string;
  /** Ce qui est réglé là-dedans, en une ligne (vide : rien de réglé). */
  summary?: string;
  /** Nombre de réglages qui ont une valeur : une pastille à côté du titre. */
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details open={defaultOpen || undefined} data-more-options="" className={`group rounded-2xl border border-line bg-bg/40 ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-2 text-[15px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block text-xs text-muted transition-transform group-open:rotate-90">▶</span>
        <span className="shrink-0">{title}</span>
        {count !== undefined && count > 0 && <span className={`${ui.chip} shrink-0`}>{count}</span>}
        {summary && <span className="min-w-0 truncate text-sm font-normal text-muted group-open:hidden" title={summary}>{summary}</span>}
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}
