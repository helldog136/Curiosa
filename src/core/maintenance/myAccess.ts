import { makeTranslator } from "@/core/i18n/dictionary";
import { canUse, withinCeiling } from "@/core/services/mcp/access";
import { getTokenGrants } from "@/core/services/mcp/tokens";
import type { McpTool } from "@/core/services/mcp/types";
import { getSiteConfig } from "@/core/settings";
import { ALWAYS_HUMAN } from "./actions";
import { getApprovalMode } from "./settings";

/**
 * `maintenance_my_access` (level 1, read): what THIS access can and cannot do, so that an assistant never assumes a tool does not exist.
 *
 *  - the tools granted, and the tools NOT granted with the right to tick in plain words (the same sentence as the rights page) and the reason (the access is read only,
 *    or the box is not ticked);
 *  - the ceiling of the access, the approval setting ("ask me first" / "act without asking"), and the requests that always wait for the owner;
 *  - the reconnection notice: the server is stateless, it recomputes the list of tools at every request but it cannot tell a connected client that the list changed
 *    (`listChanged` is false and there is no stream, see docs/MAINTENANCE-IA.md). A client keeps the list it received at connection time.
 * Names and sentences only: no setting value, no secret, nothing about other accesses.
 */
export const RECONNECT_NOTICE = "Tools the owner grants after you connected, and modules installed after you connected, only appear in your tool list after you reconnect (close and reopen the connection). The site cannot tell a connected assistant that its list changed. A tool that is granted but missing from your list can still be called by its name.";

const kindOf = (t: Pick<McpTool, "readOnly" | "destructive" | "request">): "read" | "request" | "destructive" | "write" => (t.readOnly ? "read" : t.destructive ? "destructive" : t.request ? "request" : "write");

export async function myAccess(actor: { name: string; tokenId?: string }): Promise<unknown> {
  // Loaded when called: platform.ts imports the tool definitions, which import this file.
  const { listMcpTools } = await import("@/core/platform");
  const token = actor.tokenId ? await getTokenGrants(actor.tokenId) : null;
  if (!token) return { error: "This access is not active any more." };
  const config = await getSiteConfig();
  const t = makeTranslator(config.adminLocale ?? config.defaultLocale);
  const tools = await listMcpTools();

  const plain = (tool: McpTool): string => {
    const short = tool.name.includes("__") ? tool.name.split("__")[1]! : tool.name.replace(/^maintenance_/, "");
    const key = `aim.tool.${short}`;
    const text = t(key, { name: tool.source });
    if (text && text !== key && (tool.source === "maintenance" || (!!tool.instanceId && /^(publish|unpublish)$/.test(short)))) return text;
    return tool.description.replace(/^\[[^\]]*\]\s*/, "").split(/(?<=[.!?])\s/)[0]!.slice(0, 200);
  };

  const granted: { tool: string; kind: string; summary: string }[] = [];
  const notGranted: { tool: string; kind: string; why: "access_is_read_only" | "box_not_ticked"; rightToTick: string }[] = [];
  for (const tool of tools) {
    if (canUse(tool, token)) granted.push({ tool: tool.name, kind: kindOf(tool), summary: plain(tool) });
    else notGranted.push({ tool: tool.name, kind: kindOf(tool), why: withinCeiling(tool, token.scope) ? "box_not_ticked" : "access_is_read_only", rightToTick: plain(tool) });
  }
  const approval = await getApprovalMode(actor.tokenId);
  const readOnly = token.scope === "read";
  return {
    access: { name: actor.name, ceiling: token.scope, ceilingMeaning: readOnly ? "Read only: no tool that writes can ever be granted to this access, whatever boxes are ticked. The owner must create or change the access to lift this." : "Read and write: a tool that writes works once its box is ticked." },
    approvalSetting: {
      value: approval === "direct" ? "act_without_asking" : "ask_first",
      meaning: approval === "direct"
        ? "Updates, uninstalls, font and colour changes, publishing and changes to the menu or the home page happen at once, without the owner's approval; the owner is told afterwards."
        : "Updates, uninstalls, font and colour changes, publishing and changes to the menu or the home page only create a request that the owner approves in Admin > AI assistants. Poll maintenance_request_status.",
      alwaysAskedWhateverTheSetting: ALWAYS_HUMAN.map((a) => `maintenance_${a}`),
    },
    granted,
    notGranted: notGranted.slice(0, 300),
    howToGetMore: notGranted.length ? `Tell the owner which right you need (rightToTick, in plain words). They tick it in Admin > AI assistants > this access, then you reconnect.` : "Nothing is missing: every tool of this site is granted to this access.",
    reconnect: RECONNECT_NOTICE,
  };
}
