import { pickLogo } from "@/core/logos";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { faviconUrl } from "@/core/favicon";
import { resolveLook } from "@/core/skins/render";
import { RTL_LOCALES } from "@/core/i18n/locales";
import { getVisitorLocale, getVisitorTranslator, LOCALE_HEADER, PATH_HEADER } from "@/core/i18n/request";
import { runSlot } from "@/core/modules/runtime";
import { getSiteConfig } from "@/core/settings";
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
  // L'apparence : basic < pièces des modules < skin actif (`skin.active`, absent = basic) < retouches de la personne (core/skins/render.ts). Sans skin choisi,
  // la feuille est celle d'avant les skins (mêmes valeurs) ; elle ne touche jamais l'administration.
  const look = await resolveLook(localized);
  const css = look.sheet;
  const layers = look.layers;
  const headerConfig = look.headerLayout === localized.header.layout ? localized : { ...localized, header: { ...localized.header, layout: look.headerLayout } };

  const profiles = sameAsList((await loadSocialLinks(locale)).map((s) => s.href));
  const entity = await getSiteEntity();
  const [headBlocks, bannerBlocks] = await Promise.all([runSlot("layout.head", locale), runSlot("layout.banner", locale)]);

  // Bandeau de cookies : décidé ici, côté serveur, d'après le réglage et les cookies du visiteur (donc aucun clignotement au chargement).
  const jar = await cookies();
  const tray = trayState({ enabled: config.newsToggle, newsCookie: jar.get(NEWS_COOKIE)?.value, choiceCookie: jar.get(CHOICE_COOKIE)?.value });
  const trayLabels = Object.fromEntries(TRAY_TEXT_KEYS.map((k) => [k, t(`cookies.${k}`)])) as TrayLabels;

  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? "rtl" : "ltr"} data-skin={look.composed.skinId} data-accent2={look.composed.hasAccent2 ? "1" : undefined} data-surface={look.composed.hasChosenSurface ? "1" : undefined}>
      <head>
        {/* Bascule clair / sombre du visiteur : script du cœur, même origine, BLOQUANT (ni defer ni async) pour poser data-mode avant le premier rendu ; seulement si le skin a les deux modes. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- voulu : le script doit être bloquant pour que le mode soit posé avant le premier rendu (docs/SKINS.md §3.8) */}
        {look.modeScriptUrl && <script src={look.modeScriptUrl} />}
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <link rel="alternate" type="application/rss+xml" title={localized.name} href={`${siteUrl}${feedPath(locale)}`} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(siteJsonLd({ url: siteUrl, name: localized.name, tagline: localized.tagline, logo: pickLogo(localized.logos, "any", look.appearance.dark), locale, entity, sameAs: profiles, homeUrl: pageUrl(siteUrl, locale, config.defaultLocale, "/").replace(/\/$/, "") || siteUrl })) }} />
        <HeadTags blocks={headBlocks} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased" data-skin-root="">
        {layers.length > 0 && <div className="cbg" aria-hidden="true" data-skin-region="backdrop">{layers.map((_, i) => <i key={i} />)}</div>}
        <a href="#content" data-skin-part="skip-link" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-fg">
          {t("site.skip")}
        </a>
        {tray.enabled && <CookieTray labels={trayLabels} privacyHref={`${withLocale("/privacy", locale, config.defaultLocale)}#cookies`} initialOpen={tray.showTray} />}
        {/* Coquille : le DOM est le même pour tous les skins (docs/SKINS.md §9) ; l'ordre ci-dessous est l'ordre de lecture et de tabulation. Basic : un simple bloc. */}
        <div data-skin-region="shell">
          <div data-skin-region="banner"><Blocks blocks={bannerBlocks} locale={locale} /></div>
          <Header config={headerConfig} locale={locale} appearance={look.appearance} />
          <main id="content" data-skin-region="main">
            <div data-skin-region="content">{children}</div>
          </main>
          <Footer config={localized} locale={locale} />
        </div>
        {config.statsEnabled && <VisitBeacon />}
      </body>
    </html>
  );
}
