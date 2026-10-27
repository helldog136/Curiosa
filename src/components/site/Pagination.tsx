import { pageHref, pageWindow } from "@/core/content/pagination";
import type { Translator } from "@/core/i18n/dictionary";

type Props = {
  page: number;
  pages: number;
  /** Adresse de la liste SANS paramètre de page (peut contenir une requête, ex. la recherche de l'administration). */
  base: string;
  t: Translator;
  /** Étiquette de la navigation (par défaut « Pagination ») : utile s'il y en a plusieurs sur la page. */
  label?: string;
};

const link = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line bg-surface px-4 text-sm transition-colors hover:border-accent hover:text-accent";

/**
 * Navigation entre les pages d'une liste. N'affiche RIEN pour une seule page. Une vraie navigation (`<nav>` étiquetée), des liens ordinaires
 * (fonctionne sans JavaScript), la page courante marquée `aria-current="page"`. Mobile d'abord : précédent / suivant en grand, numéros qui passent à la ligne.
 */
export function Pagination({ page, pages, base, t, label }: Props) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={label ?? t("site.pagination.label")} data-pagination="" data-skin-part="pagination" className="flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? (
        <a href={pageHref(base, page - 1)} rel="prev" data-skin-part="pagination-link" className={link}><span aria-hidden="true">←&nbsp;</span>{t("site.pagination.previous")}</a>
      ) : (
        <span className="min-h-11 min-w-11" aria-hidden="true" />
      )}
      <ol className="order-last flex w-full flex-wrap items-center justify-center gap-2 sm:order-none sm:w-auto">
        {pageWindow(page, pages).map((n, i) =>
          n === null ? (
            <li key={`gap${i}`} aria-hidden="true" className="px-1 text-muted">…</li>
          ) : (
            <li key={n}>
              <a
                href={pageHref(base, n)}
                data-skin-part="pagination-link"
                {...(n === page ? { "aria-current": "page" as const } : {})}
                aria-label={n === page ? t("site.pagination.current", { n, pages }) : t("site.pagination.goTo", { n })}
                className={`${link} ${n === page ? "border-accent font-semibold text-accent" : ""}`}
              >
                {n}
              </a>
            </li>
          ),
        )}
      </ol>
      {page < pages ? (
        <a href={pageHref(base, page + 1)} rel="next" data-skin-part="pagination-link" className={link}>{t("site.pagination.next")}<span aria-hidden="true">&nbsp;→</span></a>
      ) : (
        <span className="min-h-11 min-w-11" aria-hidden="true" />
      )}
    </nav>
  );
}
