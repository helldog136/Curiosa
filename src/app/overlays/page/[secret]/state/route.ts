import { getPageBySecret } from "@/core/overlays/store";
import { hashSecret, SECRET_RE } from "@/core/overlays/secret";
import { notFoundResponse, stateResponse } from "@/core/overlays/serve";

export const dynamic = "force-dynamic";

/** Interrogation légère faite par la page ouverte dans OBS (toutes les ~5 s, de plus en plus espacée) : version, actif, mode test. Aucune tâche de fond côté serveur. */
export async function GET(request: Request, { params }: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await params;
  if (!SECRET_RE.test(secret)) return notFoundResponse();
  const page = await getPageBySecret(hashSecret(secret)).catch(() => null);
  const known = new URL(request.url).searchParams.get("skin") ?? "";
  return page ? stateResponse(page, Date.now(), known.slice(0, 100)) : notFoundResponse();
}
