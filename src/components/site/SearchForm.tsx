import { Fragment } from "react";
import { withLocale } from "@/core/links";
import type { Translator } from "@/core/i18n/dictionary";
import { QUERY_MAX_CHARS, type Segment } from "@/core/search/text";

/**
 * Le champ « Rechercher dans le site » (docs/SKINS.md §9.2, pièce `search`). Un vrai formulaire GET vers la page de résultats : il marche sans JavaScript, sans
 * rien enregistrer (pas de cookie, pas d'historique côté site). Le libellé est relié au champ (lecteur d'écran), le bouton a un texte, les deux font au moins 44 px.
 *  - `tool` : compact, pour l'en-tête (région `tools`) ou le pied de page ; le bouton n'est qu'une loupe (son texte est lu à voix haute) ;
 *  - `page` : grand, en haut de la page de résultats, avec le bouton écrit.
 */
export function SearchForm({ locale, defaultLocale, t, id, value = "", variant, autoFocus }: { locale: string; defaultLocale: string; t: Translator; id: string; value?: string; variant: "tool" | "page"; autoFocus?: boolean }) {
  const page = variant === "page";
  return (
    <form role="search" method="get" action={withLocale("/search", locale, defaultLocale)} data-skin-part="search" data-variant={variant} className={page ? "flex w-full max-w-xl items-stretch gap-2" : "flex items-stretch gap-1"}>
      <label htmlFor={id} className="sr-only">{t("site.search.label")}</label>
      <input
        id={id} type="search" name="q" defaultValue={value} maxLength={QUERY_MAX_CHARS} autoComplete="off" enterKeyHint="search" placeholder={t("site.search.submit")} autoFocus={autoFocus} data-skin-part="input"
        className={`min-h-target min-w-0 rounded-button border-token border-line bg-surface px-3 text-sm text-fg placeholder:text-muted ${page ? "flex-1 text-base" : "w-32 max-w-full transition-[width] focus:w-48 sm:w-36"}`}
      />
      <button type="submit" data-skin-part="button" className={`inline-flex min-h-target min-w-target items-center justify-center gap-2 rounded-button border-token border-line bg-surface px-3 text-sm font-medium transition-colors hover:border-accent hover:text-accent ${page ? "px-5" : ""}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></svg>
        <span className={page ? "" : "sr-only"}>{t("site.search.submit")}</span>
      </button>
    </form>
  );
}

/** Du texte et des `<mark>` (React échappe tout : le texte d'une page ou d'une saisie ne devient jamais du HTML). */
export function Marked({ segments }: { segments: readonly Segment[] }) {
  return <>{segments.map((s, i) => (s.hit ? <mark key={i} data-skin-part="mark" className="whitespace-nowrap rounded-sm bg-accent/25 px-0.5 text-inherit">{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>))}</>;
}
