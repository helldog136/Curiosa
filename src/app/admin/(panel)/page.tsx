import { adminCtx } from "@/core/admin";
import { prisma } from "@/core/db";
import { ui } from "@/components/admin/ui";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const { t, config } = await adminCtx("editor");
  const { denied } = await searchParams;
  const [drafts, published, redirects, collections, modules] = await Promise.all([
    prisma.entry.count({ where: { status: "draft" } }),
    prisma.entry.count({ where: { status: "published" } }),
    prisma.redirect.count(),
    prisma.collection.count(),
    prisma.module.count({ where: { enabled: true } }),
  ]);
  const stat = (label: string, value: number, href: string) => (
    <a href={href} className={`${ui.card} block hover:border-accent`}>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </a>
  );
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("dashboard.title", { name: config.name })}</h1>
      {denied && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm">{t("error.denied")}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        {stat(t("dashboard.published"), published, "/admin/collections")}
        {stat(t("dashboard.drafts"), drafts, "/admin/collections")}
        {stat(t("dashboard.redirects"), redirects, "/admin/redirects")}
        {stat(t("dashboard.collections"), collections, "/admin/collections")}
        {stat(t("dashboard.modules"), modules, "/admin/modules")}
      </div>
    </div>
  );
}
