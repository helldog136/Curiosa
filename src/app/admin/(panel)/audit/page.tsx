import { adminCtx } from "@/core/admin";
import { listAudit } from "@/core/audit";
import { auditLabelKey } from "@/core/auditLabels";
import { EmptyState, PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, locale, advanced } = await adminCtx("owner");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const { rows, total, page, pages } = await listAudit({ q, page: Number(typeof sp.page === "string" ? sp.page : 1) });
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.audit")} intro={t("audit.intro")} />
      <form method="get" role="search" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} aria-label={t("audit.search")} placeholder={t("audit.search")} className={`${ui.input} max-w-sm`} />
        <button className={ui.btn}>{t("audit.searchButton")}</button>
        {q && <a href="/admin/audit" className="text-sm text-muted underline hover:text-accent">{t("audit.clear")}</a>}
      </form>
      {rows.length === 0 ? (
        <EmptyState icon="📜" title={q ? t("audit.noResult", { q }) : t("audit.emptyTitle")} action={q ? <a href="/admin/audit" className={ui.btn}>{t("audit.clear")}</a> : undefined}>
          {q ? t("audit.noResultHelp") : t("audit.empty")}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted">{t("audit.count", { n: total })}</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className={ui.th}>{t("audit.when")}</th><th className={ui.th}>{t("audit.who")}</th><th className={ui.th}>{t("audit.what")}</th><th className={ui.th}>{t("audit.target")}</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const key = auditLabelKey(r.action);
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className={`${ui.td} whitespace-nowrap`}>{r.createdAt.toLocaleString(locale)}</td>
                      <td className={`${ui.td} break-all`}>{r.actor}</td>
                      <td className={ui.td}>
                        {key ? t(key) : <span className="font-mono text-xs">{r.action}</span>}
                        {key && advanced && <span className="block font-mono text-xs text-muted">{r.action}</span>}
                      </td>
                      <td className={`${ui.td} break-all text-sm text-muted`}>{r.target}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {pages > 1 && (
        <nav className="flex items-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 && <a className={ui.btn} href={href(page - 1)}>←</a>}
          <span>{page} / {pages}</span>
          {page < pages && <a className={ui.btn} href={href(page + 1)}>→</a>}
        </nav>
      )}
    </div>
  );
}
