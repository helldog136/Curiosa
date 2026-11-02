import { withLocale } from "@/core/links";
import type { Translator } from "@/core/i18n/dictionary";
import { MAX_RESULTS } from "@/core/search/rank";
import type { SearchOutcome } from "@/core/search/service";
import { QUERY_MAX_CHARS, QUERY_MAX_WORDS } from "@/core/search/text";
import { Pagination } from "./Pagination";
import { Marked, SearchForm } from "./SearchForm";

/**
 * Le corps de la page /search (docs/SKINS.md §9.2) : titre, champ, puis ce que dit la recherche. Un composant à part, sans accès aux données, pour que la page, les tests
 * et le banc d'essai des skins montrent EXACTEMENT les mêmes balises. Pièces : `heading`, `search`, `input`, `button`, `list`, `list-item`, `link`, `badge`, `mark`, `prose`,
 * `notice`, `pagination`. Tout texte (titre, extrait, saisie) passe par React : il est échappé, jamais interprété comme du HTML.
 */
export function SearchView({ outcome, locale, defaultLocale, t }: { outcome: Exclude<SearchOutcome, { kind: "disabled" }>; locale: string; defaultLocale: string; t: Translator }) {
  const here = withLocale("/search", locale, defaultLocale);
  const shown = outcome.kind === "results" || outcome.kind === "limited" ? outcome.shown : "";
  return (
    <section className="space-y-6">
      <h1 data-skin-part="heading" data-level="1" className="text-3xl font-bold">{t("site.search.title")}</h1>
      <SearchForm locale={locale} defaultLocale={defaultLocale} t={t} id="site-search-page" value={shown} variant="page" autoFocus={outcome.kind === "empty"} />

      {outcome.kind === "empty" && <p data-skin-part="prose" className="text-muted">{t("site.search.hint")}</p>}

      {outcome.kind === "limited" && (
        <p role="alert" data-skin-part="notice" data-tone="warning" className="rounded-card border-token border-line p-4 text-sm">{t("site.search.limited", { n: outcome.retryAfterSeconds })}</p>
      )}

      {outcome.kind === "results" && (
        <div className="space-y-5">
          {outcome.trimmed && <p data-skin-part="notice" data-tone="info" className="rounded-card border-token border-line p-3 text-sm">{t("site.search.trimmed", { chars: QUERY_MAX_CHARS, words: QUERY_MAX_WORDS })}</p>}
          {outcome.items.length === 0 ? (
            <div role="status" data-skin-part="notice" data-tone="info" className="space-y-3 rounded-card border-token border-line p-4">
              <p className="font-medium">{t("site.search.none", { q: outcome.shown })}</p>
              <p className="text-sm text-muted">{t("site.search.tips")}</p>
              <p><a href={here} data-skin-part="link" className="text-sm font-medium text-link underline underline-offset-2">{t("site.search.clear")}</a></p>
            </div>
          ) : (
            <>
              <p role="status" data-skin-part="prose" className="text-sm text-muted">{t("site.search.count", { n: outcome.total, q: outcome.shown })}</p>
              <ol data-skin-part="list" data-kind="results" aria-label={t("site.search.results")} className="divide-y divide-line border-y-token border-line">
                {outcome.items.map((r) => (
                  <li key={r.id} lang={r.lang ?? undefined} data-skin-part="list-item" className="space-y-1.5 py-4">
                    <h2 data-skin-part="heading" data-level="2" className="text-lg font-semibold">
                      <a href={r.url} data-skin-part="link" {...(r.external ? { rel: "noopener noreferrer" } : {})} className="hover:text-accent"><Marked segments={r.title} /></a>
                    </h2>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span data-skin-part="badge" className="rounded-chip border-token border-line px-2 py-0.5">{r.typeLabel}</span>
                      {r.date && <time dateTime={r.date.toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(r.date)}</time>}
                    </p>
                    {r.excerpt.length > 0 && <p data-skin-part="prose" className="text-sm"><Marked segments={r.excerpt} /></p>}
                  </li>
                ))}
              </ol>
              <Pagination page={outcome.page} pages={outcome.pages} base={`${here}?q=${encodeURIComponent(outcome.shown)}`} t={t} label={t("site.search.pages")} />
              {outcome.total > outcome.reachable && <p className="text-sm text-muted">{t("site.search.capped", { n: MAX_RESULTS })}</p>}
            </>
          )}
          {outcome.indexTruncated && <p className="text-xs text-muted">{t("site.search.recentOnly")}</p>}
        </div>
      )}
    </section>
  );
}
