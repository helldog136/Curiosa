import { buildContext } from "@/core/modules/context";
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
  const handler = active?.mod.def.routes?.[path.join("/")];
  if (!active || !handler) return new Response("Not found", { status: 404 });

  try {
    // ?lang=xx choisit la langue du contenu servi (JSON d'un overlay, par exemple).
    const config = await getSiteConfig();
    const lang = new URL(request.url).searchParams.get("lang") ?? "";
    return await handler(request, await buildContext(active.mod, active.instance, config.locales.includes(lang) ? lang : undefined));
  } catch (error) {
    console.error(`[modules] ${key} route "${path.join("/")}" failed:`, error);
    return new Response("Module error", { status: 500 });
  }
}

export { handle as GET, handle as POST };
