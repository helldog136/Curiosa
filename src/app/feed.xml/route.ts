import { buildFeed, parseTopics, rssResponse } from "@/core/feeds";

export const dynamic = "force-dynamic";

// Flux RSS de tout le site. La logique est dans src/core/feeds.ts.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const feed = await buildFeed({ locale: params.get("lang") ?? undefined, topics: parseTopics(params.get("topics")) });
  if (!feed) return new Response("Not found", { status: 404 }); // rubriques demandées toutes inconnues
  return rssResponse(request, feed);
}
