import { buildLlmsTxt } from "@/core/llms";
import { isLlmsTxtEnabled } from "@/core/seoSettings";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

/** /llms.txt : la présentation du site pour les assistants IA, dans la langue principale (les autres : /<langue>/llms.txt). */
export async function GET() {
  if (!(await isLlmsTxtEnabled())) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const body = await buildLlmsTxt((await getSiteConfig()).defaultLocale);
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=600" } });
}
