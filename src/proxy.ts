import { NextResponse, type NextRequest } from "next/server";
import { isKnownLocale } from "@/core/i18n/locales";
import { NEWS_COOKIE, planVisit, SEEN_COOKIE, SINCE_COOKIE, SINCE_HEADER } from "@/core/visit";

const LOCALE_HEADER = "x-curiosa-locale";
const PATH_HEADER = "x-curiosa-path";
const COOKIE = "curiosa_locale";
/**
 * Preuve que l'en-tête de langue vient de CE proxy et non du visiteur. Next relance le proxy sur l'adresse réécrite (/en/privacy → /privacy) : sans preuve,
 * ce second passage effaçait la langue posée par le premier (toutes les pages /en/… sortaient dans la langue par défaut). Secret tiré au hasard, propre à
 * ce processus, jamais envoyé au visiteur : un visiteur ne peut donc ni l'inventer ni imposer une langue en forgeant l'en-tête.
 */
const PROOF_HEADER = "x-curiosa-lp";
const PROOF = `${crypto.randomUUID()}${crypto.randomUUID()}`;

/**
 * Langue du visiteur dans l'URL : /en/blog → on réécrit vers /blog et on
 * transmet "en" aux pages via un en-tête. La langue par défaut n'a pas de
 * préfixe. Quelles langues sont *activées* se vérifie côté serveur (le proxy
 * n'a pas besoin d'accéder à la base).
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const headers = new Headers(request.headers);
  // Jamais de confiance dans ces en-têtes s'ils viennent du client, SAUF la langue que ce même proxy vient de poser au premier passage (preuve secrète).
  const carried = request.headers.get(LOCALE_HEADER);
  const carriedLocale = carried && request.headers.get(PROOF_HEADER) === PROOF && isKnownLocale(carried) ? carried : null;
  headers.delete(LOCALE_HEADER);
  headers.delete(PROOF_HEADER);
  headers.delete(PATH_HEADER);
  headers.delete(SINCE_HEADER);
  // Dernière visite : date retenue pour cette visite, transmise aux pages ; les cookies ne contiennent que des dates.
  // Seulement si le visiteur l'a DEMANDÉ (cookie de son choix) ; sinon rien n'est déposé et les cookies d'avant sont effacés.
  const optedIn = request.cookies.get(NEWS_COOKIE)?.value === "1";
  const visit = planVisit(optedIn ? { seen: request.cookies.get(SEEN_COOKIE)?.value, since: request.cookies.get(SINCE_COOKIE)?.value } : {});
  headers.set(SINCE_HEADER, optedIn ? String(visit.since.getTime()) : "0");
  const stamp = <T extends NextResponse>(res: T): T => {
    if (!optedIn) {
      for (const name of [SEEN_COOKIE, SINCE_COOKIE]) if (request.cookies.has(name)) res.cookies.set(name, "", { path: "/", maxAge: 0 });
      return res;
    }
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
    headers.set(PROOF_HEADER, PROOF);
    headers.set(PATH_HEADER, rest);
    const url = request.nextUrl.clone();
    url.pathname = rest;
    const res = NextResponse.rewrite(url, { request: { headers } });
    res.cookies.set(COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return stamp(res);
  }

  // Second passage sur l'adresse réécrite : la langue du premier passage est conservée.
  if (carriedLocale) {
    headers.set(LOCALE_HEADER, carriedLocale);
    headers.set(PROOF_HEADER, PROOF);
  }
  headers.set(PATH_HEADER, pathname);
  return stamp(NextResponse.next({ request: { headers } }));
}

export const config = {
  // Pas d'admin, d'API, de fichiers statiques ni de routes de modules.
  matcher: ["/((?!_next|api|admin|m/|overlays/|uploads/|.*\\..*).*)"],
};
