import { NextResponse } from "next/server";
import { prisma } from "@/core/db";
import { getSiteConfig } from "@/core/settings";
import { canUse } from "./access";
import { authenticate, isMcpEnabled, rateLimited, type AuthedToken } from "./tokens";
import type { McpTool } from "./types";
import { McpToolError } from "./validate";

/**
 * SERVICE « MCP » — le mécanisme, sans aucune fonctionnalité.
 *
 * Serveur Model Context Protocol (JSON-RPC 2.0 sur HTTP, sans état), jetons hachés, portées
 * lecture/écriture, limitation de débit, audit des écritures, interrupteur général. Il reçoit une
 * fonction `listTools` : d'où viennent les outils (modules, éditeur de contenu…) n'est pas son affaire.
 *
 * Invariants garantis ici, quel que soit le fournisseur : un jeton ne voit et n'appelle que les outils
 * que son plafond (lecture/écriture) ET ses accès action par action autorisent (access.ts) ; une erreur interne n'est jamais renvoyée à l'agent (seules les erreurs
 * `McpToolError` ou marquées `expose: true` le sont) ; toute écriture est consignée dans l'audit.
 */
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 1_000_000;

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
/** Ce que ce jeton voit : plafond (lecture/écriture) ET accès accordé action par action. Recalculé à chaque requête. */
const visible = (tools: McpTool[], token: AuthedToken) => tools.filter((t) => canUse(t, token));

async function handle(rpc: RpcRequest, token: AuthedToken, listTools: () => Promise<McpTool[]>): Promise<unknown | null> {
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
    case "tools/list":
      return rpcResult(rpc.id, {
        tools: visible(await listTools(), token).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: { additionalProperties: false, ...t.input },
          annotations: { readOnlyHint: t.readOnly, destructiveHint: t.destructive, idempotentHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const tool = (await listTools()).find((t) => t.name === name);
      // Même réponse que l'outil existe ou non : un jeton ne découvre rien de ce qu'on ne lui a pas accordé.
      if (!tool || !canUse(tool, token)) return rpcError(rpc.id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await tool.call((rpc.params?.arguments as Record<string, unknown>) ?? {}, { name: token.name });
        if (!tool.readOnly) await prisma.auditLog.create({ data: { actor: `mcp:${token.name}`, action: `mcp.${tool.name}`, target: tool.source } }).catch(() => {});
        return rpcResult(rpc.id, { content: [{ type: "text", text: JSON.stringify(result ?? null, null, 2).slice(0, 200_000) }] });
      } catch (error) {
        const exposed = error instanceof McpToolError || (error as { expose?: boolean })?.expose === true;
        if (!exposed) console.error(`[mcp] ${name} failed:`, error);
        return rpcResult(rpc.id, { content: [{ type: "text", text: exposed ? (error as Error).message : "The action failed." }], isError: true });
      }
    }
    default:
      return rpc.id === undefined ? null : rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}

/** Traite une requête HTTP MCP. `listTools` est fourni par la composition (src/core/platform.ts). */
export async function handleMcpRequest(request: Request, listTools: () => Promise<McpTool[]>): Promise<Response> {
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
  const responses = (await Promise.all(((batch ? body : [body]) as unknown[]).slice(0, 20).map((r) => handle(r as RpcRequest, token, listTools)))).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return NextResponse.json(batch ? responses : responses[0], { headers: { "Cache-Control": "no-store" } });
}
