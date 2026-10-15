import { buildLlmsTxt } from "@/core/llms";
import { isLlmsTxtEnabled } from "@/core/seoSettings";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

/** /<langue>/llms.txt pour chaque langue activée du site (le proxy ne réécrit pas les adresses contenant un point). */
export async function GET(_request: Request, { params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const config = await getSiteConfig();
  if (!(await isLlmsTxtEnabled()) || !config.locales.includes(lang)) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (lang === config.defaultLocale) return new Response(null, { status: 308, headers: { location: "/llms.txt" } });
  const body = await buildLlmsTxt(lang);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=600" } });
}
