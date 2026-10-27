import type { Metadata } from "next";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getVisitorLocale } from "@/core/i18n/request";
import { pickName } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { buildPrivacyPolicy } from "@/core/privacy";
import { getSetting, getSiteConfig } from "@/core/settings";
import { siteUrl } from "@/core/config";
import { pickLogo } from "@/core/logos";
import { languageAlternates, socialMeta } from "@/core/seo";
import { resolveLook } from "@/core/skins/render";
import { Markdown } from "@/components/site/Markdown";
import { CookieSettingsLink } from "@/components/site/CookieTray";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getVisitorLocale();
  const site = await getSiteConfig();
  const config = await getSiteConfig(locale);
  const title = makeTranslator(locale)("privacy.title");
  const alt = languageAlternates(siteUrl, site.locales, locale, site.defaultLocale, "/privacy");
  return { title, alternates: { canonical: alt.canonical, ...(alt.languages ? { languages: alt.languages } : {}) }, ...socialMeta({ siteName: config.name, title, image: pickLogo(config.logos, "share", false), url: alt.canonical, locale }) };
}

/** Page obligatoire du site : le cœur l'écrit à partir de ce que le site fait réellement ; le propriétaire peut y ajouter, pas y retirer. */
export default async function PrivacyPage() {
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  const t = makeTranslator(locale);
  const features = (await getActiveInstances()).flatMap(({ instance, mod }) => {
    const declared = mod.manifest.privacy;
    return declared ? [{ name: pickName(instance, locale, config.defaultLocale), text: localized(declared, locale, config.defaultLocale) }] : [];
  });
  const extra = (await getSetting<string>("privacy.extra", locale)) ?? (await getSetting<string>("privacy.extra", config.defaultLocale)) ?? "";
  // Le choix clair/sombre du visiteur n'existe (et n'est donc déclaré) que si le skin du site fournit les deux apparences.
  const modeSwitch = (await resolveLook(config)).appearance.modeSwitch;
  const text = buildPrivacyPolicy({ siteName: config.name, contactEmail: config.contactEmail, statsEnabled: config.statsEnabled, newsToggle: config.newsToggle, modeSwitch, features, extra, t });
  return (
    <article className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("privacy.title")}</h1>
      <Markdown text={text} />
      {config.newsToggle && (
        <p id="cookies" data-testid="privacy-cookie-control" className="scroll-mt-24 rounded-xl border border-line p-4 text-sm">
          <CookieSettingsLink label={t("cookies.manage")} href="#cookies" className="font-semibold text-accent underline underline-offset-2" />
        </p>
      )}
    </article>
  );
}
