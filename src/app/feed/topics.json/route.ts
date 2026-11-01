import { listFeedTopics } from "@/core/feeds";

export const dynamic = "force-dynamic";

// Catalogue des rubriques qu'on peut suivre : /feed.xml?topics=<id>,<id>
export async function GET(request: Request) {
  const topics = await listFeedTopics(new URL(request.url).searchParams.get("lang") ?? undefined);
  return Response.json({ topics }, { headers: { "cache-control": "public, max-age=300" } });
}
