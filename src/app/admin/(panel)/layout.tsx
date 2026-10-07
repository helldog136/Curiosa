import { signOut } from "@/auth";
import { adminCtx } from "@/core/admin";
import { listCollections, pickName } from "@/core/collections";
import { getAdminModuleNav } from "@/core/modules/adminNav";
import { ui } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, t, locale, config } = await adminCtx("editor");
  const collections = await listCollections();
  const moduleNav = await getAdminModuleNav(locale, config.defaultLocale);
  const canManage = user.role !== "editor";

  const link = "block rounded-lg px-3 py-1.5 text-sm hover:bg-surface";
  const group = "mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-muted";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 border-b border-line bg-bg p-4 md:w-64 md:border-b-0 md:border-r">
        <a href="/admin" className="block px-3 text-lg font-bold">{config.name}</a>
        <nav aria-label="Admin">
          <a href="/admin" className={`${link} mt-4`}>{t("nav.dashboard")}</a>

          <p className={group}>{t("nav.content")}</p>
          {collections.map((c) => (
            <a key={c.id} href={`/admin/entries?c=${c.key}`} className={link}>{pickName(c, locale, config.defaultLocale)}</a>
          ))}
          <a href="/admin/redirects" className={link}>{t("nav.redirects")}</a>

          {canManage && (
            <>
              <p className={group}>{t("nav.site")}</p>
              <a href="/admin/collections" className={link}>{t("nav.collections")}</a>
              <a href="/admin/home" className={link}>{t("nav.home")}</a>
              <a href="/admin/navigation" className={link}>{t("nav.navigation")}</a>
              <a href="/admin/settings" className={link}>{t("nav.settings")}</a>
              <a href="/admin/modules" className={link}>{t("nav.modules")}</a>
              {moduleNav.map((m) => (
                <a key={m.id} href={`/admin/modules/${m.id}`} className={`${link} pl-6 text-muted`}>{m.icon} {m.name}</a>
              ))}
            </>
          )}

          <p className={group}>{t("nav.account")}</p>
          {canManage && <a href="/admin/users" className={link}>{t("nav.users")}</a>}
          <a href="/admin/account" className={link}>{t("nav.myAccount")}</a>
          <a href="/" className={link} target="_blank" rel="noopener">{t("nav.viewSite")} ↗</a>
        </nav>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/admin/login" });
          }}
          className="mt-6 px-3"
        >
          <p className="mb-2 truncate text-xs text-muted">{user.name} · {user.role}</p>
          <button className={ui.btn}>{t("nav.logout")}</button>
        </form>
      </aside>
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
