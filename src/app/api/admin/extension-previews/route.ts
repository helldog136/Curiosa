import { NextResponse } from "next/server";
import { currentUser, hasRole } from "@/core/permissions";
import { servePreview } from "@/core/modules/previewServe";

export const dynamic = "force-dynamic";

/**
 * Visuel d'une fiche d'extension (voir core/modules/previewServe.ts) : l'image est lue et vérifiée côté serveur, puis servie depuis le site lui-même.
 * Réservée à l'administration (comme la fiche) ; jamais servie au public. Le type annoncé est celui des octets, pas celui du nom du fichier.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user || !hasRole(user, "admin")) return new NextResponse(null, { status: 404 });
  const reply = await servePreview(new URL(request.url).searchParams);
  if (reply.status !== 200) return new NextResponse(null, { status: reply.status });
  return new NextResponse(new Uint8Array(reply.bytes), {
    headers: {
      "Content-Type": reply.mime,
      "Content-Length": String(reply.bytes.length),
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
