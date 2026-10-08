import { NextResponse, type NextRequest } from "next/server";
import { isKnownLocale } from "@/core/i18n/locales";
import { planVisit, SEEN_COOKIE, SINCE_COOKIE, SINCE_HEADER } from "@/core/visit";

const LOCALE_HEADER = "x-curiosa-locale";
const PATH_HEADER = "x-curiosa-path";
const COOKIE = "curiosa_locale";

/**
 * Langue du visiteur dans l'URL : /en/blog → on réécrit vers /blog et on
 * transmet "en" aux pages via un en-tête. La langue par défaut n'a pas de
 * préfixe. Quelles langues sont *activées* se vérifie côté serveur (le proxy
 * n'a pas besoin d'accéder à la base).
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const headers = new Headers(request.headers);
  // Jamais de confiance dans ces en-têtes s'ils viennent du client.
  headers.delete(LOCALE_HEADER);
  headers.delete(PATH_HEADER);
  headers.delete(SINCE_HEADER);
  // Dernière visite : date retenue pour cette visite, transmise aux pages ; les cookies ne contiennent que des dates.
  const visit = planVisit({ seen: request.cookies.get(SEEN_COOKIE)?.value, since: request.cookies.get(SINCE_COOKIE)?.value });
  headers.set(SINCE_HEADER, String(visit.since.getTime()));
  const stamp = <T extends NextResponse>(res: T): T => {
    if (visit.setSince !== undefined) res.cookies.set(SINCE_COOKIE, visit.setSince, { path: "/", sameSite: "lax" });
    res.cookies.set(SEEN_COOKIE, visit.setSeen, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  };

  // ?vl=default : le visiteur choisit explicitement la langue par défaut → on s'en souvient.
  if (searchParams.get("vl") === "default") {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("vl");
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE, "default", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return res;
  }

  const match = /^\/([a-z]{2})(\/.*)?$/.exec(pathname);
  if (match && isKnownLocale(match[1]!)) {
    const locale = match[1]!;
    const rest = match[2] || "/";
    headers.set(LOCALE_HEADER, locale);
    headers.set(PATH_HEADER, rest);
    const url = request.nextUrl.clone();
    url.pathname = rest;
    const res = NextResponse.rewrite(url, { request: { headers } });
    res.cookies.set(COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return stamp(res);
  }

  headers.set(PATH_HEADER, pathname);
  return stamp(NextResponse.next({ request: { headers } }));
}

export const config = {
  // Pas d'admin, d'API, de fichiers statiques ni de routes de modules.
  matcher: ["/((?!_next|api|admin|m/|overlays/|uploads/|.*\\..*).*)"],
};
