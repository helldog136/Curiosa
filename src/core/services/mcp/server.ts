import { NextResponse } from "next/server";
import { prisma } from "@/core/db";
import { getSiteConfig } from "@/core/settings";
import { canUse, dangerousUnderFullPowers } from "./access";
import { recordListSeen, revisionNow } from "./listSeen";
import { authenticate, authenticateByUrl, isMcpEnabled, rateLimited, type AuthedToken } from "./tokens";
import type { McpTool } from "./types";

/** The source of the tools. `hint.name`: the tool being called, so that a source can avoid computing tools that cannot be it (see platform.ts). */
/** The icons announced at `initialize` (`serverInfo.icons`, MCP 2025-11-25), given by the composition: the mechanism knows nothing of logos or of the public address. */
export type ServerIcons = (request: Request) => Promise<unknown[]>;
export type ListTools = (hint?: { name?: string }) => Promise<McpTool[]>;
import { McpToolError } from "./validate";
import { LIFTED_MEDIA_BODY, liftedUntil, MEDIA_BODY } from "./uploadLift";
import { toolContent } from "./image";

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
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 1_000_000;
/** Only one call may be bigger: `media_upload` (an image of 3 MB sent as base64; 10 MB, so 14 MB of body, while the owner lifted the upload limits). Everything else stays at 1 MB. */
const MAX_BODY_MEDIA = MEDIA_BODY;
const TOO_LARGE_MEDIA = "Request too large. One image sent with media_upload is 3 MB at most; the owner can lift this to 10 MB for a few minutes in Admin > AI assistants > Settings.";

type RpcRequest = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };

/** Réponses : jamais mises en cache, jamais de référent (l'adresse secrète ne doit pas fuir par un lien), type de contenu fixé. */
export const MCP_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...MCP_HEADERS, ...headers } });

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
/** Ce que ce jeton voit : plafond (lecture/écriture) ET accès accordé action par action. Recalculé à chaque requête. */
const visible = (tools: McpTool[], token: AuthedToken) => tools.filter((t) => canUse(t, token));

