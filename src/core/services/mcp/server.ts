import { NextResponse } from "next/server";
import { prisma } from "@/core/db";
import { getSiteConfig } from "@/core/settings";
import { canUse } from "./access";
import { authenticate, authenticateByUrl, isMcpEnabled, rateLimited, type AuthedToken } from "./tokens";
import type { McpTool } from "./types";
import { McpToolError } from "./validate";

/**
 * SERVICE « MCP » — le mécanisme, sans aucune fonctionnalité.
 *
 * Serveur Model Context Protocol (transport « Streamable HTTP » réduit à sa forme la plus simple : JSON-RPC 2.0 en POST,
 * réponse JSON, sans session ni flux SSE), jetons hachés, portées
 * lecture/écriture, limitation de débit, audit des écritures, interrupteur général. Il reçoit une
 * fonction `listTools` : d'où viennent les outils (modules, éditeur de contenu…) n'est pas son affaire.
 *
 * Invariants garantis ici, quel que soit le fournisseur : un jeton ne voit et n'appelle que les outils
 * que son plafond (lecture/écriture) ET ses accès action par action autorisent (access.ts) ; une erreur interne n'est jamais renvoyée à l'agent (seules les erreurs
 * `McpToolError` ou marquées `expose: true` le sont) ; toute écriture est consignée dans l'audit.
 */
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 1_000_000;

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };

/** Réponses : jamais mises en cache, jamais de référent (l'adresse secrète ne doit pas fuir par un lien), type de contenu fixé. */
export const MCP_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...MCP_HEADERS, ...headers } });

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
/** Ce que ce jeton voit : plafond (lecture/écriture) ET accès accordé action par action. Recalculé à chaque requête. */
const visible = (tools: McpTool[], token: AuthedToken) => tools.filter((t) => canUse(t, token));

async function handle(rpc: RpcRequest, token: AuthedToken, listTools: () => Promise<McpTool[]>): Promise<unknown | null> {
  if (!rpc || typeof rpc !== "object" || Array.isArray(rpc) || rpc.jsonrpc !== "2.0") return rpcError(null, -32600, "Invalid Request.");
  // Une réponse du client à une requête du serveur (nous n'en envoyons jamais) : acceptée, sans réponse.
  if (rpc.method === undefined && ("result" in rpc || "error" in rpc)) return null;
  if (typeof rpc.method !== "string") return rpcError(rpc.id ?? null, -32600, "Invalid Request.");
  // Une notification n'a pas d'« id » : elle n'appelle jamais de réponse (et n'exécute rien).
  if (rpc.id === undefined) return null;
  switch (rpc.method) {
    case "initialize": {
      const asked = String(rpc.params?.protocolVersion ?? "");
      const config = await getSiteConfig();
      return rpcResult(rpc.id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: config.name, title: config.name, version: "1.0.0" },
        instructions: "Tools come from the modules installed on this site. Nothing you create is ever published: drafts are reviewed by a human.",
      });
    }
    case "ping":
      return rpcResult(rpc.id, {});
    case "tools/list":
      return rpcResult(rpc.id, {
        tools: visible(await listTools(), token).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: { properties: {}, additionalProperties: false, ...t.input, type: "object" },
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
      return rpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}

async function safeHandle(rpc: RpcRequest, token: AuthedToken, listTools: () => Promise<McpTool[]>): Promise<unknown | null> {
  try {
    return await handle(rpc, token, listTools);
  } catch (error) {
    console.error("[mcp] internal error:", error);
    return rpcError(rpc?.id ?? null, -32603, "Internal error.");
  }
}

/** Un navigateur (GET) ou un client qui cherche un flux ou une session : le serveur n'en propose pas (permis par le transport). */
export function methodNotAllowed(): Response {
  return new Response("Use POST (JSON-RPC 2.0).", { status: 405, headers: { ...MCP_HEADERS, Allow: "POST", "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Traite une requête HTTP MCP. `listTools` est fourni par la composition (src/core/platform.ts).
 * `viaUrl` : l'adresse secrète `/api/mcp/<jeton>` ; sinon le jeton vient de l'en-tête `Authorization: Bearer`.
 * Le jeton n'est ni journalisé ni renvoyé : en cas d'échec par adresse, la réponse est la même pour tout.
 */
export async function handleMcpRequest(request: Request, listTools: () => Promise<McpTool[]>, viaUrl?: { token: string }): Promise<Response> {
  if (!(await isMcpEnabled())) return json(rpcError(null, -32000, "MCP is disabled on this site."), 503);
  if (viaUrl) {
    const token = await authenticateByUrl(viaUrl.token);
    if (!token) return json(rpcError(null, -32001, "Not found."), 404);
    return run(request, token, listTools);
  }
  const token = await authenticate(request.headers.get("authorization"));
  if (!token) return json(rpcError(null, -32001, "Missing or invalid token."), 401, { "WWW-Authenticate": "Bearer" });
  return run(request, token, listTools);
}

async function run(request: Request, token: AuthedToken, listTools: () => Promise<McpTool[]>): Promise<Response> {
  if (rateLimited(token.id)) return json(rpcError(null, -32002, "Too many requests."), 429);

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(rpcError(null, -32600, "Request too large."), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "Parse error."), 400);
  }
  const batch = Array.isArray(body);
  if (batch && (body as unknown[]).length === 0) return json(rpcError(null, -32600, "Invalid Request."), 400);
  const responses = (await Promise.all(((batch ? body : [body]) as RpcRequest[]).slice(0, 20).map((r) => safeHandle(r, token, listTools)))).filter((r) => r !== null);
  // Que des notifications ou des réponses de client : « accepté », sans corps.
  if (responses.length === 0) return new Response(null, { status: 202, headers: MCP_HEADERS });
  return json(batch ? responses : responses[0]);
}
