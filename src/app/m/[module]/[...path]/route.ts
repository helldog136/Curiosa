import { buildContext } from "@/core/modules/context";
import { getModule } from "@/core/modules/registry";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ module: string; path: string[] }> };

async function handle(request: Request, { params }: Params): Promise<Response> {
  const { module: id, path } = await params;

  // Refuse les écritures venues d'un autre site (CSRF) : un module n'a pas à y penser.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return new Response("Forbidden", { status: 403 });
  }

  const mod = await getModule(id);
  if (!mod || !mod.row.enabled) return new Response("Not found", { status: 404 });
  const handler = mod.def.routes?.[path.join("/")];
  if (!handler) return new Response("Not found", { status: 404 });

  try {
    return await handler(request, await buildContext(mod));
  } catch (error) {
    console.error(`[modules] ${id} route "${path.join("/")}" failed:`, error);
    return new Response("Module error", { status: 500 });
  }
}

export { handle as GET, handle as POST };
