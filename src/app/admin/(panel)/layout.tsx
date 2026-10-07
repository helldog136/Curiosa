import { signOut } from "@/auth";
import { adminCtx } from "@/core/admin";
import { getAdminNav } from "@/core/modules/adminNav";
import { ui } from "@/components/admin/ui";
import { setAdminMode } from "./mode/actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, t, locale, config, advanced } = await adminCtx("editor");
  const nav = await getAdminNav(locale, config.defaultLocale);
  const canManage = user.role !== "editor";

  const link = "block rounded-lg px-3 py-1.5 text-sm hover:bg-surface";
  const group = "mb-1 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-muted";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="shrink-0 border-b border-line bg-bg p-4 md:w-64 md:border-b-0 md:border-r">
        <a href="/admin" className="block px-3 text-lg font-bold">{config.name}</a>
        <nav aria-label="Admin">
          <a href="/admin" className={`${link} mt-4`}>{t("nav.dashboard")}</a>

          {nav.map((g) => (
            <div key={g.type}>
              <p className={group}>{t(`type.${g.type}`)}</p>
              {g.items.map((m) => (
                <a key={m.id} href={m.content ? `/admin/entries?c=${m.key}` : `/admin/instances/${m.id}`} className={link}>{m.icon} {m.name}</a>
              ))}
            </div>
          ))}

          <p className={group}>{t("nav.site")}</p>
          <a href="/admin/redirects" className={link}>{t("nav.redirects")}</a>
          {canManage && (
            <>
              <a href="/admin/home" className={link}>{t("nav.home")}</a>
              <a href="/admin/navigation" className={link}>{t("nav.navigation")}</a>
              <a href="/admin/settings" className={link}>{t("nav.settings")}</a>
              <a href="/admin/modules" className={link}>🧩 {t("nav.modules")}</a>
              <a href="/admin/marketplace" className={link}>🛒 {t("nav.marketplace")}</a>
              {advanced && user.role === "owner" && <a href="/admin/mcp" className={link}>🤖 {t("nav.mcp")}</a>}
              {user.role === "owner" && <a href="/admin/backup" className={link}>💾 {t("nav.backup")}</a>}
              {user.role === "owner" && <a href="/admin/audit" className={link}>📜 {t("nav.audit")}</a>}
              {user.role === "owner" && <a href="/admin/updates" className={link}>⬆️ {t("nav.updates")}</a>}
            </>
          )}

          <p className={group}>{t("nav.account")}</p>
          {canManage && <a href="/admin/users" className={link}>{t("nav.users")}</a>}
          <a href="/admin/account" className={link}>{t("nav.myAccount")}</a>
          <a href="/" className={link} target="_blank" rel="noopener">{t("nav.viewSite")} ↗</a>
        </nav>
        <form action={setAdminMode.bind(null, !advanced)} className="mt-4 px-3">
          <p className="mb-1 text-xs text-muted">{advanced ? t("mode.advanced") : t("mode.simple")}</p>
          <button className={ui.btn} title={t("mode.help")}>{advanced ? t("mode.switchToSimple") : t("mode.switchToAdvanced")}</button>
        </form>
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
