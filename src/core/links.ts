import { isExternalHref } from "./url";

/** Préfixe un lien interne avec la langue du visiteur (sauf langue par défaut). */
export function withLocale(href: string, locale: string, defaultLocale: string): string {
  if (isExternalHref(href) || !href.startsWith("/") || href.startsWith("//")) return href;
  if (locale === defaultLocale) return href;
  return `/${locale}${href === "/" ? "" : href}`;
}
