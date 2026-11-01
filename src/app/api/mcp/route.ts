import { handleMcpRequest, methodNotAllowed } from "@/core/services/mcp/server";
import { listMcpTools } from "@/core/platform";

export const dynamic = "force-dynamic";

// Route mince : le mécanisme est dans src/core/services/mcp, les outils viennent de src/core/platform.ts.
// Jeton dans l'en-tête `Authorization: Bearer vit_…`. (Variante par adresse secrète : ./[token]/route.ts.)
export function POST(request: Request) {
  return handleMcpRequest(request, listMcpTools);
}

// Pas de flux SSE ni de session côté serveur : GET et DELETE reçoivent « 405, POST seulement » (permis par le transport Streamable HTTP).
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
