import crypto from "node:crypto";
import { makeTranslator } from "../i18n/dictionary";
import { getSiteConfig } from "../settings";
import { contentSecurityPolicy, frameSources, framePaths, pageHeaders, renderPage } from "./render";
import { resolvePage } from "./resolve";
import { testActive, type OverlayPageData } from "./model";
import { skinForPage, skinPayload, type LoadedPayload } from "./skinLoad";

/** Réponse de la page de rendu, publique (par l'adresse secrète) ou d'aperçu (administration, sans secret ni interrogation). */
export const NOT_FOUND_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Content-Type": "text/plain; charset=utf-8" };
export const notFoundResponse = (): Response => new Response(null, { status: 404, headers: NOT_FOUND_HEADERS });   // empty body: nothing to show, nothing shown in OBS

export async function pageResponse(page: OverlayPageData, request: Request, opts: { preview?: boolean; stateUrl?: string; /** Admin preview only: wear this installed overlay skin instead of the page's own ("" = the common style). */ forceSkin?: string } = {}): Promise<Response> {
  const config = await getSiteConfig();
  const asked = new URL(request.url).searchParams.get("lang") ?? "";
  const lang = config.locales.includes(asked) ? asked : config.defaultLocale;
  const now = Date.now();
  const shown = opts.preview ? { ...page, active: true } : page;
  const test = testActive(page.testUntil, now);
  // Jamais d'erreur visible dans OBS : si la résolution échoue en bloc, la page reste là, sans éléments.
  const elements = shown.active ? await resolvePage(shown, { lang, defaultLocale: config.defaultLocale }).catch(() => []) : [];
  const skin: LoadedPayload | null = shown.active ? (opts.forceSkin !== undefined ? await skinPayload(opts.forceSkin || null).catch(() => null) : (await skinForPage(page.look, now)).payload) : null;
  const contextual = page.look.byContext.enabled && !opts.preview;
  const nonce = crypto.randomBytes(16).toString("base64");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const html = renderPage({ page: shown, elements, t: makeTranslator(lang), lang, test, now, nonce, stateUrl: opts.stateUrl ?? "", fit: !!opts.preview || new URL(request.url).searchParams.get("fit") === "1", skin, contextual });
  return new Response(html, { status: 200, headers: pageHeaders(contentSecurityPolicy(nonce, frameSources(host, framePaths(elements)))) });
}

/** État léger lu par OBS : version de la mise en page, actif ou non, mode test (constaté maintenant). Aucune donnée d'élément. */
export async function stateResponse(page: OverlayPageData, now = Date.now(), knownSkin = ""): Promise<Response> {
  const test = testActive(page.testUntil, now);
  // The skin now: key always, the sheet only when it differs from the one the page already wears (it switches after seeing the same key twice).
  const wears = page.active && (page.look.skin || page.look.byContext.enabled) ? (await skinForPage(page.look, now)).payload : null;
  const skin = wears ? { key: wears.key, id: wears.id, ...(wears.key !== knownSkin ? { css: wears.css } : {}) } : { key: "" };
  return new Response(JSON.stringify({ rev: page.rev, active: page.active, test, until: test ? page.testUntil : null, now, skin }), {
    status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" },
  });
}
