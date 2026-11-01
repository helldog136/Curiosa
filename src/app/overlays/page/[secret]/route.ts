import { getPageBySecret } from "@/core/overlays/store";
import { hashSecret, SECRET_RE } from "@/core/overlays/secret";
import { notFoundResponse, pageResponse } from "@/core/overlays/serve";

export const dynamic = "force-dynamic";

/**
 * /overlays/page/<adresse secrète> : la page d'overlay rendue pour OBS (voir core/overlays/render.ts). Une adresse inconnue, mal formée ou ancienne (secret changé)
 * donne le même 404 muet : rien ne permet de deviner. Ne s'applique qu'à ce chemin à deux segments : `/overlays/<clé>` (overlays des modules) ne change pas.
 */
export async function GET(request: Request, { params }: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await params;
  if (!SECRET_RE.test(secret)) return notFoundResponse();
  const page = await getPageBySecret(hashSecret(secret)).catch(() => null);
  if (!page) return notFoundResponse();
  return pageResponse(page, request, { stateUrl: `/overlays/page/${secret}/state` });
}
