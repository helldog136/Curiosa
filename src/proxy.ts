import { NextResponse, type NextRequest } from "next/server";
import { isKnownLocale } from "@/core/i18n/locales";

const LOCALE_HEADER = "x-vitrine-locale";
const PATH_HEADER = "x-vitrine-path";
const COOKIE = "vitrine_locale";

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
    return res;
  }

  headers.set(PATH_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pas d'admin, d'API, de fichiers statiques ni de routes de modules.
  matcher: ["/((?!_next|api|admin|m/|overlays/|uploads/|.*\\..*).*)"],
};
