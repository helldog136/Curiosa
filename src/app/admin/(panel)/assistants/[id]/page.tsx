import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { listInstances } from "@/core/instances";
import { getInstanceLabeler } from "@/core/modules/labels";
import { listMcpToolCatalogue } from "@/core/platform";
import { getActiveInstances } from "@/core/modules/registry";
import { siteUrl } from "@/core/config";
import { canUse, isGranted, MAINTENANCE_PROFILE, parseGrants, withinCeiling } from "@/core/services/mcp/access";
import { abilities } from "@/core/services/mcp/accessView";
import { assistantHistoryHref } from "@/core/services/mcp/teamView";
import { TEAM_HREF } from "@/core/services/mcp/assistantsLinks";
import { getApprovalMode } from "@/core/maintenance/settings";
import { MAINTENANCE_TOOLS } from "@/core/maintenance/tools";
import { isUrlAccessEnabled } from "@/core/services/mcp/tokens";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { ApprovalChoice } from "@/components/admin/ApprovalChoice";
import { GrantsEditor } from "@/components/admin/GrantsEditor";
import type { GrantSection, GrantTool } from "@/components/admin/grantsModel";
import { approvalLabels, grantsLabels } from "./grantsLabels";
import { placementOf } from "@/core/services/mcp/profiles";
import { Callout, DangerZone } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { applyGrantsAction, resetGrantsAction, revokeTokenAction, setUrlAccessAction } from "../actions";
import { setApprovalAction } from "../requestsActions";
import { PendingButton } from "@/components/admin/PendingButton";

export const dynamic = "force-dynamic";

