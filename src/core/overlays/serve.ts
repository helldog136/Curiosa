import crypto from "node:crypto";
import { makeTranslator } from "../i18n/dictionary";
import { getSiteConfig } from "../settings";
import { contentSecurityPolicy, frameSources, framePaths, pageHeaders, renderPage } from "./render";
import { resolvePage } from "./resolve";
import { testActive, type OverlayPageData } from "./model";

/** Réponse de la page de rendu, publique (par l'adresse secrète) ou d'aperçu (administration, sans secret ni interrogation). */
export const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Content-Type": "text/plain; charset=utf-8" };
export const notFoundResponse = (): Response => new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });

export async function pageResponse(page: OverlayPageData, request: Request, opts: { preview?: boolean; stateUrl?: string } = {}): Promise<Response> {
  const config = await getSiteConfig();
  const asked = new URL(request.url).searchParams.get("lang") ?? "";
  const lang = config.locales.includes(asked) ? asked : config.defaultLocale;
  const now = Date.now();
  const shown = opts.preview ? { ...page, active: true } : page;
  const test = testActive(page.testUntil, now);
  // Jamais d'erreur visible dans OBS : si la résolution échoue en bloc, la page reste là, sans éléments.
  const elements = shown.active ? await resolvePage(shown, { lang, defaultLocale: config.defaultLocale }).catch(() => []) : [];
  const nonce = crypto.randomBytes(16).toString("base64");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const html = renderPage({ page: shown, elements, t: makeTranslator(lang), lang, test, now, nonce, stateUrl: opts.stateUrl ?? "", fit: !!opts.preview || new URL(request.url).searchParams.get("fit") === "1" });
  return new Response(html, { status: 200, headers: pageHeaders(contentSecurityPolicy(nonce, frameSources(host, framePaths(elements)))) });
}

/** État léger lu par OBS : version de la mise en page, actif ou non, mode test (constaté maintenant). Aucune donnée d'élément. */
export function stateResponse(page: OverlayPageData, now = Date.now()): Response {
  const test = testActive(page.testUntil, now);
  return new Response(JSON.stringify({ rev: page.rev, active: page.active, test, until: test ? page.testUntil : null, now }), {
    status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" },
  });
}
