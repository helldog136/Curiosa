import { currentUser } from "@/core/permissions";
import { hasRole } from "@/core/auth/access";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { getPage } from "@/core/overlays/store";
import { notFoundResponse, pageResponse } from "@/core/overlays/serve";

export const dynamic = "force-dynamic";

/**
 * Aperçu en direct dans l'éditeur : la même page que celle d'OBS, lue par la session d'administration (palier « admin »), sans adresse secrète et sans interrogation.
 * Elle montre la version ENREGISTRÉE, même si la page est désactivée.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await currentUser();
  if (!hasRole(user, OVERLAY_NEED)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const page = await getPage((await params).id);
  return page ? pageResponse(page, request, { preview: true }) : notFoundResponse();
}
