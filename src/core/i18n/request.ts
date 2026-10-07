import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getSiteConfig } from "../settings";
import { makeTranslator, type Translator } from "./dictionary";
import { isKnownLocale } from "./locales";

export const LOCALE_HEADER = "x-curiosa-locale";
export const VISITOR_COOKIE = "curiosa_locale";
export const ADMIN_COOKIE = "curiosa_admin_locale";

/** Langue du visiteur : préfixe d'URL (posé par proxy.ts) sinon langue par défaut. */
export const getVisitorLocale = cache(async (): Promise<string> => {
  const config = await getSiteConfig();
  const fromUrl = (await headers()).get(LOCALE_HEADER);
  if (fromUrl && config.locales.includes(fromUrl)) return fromUrl;
  return config.defaultLocale;
});

export const getVisitorTranslator = cache(async (): Promise<Translator> => {
  return makeTranslator(await getVisitorLocale());
});

/**
 * Langue de l'interface d'admin : choix de l'utilisateur, sinon cookie (écran
 * de connexion), sinon réglage du site, sinon langue par défaut.
 */
export async function resolveAdminLocale(userLocale?: string | null): Promise<string> {
  const config = await getSiteConfig();
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  for (const candidate of [userLocale, cookie, config.adminLocale, config.defaultLocale]) {
    if (candidate && isKnownLocale(candidate)) return candidate;
  }
  return "en";
}

export async function getAdminTranslator(userLocale?: string | null): Promise<{ t: Translator; locale: string }> {
  const locale = await resolveAdminLocale(userLocale);
  return { t: makeTranslator(locale), locale };
}

/** Préfixe d'URL pour une langue ("" pour la langue par défaut). */
export function localePrefix(locale: string, defaultLocale: string): string {
  return locale === defaultLocale ? "" : `/${locale}`;
}
