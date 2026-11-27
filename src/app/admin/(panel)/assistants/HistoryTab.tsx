import { prisma } from "@/core/db";
import { listRequests } from "@/core/maintenance/requests";
import { moduleNames } from "@/core/modules/updateStatus";
import type { Translator } from "@/core/i18n/dictionary";
import { Panel } from "@/components/admin/Page";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { StatusPill } from "@/components/admin/StatusPill";
import { searchText } from "@/core/adminkit/search";
import { describeRequest } from "./requestsShared";

/** Onglet « Historique » : les demandes déjà traitées et ce que vos IA ont fait directement. La liste complète est dans le journal d'audit. */
export async function HistoryTab({ t, locale, defaultLocale, advanced }: { t: Translator; locale: string; defaultLocale: string; advanced: boolean }) {
  const [requests, names] = await Promise.all([listRequests(), moduleNames(locale, defaultLocale)]);
  const name = (id: string) => names.get(id) ?? id;
  const when = (ms: number) => new Date(ms).toLocaleString(locale);
  const answered = requests.filter((r) => r.status !== "pending").slice(0, 10);
  const direct = (await prisma.auditLog.findMany({ where: { actor: { startsWith: "mcp:" }, action: { startsWith: "mcp.maintenance." } }, orderBy: { createdAt: "desc" }, take: 30 }))
    .filter((r) => !["request", "approve", "deny", "mode", "notify"].includes(r.action.slice("mcp.maintenance.".length)) && !r.target.includes("(approved)")).slice(0, 8);

  return (
    <div className="space-y-8" data-testid="assistants-history">
      <Panel title={t("aim.history.title")} help={t("aim.history.help")} testid="ai-history">
        {answered.length === 0 && direct.length === 0 ? <p className="text-sm text-muted">{t("aim.history.none")}</p> : (
          <div className="space-y-3">
          <LiveSearch scope="ai-history" placeholder={t("assistants.history.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} />
          <ul className="divide-y divide-line text-sm">
            {answered.map((r) => (
              <li key={r.id} className="space-y-1 py-3 first:pt-0 last:pb-0" data-live-item="ai-history" data-search={searchText([describeRequest(r, t, name), r.tokenName, t(`aim.status.${r.status}`)])}>
                <p className="flex flex-wrap items-center gap-2"><StatusPill tone={r.status === "done" ? "ok" : r.status === "failed" ? "danger" : "neutral"}>{t(`aim.status.${r.status}`)}</StatusPill><span className="font-medium">{describeRequest(r, t, name)}</span></p>
                <p className="text-muted">{t("aim.from", { token: r.tokenName, date: when(r.createdAt) })}{r.result && advanced ? ` — ${r.result.message}` : ""}{r.status === "failed" && !advanced ? ` — ${t("aim.failedHint")}` : ""}</p>
              </li>
            ))}
            {direct.map((r) => {
              const tool = r.action.slice("mcp.maintenance.".length);
              const ok = r.target.startsWith("ok");
              return (
                <li key={r.id} className="space-y-1 py-3 first:pt-0 last:pb-0" data-live-item="ai-history" data-search={searchText([r.actor.slice(4), t(`aim.action.${tool}`), t(ok ? "aim.activity.ok" : "aim.activity.ko")])}>
                  <p className="flex flex-wrap items-center gap-2"><StatusPill tone={ok ? "ok" : "danger"}>{t(ok ? "aim.activity.ok" : "aim.activity.ko")}</StatusPill><span className="font-medium">{t("aim.activity", { token: r.actor.slice(4), action: t(`aim.action.${tool}`) })}</span></p>
                  <p className="text-muted">{when(r.createdAt.getTime())}</p>
                </li>
              );
            })}
          </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
