import { guardOwner } from "@/core/backup/guard";
import { previewHandler } from "@/core/backup/handlers";

export const dynamic = "force-dynamic";

// Restauration, étape 1 (propriétaire connecté). La logique est dans core/backup/handlers.ts.
export function POST(request: Request) {
  return previewHandler(request, guardOwner);
}
