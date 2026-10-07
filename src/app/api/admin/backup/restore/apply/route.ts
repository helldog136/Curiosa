import { guardOwner } from "@/core/backup/guard";
import { applyHandler } from "@/core/backup/handlers";
import { currentUser } from "@/core/permissions";

export const dynamic = "force-dynamic";

// Restauration, étape 2 (propriétaire connecté).
export function POST(request: Request) {
  return applyHandler(request, guardOwner, async () => (await currentUser())?.email ?? "owner");
}
