import { CREDIT_URL } from "@/core/credit";
import { withLocale } from "@/core/links";
import { makeTranslator } from "@/core/i18n/dictionary";
import { runSlot } from "@/core/modules/runtime";
import type { SiteConfig } from "@/core/settings";
import { Blocks } from "./Blocks";

export async function Footer({ config, locale }: { config: SiteConfig; locale: string }) {
  const blocks = await runSlot("layout.footer", locale);
  const t = makeTranslator(locale);
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 text-sm text-muted">
        <Blocks blocks={blocks} locale={locale} />
        <p>{config.footerText || `© ${new Date().getFullYear()} ${config.name}`}</p>
        {/* Lien permanent vers la politique de confidentialité du cœur : il ne se retire pas. */}
        <p><a href={withLocale("/privacy", locale, config.defaultLocale)} data-testid="privacy-link" className="underline underline-offset-2 hover:text-fg">{t("privacy.title")}</a></p>
        {/* Crédit exigé par la licence (section 4) : ne pas retirer. */}
        <p data-testid="credit" className="text-xs">
          {t("site.poweredBy")} <a href={CREDIT_URL} rel="noopener" className="underline underline-offset-2 hover:text-fg">Curiosa</a>
        </p>
      </div>
    </footer>
  );
}
