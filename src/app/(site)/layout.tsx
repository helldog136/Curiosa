import { isDarkBackground, pickLogo } from "@/core/logos";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { buildTheme, gradientTextOn, hasAccent2, hasChosenSurface, themeCss } from "@/core/color";
import { glowCss } from "@/core/glow";
import { faviconUrl } from "@/core/favicon";
import { backgroundCss, effectiveLayers } from "@/core/background";
import { RTL_LOCALES } from "@/core/i18n/locales";
import { getVisitorLocale, getVisitorTranslator, LOCALE_HEADER, PATH_HEADER } from "@/core/i18n/request";
import { runSlot } from "@/core/modules/runtime";
import { getSiteConfig, themeExtraOf } from "@/core/settings";
import { siteUrl } from "@/core/config";
import { feedPath } from "@/core/feeds";
import { jsonLd, languageAlternates, pageUrl, sameAsList, siteJsonLd, socialMeta } from "@/core/seo";
import { getSiteEntity } from "@/core/seoSettings";
import { loadSocialLinks } from "@/core/social";
import { prisma } from "@/core/db";
import { Blocks, HeadTags } from "@/components/site/Blocks";
import { CookieTray } from "@/components/site/CookieTray";
import { CHOICE_COOKIE, TRAY_TEXT_KEYS, trayState, type TrayLabels } from "@/core/cookieTray";
import { NEWS_COOKIE } from "@/core/visit";
import { withLocale } from "@/core/links";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { VisitBeacon } from "@/components/site/VisitBeacon";
import "../globals.css";

/** Chemin demandé SANS préfixe de langue (posé par proxy.ts) ; « / » à défaut. */
async function currentPath(): Promise<string> {
  const raw = (await headers()).get(PATH_HEADER) ?? "/";
  return raw.startsWith("/") ? raw : "/";
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  const base = await getSiteConfig();
  const path = await currentPath();
  const share = pickLogo(config.logos, "share", false);
  // Adresse canonique et versions par langue de la page courante. Les pages qui n'existent pas dans toutes les langues
  // (une entrée traduite en partie) redéfinissent `alternates` elles-mêmes.
  const alt = languageAlternates(siteUrl, base.locales, locale, base.defaultLocale, path);
  return {
    metadataBase: new URL(siteUrl),
    title: { default: config.name, template: `%s | ${config.name}` },
    description: config.tagline || undefined,
    icons: { icon: faviconUrl(pickLogo(config.logos, "favicon", false)), ...(pickLogo(config.logos, "favicon", false) ? { apple: pickLogo(config.logos, "favicon", false)! } : {}) },
    alternates: { canonical: alt.canonical, ...(alt.languages ? { languages: alt.languages } : {}) },
    ...socialMeta({ siteName: config.name, title: config.name, description: config.tagline || undefined, image: share, url: alt.canonical, locale }),
  };
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // Pas encore configuré : on envoie vers l'onboarding plutôt que d'afficher un site vide.
  if ((await prisma.user.count()) === 0) redirect("/admin/setup");

  const config = await getSiteConfig();
  const urlLocale = (await headers()).get(LOCALE_HEADER);
  if (urlLocale && !config.locales.includes(urlLocale)) notFound();

  const locale = await getVisitorLocale();
  const localized = await getSiteConfig(locale);
  const t = await getVisitorTranslator();
  const theme = buildTheme(localized.background, localized.accent, localized.font, themeExtraOf(localized));
  const layers = effectiveLayers(localized.bg.preset, localized.bg.custom, localized.bg.image, localized.bg.svg);
  const two = hasAccent2(localized);
  const css = themeCss(theme) + (two ? `[data-accent2]{--c-grad-fg:${gradientTextOn(localized.accent, localized.accent2)}}` : "") + glowCss(localized.glow.level, localized.glow.custom, localized.accent) + backgroundCss(layers, theme);

  const profiles = sameAsList((await loadSocialLinks(locale)).map((s) => s.href));
  const entity = await getSiteEntity();
  const [headBlocks, bannerBlocks] = await Promise.all([runSlot("layout.head", locale), runSlot("layout.banner", locale)]);

  // Bandeau de cookies : décidé ici, côté serveur, d'après le réglage et les cookies du visiteur (donc aucun clignotement au chargement).
  const jar = await cookies();
  const tray = trayState({ enabled: config.newsToggle, newsCookie: jar.get(NEWS_COOKIE)?.value, choiceCookie: jar.get(CHOICE_COOKIE)?.value });
  const trayLabels = Object.fromEntries(TRAY_TEXT_KEYS.map((k) => [k, t(`cookies.${k}`)])) as TrayLabels;

  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? "rtl" : "ltr"} data-accent2={two ? "1" : undefined} data-surface={hasChosenSurface(localized) ? "1" : undefined}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <link rel="alternate" type="application/rss+xml" title={localized.name} href={`${siteUrl}${feedPath(locale)}`} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(siteJsonLd({ url: siteUrl, name: localized.name, tagline: localized.tagline, logo: pickLogo(localized.logos, "any", isDarkBackground(localized.background)), locale, entity, sameAs: profiles, homeUrl: pageUrl(siteUrl, locale, config.defaultLocale, "/").replace(/\/$/, "") || siteUrl })) }} />
        <HeadTags blocks={headBlocks} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        {layers.length > 0 && <div className="cbg" aria-hidden="true">{layers.map((_, i) => <i key={i} />)}</div>}
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-fg">
          {t("site.skip")}
        </a>
        {tray.enabled && <CookieTray labels={trayLabels} privacyHref={`${withLocale("/privacy", locale, config.defaultLocale)}#cookies`} initialOpen={tray.showTray} />}
        <Blocks blocks={bannerBlocks} locale={locale} />
        <Header config={localized} locale={locale} />
        <main id="content" className="mx-auto max-w-5xl px-4 py-10">
          {children}
        </main>
        <Footer config={localized} locale={locale} />
        {config.statsEnabled && <VisitBeacon />}
      </body>
    </html>
  );
}
