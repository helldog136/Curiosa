import { CREDIT_URL } from "@/core/credit";
import { wordmark } from "@/components/brand/wordmark";
import { feedPath, hasFeedSource } from "@/core/feeds";
import { withLocale } from "@/core/links";
import { makeTranslator } from "@/core/i18n/dictionary";
import { runSlot } from "@/core/modules/runtime";
import type { SiteConfig } from "@/core/settings";
import { Blocks } from "./Blocks";
import { CookieSettingsLink } from "./CookieTray";

export async function Footer({ config, locale }: { config: SiteConfig; locale: string }) {
  const blocks = await runSlot("layout.footer", locale);
  const t = makeTranslator(locale);
  // Icône du flux RSS : seulement si le propriétaire ne l'a pas masquée ET si le site a de quoi alimenter un flux (voir hasFeedSource).
  const showFeed = config.feedLink && (await hasFeedSource());
  return (
    // Le pied est lui-même le conteneur centré (marges et largeur : jetons `--sk-page-*`, globals.css).
    <footer data-skin-region="footer" className="space-y-4 border-t-token border-line py-8 text-sm text-muted">
        <Blocks blocks={blocks} locale={locale} />
        <p data-skin-part="footer-text">{config.footerText || `© ${new Date().getFullYear()} ${config.name}`}</p>
        {/* Lien permanent vers la politique de confidentialité du cœur : il ne se retire pas. */}
        <p><a href={withLocale("/privacy", locale, config.defaultLocale)} data-testid="privacy-link" data-skin-part="footer-link" className="underline underline-offset-2 hover:text-fg">{t("privacy.title")}</a>
          {config.newsToggle && <> · <CookieSettingsLink label={t("cookies.settings")} href={`${withLocale("/privacy", locale, config.defaultLocale)}#cookies`} part="footer-link" className="underline underline-offset-2 hover:text-fg" /></>}
          {showFeed && (
            <> · <a href={feedPath(locale)} data-testid="feed-link" data-skin-part="footer-link" aria-label={t("feed.link")} title={t("feed.linkTitle")} className="-my-1.5 inline-flex items-center rounded-sm p-1.5 align-middle text-muted hover:text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1.6" fill="currentColor" /></svg>
            </a></>
          )}
        </p>
        {/* Crédit exigé par la licence (section 4) : ne pas retirer. */}
        <p data-testid="credit" data-skin-part="credit" className="text-xs">
          {t("site.poweredBy")} <a href={CREDIT_URL} rel="noopener" className={`${wordmark.className} text-[1.15em] underline underline-offset-2 hover:text-fg`}>Curiosa</a>
        </p>
    </footer>
  );
}
