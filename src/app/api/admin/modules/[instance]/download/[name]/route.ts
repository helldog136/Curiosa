import { downloadHandler } from "@/core/modules/adminTransferHandlers";
import { realTransferDeps } from "@/core/modules/adminTransferDeps";

export const dynamic = "force-dynamic";

/**
 * Téléchargement d'administration d'un module (`adminDownloads`). POST seulement (le formulaire du bloc `download` envoie l'en-tête Origin, qui est contrôlé) ;
 * jamais de GET : un lien ne peut pas déclencher un export de données personnelles. Voir adminTransferHandlers.ts pour les gardes.
 */
export async function POST(request: Request, ctx: { params: Promise<{ instance: string; name: string }> }) {
  return downloadHandler(request, await ctx.params, realTransferDeps);
}
