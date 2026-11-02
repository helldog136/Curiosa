import { adminCtx } from "@/core/admin";
import { can } from "@/core/auth/access";
import { navItemVisible } from "@/core/modules/adminMenu";
import { getAdminNav } from "@/core/modules/adminNav";
import { listDrafts } from "@/core/content/dashboardCounts";
import { parsePageParam } from "@/core/content/pagination";
import { ui } from "@/components/admin/ui";
import { PageHeader } from "@/components/admin/Page";
import { ModulePill } from "@/components/admin/ModulePill";
import { Pagination } from "@/components/site/Pagination";

const PER_PAGE = 50;

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const { t, locale, config, user } = await adminCtx("editor");
  const { page: pageRaw } = await searchParams;
  const nav = (await getAdminNav(config.defaultLocale, config.defaultLocale)).filter((m) => navItemVisible(m, (right) => can(user, right)));
  const param = parsePageParam(pageRaw);
  const wanted = param.kind === "page" ? param.page : 1;
  const first = await listDrafts(nav, config.defaultLocale, { limit: PER_PAGE, skip: (wanted - 1) * PER_PAGE });
  const pages = Math.max(1, Math.ceil(first.total / PER_PAGE));
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <div className="space-y-6">
      <PageHeader title={t("drafts.title")} intro={t("drafts.intro")} />
      {first.total === 0 ? (
        <div className={`${ui.card} space-y-1 py-10 text-center`} data-testid="drafts-empty">
          <p className="text-lg font-semibold">{t("drafts.empty")}</p>
          <p className="text-sm text-muted">{t("drafts.emptyHelp")}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted" data-testid="drafts-count">{t("drafts.count", { n: first.total })}</p>
          <ul className={`${ui.card} divide-y divide-line !p-0`} data-testid="drafts-list">
            {first.rows.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:px-6">
                <div className="min-w-0 flex-1 basis-56">
                  <a href={`/admin/entries/${d.id}`} className="block truncate font-medium hover:text-accent" title={d.title || undefined}>{d.title || "—"}</a>
                  <p className="mt-0.5 text-xs text-muted">{t("entries.updatedOn", { date: fmt.format(d.updatedAt) })}</p>
                </div>
                <ModulePill id={d.key} name={d.name} icon={d.icon} />
                <a href={`/admin/entries/${d.id}`} className={ui.btn}>{t("drafts.open")}</a>
              </li>
            ))}
          </ul>
          <Pagination page={Math.min(wanted, pages)} pages={pages} base="/admin/drafts" t={t} label={t("entries.pagesLabel")} />
        </>
      )}
    </div>
  );
}
