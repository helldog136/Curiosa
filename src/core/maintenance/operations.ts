import { makeTranslator, type Translator } from "@/core/i18n/dictionary";
import { canUse, withinCeiling } from "@/core/services/mcp/access";
import { COARSE_FALLBACK, ownerCeilingAllows, requirementOf, type ToolRequirement } from "@/core/services/mcp/ownerCeiling";
import { getTokenGrants } from "@/core/services/mcp/tokens";
import { SETUP_TOOLS } from "@/core/services/mcp/profileTexts";
import type { McpTool } from "@/core/services/mcp/types";
import { validateArgs } from "@/core/services/mcp/validate";
import { moduleNames } from "@/core/modules/updateStatus";
import { getActiveInstances } from "@/core/modules/registry";
import { getPersonalPolicy } from "@/core/personalAi/policy";
import { getSiteConfig } from "@/core/settings";
import { ALWAYS_HUMAN } from "./actions";
import { getApprovalMode } from "./settings";

/**
 * `maintenance_available_operations` (level 1, read): EVERY operation this site could offer to this access, the ones its rights do not allow included, so that an assistant can say
 * "if you grant me this right, I could do it myself". Always listed (access.ts `ALWAYS_LISTED`), never asks for approval, writes nothing.
 *
 * It is a sibling of `maintenance_my_access`, not an extension: that one describes the ACCESS (ceiling, approval, limits, uploads, reconnection) and keeps its shape; this one is the catalogue
 * of OPERATIONS, grouped by module, filterable and bounded (the first one cannot be bounded without hiding rights). Both read the same rules (`canUse`, `ownerCeilingAllows`).
 * The list is the live one (`listMcpTools`): installed and enabled modules and instances only. Names, one-line texts and flags only: no schema, no setting value, no secret, nothing about other accesses.
 */
