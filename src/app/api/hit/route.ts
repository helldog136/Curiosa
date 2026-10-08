import { recordVisit } from "@/core/stats";
import { siteUrl } from "@/core/config";

export const dynamic = "force-dynamic";

const MAX_BODY = 1024;

/** Une page vue, envoyée par le navigateur du visiteur (voir VisitBeacon). Répond toujours 204 : le visiteur n'a rien à savoir. */
export async function POST(request: Request): Promise<Response> {
  const none = new Response(null, { status: 204 });
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return none;
    const body = JSON.parse(text) as { p?: unknown; r?: unknown };
    const cookie = request.headers.get("cookie") ?? "";
    // Les personnes connectées à l'admin (l'équipe du site) ne sont pas des visiteurs.
    if (/(^|;\s*)(__Secure-)?authjs\.session-token=/.test(cookie)) return none;
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || request.headers.get("x-real-ip") || "?";
    await recordVisit({
      path: body.p, referrer: body.r, ip, userAgent: request.headers.get("user-agent") ?? "",
      doNotTrack: request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1", ownHost: new URL(siteUrl).host,
    });
  } catch { /* une mesure ratée ne doit jamais gêner personne */ }
  return none;
}
