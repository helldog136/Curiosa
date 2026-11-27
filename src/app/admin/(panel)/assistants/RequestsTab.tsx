import { prisma } from "@/core/db";
import { listMcpToolCatalogue } from "@/core/platform";
import { canUse, parseGrants } from "@/core/services/mcp/access";
import { fullPowersIds } from "@/core/services/mcp/fullPowers";
import { accessHref, newAccessHref } from "@/core/services/mcp/assistantsLinks";
import { isMailConfigured } from "@/core/services/mail";
import { listRequests } from "@/core/maintenance/requests";
import { getApprovalModes, getNotifyMode } from "@/core/maintenance/settings";
import { moduleNames } from "@/core/modules/updateStatus";
import type { Translator } from "@/core/i18n/dictionary";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Callout, EmptyState, Panel } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { approveRequestAction, denyRequestAction, saveNotifyAction, setApprovalAction } from "./requestsActions";
import { describeRequest } from "./requestsShared";
import { PendingButton } from "@/components/admin/PendingButton";
import { ApprovalChoice } from "@/components/admin/ApprovalChoice";
import { Segmented } from "@/components/admin/Segmented";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { StatusPill } from "@/components/admin/StatusPill";
import { searchText } from "@/core/adminkit/search";
import { approvalLabels } from "./[id]/grantsLabels";

/**
 * Onglet « Demandes à valider » : ce que vos IA veulent faire et qui attend votre accord, puis les réglages de cette validation
 * (qui décide pour chaque assistant d'entretien, comment être prévenu). Propriétaire seulement (la page l'exige).
 */
export async function RequestsTab({ t, locale, defaultLocale, notice }: { t: Translator; locale: string; defaultLocale: string; notice?: string }) {
  const [requests, names, notify, mailOk, approval, catalogue, tokens, fullIds] = await Promise.all([
    listRequests(), moduleNames(locale, defaultLocale), getNotifyMode(), isMailConfigured(), getApprovalModes(),
    listMcpToolCatalogue(), prisma.apiToken.findMany({ where: { revokedAt: null, ownerId: null }, orderBy: { createdAt: "desc" } }), fullPowersIds(),
  ]);
  const name = (id: string) => names.get(id) ?? id;
  const when = (ms: number) => new Date(ms).toLocaleString(locale);
  const pending = requests.filter((r) => r.status === "pending");

  // Les accès qui ont au moins une action d'entretien autorisée (type « Entretien du site » ou droit accordé à la main).
  const upkeepTools = catalogue.filter((x) => x.source === "maintenance" || x.request);
  const mine = tokens
    .map((k) => ({ row: k, token: { scope: k.scope === "write" ? ("write" as const) : ("read" as const), grants: parseGrants(k.grants), fullPowers: k.scope === "write" && fullIds.includes(k.id) } }))
    .filter((k) => upkeepTools.some((x) => canUse(x, k.token)))
    .map((k) => ({ ...k, risky: upkeepTools.some((x) => (x.destructive || x.request) && canUse(x, k.token)) }));

  return (
    <div className="space-y-8" data-testid="assistants-requests">
      {notice && <Callout tone="warn" role="status" testid="ai-notice">{t(`aim.notice.${notice}`)}</Callout>}

      <Panel title={t("aim.pending.title")} help={t("aim.pending.help")} testid="ai-requests">
        {pending.length === 0 ? (
          <EmptyState icon="✅" title={t("aim.pending.none")} />
        ) : (
          <div className="space-y-3">
          <LiveSearch scope="requests" placeholder={t("assistants.requests.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} />
          <ul className="space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="space-y-3 rounded-xl border border-line-strong border-l-4 border-l-warn-text bg-surface p-4" data-testid="ai-request" data-live-item="requests" data-search={searchText([describeRequest(r, t, name), r.tokenName])}>
                <p className="text-lg font-semibold leading-snug">{describeRequest(r, t, name)}</p>
                <p className="text-sm leading-6">{t(`aim.risk.${r.action}`)}</p>
                <p className="text-sm text-muted">{t("aim.from", { token: r.tokenName, date: when(r.createdAt) })} · {t("aim.expires", { date: when(r.expiresAt) })}</p>
                <div className="flex flex-wrap gap-2">
                  <form action={approveRequestAction.bind(null, r.id)}><ConfirmButton danger={false} primary message={t("aim.approveConfirm", { what: describeRequest(r, t, name) })}>✓ {t("aim.approve")}</ConfirmButton></form>
                  <form action={denyRequestAction.bind(null, r.id)}><ConfirmButton danger={false} message={t("aim.denyConfirm")}>{t("aim.deny")}</ConfirmButton></form>
                </div>
              </li>
            ))}
          </ul>
          </div>
        )}
      </Panel>

      <Panel title={t("assistants.approval.title")} help={t("assistants.approval.help")} testid="ai-tokens">
        {mine.length === 0 ? (
          <EmptyState icon="🛠️" title={t("assistants.approval.none")} action={<a href={newAccessHref(true)} className={ui.btnPrimary}>{t("assistants.approval.create")}</a>} />
        ) : (
          <div className="space-y-3">
            <LiveSearch scope="approval" placeholder={t("assistants.approval.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} />
            <ul className="divide-y divide-line" aria-label={t("assistants.approval.title")}>
              {mine.map((k) => {
                const mode = approval[k.row.id] === "direct" ? "direct" : "human";
                return (
                  <li key={k.row.id} className="space-y-3 py-4 first:pt-0 last:pb-0" data-live-item="approval" data-search={searchText([k.row.name])} data-testid="ai-token-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="break-words font-medium">{k.row.name}</p>
                      <a href={accessHref(k.row.id)} className={ui.btn}>{t("assistants.manage")}<span className="sr-only"> {k.row.name}</span></a>
                    </div>
                    {!k.risky && <StatusPill tone="info" title={t("assistants.approval.noRisk")}>{t("assistants.approval.noRiskPill")}</StatusPill>}
                    <ApprovalChoice current={mode} onChange={setApprovalAction.bind(null, k.row.id)} labels={approvalLabels(t, k.row.name)} />
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Panel>

      <Panel title={t("aim.notify.title")} help={t("aim.notify.help")} testid="ai-notify">
        <form action={saveNotifyAction} className="space-y-3">
          <Segmented label={t("aim.notify.where")} name="notify" defaultValue={notify} help={t("aim.notify.emailHelp")} options={(["admin", "email"] as const).map((m) => ({ value: m, label: t(`aim.notify.${m}`) }))} />
          {notify === "email" && !mailOk && <Callout tone="warn">{t("aim.notify.mailMissing")}</Callout>}
          <PendingButton pendingLabel={t("progress.saving")}>{t("aim.notify.save")}</PendingButton>
        </form>
      </Panel>
    </div>
  );
}
