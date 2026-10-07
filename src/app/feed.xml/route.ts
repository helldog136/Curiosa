import { buildFeed, renderRss } from "@/core/feeds";

export const dynamic = "force-dynamic";

// Flux RSS de tout le site. La logique est dans src/core/feeds.ts.
export async function GET(request: Request) {
  const feed = await buildFeed({ locale: new URL(request.url).searchParams.get("lang") ?? undefined });
  return new Response(renderRss(feed!), { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
