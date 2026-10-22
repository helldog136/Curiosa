import { getActiveInstances } from "@/core/modules/registry";
import { readModuleScript, scriptVersion } from "@/core/modules/pageScripts";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ instance: string; name: string }> };

/** /m/<clé d'instance>/_script/<nom>.js : un script de page d'un module (dossier `scripts/` du module), lecture seule. Voir pageScripts.ts. */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { instance: key, name } = await params;
  const active = (await getActiveInstances()).find((a) => a.instance.key === key);
  const file = active && active.mod.def.page ? readModuleScript(active.mod.manifest.id, name) : null;
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      // L'adresse porte l'empreinte du contenu (?v=) : un fichier changé a une autre adresse.
      "Cache-Control": new URL(request.url).searchParams.get("v") === scriptVersion(file.integrity) ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}
