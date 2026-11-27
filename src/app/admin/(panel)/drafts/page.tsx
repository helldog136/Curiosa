import { adminCtx } from "@/core/admin";
import { can } from "@/core/auth/access";
import { navItemVisible } from "@/core/modules/adminMenu";
import { getAdminNav } from "@/core/modules/adminNav";
import { listDrafts } from "@/core/content/dashboardCounts";
import { cleanQuery } from "@/core/content/adminList";
import { parsePageParam } from "@/core/content/pagination";
import { ui } from "@/components/admin/ui";
import { PageHeader } from "@/components/admin/Page";
import { EmptyState } from "@/components/admin/EmptyState";
import { LiveSearch, NoResults } from "@/components/admin/LiveSearch";
import { ModulePill } from "@/components/admin/ModulePill";
import { Pagination } from "@/components/site/Pagination";
import { ADMIN_HREF, DRAFTS_HREF, entryHref, entryNewHref } from "@/core/adminLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

const PER_PAGE = 50;

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("drafts.title"));
}

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; q?: string | string[] }> }) {
  const { t, locale, config, user } = await adminCtx("editor");
  const { page: pageRaw, q: qRaw } = await searchParams;
  const nav = (await getAdminNav(config.defaultLocale, config.defaultLocale)).filter((m) => navItemVisible(m, (right) => can(user, right)));
  const q = cleanQuery(typeof qRaw === "string" ? qRaw : "");
  const param = parsePageParam(pageRaw);
  const wanted = param.kind === "page" ? param.page : 1;
  const first = await listDrafts(nav, config.defaultLocale, { limit: PER_PAGE, skip: (wanted - 1) * PER_PAGE, q });
  const pages = Math.max(1, Math.ceil(first.total / PER_PAGE));
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  // The way out of an empty list: write something in the first list of entries the person can open (the dashboard when there is none).
  const writeIn = nav.find((m) => m.content && !m.error);
  const none = first.total === 0 && !q;
  return (
    <div className="space-y-6">
      <PageHeader title={t("drafts.title")} intro={t("drafts.intro")} />
      {none ? (
        <EmptyState title={t("drafts.empty")} testid="drafts-empty"
          action={writeIn ? <a href={entryNewHref(writeIn.key)} className={ui.btnPrimary}>{t("entries.new")}</a> : <a href={ADMIN_HREF} className={ui.btn}>{t("nav.dashboard")}</a>} />
      ) : (
        <>
          {/* R15: the search is there from the first draft, and asks the server (the list is paginated). */}
          <LiveSearch mode="server" scope="drafts" action={DRAFTS_HREF} initialQuery={q} serverCount={q ? t("search.results", { n: first.total }) : undefined}
            placeholder={t("entries.searchPlaceholder")} noneLabel={t("search.none")} clearLabel={t("search.clear")} busyLabel={t("search.busy")} />
          {first.rows.length === 0 && <NoResults message={t("search.none")} clearLabel={t("search.clear")} href={DRAFTS_HREF} />}
          {first.rows.length > 0 && (
            <ul className={`${ui.card} divide-y divide-line !p-0`} data-testid="drafts-list">
              {first.rows.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 sm:px-6">
                  <div className="min-w-0 flex-1 basis-56">
                    <a href={entryHref(d.id)} className="block truncate font-medium hover:text-accent" title={d.title || undefined}>{d.title || "—"}</a>
                    <p className="mt-0.5 text-xs text-muted">{t("entries.updatedOn", { date: fmt.format(d.updatedAt) })}</p>
                  </div>
                  <ModulePill id={d.key} name={d.name} icon={d.icon} />
                  <a href={entryHref(d.id)} className={`${ui.btn} min-h-11`}>{t("drafts.open")}</a>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={Math.min(wanted, pages)} pages={pages} base={q ? `${DRAFTS_HREF}?q=${encodeURIComponent(q)}` : DRAFTS_HREF} t={t} label={t("entries.pagesLabel")} />
        </>
      )}
    </div>
  );
}
