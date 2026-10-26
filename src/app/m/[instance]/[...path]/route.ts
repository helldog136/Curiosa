import { buildContext } from "@/core/modules/context";
import { matchModuleRoute } from "@/core/modules/pageMeta";
import { getActiveInstances } from "@/core/modules/registry";
import { getSiteConfig } from "@/core/settings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ instance: string; path: string[] }> };

/** /m/<clé d'instance>/<route> : les routes qu'un module expose pour chacune de ses instances. */
async function handle(request: Request, { params }: Params): Promise<Response> {
  const { instance: key, path } = await params;

  // Refuse les écritures venues d'un autre site (CSRF) : un module n'a pas à y penser.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host && new URL(origin).host !== host) return new Response("Forbidden", { status: 403 });
  }

  const active = (await getActiveInstances()).find((a) => a.instance.key === key);
  // (0.3.0) La route de ce nom exact d'abord (comme toujours) ; sinon une route `…/:slug` dont le dernier segment passe le motif strict (voir pageMeta.ts).
  const route = active ? matchModuleRoute(active.mod.def.routes, path) : null;
  if (!active || !route) return new Response("Not found", { status: 404 });

  try {
    // ?lang=xx choisit la langue du contenu servi (JSON d'un overlay, par exemple).
    const config = await getSiteConfig();
    const lang = new URL(request.url).searchParams.get("lang") ?? "";
    const ctx = await buildContext(active.mod, active.instance, config.locales.includes(lang) ? lang : undefined);
    ctx.params = Object.freeze({ ...route.params });
    return await route.handler(request, ctx);
  } catch (error) {
    console.error(`[modules] ${key} route "${path.join("/")}" failed:`, error);
    return new Response("Module error", { status: 500 });
  }
}

export { handle as GET, handle as POST };
