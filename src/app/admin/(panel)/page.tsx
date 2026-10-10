import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { getAdminNav } from "@/core/modules/adminNav";
import { ui } from "@/components/admin/ui";
import { Callout, PageHeader } from "@/components/admin/Page";
import { getUpdateCheck } from "@/core/updates/service";
import { statsEnabled, statsSummary } from "@/core/stats";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string; welcome?: string }> }) {
  const { t, config, advanced, user } = await adminCtx("editor");
  const nav = await getAdminNav(config.defaultLocale, config.defaultLocale);
  const firstContent = nav.find((i) => i.content && i.enabled && !i.error);
  const { denied, welcome } = await searchParams;
  const [drafts, published, redirects, collections, modules] = await Promise.all([
    prisma.entry.count({ where: { status: "draft" } }),
    prisma.entry.count({ where: { status: "published" } }),
    prisma.redirect.count(),
    prisma.moduleInstance.count(),
    prisma.module.count({ where: { enabled: true } }),
  ]);
  const todo = nav.filter((i) => i.badge > 0);
  const updateAvailable = user.role === "owner" && (await getUpdateCheck().catch(() => null))?.available === true;
  const stats = (await statsEnabled()) ? await statsSummary() : null;
  const peak = Math.max(1, ...(stats?.days.map((d) => d.visitors) ?? [1]));
  const stat = (label: string, value: number, href: string) => (
    <a href={href} className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </a>
  );
  const entriesHref = firstContent ? `/admin/entries?c=${firstContent.key}` : "/admin/modules";
  const first = user.name.split(" ")[0] ?? user.name;
  const noVisits = !!stats && stats.totals.last30.visitors === 0;
  return (
    <div className="space-y-6">
      <PageHeader title={advanced ? t("dashboard.title", { name: config.name }) : t("dashboard.hello", { name: first })} intro={advanced ? t("dashboard.introAdvanced") : t("dashboard.helloIntro", { site: config.name })} />
      {welcome && !advanced && <Callout tone="ok" role="status">🎉 {t("dashboard.welcome", { name: first })}</Callout>}
      {denied && <Callout tone="danger">{t("error.denied")}</Callout>}
      {(todo.length > 0 || updateAvailable) && (
        <section aria-label={t("dashboard.todo")} data-testid="todo" className={`${ui.card} space-y-2`}>
          <h2 className="text-lg font-semibold">{t("dashboard.todo")}</h2>
          <ul className="space-y-1.5">
            {todo.map((i) => (
              <li key={i.id}><a href={i.content ? `/admin/entries?c=${i.key}` : `/admin/instances/${i.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-accent/10"><span>{i.icon} {i.name}</span><span className="rounded-full bg-accent px-2 text-sm font-semibold text-accent-fg">{i.badge} {t("nav.badge.todo")}</span></a></li>
            ))}
            {updateAvailable && <li><a href="/admin/updates" className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-accent/10"><span>⬆️ {t("dashboard.updateReady")}</span><span className="rounded-full bg-accent px-2 text-sm font-semibold text-accent-fg">{t("nav.badge.update")}</span></a></li>}
          </ul>
        </section>
      )}
      {!advanced && (
        <section aria-label={t("dashboard.start")} className="space-y-3">
          <h2 className="text-lg font-semibold">{t("dashboard.start")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {firstContent && (
              <a href={`/admin/entries/new?c=${firstContent.key}`} className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>✍️</span>
                <p className="text-lg font-semibold">{t("dashboard.writeFirst")}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{t("dashboard.writeFirstHelp")}</p>
              </a>
            )}
            <a href="/admin/settings" className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>🎨</span>
                <p className="text-lg font-semibold">{t("dashboard.customize")}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{t("dashboard.customizeHelp")}</p>
            </a>
            <a href="/admin/redirects" className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>🔗</span>
                <p className="text-lg font-semibold">{t("dashboard.shortcuts")}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{t("dashboard.shortcutsHelp")}</p>
            </a>
            {user.role !== "editor" && (
              <a href="/admin/modules" className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>🧩</span>
                <p className="text-lg font-semibold">{t("dashboard.addFeature")}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{t("dashboard.addFeatureHelp")}</p>
              </a>
            )}
            <a href="/" target="_blank" rel="noopener" className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>
              <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>👀</span>
                <p className="text-lg font-semibold">{t("dashboard.viewSite")}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{t("dashboard.viewSiteHelp")}</p>
            </a>
          </div>
        </section>
      )}
      {stats && (
        <section aria-label={t("dashboard.visits")} data-testid="visits" className={`${ui.card} space-y-4`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{t("dashboard.visits")}</h2>
            <p className="text-xs text-muted">{t("dashboard.visitsPrivacy")}</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {([["today", stats.totals.today], ["last7", stats.totals.last7], ["last30", stats.totals.last30]] as const).map(([k, v]) => (
              <div key={k}><p className="text-2xl font-bold">{v.visitors}</p><p className="text-xs text-muted">{t(`dashboard.visits.${k}`)}</p></div>
            ))}
          </div>
          {noVisits && <p className="text-sm text-muted">{t("dashboard.visitsEmpty")}</p>}
          <div className="flex h-20 items-end gap-px" role="img" aria-label={t("dashboard.visitsChart")}>
            {stats.days.map((d) => (
              <div key={d.day} title={`${d.day} : ${d.visitors}`} className="min-h-px flex-1 rounded-t bg-accent/70" style={{ height: `${Math.max(2, (d.visitors / peak) * 100)}%`, opacity: d.visitors ? 1 : 0.25 }} />
            ))}
          </div>
          {(stats.topPages.length > 0 || stats.topSources.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {([["dashboard.topPages", stats.topPages.map((p) => [p.path, p.views] as const)], ["dashboard.topSources", stats.topSources.map((p) => [p.host, p.views] as const)]] as const).map(([title, rows]) => rows.length > 0 && (
                <div key={title}>
                  <h3 className="mb-1 text-sm font-semibold">{t(title)}</h3>
                  <ul className="space-y-0.5 text-sm">{rows.map(([label, n]) => <li key={label} className="flex justify-between gap-3"><span className="truncate">{label}</span><span className="text-muted">{n}</span></li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {advanced && (
        <section aria-label={t("dashboard.inNumbers")} className="space-y-3">
          <h2 className="text-lg font-semibold">{t("dashboard.inNumbers")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {stat(t("dashboard.published"), published, entriesHref)}
            {stat(t("dashboard.drafts"), drafts, entriesHref)}
            {stat(t("dashboard.redirects"), redirects, "/admin/redirects")}
            {stat(t("dashboard.instances"), collections, "/admin/modules")}
            {stat(t("dashboard.modules"), modules, "/admin/modules")}
          </div>
        </section>
      )}
    </div>
  );
}
