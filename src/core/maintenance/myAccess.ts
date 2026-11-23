import { makeTranslator } from "@/core/i18n/dictionary";
import { canUse, withinCeiling } from "@/core/services/mcp/access";
import { ownerCeilingAllows } from "@/core/services/mcp/ownerCeiling";
import { getTokenGrants } from "@/core/services/mcp/tokens";
import type { McpTool } from "@/core/services/mcp/types";
import { getSiteConfig } from "@/core/settings";
import { SETUP_TOOLS } from "@/core/services/mcp/profileTexts";
import { ALWAYS_HUMAN } from "./actions";
import { reconnectView } from "./reconnect";
import { getApprovalMode } from "./settings";
import { remainingSlots } from "./slots";
import { prisma } from "@/core/db";
import { mediaLimitsNow } from "@/core/services/mcp/uploadLift";
import { DAILY_BYTES as FILES_DAILY_BYTES, DAILY_FILES as FILES_DAILY } from "@/core/services/assistantUploads";

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
  const config = await getSiteConfig();
  // Every sentence returned here follows the site language (English and French in step), like the rights page.
  const t = makeTranslator(config.adminLocale ?? config.defaultLocale, config.defaultLocale);
  if (!token) return { error: t("aim.my.inactive") };
  const tools = await listMcpTools();

  const plain = (tool: McpTool): string => {
    const short = tool.name.includes("__") ? tool.name.split("__")[1]! : SETUP_TOOLS.includes(tool.name) ? tool.name : tool.name.replace(/^maintenance_/, "");
    const key = `aim.tool.${short}`;
    const text = t(key, { name: tool.source });
    if (text && text !== key && (tool.source === "maintenance" || SETUP_TOOLS.includes(tool.name) || (!!tool.instanceId && /^(publish|unpublish|update_published_meta)$/.test(short)))) return text;
    return tool.description.replace(/^\[[^\]]*\]\s*/, "").split(/(?<=[.!?])\s/)[0]!.slice(0, 200);
  };

  const granted: { tool: string; kind: string; summary: string }[] = [];
  const notGranted: { tool: string; kind: string; why: "access_is_read_only" | "box_not_ticked" | "above_owner_rights"; rightToTick: string }[] = [];
  for (const tool of tools) {
    if (canUse(tool, token)) granted.push({ tool: tool.name, kind: kindOf(tool), summary: plain(tool) });
    // A personal AI (0.46.0): a tool above its owner's rights is not a box to tick; it needs an administrator, and no tick would help.
    else if (token.personal && !ownerCeilingAllows(tool, token.personal, { coarse: token.coarse })) notGranted.push({ tool: tool.name, kind: kindOf(tool), why: "above_owner_rights", rightToTick: t("aim.my.aboveOwner") });
    else notGranted.push({ tool: tool.name, kind: kindOf(tool), why: withinCeiling(tool, token.scope) ? "box_not_ticked" : "access_is_read_only", rightToTick: plain(tool) });
  }
  // Module tools whose text is not in the site language (the module has no translation): shown in English, and said so, so that nobody blames the site.
  const wanted = (config.adminLocale ?? config.defaultLocale).split("-")[0]!;
  const inEnglish = tools.filter((x) => x.descriptionLang && x.descriptionLang.split("-")[0] !== wanted).map((x) => x.name);
  const approval = await getApprovalMode(actor.tokenId);
  const readOnly = token.scope === "read";
  const slots = await remainingSlots(actor.tokenId);
  const media = await mediaLimitsNow();
  // Top level, first thing the assistant reads: did the rights or the features change after its list was sent?
  const reconnect = await reconnectView(actor.tokenId, token, t, granted.map((g) => g.tool));
  return {
    ...reconnect,
    access: {
      name: actor.name, ceiling: token.scope, ceilingMeaning: t(readOnly ? "aim.my.ceiling.read" : "aim.my.ceiling.write"),
      // (0.47.0) Every access belongs to a person: the name of the owner (never an e-mail or a secret), or the plain fact that nobody owns this one yet.
      owner: token.ownerId ? { name: await ownerDisplayName(token.ownerId) } : { name: null, meaning: t("aim.my.noOwner") },
    },
    approvalSetting: {
      value: approval === "direct" ? "act_without_asking" : "ask_first",
      meaning: t(approval === "direct" ? "aim.my.approval.direct" : "aim.my.approval.ask"),
      alwaysAskedWhateverTheSetting: ALWAYS_HUMAN.map((a) => `maintenance_${a}`),
    },
    hourlyLimits: {
      meaning: t("aim.my.limits.meaning"),
      risky: { ...slots.risky, covers: t("aim.my.limits.risky") },
      content: { ...slots.content, covers: t("aim.my.limits.content") },
    },
    // (0.28.0) Read only: whether the owner lifted the upload limits, and until when. No tool can change it.
    imageUploads: {
      liftedUntil: media.until === null ? null : new Date(media.until).toISOString(),
      maxImageMB: media.imageBytes / 1024 / 1024,
      dailyQuotaApplies: media.daily,
      meaning: t(media.until === null ? "aim.my.uploads.normal" : "aim.my.uploads.lifted"),
    },
    // (0.28.2) The files a module tool receives (ctx.api.files.upload): the same lift and the same "start over"; the byte caps per kind are never raised.
    fileUploads: {
      liftedUntil: media.until === null ? null : new Date(media.until).toISOString(),
      dailyQuotaApplies: media.until === null,
      dailyQuota: { files: FILES_DAILY, mb: FILES_DAILY_BYTES / 1024 / 1024 },
      meaning: t(media.until === null ? "aim.my.files.normal" : "aim.my.files.lifted"),
    },
    granted,
    notGranted: notGranted.slice(0, 300),
    // (0.35.0) Present only when the owner gave this access full powers: every tool of the catalogue is granted, now and later, except what is kept out (accesses, secrets).
    ...(token.fullPowers ? { fullPowers: { on: true, meaning: t("aim.my.fullPowers"), keptOut: t("aim.my.fullPowers.out") } } : {}),
    ...(token.personal ? { personalAssistant: { meaning: t("aim.my.personal"), ownerRightsFingerprint: token.personal.fingerprint } } : {}),
    howToGetMore: notGranted.length ? t(token.personal ? "aim.my.howToGetMore.personal" : "aim.my.howToGetMore") : t("aim.my.nothingMissing"),
    ...(inEnglish.length ? { textsNotInYourLanguage: { count: inEnglish.length, tools: inEnglish.slice(0, 10), note: t("aim.my.lang.gap", { n: inEnglish.length, lang: wanted }) } } : {}),
    reconnect: t("aim.my.reconnect"),
    discover: t("aim.my.discover"),
  };
}

/** The display name of the owner of an access (name only; null when the person does not exist). */
async function ownerDisplayName(ownerId: string): Promise<string | null> {
  return (await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } }))?.name ?? null;
}
