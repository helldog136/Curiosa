import { notFound } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { listInstances } from "@/core/instances";
import { getInstanceLabeler } from "@/core/modules/labels";
import { listMcpToolCatalogue } from "@/core/platform";
import { getActiveInstances } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { siteUrl } from "@/core/config";
import { canUse, defaultFor, isGranted, MAINTENANCE_PROFILE, parseGrants, withinCeiling } from "@/core/services/mcp/access";
import { abilities } from "@/core/services/mcp/accessView";
import { ASSISTANTS_HREF } from "@/core/services/mcp/assistantsLinks";
import { getApprovalMode } from "@/core/maintenance/settings";
import { MAINTENANCE_TOOLS } from "@/core/maintenance/tools";
import { isUrlAccessEnabled } from "@/core/services/mcp/tokens";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { GrantToggle } from "@/components/admin/GrantToggle";
import { Callout, DangerZone } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { resetGrantsAction, revokeTokenAction, setGrantAction, setUrlAccessAction } from "../actions";
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
  const shown = [...groups.entries()].filter(([source]) => advanced || source === "maintenance");

  return (
    <div className="space-y-6">
      <div>
        <a href={ASSISTANTS_HREF} className="text-sm text-muted hover:text-accent">← {t("assistants.title")}</a>
        <h1 className={`mt-1 break-words ${ui.pageTitle}`}>{row.name} {advanced && <span className="font-mono text-base text-muted">{row.prefix}…</span>}</h1>
        {advanced && (
          <p className="mt-1 text-sm text-muted">
            {t(`mcp.scope.${token.scope}`)} · {t("mcp.allowedCount", { n: usable.length, total: catalogue.filter((x) => !x.instanceOptedOut).length })}
          </p>
        )}
        {revoked && <p className="mt-2 rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm" role="status" data-testid="access-revoked">{t("assistants.detail.revoked")}</p>}
        <p className="mt-2 max-w-2xl text-[15px] leading-6" data-testid="assistants-can">{can.map((a) => t(`assistants.can.${a}`)).join(" ")}</p>
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

      {shown.map(([source, tools]) => {
        const inst = instances.find((i) => i.key === source);
        const mod = active.find((a) => a.instance.key === source)?.mod;
        const isMaintenance = source === "maintenance";
        const title = isMaintenance ? `🛠️ ${t("aim.group")}` : source === "core" ? t("mcp.platform") : `${mod?.manifest.icon ?? "🧩"} ${inst ? labeler.label(inst) : source}`;
        return (
          <section key={source} className={`${ui.card} space-y-3`} aria-label={title}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {title}
                {mod && advanced && <span className="ml-2 text-xs font-normal text-muted">{localized(mod.manifest.name, locale, config.defaultLocale)} · {source}</span>}
              </h2>
              {source !== "core" && !revoked && (
                <div className="flex flex-wrap gap-2">
                  <form action={resetGrantsAction.bind(null, id, source, "defaults")}><PendingButton>{t("mcp.resetDefaults")}</PendingButton></form>
                  <form action={resetGrantsAction.bind(null, id, source, "none")}><PendingButton>{t("mcp.disableAll")}</PendingButton></form>
                </div>
              )}
            </div>
            {isMaintenance && (
              <div className="space-y-3 rounded-xl border border-line bg-bg p-4 text-sm" data-testid="maintenance-approval">
                <p className="font-medium">{t("aim.approval.title")}</p>
                <p className="text-muted">{approval === "human" ? t("aim.approval.humanHelp") : t("aim.approval.directHelp")}</p>
                {!revoked && (
                  <form action={setApprovalAction.bind(null, id, approval === "human" ? "direct" : "human")}>
                    {approval === "human"
                      ? <ConfirmButton message={t("aim.approval.directConfirm", { token: row.name })}>{t("aim.approval.direct")}</ConfirmButton>
                      : <PendingButton>{t("aim.approval.human")}</PendingButton>}
                  </form>
                )}
                {advanced && token.grants[MAINTENANCE_PROFILE] === true && <p className="text-muted">{t("mcp.profile.maintenance")}</p>}
              </div>
            )}
            {tools[0]?.instanceOptedOut && <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2 text-sm">{t("mcp.instanceOptedOut")}</p>}
            <ul className="divide-y divide-line">
              {tools.map((tool) => {
                const ceilingBlocks = !withinCeiling(tool, token.scope);
                const effective = !ceilingBlocks && isGranted(tool, token.grants);
                const short = tool.name.includes("__") ? tool.name.split("__")[1]! : tool.name;
                const plain = isMaintenance ? t(`aim.tool.${short.replace(/^maintenance_/, "")}`) : "";
                const level = levelOf.get(tool.name);
                const firstOfLevel = isMaintenance && level !== undefined && tools.findIndex((x) => levelOf.get(x.name) === level) === tools.indexOf(tool);
                return (
                  <li key={tool.name} className="py-3">
                    {firstOfLevel && <div className="mb-3 rounded-lg bg-surface p-3 text-sm"><p className="font-semibold">{t(`aim.level.${level}`)}</p><p className="text-muted">{t(`aim.level.${level}.help`)}</p></div>}
                    <div className="flex items-start gap-4">
                      <div className="pt-0.5">
                        <GrantToggle
                          label={advanced ? `${title} — ${short}` : plain}
                          checked={effective}
                          disabled={revoked || ceilingBlocks || tool.instanceOptedOut}
                          confirmMessage={tool.destructive ? t(advanced ? "mcp.confirmDestructive" : "assistants.confirmDestructive", { action: advanced ? short : t(`aim.action.${short.replace(/^maintenance_/, "")}`) }) : undefined}
                          onToggle={setGrantAction.bind(null, id, tool.name)}
                        />
                      </div>
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          {advanced && <span className="break-all font-mono">{short}</span>}{" "}
                          <span className={`rounded px-1.5 py-0.5 text-xs ${tool.destructive ? "bg-red-500/20 text-red-700" : tool.readOnly ? "bg-surface" : "bg-amber-500/20"}`}>
                            {tool.destructive ? t("mcp.destructive") : tool.readOnly ? t("mcp.action.read") : t("mcp.action.write")}
                          </span>
                          {advanced && <span className="ml-1 text-xs text-muted">{defaultFor(tool, token.grants) ? t("mcp.onByDefault") : t("mcp.offByDefault")}</span>}
                        </p>
                        {isMaintenance ? <p className="mt-0.5 text-muted">{plain}</p> : advanced && <p className="mt-0.5 text-muted">{tool.description}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

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
