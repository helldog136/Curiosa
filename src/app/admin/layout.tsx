import { pickLogo } from "@/core/logos";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_THEME_COOKIE, adminThemeCss, parseAdminTheme } from "@/core/adminTheme";
import { getAdminTranslator } from "@/core/i18n/request";
import { RTL_LOCALES } from "@/core/i18n/locales";
import { currentUser } from "@/core/permissions";
import { faviconUrl } from "@/core/favicon";
import { getSiteConfig } from "@/core/settings";
import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  // L'onglet de l'admin porte l'icône du site, comme le site lui-même.
  const config = await getSiteConfig().catch(() => null);
  return {
    title: { default: "Admin", template: "%s · Admin" },
    robots: { index: false, follow: false },
    icons: { icon: faviconUrl(config ? pickLogo(config.logos, "favicon", false) : null) },
  };
}

// Interface d'admin : palette chaleureuse (papier crème, cartes blanches, accent violet doux) ou sombre, indépendante du thème du site (voir core/adminTheme.ts).
const CSS = adminThemeCss();

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const { locale } = await getAdminTranslator(user?.locale);
  const theme = parseAdminTheme((await cookies()).get(ADMIN_THEME_COOKIE)?.value);
  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? "rtl" : "ltr"} data-admin-theme={theme}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
