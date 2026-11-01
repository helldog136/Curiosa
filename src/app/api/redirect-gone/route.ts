import { buildTheme, themeCss } from "@/core/color";
import { prisma } from "@/core/db";
import { RTL_LOCALES } from "@/core/i18n/locales";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getVisitorLocale } from "@/core/i18n/request";
import { pickLogo, isDarkBackground } from "@/core/logos";
import { renderGonePage } from "@/core/redirectGone";
import { getSiteConfig, themeExtraOf } from "@/core/settings";

export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
const PATH_RE = /^[a-z0-9][a-z0-9_/-]{0,79}$/;

/**
 * Page « lien terminé » (réponse 410). Le proxy y envoie les adresses dont la date de fin est passée (Next ne sait pas répondre 410 depuis une page).
 * Elle ne dit rien d'autre que « ce lien est terminé » : jamais la destination. Pour tout autre cas (lien inconnu, désactivé, pas terminé), 404.
 */
async function gone(request: Request, withBody: boolean): Promise<Response> {
  const path = (new URL(request.url).searchParams.get("p") ?? "").toLowerCase();
  if (!PATH_RE.test(path)) return NOT_FOUND();
  const row = await prisma.redirect.findUnique({ where: { path }, select: { active: true, expiresAt: true, endMessage: true } });
  if (!row || !row.active || !row.expiresAt || row.expiresAt.getTime() > Date.now()) return NOT_FOUND();

  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  const defaultLocale = (await getSiteConfig()).defaultLocale;
  const t = makeTranslator(locale);
  const html = renderGonePage({
    lang: locale, rtl: RTL_LOCALES.has(locale), siteName: config.name,
    title: t("site.gone.title"), message: row.endMessage, defaultMessage: t("site.gone.message"),
    homeLabel: t("site.backHome"), homeHref: locale === defaultLocale ? "/" : `/${locale}`,
    themeCss: themeCss(buildTheme(config.background, config.accent, config.font, themeExtraOf(config))),
    logoUrl: pickLogo(config.logos, "any", isDarkBackground(config.background)),
  });
  return new Response(withBody ? html : null, {
    status: 410,
    // Jamais en mémoire : la personne peut réactiver le lien en un clic, et le visiteur doit alors être redirigé tout de suite.
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" },
  });
}

export const GET = (request: Request) => gone(request, true);
export const HEAD = (request: Request) => gone(request, false);
