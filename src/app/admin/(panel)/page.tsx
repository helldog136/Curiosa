import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { getAdminNav } from "@/core/modules/adminNav";
import { ui } from "@/components/admin/ui";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { t, config, advanced, user } = await adminCtx("editor");
  const nav = await getAdminNav(config.defaultLocale, config.defaultLocale);
  const firstContent = nav.flatMap((g) => g.items).find((i) => i.content);
  const { denied } = await searchParams;
  const [drafts, published, redirects, collections, modules] = await Promise.all([
    prisma.entry.count({ where: { status: "draft" } }),
    prisma.entry.count({ where: { status: "published" } }),
    prisma.redirect.count(),
    prisma.moduleInstance.count(),
    prisma.module.count({ where: { enabled: true } }),
  ]);
  const stat = (label: string, value: number, href: string) => (
    <a href={href} className={`${ui.card} block transition hover:-translate-y-0.5 hover:border-accent`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </a>
  );
  return (
    <div className="space-y-6">
      <header>
        <h1 className={ui.pageTitle}>{advanced ? t("dashboard.title", { name: config.name }) : t("dashboard.hello", { name: user.name.split(" ")[0] ?? user.name })}</h1>
        {!advanced && <p className={ui.pageIntro}>{t("dashboard.helloIntro", { site: config.name })}</p>}
      </header>
      {denied && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t("error.denied")}</p>}
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
      {advanced && <div className="grid gap-4 sm:grid-cols-3">
        {stat(t("dashboard.published"), published, "/admin/modules")}
        {stat(t("dashboard.drafts"), drafts, "/admin/modules")}
        {stat(t("dashboard.redirects"), redirects, "/admin/redirects")}
        {stat(t("dashboard.instances"), collections, "/admin/modules")}
        {stat(t("dashboard.modules"), modules, "/admin/modules")}
      </div>}
    </div>
  );
}
