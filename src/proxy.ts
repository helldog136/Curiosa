import { NextResponse, type NextRequest } from "next/server";
import { isKnownLocale } from "@/core/i18n/locales";
import { NEWS_COOKIE, planVisit, SEEN_COOKIE, SINCE_COOKIE, SINCE_HEADER } from "@/core/visit";
import { TIMED_OUT, withDeadline } from "@/core/deadline";
import { isRedirectEnded } from "@/core/redirectGate";
import { geolocationOpen, policyValue } from "@/core/permissionsPolicy";
import { PREVIEW_HEADER, PREVIEW_PARAM, PREVIEW_TOKEN_RE } from "@/core/skins/previewToken";

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

/** Forme d'un chemin de lien court (le même que dans core/redirects.ts) : seuls ces chemins sont comparés à la porte des liens terminés. */
const SHORT_PATH = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
/** Temps maximal accordé à la porte des liens terminés : au-delà, la page se sert normalement (jamais d'attente sans borne). */
const GATE_MAX_MS = 1500;
/** Temps maximal accordé à la lecture de « un module a-t-il besoin de la position ? » : au-delà (ou au moindre doute), l'en-tête reste FERMÉ. */
const POLICY_MAX_MS = 500;

/** Le lien court de ce chemin a-t-il passé sa date de fin ? Alors on détourne vers la page « lien terminé », qui répond 410 (une page de Next ne sait répondre qu'en 200 ou 404). */
async function endedRewrite(request: NextRequest, path: string, headers: Headers): Promise<NextResponse | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  let short: string;
  try { short = decodeURIComponent(path).replace(/^\/+|\/+$/g, "").toLowerCase(); } catch { return null; }
  if (short.length === 0 || short.length > 80 || !SHORT_PATH.test(short)) return null;
  const ended = await withDeadline(() => isRedirectEnded(short), GATE_MAX_MS).catch(() => false);
  if (ended === TIMED_OUT || !ended) return null;
  const url = request.nextUrl.clone();
  url.pathname = "/api/redirect-gone";
  url.search = `?p=${encodeURIComponent(short)}`;
  return NextResponse.rewrite(url, { request: { headers } });
}

/**
 * Langue du visiteur dans l'URL : /en/blog → on réécrit vers /blog et on
 * transmet "en" aux pages via un en-tête. La langue par défaut n'a pas de
 * préfixe. Quelles langues sont *activées* se vérifie côté serveur. Seule exception à « pas de base ici » : la porte des liens terminés
 * (core/redirectGate.ts), une petite carte en mémoire relue au plus toutes les 30 secondes.
 */
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const headers = new Headers(request.headers);
  // Jamais de confiance dans ces en-têtes s'ils viennent du client, SAUF la langue que ce même proxy vient de poser au premier passage (preuve secrète).
  const carried = request.headers.get(LOCALE_HEADER);
  const carriedLocale = carried && request.headers.get(PROOF_HEADER) === PROOF && isKnownLocale(carried) ? carried : null;
  headers.delete(LOCALE_HEADER);
  headers.delete(PROOF_HEADER);
  headers.delete(PATH_HEADER);
  headers.delete(SINCE_HEADER);
  // Aperçu d'un skin (page Apparence) : le jeton de l'adresse est recopié dans un en-tête interne ; il n'est cru qu'après vérification de sa signature, par le gabarit du site.
  headers.delete(PREVIEW_HEADER);
  const previewToken = searchParams.get(PREVIEW_PARAM);
  if (previewToken && PREVIEW_TOKEN_RE.test(previewToken)) headers.set(PREVIEW_HEADER, previewToken);
  // Dernière visite : date retenue pour cette visite, transmise aux pages ; les cookies ne contiennent que des dates.
  // Seulement si le visiteur l'a DEMANDÉ (cookie de son choix) ; sinon rien n'est déposé et les cookies d'avant sont effacés.
  const optedIn = request.cookies.get(NEWS_COOKIE)?.value === "1";
  const visit = planVisit(optedIn ? { seen: request.cookies.get(SEEN_COOKIE)?.value, since: request.cookies.get(SINCE_COOKIE)?.value } : {});
  headers.set(SINCE_HEADER, optedIn ? String(visit.since.getTime()) : "0");
  // Position du visiteur : permise (au site seul) uniquement si un module installé la demande ; sinon la valeur fermée de next.config.mjs reste. Cache en mémoire (core/permissionsPolicy.ts).
  const policy = policyValue((await withDeadline(() => geolocationOpen(), POLICY_MAX_MS).catch(() => false)) === true);
  const stamp = <T extends NextResponse>(res: T): T => {
    res.headers.set("Permissions-Policy", policy);
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
    const gone = await endedRewrite(request, rest, headers);
    if (gone) return stamp(gone);
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
  const gone = await endedRewrite(request, pathname, headers);
  if (gone) return stamp(gone);
  return stamp(NextResponse.next({ request: { headers } }));
}

export const config = {
  // Pas d'admin, d'API, de fichiers statiques ni de routes de modules.
  matcher: ["/((?!_next|api|admin|m/|overlays/|uploads/|.*\\..*).*)"],
};
