import type { Metadata } from "next";
import { buildPalette } from "@/core/color";
import { getAdminTranslator } from "@/core/i18n/request";
import { RTL_LOCALES } from "@/core/i18n/locales";
import { currentUser } from "@/core/permissions";
import "../globals.css";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

// Interface d'admin : palette neutre et claire, indépendante du thème du site.
const PALETTE = buildPalette("#f6f6f7", "#4f46e5");
const CSS = `:root{${Object.entries(PALETTE).map(([k, v]) => `${k}:${v}`).join(";")}}`;

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const { locale } = await getAdminTranslator(user?.locale);
  return (
    <html lang={locale} dir={RTL_LOCALES.has(locale) ? "rtl" : "ltr"}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
