import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { adminCtx } from "@/core/admin";
import { adminTitle } from "@/core/adminTitle";
import { currentVocabulary } from "@/core/modules/placesLoad";
import { loadGroupIndex } from "@/core/modules/connectionsIndex";
import { loadAccountsTable, EDIT_PARAM } from "@/components/admin/connectionsLoad";
import { ConnectionsTable } from "@/components/admin/ConnectionsTable";
import { AccountEditor } from "@/components/admin/AccountEditor";
import { connectionsLabels } from "@/components/admin/connectionRows";
import { EXTENSIONS_ADD_HREF } from "@/core/modules/extensionsLinks";
import { EmptyState, PageHeader } from "@/components/admin/Page";
import { ui } from "@/components/admin/ui";
import { hasRole } from "@/core/auth/access";
import { NETWORKS_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

type Params = { group: string };

/** The name of the page: "Accounts and connections" for the Networks group, the title of the group otherwise. */
const NETWORKS = "networks";

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { group } = await params;
  return adminTitle(({ t, locale }) => {
    if (group === NETWORKS) return t("nav.accounts");
    const g = currentVocabulary().groups.find((x) => x.id === group);
    return g ? (/^fr/i.test(locale) ? g.fr : g.en) : "";
  }, { need: "member" });
}

/**
 * (C2b) The index of a group of places: `/admin/networks` is "Accounts and connections", the page that replaces the Networks group and the Connections section of the sidebar.
 * It lists what this person may open (the access table decides, as for the sidebar); an unknown group, or a group with nothing to open, is a 404.
 */
export default async function GroupIndexPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { group } = await params;
  const { user, t, locale, config, advanced } = await adminCtx("member");
  const index = await loadGroupIndex(user, { group, advanced, locale, defaultLocale: config.defaultLocale });
  if (!index) {
    if (group === NETWORKS && hasRole(user, "admin")) {
      return (
        <div className="space-y-6">
          <PageHeader title={t("nav.accounts")} intro={t("connections.intro")} />
          <EmptyState icon="🔌" title={t("connections.emptyTitle")} action={<a href={EXTENSIONS_ADD_HREF} className={ui.btnPrimary}>{t("connections.emptyAction")}</a>}>{t("connections.emptyHelp")}</EmptyState>
        </div>
      );
    }
    notFound();
  }
  if (group === NETWORKS) {
    // (C5c) One table of every account and connection (R30): where a row comes from and its state are columns, the search and the filters cover all of it.
    const table = await loadAccountsTable(user, { group, advanced, locale, defaultLocale: config.defaultLocale, locales: config.locales, t });
    if (table && table.rows.length > 0) {
      const asked = (await searchParams)[EDIT_PARAM];
      const editing = typeof asked === "string" ? table.addresses.get(asked) : undefined;
      return (
        <div className="space-y-6">
          <PageHeader title={t("nav.accounts")} intro={t("connections.intro")} />
          <ConnectionsTable rows={table.rows} labels={connectionsLabels(t)} />
          {editing && <AccountEditor loaded={editing} closeHref={NETWORKS_HREF} t={t} locale={locale} config={config} advanced={advanced} />}
        </div>
      );
    }
  }
  const title = group === NETWORKS ? t("nav.accounts") : index.title;
  return (
    <div className="space-y-8">
      <PageHeader title={title} {...(group === NETWORKS ? { intro: t("connections.intro") } : {})} />
      {index.blocks.map((b) => (
        <section key={b.id} aria-label={b.title ?? title} className="space-y-3" data-testid={`group-index-${b.id}`}>
          {b.title && <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{b.title}</h2>}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
            {b.links.map((l) => (
              <li key={l.id}>
                <a href={l.href} className={`${ui.card} flex min-h-11 items-center justify-between gap-3 hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}>
                  <span className="min-w-0 break-words font-medium">{l.name}</span>
                  {l.badge > 0 && <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold leading-5 text-accent-fg">{l.badge}<span className="sr-only"> {t("nav.badge.todo")}</span></span>}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
