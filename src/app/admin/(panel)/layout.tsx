import { signOut } from "@/auth";
import { adminCtx } from "@/core/admin";
import { CREDIT_URL } from "@/core/credit";
import { NavLink } from "@/components/admin/NavLink";
import { getAdminNav } from "@/core/modules/adminNav";
import { getUpdateCheck, readVersion } from "@/core/updates/service";
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
  const updateAvailable = user.role === "owner" && (await getUpdateCheck().catch(() => null))?.available === true;
  const items = nav.flatMap((g) => g.items.map((i) => ({ ...i, type: g.type })));
  const contentItems = items.filter((i) => i.type === "content");
  const otherItems = items.filter((i) => i.type !== "content");

  const group = "mb-1 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-muted";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col md:flex-row">
      <MobileMenu menuLabel={t("nav.menu")} brand={<a href="/admin" className="flex flex-col px-3 leading-tight"><span className="text-lg font-bold">{config.name}</span><span className="text-xs text-muted">{t("nav.adminTagline")}</span></a>}>
        <nav aria-label="Admin">
          <div className="mt-4"><NavLink href="/admin" exact>{t("nav.dashboard")}</NavLink></div>

          {contentItems.length > 0 && (
            <div>
              <p className={group}>{t("nav.myContent")}</p>
              {contentItems.map((m) => <NavLink key={m.id} href={`/admin/entries?c=${m.key}`} badge={m.badge} badgeLabel={t("nav.badge.todo")}>{m.icon} {m.name}</NavLink>)}
            </div>
          )}

          <p className={group}>{t("nav.mySite")}</p>
          {canManage && <NavLink href="/admin/home">{t("nav.home")}</NavLink>}
          {canManage && <NavLink href="/admin/navigation">{advanced ? t("nav.navigation") : t("nav.navigation.simple")}</NavLink>}
          {canManage && <NavLink href="/admin/settings">{advanced ? t("nav.settings") : t("nav.settings.simple")}</NavLink>}
          <NavLink href="/admin/redirects">{advanced ? t("nav.redirects") : t("nav.redirects.simple")}</NavLink>

          <p className={group}>{t("nav.features")}</p>
          {otherItems.map((m) => <NavLink key={m.id} href={m.content ? `/admin/entries?c=${m.key}` : `/admin/instances/${m.id}`} badge={m.badge} badgeLabel={t("nav.badge.todo")}>{m.icon} {m.name}</NavLink>)}
          {/* Une seule entrée : « installé » et « ajouter » (catalogue) sont deux onglets d'un même endroit. */}
          {canManage && <NavLink href="/admin/modules" also={["/admin/catalogue"]}>{advanced ? t("nav.modules") : t("nav.modules.simple")}</NavLink>}

          {(canManage || user.role === "owner") && (
            <>
              <p className={group}>{t("nav.admin")}</p>
              {canManage && <NavLink href="/admin/users">{t("nav.users")}</NavLink>}
              {user.role === "owner" && <NavLink href="/admin/backup">{t("nav.backup")}</NavLink>}
              {user.role === "owner" && <NavLink href="/admin/updates" badge={updateAvailable ? 1 : 0} badgeLabel={t("nav.badge.update")}>{t("nav.updates")}</NavLink>}
              {advanced && user.role === "owner" && <NavLink href="/admin/audit">{t("nav.audit")}</NavLink>}
              {advanced && user.role === "owner" && <NavLink href="/admin/mcp">{t("nav.mcp")}</NavLink>}
            </>
          )}

          <p className={group}>{t("nav.account")}</p>
          <NavLink href="/admin/account">{t("nav.myAccount")}</NavLink>
          <NavLink href="/" external>{t("nav.viewSite")} ↗</NavLink>
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
      </MobileMenu>
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-4xl">{children}</div>
      </main>
      </div>
      {/* Tout en bas de la page, pour tous les rôles et dans les deux modes : crédit exigé par la licence, et numéro de version à donner pour un signalement ou une mise à jour. */}
      <footer className="border-t border-line px-4 py-3 text-center text-xs text-muted" data-testid="app-version">
        {t("site.poweredBy")} <a href={CREDIT_URL} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-fg">Curiosa</a> v{readVersion()}
      </footer>
    </div>
  );
}
