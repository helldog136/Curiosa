import { NextResponse } from "next/server";
import { currentUser, hasRole } from "@/core/permissions";
import { warmFiche } from "@/core/modules/previewServe";

export const dynamic = "force-dynamic";

/**
 * Réchauffe la fiche d'une extension (voir `warmFiche`) : appelée au survol du bouton « Voir le détail et installer », répond tout de suite (204).
 * Réservée à l'administration, comme la fiche. N'écrit rien et n'installe rien : elle lit seulement le dépôt, comme la fiche le ferait.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !hasRole(user, "admin")) return new NextResponse(null, { status: 404 });
  const q = new URL(request.url).searchParams;
  const id = q.get("id"), repo = q.get("repo");
  if (id && id.length <= 60) void warmFiche({ id });
  else if (repo && repo.length <= 300) void warmFiche({ repo });
  else return new NextResponse(null, { status: 400 });
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
