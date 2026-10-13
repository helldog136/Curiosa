import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { siteUrl } from "@/core/config";
import { listMcpTools } from "@/core/platform";
import { isMcpEnabled, urlAccessIds } from "@/core/services/mcp/tokens";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { GUIDE_KEYS, McpConnectGuide, type GuideTexts } from "@/components/admin/McpConnectGuide";
import { McpTokenCreator } from "@/components/admin/McpTokenCreator";
import { EmptyState, PageHeader, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { createTokenAction, revokeTokenAction, setMcpEnabled } from "./actions";

/** Brancher un assistant IA : 1) l'activer, 2) lui créer un jeton, 3) choisir ce qu'il a le droit de faire. */
export default async function McpPage({ searchParams }: { searchParams: Promise<{ profile?: string }> }) {
  const { t, advanced } = await adminCtx("owner");
  const { profile } = await searchParams;
  const enabled = await isMcpEnabled();
  const tokens = await prisma.apiToken.findMany({ orderBy: { createdAt: "desc" } });
  const byUrl = new Set(await urlAccessIds());
  const guide = Object.fromEntries(GUIDE_KEYS.map((k) => [k, t(k)])) as GuideTexts;
  const tools = enabled ? await listMcpTools() : [];
  const date = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : t("mcp.neverUsed"));
  const active = tokens.filter((k) => !k.revokedAt);
  const revoked = tokens.filter((k) => k.revokedAt);

  return (
    <div className="space-y-8">
      <PageHeader title={t("mcp.title")} intro={t("mcp.intro")} />

      <a href="/admin/maintenance-ia" className={`${ui.card} flex flex-wrap items-center justify-between gap-3 transition hover:border-accent`} data-testid="mcp-maintenance-link">
        <span><span className="block text-lg font-semibold">🤖 {t("mcp.maintenanceLink")}</span><span className="mt-1 block text-sm text-muted">{t("mcp.maintenanceLinkHelp")}</span></span>
        <span className={ui.btn}>{t("nav.maintenanceAi")}</span>
      </a>

      <Panel title={t("mcp.connect.title")} help={t("mcp.connect.intro")} testid="mcp-connect">
        <ol className="grid gap-3 sm:grid-cols-3">
          {(["s1", "s2", "s3"] as const).map((k, i) => (
            <li key={k} className="rounded-xl border border-line bg-bg p-4">
              <p className="flex items-center gap-2 font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-sm text-accent-fg">{i + 1}</span>{t(`mcp.connect.${k}`)}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{t(`mcp.connect.${k}d`)}</p>
            </li>
          ))}
        </ol>
        <McpConnectGuide texts={guide} baseUrl={siteUrl} advanced={advanced} />
      </Panel>

      <Panel title={t("mcp.step1")} testid="mcp-status">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-medium"><span className={enabled ? ui.chipOk : ui.chip}>{enabled ? t("mcp.stateOn") : t("mcp.stateOff")}</span>{enabled ? t("mcp.on") : t("mcp.off")}</p>
          <form action={setMcpEnabled.bind(null, !enabled)}>
            {enabled ? <ConfirmButton message={t("mcp.disableConfirm")}>{t("action.disable")}</ConfirmButton> : <button className={ui.btnPrimary}>{t("action.enable")}</button>}
          </form>
        </div>
        {enabled && <p className="text-sm">{t("mcp.endpoint")} : <code className="select-all break-all rounded bg-line px-1.5 py-0.5 font-mono text-[13px]">{siteUrl}/api/mcp</code></p>}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">{t("mcp.safetyTitle")}</summary>
          <p className="mt-2 leading-6 text-muted">{t("mcp.safety")}</p>
        </details>
      </Panel>

      {enabled && (
        <>
          <Panel title={t("mcp.step2")} help={t("mcp.tokensHelp")} testid="mcp-tokens">
            {active.length === 0 ? (
              <EmptyState icon="🔑" title={t("mcp.noTokensTitle")} action={<a href="#new-token" className={ui.btnPrimary}>{t("mcp.newToken")}</a>}>{t("mcp.noTokens")}</EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {active.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <a href={`/admin/mcp/${k.id}`} className="font-medium hover:text-accent">{k.name}</a>
                      {advanced && <span className="ml-2 font-mono text-xs text-muted">{k.prefix}…</span>}
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted"><span className={k.scope === "write" ? ui.chipWarn : ui.chip}>{t(`mcp.scope.${k.scope}`)}</span>{byUrl.has(k.id) && <span className={ui.chip}>{t("mcp.urlChip")}</span>}{t("mcp.lastUsed")} : {date(k.lastUsedAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={`/admin/mcp/${k.id}`} className={ui.btn}>{t("mcp.access")}</a>
                      <form action={revokeTokenAction.bind(null, k.id)}><ConfirmButton message={t("mcp.revokeConfirm", { name: k.name })}>{t("mcp.revoke")}</ConfirmButton></form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {revoked.length > 0 && advanced && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">{t("mcp.revokedList", { n: revoked.length })}</summary>
                <ul className="mt-2 space-y-1 text-muted">{revoked.map((k) => <li key={k.id}>{k.name} <span className="font-mono text-xs">{k.prefix}…</span> — {t("mcp.revoked")}</li>)}</ul>
              </details>
            )}
          </Panel>

          <Panel title={t("mcp.newToken")} help={t("mcp.newTokenHelp")} testid="new-token">
            <span id="new-token" className="sr-only" />
            <McpTokenCreator
              action={createTokenAction}
              baseUrl={siteUrl}
              advanced={advanced}
              guide={guide}
              defaultProfile={profile === "maintenance" ? "maintenance" : "standard"}
              labels={{
                name: t("mcp.tokenName"), nameHelp: t("mcp.tokenNameHelp"), scope: t("mcp.scope"), scopeHelp: t("mcp.scopeHelp"),
                read: t("mcp.scope.read"), write: t("mcp.scope.write"), urlOption: t("mcp.urlOption"), urlOptionHelp: t("mcp.urlOptionHelp"),
                submit: t("mcp.createToken"), afterCreate: t("mcp.afterCreate"),
                createdTitle: t("mcp.created.title", { name: "{name}" }), createdToken: t("mcp.created.token"), createdUrl: t("mcp.created.url"), createdOnce: t("mcp.created.once"),
                copy: t("mcp.guide.copy"), copied: t("mcp.guide.copied"),
                profile: {
                  label: t("mcp.profile"), standard: t("mcp.profile.standard"), maintenance: t("mcp.profile.maintenance"), help: t("mcp.profile.help"),
                  levels: [t("mcp.profile.l1"), t("mcp.profile.l2"), t("mcp.profile.l3")],
                  approval: t("mcp.profile.approval"), approvalHuman: t("mcp.profile.approval.human"), approvalDirect: t("mcp.profile.approval.direct"),
                  notify: t("mcp.profile.notify"), notifyAdmin: t("mcp.profile.notify.admin"), notifyEmail: t("mcp.profile.notify.email"),
                },
              }}
            />
          </Panel>

          <details className="rounded-2xl border border-line bg-surface p-5">
            <summary className="cursor-pointer text-lg font-semibold">{t("mcp.tools")} ({tools.length})</summary>
            <p className="mt-2 text-sm text-muted">{t("mcp.toolsHelp")}</p>
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {tools.map((tool) => (
                <li key={tool.name} className="space-y-0.5 px-4 py-3 text-sm">
                  <p><span className="font-mono">{tool.name}</span> <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tool.readOnly ? "bg-surface" : "bg-amber-500/20"}`}>{tool.readOnly ? t("mcp.scope.read") : t("mcp.scope.write")}</span></p>
                  {advanced && <p className="text-muted">{tool.description}</p>}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
