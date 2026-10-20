import { actionHandler } from "@/core/modules/adminTransferHandlers";
import { realTransferDeps } from "@/core/modules/adminTransferDeps";

export const dynamic = "force-dynamic";

/**
 * Action d'administration d'un module qui reçoit un FICHIER (champ `kind: "file"`). Les actions serveur de Next sont plafonnées à 1 Mo et on ne relève pas cette limite
 * pour tout le site : les envois de fichier passent par cette route, qui lit au plus 5 Mo par fichier. Mêmes gardes que les `adminActions`.
 */
export async function POST(request: Request, ctx: { params: Promise<{ instance: string; action: string }> }) {
  return actionHandler(request, await ctx.params, realTransferDeps);
}
