import { prisma } from "@/core/db";
import { siteUrl } from "@/core/config";
import { listMcpToolCatalogue, listMcpTools } from "@/core/platform";
import { canUse, parseGrants } from "@/core/services/mcp/access";
import { abilities, accessState, splitAccesses, type Ability } from "@/core/services/mcp/accessView";
import { accessHref } from "@/core/services/mcp/assistantsLinks";
import { isMcpEnabled, urlAccessIds } from "@/core/services/mcp/tokens";
import { getApprovalModes } from "@/core/maintenance/settings";
import type { Translator } from "@/core/i18n/dictionary";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { GUIDE_KEYS, McpConnectGuide, type GuideTexts } from "@/components/admin/McpConnectGuide";
import { McpTokenCreator, type CreatorLabels } from "@/components/admin/McpTokenCreator";
import { Callout, EmptyState, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { createTokenAction, revokeTokenAction, setMcpEnabled } from "./actions";

/** Les textes du formulaire de création : mêmes champs, mais des mots de tous les jours en mode simple. */
function creatorLabels(t: Translator, advanced: boolean): CreatorLabels {
  const levels = [t("mcp.profile.l1"), t("mcp.profile.l2"), t("mcp.profile.l3")];
  return {
    name: t("assistants.new.name"), nameHelp: t("assistants.new.nameHelp"), submit: t("assistants.new.submit"), afterCreate: t(advanced ? "mcp.afterCreate" : "assistants.new.after"),
    createdTitle: t("assistants.created.title", { name: "{name}" }), createdSecret: t(advanced ? "mcp.created.token" : "assistants.created.key"), createdUrl: t(advanced ? "mcp.created.url" : "assistants.created.url"),
    createdOnce: t(advanced ? "mcp.created.once" : "assistants.created.once"), copy: t("mcp.guide.copy"), copied: t("mcp.guide.copied"),
    profile: {
      label: t(advanced ? "mcp.profile" : "assistants.new.kind"), standard: t(advanced ? "mcp.profile.standard" : "assistants.new.kind.content"), maintenance: t(advanced ? "mcp.profile.maintenance" : "assistants.new.kind.upkeep"),
      help: t(advanced ? "mcp.profile.help" : "assistants.new.kind.upkeepHelp"), levels,
      approval: t("mcp.profile.approval"), approvalHuman: t("mcp.profile.approval.human"), approvalDirect: t("mcp.profile.approval.direct"),
      notify: t("mcp.profile.notify"), notifyAdmin: t("mcp.profile.notify.admin"), notifyEmail: t("mcp.profile.notify.email"),
    },
    scope: { label: t(advanced ? "mcp.scope" : "assistants.new.power"), help: t(advanced ? "mcp.scopeHelp" : "assistants.new.powerHelp"), read: t(advanced ? "mcp.scope.read" : "assistants.new.power.read"), write: t(advanced ? "mcp.scope.write" : "assistants.new.power.write") },
    url: advanced
      ? { label: t("mcp.urlOption"), help: t("mcp.urlOptionHelp"), keyLabel: "", keyHelp: "" }
      : { label: t("assistants.new.how"), help: t("assistants.new.how.claude"), keyLabel: t("assistants.new.how.key"), keyHelp: t("assistants.new.how.keyHelp") },
    simpleGuide: { claudeTitle: t("mcp.guide.claude.title"), claudeText: t("mcp.guide.claude.text"), keyText: t("assistants.guide.keyText"), warn: t("assistants.guide.warn") },
  };
}

/** Onglet « Accès » : les assistants connectés (actifs d'abord), puis la zone repliée des accès arrêtés, puis le formulaire pour en connecter un. */
export async function AccessTab({ t, locale, advanced, profile }: { t: Translator; locale: string; advanced: boolean; profile?: string }) {
  const now = new Date();
  const [enabled, rows, byUrl, modes, catalogue] = await Promise.all([
    isMcpEnabled(), prisma.apiToken.findMany({ orderBy: { createdAt: "desc" } }), urlAccessIds(), getApprovalModes(), listMcpToolCatalogue(),
  ]);
  const { active, inactive } = splitAccesses(rows, now);
  const urlSet = new Set(byUrl);
  const guide = Object.fromEntries(GUIDE_KEYS.map((k) => [k, t(k)])) as GuideTexts;
  const when = (d: Date) => d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const day = (d: Date) => d.toLocaleDateString(locale, { dateStyle: "medium" });

  /** Ce que cet accès peut faire, d'après les actions réellement autorisées (plafond, accès accordés, retraits d'instance). */
  const canDo = (row: (typeof rows)[number]): Ability[] => {
    const token = { scope: row.scope === "write" ? ("write" as const) : ("read" as const), grants: parseGrants(row.grants) };
    return abilities(catalogue.filter((x) => !x.instanceOptedOut && canUse(x, token)).map((x) => ({ readOnly: x.readOnly, destructive: x.destructive, source: x.source })));
  };

  return (
    <div className="space-y-8" data-testid="assistants-access">
      {!enabled && (
        <Callout tone="warn" testid="assistants-off">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span><strong>{t("assistants.off.title")}</strong> {t("assistants.off.help")}</span>
            <form action={setMcpEnabled.bind(null, true)}><button className={ui.btnPrimary}>{t("assistants.off.resume")}</button></form>
          </span>
        </Callout>
      )}

      <Panel title={t("assistants.active.title")} help={t("assistants.active.help")} testid="assistants-active">
        {active.length === 0 ? (
          <EmptyState icon="🤖" title={t("assistants.none.title")} action={enabled ? <a href="#new-token" className={ui.btnPrimary}>{t("assistants.connect")}</a> : undefined}>{t("assistants.none.help")}</EmptyState>
        ) : (
          <>
            {enabled && <a href="#new-token" className={`${ui.btnPrimary} self-start`} data-testid="assistants-connect">{t("assistants.connect")}</a>}
            <ul className="divide-y divide-line">
              {active.map((k) => {
                const can = canDo(k);
                const upkeep = can.some((a) => a.startsWith("maintenance"));
                return (
                  <li key={k.id} className="space-y-2 py-4 first:pt-0 last:pb-0" data-testid="assistants-item">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <a href={accessHref(k.id)} className="break-words text-base font-semibold hover:text-accent">{k.name}</a>
                        {advanced && <span className="ml-2 font-mono text-xs text-muted">{k.prefix}…</span>}
                        <p className="mt-1 flex flex-wrap items-center gap-2">
                          {upkeep && <span className={modes[k.id] === "direct" ? ui.chipWarn : ui.chip}>{t(modes[k.id] === "direct" ? "assistants.chip.direct" : "assistants.chip.human")}</span>}
                          {urlSet.has(k.id) && <span className={ui.chip}>{t("mcp.urlChip")}</span>}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={accessHref(k.id)} className={ui.btn}>{t("assistants.manage")}<span className="sr-only"> {k.name}</span></a>
                        <form action={revokeTokenAction.bind(null, k.id)}><ConfirmButton message={t("assistants.revokeConfirm", { name: k.name })}>{t("assistants.revoke")}<span className="sr-only"> {k.name}</span></ConfirmButton></form>
                      </div>
                    </div>
                    <p className="text-sm leading-6" data-testid="assistants-can">{can.map((a) => t(`assistants.can.${a}`)).join(" ")}</p>
                    <p className="text-sm text-muted">
                      {t("mcp.lastUsed")} : {k.lastUsedAt ? when(k.lastUsedAt) : t("assistants.neverUsed")} · {t("assistants.expiry.never")}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {inactive.length > 0 && (
          <details className="rounded-xl border border-line bg-bg" data-testid="assistants-inactive">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium">{t("assistants.inactive.summary", { n: inactive.length })}</summary>
            <div className="space-y-2 border-t border-line px-4 py-3">
              <p className="text-sm leading-6 text-muted">{t("assistants.inactive.help")}</p>
              <ul className="divide-y divide-line text-sm">
                {inactive.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                    <a href={accessHref(k.id)} className="break-words font-medium hover:text-accent">{k.name}{advanced && <span className="ml-2 font-mono text-xs text-muted">{k.prefix}…</span>}</a>
                    <span className="text-muted">
                      {accessState(k, now) === "revoked" && k.revokedAt ? t("assistants.state.revoked", { date: day(k.revokedAt) }) : t("assistants.state.expired")}
                      {" · "}{t("mcp.lastUsed")} : {k.lastUsedAt ? day(k.lastUsedAt) : t("assistants.neverUsed")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </Panel>

      {enabled && (
        <Panel title={t("assistants.new.title")} help={t("assistants.new.help")} testid="new-token">
          <span id="new-token" className="sr-only" />
          <ol className="grid gap-3 sm:grid-cols-3">
            {(["1", "2", "3"] as const).map((n) => (
              <li key={n} className="rounded-xl border border-line bg-bg p-4">
                <p className="flex items-center gap-2 font-semibold"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-sm text-accent-fg">{n}</span>{t(`assistants.step.${n}`)}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{t(`assistants.step.${n}d`)}</p>
              </li>
            ))}
          </ol>
          <McpTokenCreator action={createTokenAction} baseUrl={siteUrl} advanced={advanced} guide={guide} defaultProfile={profile === "maintenance" ? "maintenance" : "standard"} labels={creatorLabels(t, advanced)} />
        </Panel>
      )}

      <Panel title={t("assistants.master.title")} testid="assistants-master">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-medium"><span className={enabled ? ui.chipOk : ui.chipWarn}>{t(enabled ? "assistants.master.onChip" : "assistants.master.offChip")}</span>{t(enabled ? "assistants.master.on" : "assistants.master.off")}</p>
          <form action={setMcpEnabled.bind(null, !enabled)}>
            {enabled ? <ConfirmButton message={t("assistants.master.confirm")}>{t("assistants.master.suspend")}</ConfirmButton> : <button className={ui.btnPrimary}>{t("assistants.off.resume")}</button>}
          </form>
        </div>
      </Panel>

      {advanced && (
        <Panel title={t("assistants.tech.title")} help={t("assistants.tech.help")} testid="assistants-tech">
          <p className="text-sm">{t("mcp.endpoint")} : <code className="select-all break-all rounded bg-line px-1.5 py-0.5 font-mono text-[13px]">{siteUrl}/api/mcp</code></p>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">{t("mcp.safetyTitle")}</summary>
            <p className="mt-2 leading-6 text-muted">{t("mcp.safety")}</p>
          </details>
          <details className="rounded-xl border border-line bg-bg p-4" data-testid="mcp-connect">
            <summary className="cursor-pointer text-[15px] font-semibold">{t("mcp.connect.title")}</summary>
            <div className="mt-3 space-y-3">
              <p className="text-sm leading-6 text-muted">{t("mcp.connect.intro")}</p>
              <McpConnectGuide texts={guide} baseUrl={siteUrl} advanced={advanced} />
            </div>
          </details>
          {enabled && <ToolsList t={t} />}
        </Panel>
      )}
    </div>
  );
}

/** La liste des actions que les modules proposent aux assistants (mode avancé). */
async function ToolsList({ t }: { t: Translator }) {
  const tools = await listMcpTools();
  return (
    <details className="rounded-xl border border-line bg-bg p-4">
      <summary className="cursor-pointer text-[15px] font-semibold">{t("mcp.tools")} ({tools.length})</summary>
      <p className="mt-2 text-sm text-muted">{t("mcp.toolsHelp")}</p>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
        {tools.map((tool) => (
          <li key={tool.name} className="space-y-0.5 px-4 py-3 text-sm">
            <p className="break-all"><span className="font-mono">{tool.name}</span> <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tool.readOnly ? "bg-surface" : "bg-amber-500/20"}`}>{tool.readOnly ? t("mcp.scope.read") : t("mcp.scope.write")}</span></p>
            <p className="text-muted">{tool.description}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
