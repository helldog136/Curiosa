import { buildFeed, parseTopics, renderRss } from "@/core/feeds";

export const dynamic = "force-dynamic";

// Flux RSS d'une seule instance : /feed/<clé>.xml
export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const params = new URL(request.url).searchParams;
  const instance = key.endsWith(".xml") ? key.slice(0, -4) : null;
  const feed = instance ? await buildFeed({ locale: params.get("lang") ?? undefined, instance, topics: parseTopics(params.get("topics")) }) : null;
  if (!feed) return new Response("Not found", { status: 404 });
  return new Response(renderRss(feed), { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