/** Un accès : ce qu'il peut faire, comment les actions à risque sont validées, et (en mode avancé) chaque action de chaque module. Modifiable en direct. */
export default async function AccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale, config, advanced } = await adminCtx({ right: "core:mcp.tokens" });
  const { id } = await params;
  const row = await prisma.apiToken.findUnique({ where: { id } });
  if (!row) notFound();
  const token = { scope: row.scope === "write" ? ("write" as const) : ("read" as const), grants: parseGrants(row.grants) };
  const revoked = !!row.revokedAt;
  const urlOn = !revoked && (await isUrlAccessEnabled(id));
  const approval = await getApprovalMode(id);
  const levelOf = new Map(MAINTENANCE_TOOLS.map((m) => [m.name, m.level]));

  const catalogue = await listMcpToolCatalogue();
  const active = await getActiveInstances();
  const instances = await listInstances();
  const labeler = await getInstanceLabeler(locale, config.defaultLocale);

  // Regroupement par source : la plateforme, puis chaque instance de module. En mode simple, seul l'entretien du site se règle ici (le détail, module par module, est réservé au mode avancé).
  const groups = new Map<string, typeof catalogue>();
  for (const tool of catalogue) groups.set(tool.source, [...(groups.get(tool.source) ?? []), tool]);
  const usable = catalogue.filter((x) => !x.instanceOptedOut && canUse(x, token));
  const can = abilities(usable.map((x) => ({ readOnly: x.readOnly, destructive: x.destructive, source: x.source })));
  // Publishing is a right of its own, per content list: in simple mode it gets a section in plain words (in advanced mode each list shows its own tools).
  const publishing = catalogue.filter((x) => !x.instanceOptedOut && !!x.instanceId && /__(publish|unpublish)$/.test(x.name));
  const shown: [string, typeof catalogue][] = [...groups.entries()].filter(([source]) => advanced || source === "maintenance");
  if (!advanced && publishing.length) shown.push(["publishing", publishing]);
  const labelOfSource = (source: string) => { const i = instances.find((x) => x.key === source); return i ? labeler.label(i) : source; };

  // The rights page works on sections: the maintenance tools by level (the third one is "Risky actions", with its approval choice), then, in advanced mode, one per module.
  const sections: GrantSection[] = [];
  for (const [source, tools] of shown) {
    const inst = instances.find((i) => i.key === source);
    const mod = active.find((a) => a.instance.key === source)?.mod;
    const isMaintenance = source === "maintenance";
    const isPublishing = source === "publishing";
    const title = isPublishing ? `📣 ${t("aim.publish.group")}` : isMaintenance ? `🛠️ ${t("aim.group")}` : source === "core" ? t("mcp.platform") : `${mod?.manifest.icon ?? "🧩"} ${inst ? labeler.label(inst) : source}`;
    const toGrantTool = (tool: (typeof tools)[number]): GrantTool => {
      const ceilingBlocks = !withinCeiling(tool, token.scope);
      const short = tool.name.includes("__") ? tool.name.split("__")[1]! : tool.name;
      const plain = isMaintenance ? t(`aim.tool.${short.replace(/^maintenance_/, "")}`) : isPublishing ? t(`aim.tool.${short}`, { name: labelOfSource(tool.source) }) : "";
      const placement = placementOf(tool);
      return {
        name: tool.name, label: advanced ? `${title} — ${short}` : plain || short, code: advanced ? short : undefined,
        help: isMaintenance || isPublishing ? plain : advanced ? tool.description : undefined,
        kind: tool.destructive ? "destructive" : tool.readOnly ? "read" : "write",
        kindLabel: tool.destructive ? t("mcp.destructive") : tool.readOnly ? t("mcp.action.read") : t("mcp.action.write"),
        initial: !ceilingBlocks && isGranted(tool, token.grants), blocked: ceilingBlocks, locked: revoked || tool.instanceOptedOut,
        confirm: tool.destructive ? t(advanced ? "mcp.confirmDestructive" : "assistants.confirmDestructive", { action: advanced ? short : t(`aim.action.${short.replace(/^maintenance_/, "")}`) }) : undefined,
        rank: placement === "read" || placement === "assistant" || placement === "full" ? placement : null,
      };
    };
    const reset = source !== "core" && !isPublishing && !revoked ? (
      <div className="flex flex-wrap gap-2">
        <form action={resetGrantsAction.bind(null, id, source, "defaults")}><PendingButton>{t("mcp.resetDefaults")}</PendingButton></form>
        <form action={resetGrantsAction.bind(null, id, source, "none")}><PendingButton>{t("mcp.disableAll")}</PendingButton></form>
      </div>
    ) : null;
    const optedOut = tools[0]?.instanceOptedOut ? <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-sm">{t("mcp.instanceOptedOut")}</p> : null;
    if (!isMaintenance) {
      sections.push({ id: source, group: "", title, ...(isPublishing ? { help: t("aim.publish.help") } : {}), tools: tools.map(toGrantTool), header: <>{reset}{optedOut}</> });
      continue;
    }
    for (const level of [1, 2, 3] as const) {
      const here = tools.filter((x) => levelOf.get(x.name) === level);
      if (!here.length) continue;
      sections.push({
        id: `maintenance-${level}`, group: title, title: t(`aim.level.${level}`), help: t(`aim.level.${level}.help`), risky: level === 3, tools: here.map(toGrantTool),
        header: level === 3 ? (
          <div className="space-y-3 rounded-xl border border-line bg-bg p-4 text-sm" data-testid="maintenance-approval">
            {revoked ? <p className="text-muted">{approval === "human" ? t("aim.approval.askHelp") : t("aim.approval.actHelp")} {t("aim.approval.installNote")}</p> : <ApprovalChoice current={approval} onChange={setApprovalAction.bind(null, id)} labels={approvalLabels(t, row.name)} />}
            {advanced && token.grants[MAINTENANCE_PROFILE] === true && <p className="text-muted">{t("mcp.profile.maintenance")}</p>}
          </div>
        ) : level === 1 ? <>{reset}{optedOut}</> : undefined,
      });
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <a href={TEAM_HREF} className="text-sm text-muted hover:text-accent" data-testid="assistant-back">← {t("nav.users")}</a>
        <h1 className={`mt-1 break-words ${ui.pageTitle}`}>{row.name} {advanced && <span className="font-mono text-base text-muted">{row.prefix}…</span>}</h1>
        {advanced && (
          <p className="mt-1 text-sm text-muted">
            {t(`mcp.scope.${token.scope}`)} · {t("mcp.allowedCount", { n: usable.length, total: catalogue.filter((x) => !x.instanceOptedOut).length })}
          </p>
        )}
        {revoked && <p className="mt-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm" role="status" data-testid="access-revoked">{t("assistants.detail.revoked")}</p>}
        <p className="mt-2 max-w-2xl text-[15px] leading-6" data-testid="assistants-can">{can.map((a) => t(`assistants.can.${a}`)).join(" ")}</p>
        {!revoked && <p className="mt-2 text-sm"><a href={assistantHistoryHref(row.name)} className="text-accent underline underline-offset-2" data-testid="assistant-history">{t("team.ai.history")}</a></p>}
        <p className={ui.pageIntro}>{t(advanced ? "mcp.accessIntro" : "assistants.detail.intro")}</p>
        {token.scope === "read" && <p className="mt-2 rounded-lg border border-line bg-surface p-3 text-sm">{t(advanced ? "mcp.readCeiling" : "assistants.detail.readOnly")}</p>}
      </div>

      {!revoked && (
        <section className={`${ui.card} space-y-3`} aria-label={t("mcp.url.title")} data-testid="mcp-url-access">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{t("mcp.url.title")} <span className={urlOn ? ui.chipWarn : ui.chip}>{urlOn ? t("mcp.url.stateOn") : t("mcp.url.stateOff")}</span></h2>
            <form action={setUrlAccessAction.bind(null, id, !urlOn)}>
              {urlOn ? <PendingButton>{t("mcp.url.disable")}</PendingButton> : <ConfirmButton danger={false} message={t(advanced ? "mcp.url.enableConfirm" : "assistants.url.enableConfirm")}>{t("mcp.url.enable")}</ConfirmButton>}
            </form>
          </div>
          <p className="text-sm leading-6 text-muted">{advanced ? t("mcp.url.help", { siteUrl }) : t("assistants.url.help")}</p>
          {urlOn && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">{t(advanced ? "mcp.guide.secretWarn" : "assistants.guide.warn")}</p>}
        </section>
      )}

      <GrantsEditor sections={sections} labels={grantsLabels(t)} save={applyGrantsAction.bind(null, id)}
        riskyApproval={t(approval === "human" ? "grants.risky.approval.human" : "grants.risky.approval.direct")} />

      {!advanced && groups.size > 1 && <Callout tone="info" testid="assistants-more-advanced">{t("assistants.detail.moreInAdvanced")} <a href="/admin/mode" className="underline">{t("assistants.detail.modeLink")}</a></Callout>}

      {!revoked && advanced && (
        <form action={resetGrantsAction.bind(null, id, null, "defaults")} className="border-t border-line pt-4">
          <PendingButton>{t("mcp.resetAll")}</PendingButton>
        </form>
      )}

      {!revoked && (
        <DangerZone title={t("assistants.revoke")} help={t("assistants.detail.revokeHelp")}>
          <form action={revokeTokenAction.bind(null, id)}><ConfirmButton message={t("assistants.revokeConfirm", { name: row.name })}>{t("assistants.revoke")}</ConfirmButton></form>
        </DangerZone>
      )}
    </div>
  );
}
