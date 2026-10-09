import { ui } from "./ui";

/**
 * Briques communes des pages d'administration (hors réglages) : mêmes titres, mêmes encadrés, mêmes états vides, même « zone danger » partout.
 * Composants serveur sans état : aucune logique ici, seulement de la mise en page cohérente.
 */

/** En-tête de page : un titre, une phrase qui dit à quoi sert la page, et (à droite) l'action principale si elle est unique. */
export function PageHeader({ title, intro, icon, children }: { title: string; intro?: React.ReactNode; icon?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className={ui.pageTitle}>{icon && <span aria-hidden>{icon} </span>}{title}</h1>
        {intro && <p className={ui.pageIntro}>{intro}</p>}
      </div>
      {children}
    </header>
  );
}

/** Une section de page : un titre, une aide courte, puis le contenu. `card` l'entoure d'une carte (par défaut), sinon le contenu s'étale. */
export function Panel({ title, help, children, card = true, tone, testid, className = "" }: { title?: string; help?: React.ReactNode; children: React.ReactNode; card?: boolean; tone?: "danger"; testid?: string; className?: string }) {
  const frame = card ? (tone === "danger" ? "rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-5 sm:p-6" : ui.card) : "";
  return (
    <section className={`${frame} space-y-4 ${className}`} data-testid={testid}>
      {(title || help) && (
        <div>
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {help && <p className="mt-1 text-sm leading-6 text-muted">{help}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

const CALLOUT = {
  info: "border-line bg-surface",
  warn: "border-amber-500/50 bg-amber-500/10",
  danger: "border-red-500/50 bg-red-500/10",
  ok: "border-emerald-500/40 bg-emerald-500/10",
} as const;

/** Encadré d'information : à lire (info), à ne pas manquer (warn), problème (danger) ou tout va bien (ok). */
export function Callout({ tone = "info", children, role, testid }: { tone?: keyof typeof CALLOUT; children: React.ReactNode; role?: "status" | "alert"; testid?: string }) {
  return <div role={role ?? (tone === "danger" ? "alert" : undefined)} data-testid={testid} className={`rounded-xl border p-3.5 text-sm leading-6 ${CALLOUT[tone]}`}>{children}</div>;
}

/** État vide : explique ce qui manque ici et propose l'étape suivante. */
export function EmptyState({ icon, title, children, action }: { icon?: string; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-10 text-center" data-testid="empty-state">
      {icon && <span className="text-3xl" aria-hidden>{icon}</span>}
      <p className="text-lg font-semibold">{title}</p>
      {children && <p className="max-w-md text-sm leading-6 text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Actions irréversibles ou risquées, à part du reste et toujours repliées : on ne les croise pas par hasard. */
export function DangerZone({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-red-500/30 bg-red-500/[0.04]" data-testid="danger-zone">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-red-700">{title}</summary>
      <div className="space-y-3 border-t border-red-500/20 px-4 py-3">
        {help && <p className="text-sm leading-6 text-muted">{help}</p>}
        <div className="flex flex-wrap items-start gap-3">{children}</div>
      </div>
    </details>
  );
}