export const OPERATION_STATUSES = ["allowed", "needs_approval", "not_granted", "above_owner_ceiling"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type OperationKind = "read" | "draft" | "write" | "publish" | "request" | "delete";

export const DESCRIPTION_MAX = 120;
export const LIMIT_DEFAULT = 150;
export const LIMIT_MAX = 300;

export const OPERATIONS_INPUT = {
  type: "object",
  properties: {
    module: { type: "string", maxLength: 64, description: "Only one module: its identifier (blog) or the key of one of its instances (blog-news); core for the tools of the site itself." },
    status: { type: "string", maxLength: 24, enum: [...OPERATION_STATUSES], description: "Only the operations in this state for your access." },
    limit: { type: "integer", minimum: 1, maximum: LIMIT_MAX, description: `At most this many operations (default ${LIMIT_DEFAULT}).` },
    offset: { type: "integer", minimum: 0, maximum: 5000, description: "Skip this many operations (the answer says the next offset when it is cut)." },
  },
} as const;

/** The first sentence of a text, without the leading `[label]`, cut to `max` characters. */
export function oneLine(text: string, max = DESCRIPTION_MAX): string {
  const s = text.replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").split(/(?<=[.!?])\s/)[0]!.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** The plain sentence of a tool: the one of the rights page when the core has it, otherwise the first sentence of its description. */
export function plainTool(tool: McpTool, t: Translator): string {
  const short = tool.name.includes("__") ? tool.name.split("__")[1]! : SETUP_TOOLS.includes(tool.name) ? tool.name : tool.name.replace(/^maintenance_/, "");
  const key = `aim.tool.${short}`;
  const text = t(key, { name: tool.source });
  if (text && text !== key && (tool.source === "maintenance" || SETUP_TOOLS.includes(tool.name) || (!!tool.instanceId && /^(publish|unpublish|update_published_meta)$/.test(short)))) return text;
  return tool.description.replace(/^\[[^\]]*\]\s*/, "").split(/(?<=[.!?])\s/)[0]!.slice(0, 200);
}

export function operationKind(tool: Pick<McpTool, "name" | "readOnly" | "destructive" | "request" | "instanceId">): OperationKind {
  if (tool.readOnly) return "read";
  if (tool.destructive) return "delete";
  if (/__(publish|unpublish|update_published_meta)$/.test(tool.name)) return "publish";
  if (tool.request) return "request";
  if (/__(create_draft|update_draft)$/.test(tool.name)) return "draft";
  return "write";
}

/** What the tool needs, in a few words: `admin`, `editor`, `owner`, a right (`core:updates`), `none`; `assumed` when the module declared nothing (the coarse fallback of ownerCeiling.ts). */
export function needsOf(tool: McpTool): { needs: string; assumed: boolean } {
  const declared = requirementOf(tool);
  const req: ToolRequirement = declared ?? COARSE_FALLBACK;
  const text = req.none && !req.right && !req.tier ? "none" : [req.tier, req.right].filter(Boolean).join(" + ") || "nobody";
  return { needs: text, assumed: declared === undefined };
}

/** "ask_first" unless the owner chose "act without asking" for this access AND the site policy lets a personal access do so (the same rule as callLevel3). */
export async function approvalOf(token: { personal?: unknown; coarse?: boolean }, tokenId: string | undefined): Promise<"human" | "direct"> {
  return token.personal && !token.coarse && !(await getPersonalPolicy()).allowDirect ? "human" : await getApprovalMode(tokenId);
}

type Operation = { tool: string; kind: OperationKind; status: OperationStatus; needs: string; needsAssumed?: true; why?: string; what: string };
type Group = { module: string; name: string; operations: Operation[]; howToGrant?: string };

export async function availableOperations(actor: { name: string; tokenId?: string }, rawArgs: Record<string, unknown> = {}): Promise<unknown> {
  const args = validateArgs(OPERATIONS_INPUT as never, rawArgs);
  const moduleFilter = typeof args.module === "string" ? args.module : undefined;
  const statusFilter = typeof args.status === "string" ? (args.status as OperationStatus) : undefined;
  const limit = typeof args.limit === "number" ? args.limit : LIMIT_DEFAULT;
  const offset = typeof args.offset === "number" ? args.offset : 0;

  // Loaded when called: platform.ts imports the tool definitions, which import this file.
  const { listMcpTools } = await import("@/core/platform");
  const token = actor.tokenId ? await getTokenGrants(actor.tokenId) : null;
  const config = await getSiteConfig();
  const locale = config.adminLocale ?? config.defaultLocale;
  const t = makeTranslator(locale, config.defaultLocale);
  if (!token) return { error: t("aim.my.inactive") };

  const tools = await listMcpTools();
  const names = await moduleNames(locale, config.defaultLocale).catch(() => new Map<string, string>());
  const approval = await approvalOf(token, actor.tokenId);
  // The content tools of an instance do not carry their module: it is read from the live instances (the same ones that built the list).
  const moduleOfInstance = new Map((await getActiveInstances()).map(({ instance, mod }) => [instance.id, mod.manifest.id]));

  const statusOf = (tool: McpTool): { status: OperationStatus; why?: string } => {
    if (canUse(tool, token)) {
      // A request (level 3, publishing) waits for the owner unless the access acts without asking; installing code or adding an instance always waits.
      const asks = tool.request === true && (approval === "human" || ALWAYS_HUMAN.some((a) => tool.name === `maintenance_${a}`));
      return { status: asks ? "needs_approval" : "allowed" };
    }
    if (token.personal && !ownerCeilingAllows(tool, token.personal, { coarse: token.coarse })) return { status: "above_owner_ceiling", ...(requirementOf(tool) === undefined && !token.coarse ? { why: "module_declares_no_right" } : {}) };
    return { status: "not_granted", why: withinCeiling(tool, token.scope) ? "box_not_ticked" : "access_is_read_only" };
  };

  const counts: Record<OperationStatus, number> = { allowed: 0, needs_approval: 0, not_granted: 0, above_owner_ceiling: 0 };
  const groups = new Map<string, Group>();
  const matches: { group: string; op: Operation }[] = [];
  for (const tool of tools) {
    const modId = tool.moduleId ?? (tool.instanceId ? moduleOfInstance.get(tool.instanceId) : undefined) ?? "core";
    if (moduleFilter && moduleFilter !== modId && moduleFilter !== tool.source) continue;
    const { status, why } = statusOf(tool);
    counts[status]++;
    if (statusFilter && statusFilter !== status) continue;
    const { needs, assumed } = needsOf(tool);
    if (!groups.has(modId)) groups.set(modId, { module: modId, name: modId === "core" ? t("aim.ops.core") : names.get(modId) ?? modId, operations: [] });
    matches.push({ group: modId, op: { tool: tool.name, kind: operationKind(tool), status, needs, ...(assumed ? { needsAssumed: true as const } : {}), ...(why ? { why } : {}), what: oneLine(plainTool(tool, t)) } });
  }
  const page = matches.slice(offset, offset + limit);
  for (const { group, op } of page) groups.get(group)!.operations.push(op);
  const shown = [...groups.values()].filter((g) => g.operations.length > 0).sort((a, b) => (a.module === "core" ? -1 : b.module === "core" ? 1 : a.name.localeCompare(b.name)));
  // One sentence per group that has something the owner could change, or nothing they can: the assistant repeats it as is.
  for (const g of shown) {
    const present = new Set(g.operations.map((o) => o.status));
    const parts: string[] = [];
    if (present.has("not_granted")) parts.push(t(token.personal ? "aim.ops.how.personal" : "aim.ops.how.box"));
    if (g.operations.some((o) => o.why === "access_is_read_only")) parts.push(t("aim.ops.how.readOnly"));
    if (present.has("needs_approval")) parts.push(t("aim.ops.how.approval"));
    if (present.has("above_owner_ceiling")) parts.push(t("aim.ops.how.ceiling"));
    if (parts.length) g.howToGrant = parts.join(" ");
  }
  const next = offset + page.length < matches.length ? offset + page.length : undefined;
  return {
    meaning: t("aim.ops.meaning"),
    access: { name: actor.name, ceiling: token.scope, approvalSetting: approval === "direct" ? "act_without_asking" : "ask_first", ...(token.personal ? { personal: true } : {}) },
    counts: { total: counts.allowed + counts.needs_approval + counts.not_granted + counts.above_owner_ceiling, ...counts },
    ...(moduleFilter || statusFilter || offset ? { filter: { ...(moduleFilter ? { module: moduleFilter } : {}), ...(statusFilter ? { status: statusFilter } : {}), ...(offset ? { offset } : {}) } } : {}),
    ...(moduleFilter && matches.length === 0 && counts.allowed + counts.needs_approval + counts.not_granted + counts.above_owner_ceiling === 0 ? { note: t("aim.ops.noModule", { module: moduleFilter }) } : {}),
    modules: shown,
    ...(next !== undefined ? { truncated: { shown: page.length, matching: matches.length, nextOffset: next, note: t("aim.ops.truncated") } } : {}),
    reconnect: t("aim.my.reconnect"),
  };
}
