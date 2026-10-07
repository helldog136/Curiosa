import { adminCtx } from "@/core/admin";
import { listAudit } from "@/core/audit";
import { TextField } from "@/components/admin/Field";
import { ui } from "@/components/admin/ui";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, locale } = await adminCtx("owner");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const { rows, total, page, pages } = await listAudit({ q, page: Number(typeof sp.page === "string" ? sp.page : 1) });
  const href = (p: number) => `/admin/audit?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("nav.audit")}</h1>
        <p className="mt-1 text-sm text-muted">{t("audit.intro")}</p>
      </div>
      <form method="get" className="flex items-end gap-2">
        <TextField name="q" label={t("audit.search")} defaultValue={q} />
        <button className={ui.btn}>{t("audit.searchButton")}</button>
      </form>
      <p className="text-sm text-muted">{t("audit.count", { n: total })}</p>
      <table className="w-full">
        <thead><tr><th className={ui.th}>{t("audit.when")}</th><th className={ui.th}>{t("audit.who")}</th><th className={ui.th}>{t("audit.what")}</th><th className={ui.th}>{t("audit.target")}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className={`${ui.td} whitespace-nowrap`}>{r.createdAt.toLocaleString(locale)}</td>
              <td className={ui.td}>{r.actor}</td>
              <td className={`${ui.td} font-mono text-sm`}>{r.action}</td>
              <td className={`${ui.td} break-all text-sm`}>{r.target}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className={`${ui.td} text-muted`}>{t("audit.empty")}</td></tr>}
        </tbody>
      </table>
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
