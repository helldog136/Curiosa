import { guardFresh } from "@/core/backup/guard";
import { previewHandler } from "@/core/backup/handlers";

export const dynamic = "force-dynamic";

// Restauration depuis l'assistant de première installation, étape 1 : seulement tant qu'aucun compte n'existe.
export function POST(request: Request) {
  return previewHandler(request, (r) => guardFresh(r));
}
