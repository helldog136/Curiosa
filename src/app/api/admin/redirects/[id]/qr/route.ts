import { prisma } from "@/core/db";
import { currentUser, hasRole } from "@/core/permissions";
import { parseLevel, qrPng, qrSvg } from "@/core/redirectQr";
import { redirectShortUrl } from "@/core/redirects";
import { makeTranslator } from "@/core/i18n/dictionary";
import { resolveAdminLocale } from "@/core/i18n/request";

export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } as const;

/**
 * QR code d'une redirection, pour l'administration (équipe connectée seulement).
 *   ?fmt=svg|png   format (svg par défaut)    ?level=m|q   correction d'erreurs (M par défaut)    ?dl=1   téléchargement
 * Il encode l'adresse COMPLÈTE du lien court, pas sa destination.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: HEADERS });
  if (!hasRole(user, "editor")) return new Response("Forbidden", { status: 403, headers: HEADERS });
  const { id } = await ctx.params;
  const row = await prisma.redirect.findUnique({ where: { id }, select: { path: true } });
  if (!row) return new Response("Not found", { status: 404, headers: HEADERS });
  const url = new URL(request.url);
  const png = url.searchParams.get("fmt") === "png";
  const level = parseLevel(url.searchParams.get("level"));
  const text = redirectShortUrl(row.path);
  const t = makeTranslator(await resolveAdminLocale(user.locale));
  const name = `qr-${row.path.replace(/[^a-z0-9_-]+/g, "-")}.${png ? "png" : "svg"}`;
  const disposition: Record<string, string> = url.searchParams.get("dl") === "1" ? { "content-disposition": `attachment; filename="${name}"` } : {};
  try {
    if (png) return new Response(new Uint8Array(await qrPng(text, { level })), { headers: { ...HEADERS, ...disposition, "content-type": "image/png" } });
    return new Response(qrSvg(text, { level, label: t("redirects.qr.alt", { address: text }) }), { headers: { ...HEADERS, ...disposition, "content-type": "image/svg+xml; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  } catch {
    return new Response("QR code unavailable", { status: 422, headers: HEADERS });
  }
}
