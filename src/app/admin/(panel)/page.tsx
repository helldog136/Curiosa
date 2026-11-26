import { adminCtx } from "@/core/admin";
import { takeDenied } from "@/core/auth/access";
import { currentVocabulary } from "@/core/modules/placesLoad";
import { canOpen, openableModuleEntries, ownersOf } from "@/core/adminAccess";
import { denialText } from "@/core/adminDenial";
import { prisma } from "@/core/db";
import { getAdminNav } from "@/core/modules/adminNav";
import { ui } from "@/components/admin/ui";
import { Callout, PageHeader } from "@/components/admin/Page";
import { EXTENSIONS_ADD_HREF, EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { ModulePill } from "@/components/admin/ModulePill";
import { dashboardEntryCounts, listDrafts, unlistedEntries, type EntryCount } from "@/core/content/dashboardCounts";
import { dashboardPlan } from "@/core/dashboard/layout";
import { ActivityBlock, CardsBlock, CreateBlock, HealthPill, SetupBlock, Slot, StorageBlock, TodoBlock, VisitsBlock, type BlockCtx } from "@/components/admin/dashboard/Blocks";
import { DRAFTS_HREF, REDIRECTS_HREF, entriesHref, entryHref, entryNewHref } from "@/core/adminLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("nav.dashboard"));
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string; welcome?: string; modules?: string }> }) {
  // Tout accès suffit (le menu y renvoie) ; ne montre que ce que cette personne peut ouvrir.
  const { t, locale, config, advanced, user } = await adminCtx("member");
  const allNav = await getAdminNav(config.defaultLocale, config.defaultLocale);
  // R35: the entries of the modules this person may open (the rule of the menu, then the access table), and who owns each instance for the pages of instances.
  const owners = ownersOf(allNav, currentVocabulary().groups.map((g) => g.id));
  const nav = openableModuleEntries(user, allNav, owners);
  const firstContent = nav.find((i) => i.content && !i.error);
  const { denied, welcome, modules: setupModulesState } = await searchParams;
  // R35: the refusal names what the page needed (kept in memory for this person only, never read from the address).
  const deniedNeed = denied ? takeDenied(user.id) : null;
  const canEdit = canOpen(user, DRAFTS_HREF, owners);
  const [counts, draftList, unlisted, redirects, instanceCount, modules] = await Promise.all([
    dashboardEntryCounts(nav),
    listDrafts(nav, config.defaultLocale, { limit: 5 }),
    advanced && canOpen(user, EXTENSIONS_HREF, owners) ? unlistedEntries(allNav) : Promise.resolve({ total: 0, parts: [] }),
    prisma.redirect.count(),
    prisma.moduleInstance.count(),
    prisma.module.count(),
  ]);
  const plan = dashboardPlan(user, advanced);
  const c: BlockCtx = {
    t, locale, defaultLocale: config.defaultLocale, advanced, user,
    nav: nav.map((i) => ({ id: i.id, key: i.key, name: i.name, icon: i.icon, content: i.content, error: i.error, badge: i.badge, moduleId: i.moduleId })),
    contentIds: nav.filter((i) => i.content && !i.error).map((i) => i.id),
    newPageHref: firstContent ? entryNewHref(firstContent.key) : EXTENSIONS_ADD_HREF,
    owners,
  };
  const ARROW = <span aria-hidden="true"> →</span>;
  const plain = `${ui.card} block`;
  const link = `${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`;
  // Un chiffre qui ouvre une page se voit comme tel (flèche, survol) ; un chiffre seul ne ressemble pas à un bouton.
  const stat = (label: string, value: number, href: string | null, testid?: string) => {
    const body = (<><p className="text-3xl font-bold">{value}</p><p className="text-sm text-muted">{label}{href && ARROW}</p></>);
    return href ? <a href={href} data-testid={testid} className={link}>{body}</a> : <div data-testid={testid} className={plain}>{body}</div>;
  };
  // Contenus publiés : le total, puis une ligne par extension qui ouvre sa liste (jamais de lien vers une liste qui ne montrerait rien).
  const publishedStat = (c: EntryCount) => (
    <div data-testid="stat-published" className={plain}>
      <p className="text-3xl font-bold">{c.total}</p>
      <p className="text-sm text-muted">{t("dashboard.published")}</p>
      {c.parts.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {c.parts.map((p) => {
            const row = (<><span className="truncate">{p.icon} {p.name}</span><span className="text-muted">{p.n}{canOpen(user, entriesHref(p.key), owners) && ARROW}</span></>);
            return <li key={p.key}>{canOpen(user, entriesHref(p.key), owners)
              ? <a href={entriesHref(p.key, { state: "published" })} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 hover:bg-accent/10">{row}</a>
              : <span className="flex items-center justify-between gap-3 px-2 py-1">{row}</span>}</li>;
          })}
        </ul>
      )}
    </div>
  );
  const first = user.name.split(" ")[0] ?? user.name;
  const draftsBlock = canEdit ? (
    <section aria-label={t("dashboard.toFinish")} data-testid="to-finish" className={`${ui.card} space-y-3`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("dashboard.toFinish")}</h2>
            {draftList.total > 0 && <a href={DRAFTS_HREF} data-testid="drafts-all" className="text-sm underline hover:text-accent">{t("dashboard.draftsAll", { n: draftList.total })}{ARROW}</a>}
          </div>
          {draftList.total === 0 ? (
            <p className="text-sm text-muted" data-testid="drafts-none">{counts.published.total > 0 ? t("dashboard.draftsNone") : t("dashboard.draftsNoneYet")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {draftList.rows.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className="min-w-0 flex-1 basis-48 truncate font-medium" title={d.title || undefined}>{d.title || "—"}</span>
                  <ModulePill id={d.key} name={d.name} icon={d.icon} />
                  <span className="text-xs text-muted">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d.updatedAt)}</span>
                  <a href={entryHref(d.id)} className={ui.btn}>{t("dashboard.draftOpen")}{ARROW}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
  ) : null;
  const numbersBlock = (
    <section aria-label={t("dashboard.inNumbers")} data-testid="in-numbers" className="space-y-3">
        <h2 className="text-lg font-semibold">{t("dashboard.inNumbers")}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {publishedStat(counts.published)}
          {/* R35: a tile is shown only to someone who can open the page it leads to (the number alone is not offered to a person who cannot act on it). */}
          {canOpen(user, EXTENSIONS_HREF, owners) && stat(t("dashboard.extensions"), allNav.length, EXTENSIONS_HREF, "stat-extensions")}
          {redirects > 0 && canOpen(user, REDIRECTS_HREF, owners) && stat(t("dashboard.shortLinks"), redirects, REDIRECTS_HREF, "stat-redirects")}
          {advanced && canOpen(user, EXTENSIONS_HREF, owners) && stat(t("dashboard.instances"), instanceCount, EXTENSIONS_HREF, "stat-instances")}
          {advanced && canOpen(user, EXTENSIONS_HREF, owners) && stat(t("dashboard.modules"), modules, EXTENSIONS_HREF, "stat-modules")}
        </div>
        {advanced && unlisted.total > 0 && (
          <p className="text-sm text-muted" data-testid="unlisted">{t("dashboard.unlisted", { where: unlisted.parts.map((p) => `${p.name || t("dashboard.removedExtension")} (${p.n})`).join(", ") })}</p>
        )}
      </section>
  );
  const blocks: Record<string, React.ReactNode> = {
    setup: <Slot key="setup" label={t("dash.loading")}><SetupBlock c={c} /></Slot>,
    todo: <Slot key="todo" label={t("dash.loading")}><TodoBlock c={c} /></Slot>,
    drafts: draftsBlock,
    create: <Slot key="create" label={t("dash.loading")} height="h-16"><CreateBlock c={c} /></Slot>,
    activity: <Slot key="activity" label={t("dash.loading")} height="h-40"><ActivityBlock c={c} /></Slot>,
    visits: <Slot key="visits" label={t("dash.loading")} height="h-56"><VisitsBlock c={c} /></Slot>,
    modules: <Slot key="modules" label={t("dash.loading")} height="h-24"><CardsBlock c={c} max={plan.cards} /></Slot>,
    numbers: numbersBlock,
    storage: <Slot key="storage" label={t("dash.loading")} height="h-40"><StorageBlock c={c} /></Slot>,
  };
  return (
    <div className="space-y-6">
      <PageHeader title={advanced ? t("dashboard.title", { name: config.name }) : t("dashboard.hello", { name: first })} intro={advanced ? t("dashboard.introAdvanced") : undefined}>
        <div className="flex flex-wrap items-center gap-2">
          {plan.blocks.includes("health") && <Slot label={t("dash.loading")} height="h-10"><HealthPill c={c} /></Slot>}
          <a href="/" target="_blank" rel="noopener" className={`${ui.btn} min-h-11`}>{t("dash.view")}{ARROW}</a>
        </div>
      </PageHeader>
      {welcome && !advanced && <Callout tone="ok" role="status">🎉 {t("dashboard.welcome", { name: first })}</Callout>}
      {welcome && (setupModulesState === "failed" || setupModulesState === "partial") && <Callout tone="warn" role="status" testid="setup-modules-failed">{t(setupModulesState === "failed" ? "dashboard.modulesFailed" : "dashboard.modulesPartial")}</Callout>}
      {denied && <Callout tone="danger" testid="denied">{denialText(t, deniedNeed)}</Callout>}
      {plan.blocks.filter((b) => b !== "health").map((b) => blocks[b] ?? null)}
    </div>
  );
}
