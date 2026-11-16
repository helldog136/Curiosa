import { currentUser } from "@/core/permissions";
import { hasRole } from "@/core/auth/access";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { getPage, listVersions } from "@/core/overlays/store";
import { notFoundResponse, pageResponse } from "@/core/overlays/serve";

export const dynamic = "force-dynamic";

/**
 * Aperçu en direct dans l'éditeur : la même page que celle d'OBS, lue par la session d'administration (palier « admin »), sans adresse secrète et sans interrogation.
 * Elle montre la version ENREGISTRÉE, même si la page est désactivée.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await currentUser();
  if (!hasRole(user, OVERLAY_NEED)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const id = (await params).id;
  const page = await getPage(id);
  const query = new URL(request.url).searchParams;
  const forced = query.get("skin");
  // (0.20.0) `?version=<at>`: a saved version, shown before "Restore this version" (R24). Same page, same look; only the layout differs.
  const at = Number(query.get("version") ?? "");
  const version = page && query.has("version") ? (await listVersions(id)).find((v) => v.at === at) : undefined;
  if (page && query.has("version") && !version) return notFoundResponse();
  const shown = page && version ? { ...page, name: version.name, width: version.width, height: version.height, style: version.style, elements: version.elements } : page;
  return shown ? pageResponse(shown, request, { preview: true, ...(forced !== null ? { forceSkin: forced.slice(0, 41) } : {}) }) : notFoundResponse();
}
