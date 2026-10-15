import { adminCtx } from "@/core/admin";
import { CREDIT_URL } from "@/core/credit";
import { adminBugReportUrl } from "@/core/bugReport";
import { prisma } from "@/core/db";
import { listMcpToolCatalogue } from "@/core/platform";
import { canUse, parseGrants, MAINTENANCE_PROFILE } from "@/core/services/mcp/access";
import { isMcpEnabled } from "@/core/services/mcp/tokens";
import { isMailConfigured } from "@/core/services/mail";
import { listRequests, type MaintenanceRequest } from "@/core/maintenance/requests";
import { getApprovalModes, getNotifyMode, markSeen } from "@/core/maintenance/settings";
import { moduleNames } from "@/core/modules/updateStatus";
import type { Translator } from "@/core/i18n/dictionary";
import { BugReportLink } from "@/components/admin/BugReportLink";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Callout, EmptyState, PageHeader, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { approveRequestAction, denyRequestAction, saveNotifyAction, setApprovalAction } from "./actions";

export const dynamic = "force-dynamic";

/** Ce que la demande va faire, en langage simple. */
function describe(r: MaintenanceRequest, t: Translator, name: (id: string) => string): string {
  const p = r.plan;
  if (r.action === "core_update") return t("aim.req.core_update", { from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "module_update") return t("aim.req.module_update", { name: name(p.module ?? ""), from: p.from ?? "?", to: p.to ?? "?" });
  if (r.action === "modules_update_all") return t("aim.req.modules_update_all", { n: p.modules?.length ?? 0, list: (p.modules ?? []).map((m) => `${name(m.id)} (${m.from} → ${m.to})`).join(", ") });
  return t(p.keepData === false ? "aim.req.module_uninstall_erase" : "aim.req.module_uninstall", { name: name(p.module ?? "") });
}

/** Maintenance par IA : les demandes qui attendent un accord, ce qui s'est passé, et comment chaque jeton se comporte. Propriétaire seulement. */
export default async function AiMaintenancePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { t, locale, config, advanced } = await adminCtx("owner");
  const { notice } = await searchParams;
  const [enabled, requests, names, notify, mailOk, approval, catalogue, tokens, bugUrl] = await Promise.all([
    isMcpEnabled(), listRequests(), moduleNames(locale, config.defaultLocale), getNotifyMode(), isMailConfigured(), getApprovalModes(),
    listMcpToolCatalogue(), prisma.apiToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" } }), adminBugReportUrl(t),
  ]);
  const name = (id: string) => names.get(id) ?? id;
  const when = (ms: number) => new Date(ms).toLocaleString(locale);
  const pending = requests.filter((r) => r.status === "pending");
  const answered = requests.filter((r) => r.status !== "pending").slice(0, 10);
  const direct = (await prisma.auditLog.findMany({ where: { actor: { startsWith: "mcp:" }, action: { startsWith: "mcp.maintenance." } }, orderBy: { createdAt: "desc" }, take: 30 }))
    .filter((r) => !["request", "approve", "deny", "mode", "notify"].includes(r.action.slice("mcp.maintenance.".length)) && !r.target.includes("(approved)")).slice(0, 8);

  // Les jetons qui ont au moins un outil de maintenance autorisé (profil « Maintenance » ou accès accordé à la main).
  const maintenanceTools = catalogue.filter((x) => x.source === "maintenance");
  const mine = tokens.map((k) => ({ row: k, grants: parseGrants(k.grants) })).map((k) => ({ ...k, scope: k.row.scope === "write" ? ("write" as const) : ("read" as const) }))
    .filter((k) => maintenanceTools.some((x) => canUse(x, k)))
    .map((k) => ({ ...k, profile: k.grants[MAINTENANCE_PROFILE] === true, risky: maintenanceTools.some((x) => x.destructive && canUse(x, k)) }));
  await markSeen();

  return (
    <div className="space-y-8">
      <PageHeader title={t("nav.maintenanceAi")} intro={t("aim.intro")} icon="🤖" />
      {!enabled && <Callout tone="warn">{t("aim.mcpOff")} <a href="/admin/mcp" className="underline">{t("nav.mcp")}</a></Callout>}
      {notice && <Callout tone="warn" role="status" testid="ai-notice">{t(`aim.notice.${notice}`)}</Callout>}

      <Panel title={t("aim.pending.title")} help={t("aim.pending.help")} testid="ai-requests">
        {pending.length === 0 ? (
          <EmptyState icon="✅" title={t("aim.pending.none")} />
        ) : (
          <ul className="space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" data-testid="ai-request">
                <p className="text-lg font-semibold leading-snug">{describe(r, t, name)}</p>
                <p className="text-sm leading-6">{t(`aim.risk.${r.action}`)}</p>
                <p className="text-sm text-muted">{t("aim.from", { token: r.tokenName, date: when(r.createdAt) })} · {t("aim.expires", { date: when(r.expiresAt) })}</p>
                <div className="flex flex-wrap gap-2">
                  <form action={approveRequestAction.bind(null, r.id)}><ConfirmButton danger={false} message={t("aim.approveConfirm", { what: describe(r, t, name) })}>✓ {t("aim.approve")}</ConfirmButton></form>
                  <form action={denyRequestAction.bind(null, r.id)}><ConfirmButton message={t("aim.denyConfirm")}>{t("aim.deny")}</ConfirmButton></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t("aim.history.title")} help={t("aim.history.help")} testid="ai-history">
        {answered.length === 0 && direct.length === 0 ? <p className="text-sm text-muted">{t("aim.history.none")}</p> : (
          <ul className="divide-y divide-line text-sm">
            {answered.map((r) => (
              <li key={r.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <p className="flex flex-wrap items-center gap-2"><span className={r.status === "done" ? ui.chipOk : r.status === "failed" ? ui.chipDanger : ui.chip}>{t(`aim.status.${r.status}`)}</span><span className="font-medium">{describe(r, t, name)}</span></p>
                <p className="text-muted">{t("aim.from", { token: r.tokenName, date: when(r.createdAt) })}{r.result && advanced ? ` — ${r.result.message}` : ""}{r.status === "failed" && !advanced ? ` — ${t("aim.failedHint")}` : ""}</p>
              </li>
            ))}
            {direct.map((r) => {
              const tool = r.action.slice("mcp.maintenance.".length);
              const ok = r.target.startsWith("ok");
              return (
                <li key={r.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-2"><span className={ok ? ui.chipOk : ui.chipDanger}>{t(ok ? "aim.activity.ok" : "aim.activity.ko")}</span><span className="font-medium">{t("aim.activity", { token: r.actor.slice(4), action: t(`aim.action.${tool}`) })}</span></p>
                  <p className="text-muted">{when(r.createdAt.getTime())}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t("aim.tokens.title")} help={t("aim.tokens.help")} testid="ai-tokens">
        {mine.length === 0 ? (
          <EmptyState icon="🔑" title={t("aim.tokens.none")} action={<a href="/admin/mcp?profile=maintenance#new-token" className={ui.btnPrimary}>{t("aim.tokens.create")}</a>} />
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((k) => {
              const mode = approval[k.row.id] === "direct" ? "direct" : "human";
              return (
                <li key={k.row.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{k.row.name}</p>
                    <a href={`/admin/mcp/${k.row.id}`} className={ui.btn}>{t("aim.tokens.edit")}</a>
                  </div>
                  <p className="text-sm font-medium">{t("aim.approval.title")}</p>
                  {!k.risky && <p className="text-sm text-muted">{t("aim.approval.noRisk")}</p>}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <form action={setApprovalAction.bind(null, k.row.id, "human")} className={`rounded-xl border p-3 text-sm ${mode === "human" ? "border-accent bg-accent/5" : "border-line"}`}>
                      <p className="font-medium">{mode === "human" && "● "}{t("aim.approval.human")}</p>
                      <p className="mt-1 text-muted">{t("aim.approval.humanHelp")}</p>
                      {mode !== "human" && <button className={`${ui.btn} mt-2`}>{t("aim.approval.save")}</button>}
                    </form>
                    <form action={setApprovalAction.bind(null, k.row.id, "direct")} className={`rounded-xl border p-3 text-sm ${mode === "direct" ? "border-red-500/60 bg-red-500/5" : "border-line"}`}>
                      <p className="font-medium">{mode === "direct" && "● "}{t("aim.approval.direct")}</p>
                      <p className="mt-1 text-muted">{t("aim.approval.directHelp")}</p>
                      {mode !== "direct" && <div className="mt-2"><ConfirmButton message={t("aim.approval.directConfirm", { token: k.row.name })}>{t("aim.approval.save")}</ConfirmButton></div>}
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {mine.length > 0 && <a href="/admin/mcp?profile=maintenance#new-token" className={`${ui.btn} self-start`}>{t("aim.tokens.create")}</a>}
      </Panel>

      <Panel title={t("aim.notify.title")} help={t("aim.notify.help")} testid="ai-notify">
        <form action={saveNotifyAction} className="space-y-3">
          {(["admin", "email"] as const).map((m) => (
            <label key={m} className="flex items-start gap-3 text-sm">
              <input type="radio" name="notify" value={m} defaultChecked={notify === m} className="mt-1 h-4 w-4 accent-[var(--v-accent)]" />
              <span><span className="font-medium">{t(`aim.notify.${m}`)}</span>{m === "email" && <span className="mt-0.5 block text-muted">{t("aim.notify.emailHelp")}</span>}</span>
            </label>
          ))}
          {notify === "email" && !mailOk && <Callout tone="warn">{t("aim.notify.mailMissing")}</Callout>}
          <button className={ui.btn}>{t("aim.notify.save")}</button>
        </form>
      </Panel>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <a href={`${CREDIT_URL}/blob/HEAD/docs/MAINTENANCE-IA.md`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-accent" data-testid="ai-guide-link">📄 {t("aim.guide")} ↗</a>
        <span>{t("aim.guideHelp")}</span>
        <BugReportLink href={bugUrl} className="underline underline-offset-2 hover:text-accent">🐞 {t("bugReport.link")} ↗</BugReportLink>
      </p>
    </div>
  );
}
