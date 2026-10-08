import { signOut } from "@/auth";
import { adminCtx } from "@/core/admin";
import { getAdminNav } from "@/core/modules/adminNav";
import { readVersion } from "@/core/updates/service";
import { MobileMenu } from "@/components/admin/MobileMenu";
import { ui } from "@/components/admin/ui";
import { cookies } from "next/headers";
import { ADMIN_THEMES, ADMIN_THEME_COOKIE, parseAdminTheme } from "@/core/adminTheme";
import { setAdminMode, setAdminTheme } from "./mode/actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user, t, locale, config, advanced } = await adminCtx("editor");
  const nav = await getAdminNav(locale, config.defaultLocale);
  const theme = parseAdminTheme((await cookies()).get(ADMIN_THEME_COOKIE)?.value);
  const canManage = user.role !== "editor";

  const link = "block rounded-xl px-3 py-2 text-[15px] transition-colors hover:bg-accent/10 hover:text-accent";
  const group = "mb-1 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-muted";

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <MobileMenu menuLabel={t("nav.menu")} brand={<a href="/admin" className="flex flex-col px-3 leading-tight"><span className="text-lg font-bold">{config.name}</span><span className="text-xs text-muted">{t("nav.adminTagline")}</span></a>}>
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
              <a href="/admin/modules" className={link}>🧩 {advanced ? t("nav.modules") : t("nav.modules.simple")}</a>
              <a href="/admin/catalogue" className={link}>🛒 {advanced ? t("nav.catalogue") : t("nav.catalogue.simple")}</a>
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
        <div className="mt-4 px-3" role="group" aria-label={t("theme.admin")}>
          <p className="mb-1 text-xs text-muted">{t("theme.admin")}</p>
          <div className="inline-flex overflow-hidden rounded-xl border border-line">
            {ADMIN_THEMES.map((id) => (
              <form key={id} action={setAdminTheme.bind(null, id)}>
                <button aria-pressed={theme === id} className={`px-3 py-1.5 text-xs transition-colors ${theme === id ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{t(`theme.admin.${id}`)}</button>
              </form>
            ))}
          </div>
        </div>
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
        {/* Toujours visible, pour tous les rôles et dans les deux modes : c'est le numéro à donner pour un signalement ou une mise à jour. */}
        <p className="mt-6 px-3 pb-2 text-xs text-muted" data-testid="app-version">Curiosa v{readVersion()}</p>
      </MobileMenu>
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
    </div>
  );
}
