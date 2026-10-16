import { buildFeed, parseTopics, rssResponse } from "@/core/feeds";

export const dynamic = "force-dynamic";

// Flux RSS d'une seule instance : /feed/<clé>.xml (le « .xml » est facultatif)
export async function GET(request: Request, context: { params: Promise<{ key: string }> }) {
  const { key } = await context.params;
  const params = new URL(request.url).searchParams;
  const instance = key.endsWith(".xml") ? key.slice(0, -4) : key;
  const feed = await buildFeed({ locale: params.get("lang") ?? undefined, instance, topics: parseTopics(params.get("topics")) });
  if (!feed) return new Response("Not found", { status: 404 });
  return rssResponse(request, feed);
}
