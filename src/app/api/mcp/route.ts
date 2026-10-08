import { handleMcpRequest } from "@/core/services/mcp/server";
import { listMcpTools } from "@/core/platform";

export const dynamic = "force-dynamic";

// Route mince : le mécanisme est dans src/core/services/mcp, les outils viennent de src/core/platform.ts.
export function POST(request: Request) {
  return handleMcpRequest(request, listMcpTools);
}

// Pas de flux SSE côté serveur : un GET indique au client de n'utiliser que POST.
export function GET() {
  return new Response("Use POST (JSON-RPC 2.0).", { status: 405, headers: { Allow: "POST" } });
}
