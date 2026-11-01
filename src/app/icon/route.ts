import { defaultFaviconSvg } from "@/core/favicon";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

/** Icône par défaut (sans image envoyée) : couleurs d'accent et de fond du site. */
export async function GET(): Promise<Response> {
  const config = await getSiteConfig();
  return new Response(defaultFaviconSvg(config.accent, config.background), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=600" } });
}
