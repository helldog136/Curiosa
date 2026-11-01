import { prisma } from "@/core/db";
import { listMcpToolCatalogue } from "@/core/platform";
import { canUse, parseGrants } from "@/core/services/mcp/access";
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

/**
 * Onglet « Demandes à valider » : ce que vos IA veulent faire et qui attend votre accord, puis les réglages de cette validation
 * (qui décide pour chaque assistant d'entretien, comment être prévenu). Propriétaire seulement (la page l'exige).
 */
export async function RequestsTab({ t, locale, defaultLocale, notice }: { t: Translator; locale: string; defaultLocale: string; notice?: string }) {
  const [requests, names, notify, mailOk, approval, catalogue, tokens] = await Promise.all([
    listRequests(), moduleNames(locale, defaultLocale), getNotifyMode(), isMailConfigured(), getApprovalModes(),
    listMcpToolCatalogue(), prisma.apiToken.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" } }),
  ]);
  const name = (id: string) => names.get(id) ?? id;
  const when = (ms: number) => new Date(ms).toLocaleString(locale);
  const pending = requests.filter((r) => r.status === "pending");

  // Les accès qui ont au moins une action d'entretien autorisée (type « Entretien du site » ou droit accordé à la main).
  const upkeepTools = catalogue.filter((x) => x.source === "maintenance");
  const mine = tokens
    .map((k) => ({ row: k, token: { scope: k.scope === "write" ? ("write" as const) : ("read" as const), grants: parseGrants(k.grants) } }))
    .filter((k) => upkeepTools.some((x) => canUse(x, k.token)))
    .map((k) => ({ ...k, risky: upkeepTools.some((x) => x.destructive && canUse(x, k.token)) }));

  return (
    <div className="space-y-8" data-testid="assistants-requests">
      {notice && <Callout tone="warn" role="status" testid="ai-notice">{t(`aim.notice.${notice}`)}</Callout>}

      <Panel title={t("aim.pending.title")} help={t("aim.pending.help")} testid="ai-requests">
        {pending.length === 0 ? (
          <EmptyState icon="✅" title={t("aim.pending.none")} />
        ) : (
          <ul className="space-y-4">
            {pending.map((r) => (
              <li key={r.id} className="space-y-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4" data-testid="ai-request">
                <p className="text-lg font-semibold leading-snug">{describeRequest(r, t, name)}</p>
                <p className="text-sm leading-6">{t(`aim.risk.${r.action}`)}</p>
                <p className="text-sm text-muted">{t("aim.from", { token: r.tokenName, date: when(r.createdAt) })} · {t("aim.expires", { date: when(r.expiresAt) })}</p>
                <div className="flex flex-wrap gap-2">
                  <form action={approveRequestAction.bind(null, r.id)}><ConfirmButton danger={false} message={t("aim.approveConfirm", { what: describeRequest(r, t, name) })}>✓ {t("aim.approve")}</ConfirmButton></form>
                  <form action={denyRequestAction.bind(null, r.id)}><ConfirmButton message={t("aim.denyConfirm")}>{t("aim.deny")}</ConfirmButton></form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t("assistants.approval.title")} help={t("assistants.approval.help")} testid="ai-tokens">
        {mine.length === 0 ? (
          <EmptyState icon="🛠️" title={t("assistants.approval.none")} action={<a href={newAccessHref(true)} className={ui.btnPrimary}>{t("assistants.approval.create")}</a>} />
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((k) => {
              const mode = approval[k.row.id] === "direct" ? "direct" : "human";
              return (
                <li key={k.row.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="break-words font-medium">{k.row.name}</p>
                    <a href={accessHref(k.row.id)} className={ui.btn}>{t("assistants.manage")}<span className="sr-only"> {k.row.name}</span></a>
                  </div>
                  <p className="text-sm font-medium">{t("aim.approval.title")}</p>
                  {!k.risky && <p className="text-sm text-muted">{t("assistants.approval.noRisk")}</p>}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <form action={setApprovalAction.bind(null, k.row.id, "human")} className={`rounded-xl border p-3 text-sm ${mode === "human" ? "border-accent bg-accent/5" : "border-line"}`}>
                      <p className="font-medium">{mode === "human" && "● "}{t("aim.approval.human")}</p>
                      <p className="mt-1 text-muted">{t("aim.approval.humanHelp")}</p>
                      {mode !== "human" && <PendingButton className="mt-2" pendingLabel={t("progress.saving")}>{t("aim.approval.save")}</PendingButton>}
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
          <PendingButton pendingLabel={t("progress.saving")}>{t("aim.notify.save")}</PendingButton>
        </form>
      </Panel>
    </div>
  );
}
