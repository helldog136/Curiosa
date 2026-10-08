import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { buildTheme, themeCss } from "@/core/color";
import { glowCss } from "@/core/glow";
import { backgroundCss, effectiveLayers } from "@/core/background";
import { RTL_LOCALES } from "@/core/i18n/locales";
import { getVisitorLocale, getVisitorTranslator, LOCALE_HEADER } from "@/core/i18n/request";
import { runSlot } from "@/core/modules/runtime";
import { getSiteConfig } from "@/core/settings";
import { siteUrl } from "@/core/config";
import { jsonLd, siteJsonLd } from "@/core/seo";
import { prisma } from "@/core/db";
import { Blocks, HeadTags } from "@/components/site/Blocks";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  return {
    metadataBase: new URL(siteUrl),
    title: { default: config.name, template: `%s | ${config.name}` },
    description: config.tagline || undefined,
    openGraph: { siteName: config.name, title: config.name, description: config.tagline || undefined, images: config.logo ? [config.logo] : undefined },
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
  const theme = buildTheme(localized.background, localized.accent, localized.font);
  const layers = effectiveLayers(localized.bg.preset, localized.bg.custom, localized.bg.image);
  const css = themeCss(theme) + glowCss(localized.glow.level, localized.glow.custom, localized.accent) + backgroundCss(layers, theme);

  const [headBlocks, bannerBlocks] = await Promise.all([runSlot("layout.head", locale), runSlot("layout.banner", locale)]);

  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? "rtl" : "ltr"}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <link rel="alternate" type="application/rss+xml" title={localized.name} href={`/feed.xml?lang=${locale}`} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(siteJsonLd({ url: siteUrl, name: localized.name, tagline: localized.tagline, logo: localized.logo, locale })) }} />
        <HeadTags blocks={headBlocks} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        {layers.length > 0 && <div className="cbg" aria-hidden="true">{layers.map((_, i) => <i key={i} />)}</div>}
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-1 focus:text-accent-fg">
          {t("site.skip")}
        </a>
        <Blocks blocks={bannerBlocks} locale={locale} />
        <Header config={localized} locale={locale} />
        <main id="content" className="mx-auto max-w-5xl px-4 py-10">
          {children}
        </main>
        <Footer config={localized} locale={locale} />
      </body>
    </html>
  );
}
