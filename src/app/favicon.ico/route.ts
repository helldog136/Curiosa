import { faviconUrl } from "@/core/favicon";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

/** Les navigateurs et robots demandent /favicon.ico d'office : on les envoie vers l'icône du site. */
export async function GET(request: Request): Promise<Response> {
  const config = await getSiteConfig();
  return Response.redirect(new URL(faviconUrl(config.favicon), request.url), 307);
}
