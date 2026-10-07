import { getAdminTranslator } from "./i18n/request";
import type { Translator } from "./i18n/dictionary";
import { requireRole, type AdminUser, type Role } from "./permissions";
import { getSiteConfig, type SiteConfig } from "./settings";

/** `advanced` : version avancée de l'admin (réglages techniques) ; sinon version simplifiée. */
export type AdminCtx = { user: AdminUser; t: Translator; locale: string; config: SiteConfig; advanced: boolean };

/** Point d'entrée commun des pages et actions d'admin : droits, langue, réglages. */
export async function adminCtx(min: Role = "editor"): Promise<AdminCtx> {
  const user = await requireRole(min);
  const { t, locale } = await getAdminTranslator(user.locale);
  return { user, t, locale, config: await getSiteConfig(), advanced: user.advanced };
}
