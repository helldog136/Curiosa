import { NextResponse } from "next/server";
import { buildTools, type McpTool } from "@/core/mcp/tools";
import { authenticate, isMcpEnabled, rateLimited, type AuthedToken } from "@/core/mcp/tokens";
import { McpToolError } from "@/core/mcp/validate";
import { getSiteConfig } from "@/core/settings";
import { prisma } from "@/core/db";

export const dynamic = "force-dynamic";

/**
 * Serveur MCP (Model Context Protocol, transport « Streamable HTTP » sans état), généraliste :
 * il n'a aucun outil codé en dur. Les outils viennent de TOUS les modules actifs (manifeste
 * `mcp` + code `mcp`) et des actions éditoriales générées pour les instances à contenu — voir
 * src/core/mcp/tools.ts. Désactivable en un clic (admin → API & MCP) ; chaque appel exige un
 * jeton créé par le propriétaire (portée « lecture » ou « écriture »).
 *
 * Écrit à la main : le protocole utile tient en cinq méthodes JSON-RPC.
 */
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 1_000_000;

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });

function visible(tools: McpTool[], token: AuthedToken) {
  return token.scope === "write" ? tools : tools.filter((t) => t.readOnly);
}

async function handle(rpc: RpcRequest, token: AuthedToken): Promise<unknown | null> {
  const isNotification = rpc.id === undefined;
  switch (rpc.method) {
    case "initialize": {
      const asked = String(rpc.params?.protocolVersion ?? "");
      const config = await getSiteConfig();
      return rpcResult(rpc.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: config.name, version: "1.0.0" },
        instructions: "Tools come from the modules installed on this site. Nothing you create is ever published: drafts are reviewed by a human.",
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return rpcResult(rpc.id, {});
    case "tools/list": {
      const tools = visible(await buildTools(), token);
      return rpcResult(rpc.id, {
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: { additionalProperties: false, ...t.input },
          annotations: { readOnlyHint: t.readOnly, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        })),
      });
    }
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const tool = (await buildTools()).find((t) => t.name === name);
      if (!tool || (!tool.readOnly && token.scope !== "write")) {
        // Même réponse que l'outil existe ou non : un jeton « lecture » ne découvre rien d'autre.
        return rpcError(rpc.id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const result = await tool.call((rpc.params?.arguments as Record<string, unknown>) ?? {}, { name: token.name });
        if (!tool.readOnly) await prisma.auditLog.create({ data: { actor: `mcp:${token.name}`, action: `mcp.${tool.name}`, target: tool.source } }).catch(() => {});
        return rpcResult(rpc.id, { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2).slice(0, 200_000) }] });
      } catch (error) {
        // Un module signale une erreur destinée à l'agent avec `expose: true` ; toute autre erreur reste masquée.
        const visible = error instanceof McpToolError || (error as { expose?: boolean })?.expose === true;
        if (!visible) console.error(`[mcp] ${name} failed:`, error);
        const message = visible ? (error as Error).message : "The action failed.";
        return rpcResult(rpc.id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      return isNotification ? null : rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}

export async function POST(request: Request) {
  if (!(await isMcpEnabled())) return NextResponse.json(rpcError(null, -32000, "MCP is disabled on this site."), { status: 503 });

  const token = await authenticate(request.headers.get("authorization"));
  if (!token) return NextResponse.json(rpcError(null, -32001, "Missing or invalid token."), { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  if (rateLimited(token.id)) return NextResponse.json(rpcError(null, -32002, "Too many requests."), { status: 429 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json(rpcError(null, -32600, "Request too large."), { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error."), { status: 400 });
  }

  const batch = Array.isArray(body);
  const responses = (await Promise.all(((batch ? body : [body]) as unknown[]).slice(0, 20).map((r) => handle(r as RpcRequest, token)))).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return NextResponse.json(batch ? responses : responses[0], { headers: { "Cache-Control": "no-store" } });
}

// Pas de flux SSE côté serveur : un GET indique au client de n'utiliser que POST.
export function GET() {
  return new Response("Use POST (JSON-RPC 2.0).", { status: 405, headers: { Allow: "POST" } });
}