async function handle(rpc: RpcRequest, token: AuthedToken, listTools: ListTools, icons: unknown[]): Promise<unknown | null> {
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
        // `icons` (MCP 2025-11-25): ABSOLUTE https addresses on the exact public host of THIS site (clients accept only the server's own origin, without redirect).
        serverInfo: { name: config.name, title: config.name, version: "1.0.0", ...(icons.length > 0 ? { icons } : {}) },
        instructions: "Tools come from the modules installed on this site. What you create stays a draft: publishing is a separate right that the owner may grant, and it follows the owner's approval setting. The menu and the home page have their own tools (navigation_get / navigation_set, home_sections_list / home_sections_set): read, change the whole list, send it back; they follow the same approval setting. If a tool you expect is missing, the owner may not have granted it yet: call maintenance_available_operations for every operation this site could offer you, with its state for your access and how the owner can grant it (maintenance_my_access describes the access itself), and reconnect after a change. To set up the identity of the site: upload images with media_upload (base64, alternative text required, 3 MB; the owner can lift this to 10 MB for a few minutes), then use site_settings_get and site_settings_set (name, tagline, presentation per language, contact e-mail, logos); changing settings follows the owner's approval setting.",
      });
    }
    case "ping":
      return rpcResult(rpc.id, {});
    case "tools/list": {
      const shown = visible(await listTools(), token);
      // What this client is shown now: the baseline of "has my list changed since?" (maintenance_my_access, maintenance_status).
      await revisionNow(token).then((rev) => recordListSeen(token.id, rev, shown.map((t) => t.name))).catch(() => {});
      return rpcResult(rpc.id, {
        tools: shown.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: { properties: {}, additionalProperties: false, ...t.input, type: "object" },
          annotations: { readOnlyHint: t.readOnly, destructiveHint: t.destructive, idempotentHint: false, openWorldHint: false },
        })),
      });
    }
    case "tools/call": {
      const name = String(rpc.params?.name ?? "");
      const tool = (await listTools({ name })).find((t) => t.name === name);
      // Même réponse que l'outil existe ou non : un jeton ne découvre rien de ce qu'on ne lui a pas accordé.
      if (!tool || !canUse(tool, token)) return rpcError(rpc.id, -32602, `Unknown tool: ${name}`);
      // Under full powers, each dangerous action leaves its own journal line, written BEFORE it runs (a crash still leaves the trace). It says "under full powers"
      // whether or not the box of that action was also ticked: the owner sees what the switch was used for.
      if (token.fullPowers && dangerousUnderFullPowers(tool)) await prisma.auditLog.create({ data: { actor: `mcp:${token.name}`, actorKind: "assistant", action: "mcp.fullpowers.action", target: tool.name, module: tool.moduleId ?? "", instance: tool.moduleId ? tool.source : "" } }).catch(() => {});
      try {
        const result = await tool.call((rpc.params?.arguments as Record<string, unknown>) ?? {}, { name: token.name, tokenId: token.id, ...(token.ownerId ? { ownerId: token.ownerId } : {}) });
        if (!tool.readOnly && !tool.audited) await prisma.auditLog.create({ data: { actor: `mcp:${token.name}`, actorKind: "assistant", action: `mcp.${tool.name}`, target: tool.source, module: tool.moduleId ?? "", instance: tool.moduleId ? tool.source : "" } }).catch(() => {});
        // (0.25.0) a tool may answer with a picture (mcpImage): an `image` content item, then its text
        return rpcResult(rpc.id, { content: toolContent(result) });
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

async function safeHandle(rpc: RpcRequest, token: AuthedToken, listTools: ListTools, icons: unknown[]): Promise<unknown | null> {
  try {
    return await handle(rpc, token, listTools, icons);
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
export async function handleMcpRequest(request: Request, listTools: ListTools, viaUrl?: { token: string }, serverIcons?: ServerIcons): Promise<Response> {
  if (!(await isMcpEnabled())) return json(rpcError(null, -32000, "MCP is disabled on this site."), 503);
  if (viaUrl) {
    const token = await authenticateByUrl(viaUrl.token);
    if (!token) return json(rpcError(null, -32001, "Not found."), 404);
    return run(request, token, listTools, serverIcons);
  }
  const token = await authenticate(request.headers.get("authorization"));
  if (!token) return json(rpcError(null, -32001, "Missing or invalid token."), 401, { "WWW-Authenticate": "Bearer" });
  return run(request, token, listTools, serverIcons);
}

/** Last inert reason written to the journal per personal access: one line per TRANSITION (not per call), in memory. */
const inertSeen = ((globalThis as unknown as { curiosaInertSeen?: Map<string, string> }).curiosaInertSeen ??= new Map<string, string>());

/** An access that cannot answer: say why to its owner, without revealing anything about anyone else. A missing owner looks like an unknown access. */
function inertAnswer(token: AuthedToken): Response | null {
  const personal = token.personal;
  if (!personal) return null;
  if (personal.active) { inertSeen.delete(token.id); return null; }
  const why = personal.inert;
  if (why && inertSeen.get(token.id) !== why) {
    inertSeen.set(token.id, why);
    void prisma.auditLog.create({ data: { actor: `mcp:${token.name}`, actorKind: "assistant", action: "mcp.personal.inert", target: why } }).catch(() => {});
  }
  if (why === "owner_missing" || why === "unavailable" || why === undefined) return json(rpcError(null, -32001, "Missing or invalid token."), 401, { "WWW-Authenticate": "Bearer" });
  const message = why === "paused" ? "This access is paused. Its owner can resume it from the account page."
    : why === "owner_locked" ? "This access waits until its owner has finished securing the account."
    : "This access is switched off: its owner may no longer have an AI access.";
  return json(rpcError(null, -32003, message), 403);
}

async function run(request: Request, token: AuthedToken, listTools: ListTools, serverIcons?: ServerIcons): Promise<Response> {
  const inert = inertAnswer(token);
  if (inert) return inert;
  if (rateLimited(token.id)) return json(rpcError(null, -32002, "Too many requests."), 429);

  const icons = await serverIcons?.(request).catch(() => []) ?? [];
  const raw = await request.text();
  // Above the usual media cap, the lift is read (from the database, every time): only then can a body reach 14 MB. It is never unbounded.
  if (raw.length > MAX_BODY_MEDIA && (raw.length > LIFTED_MEDIA_BODY || (await liftedUntil()) === null)) return json(rpcError(null, -32600, raw.length > LIFTED_MEDIA_BODY ? "Request too large." : TOO_LARGE_MEDIA), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(rpcError(null, -32700, "Parse error."), raw.length > MAX_BODY ? 413 : 400);
  }
  // Above 1 MB only a single media_upload call is accepted (not in a batch).
  if (raw.length > MAX_BODY && !(!Array.isArray(body) && (body as RpcRequest)?.method === "tools/call" && (body as RpcRequest).params?.name === "media_upload")) return json(rpcError(null, -32600, "Request too large."), 413);
  const batch = Array.isArray(body);
  if (batch && (body as unknown[]).length === 0) return json(rpcError(null, -32600, "Invalid Request."), 400);
  const responses = (await Promise.all(((batch ? body : [body]) as RpcRequest[]).slice(0, 20).map((r) => safeHandle(r, token, listTools, icons)))).filter((r) => r !== null);
  // Que des notifications ou des réponses de client : « accepté », sans corps.
  if (responses.length === 0) return new Response(null, { status: 202, headers: MCP_HEADERS });
  return json(batch ? responses : responses[0]);
}
