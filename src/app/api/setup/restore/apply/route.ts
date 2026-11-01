import { guardFresh } from "@/core/backup/guard";
import { applyHandler } from "@/core/backup/handlers";

export const dynamic = "force-dynamic";

// Restauration depuis l'assistant de première installation, étape 2 : seulement tant qu'aucun compte n'existe.
export function POST(request: Request) {
  return applyHandler(request, (r) => guardFresh(r), async () => "setup");
}
