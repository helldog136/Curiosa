"use client";

/**
 * Page d'erreur de l'admin (le menu reste là). Le texte est écrit en français ET en anglais : un composant d'erreur n'a pas accès à la langue du serveur.
 * Le lien « Signaler un bug » passe par /admin/bug-report, qui ajoute les versions (jamais de donnée du site).
 */
export default function AdminError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-4 rounded-2xl border border-red-500/40 bg-red-500/5 p-6" data-testid="admin-error">
      <h1 className="text-2xl font-bold">Une erreur est survenue <span className="font-normal text-muted">/ Something went wrong</span></h1>
      <p className="text-[15px] leading-6">Cette page n&apos;a pas pu s&apos;afficher. Vos données ne sont pas touchées. Vous pouvez réessayer, ou nous le signaler.</p>
      <p className="text-sm leading-6 text-muted">This page could not be displayed. Your data is not affected. You can try again, or report it to us.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => retry()} className="inline-flex items-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-fg shadow-sm transition hover:brightness-110">Réessayer / Try again</button>
        <a href="/admin/bug-report" target="_blank" rel="noopener noreferrer" data-testid="bug-report-link" className="text-sm underline underline-offset-2 hover:text-accent">🐞 Signaler un bug / Report a bug ↗</a>
      </div>
    </div>
  );
}
