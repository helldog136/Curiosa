import { signOut } from "@/auth";
import { adminCtx } from "@/core/admin";
import { adminBugReportUrl } from "@/core/bugReport";
import { CREDIT_URL } from "@/core/credit";
import { BugReportLink } from "@/components/admin/BugReportLink";
import { maintenanceSummary } from "@/core/maintenance/summary";
import { NavLink } from "@/components/admin/NavLink";
import { NavGroup } from "@/components/admin/NavGroup";
import { NAV_STATE_COOKIE, buildMenuLayout, extensionsBadge, parseNavState } from "@/core/modules/menuPlacement";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { getAdminNav } from "@/core/modules/adminNav";
import { getUpdateCheck, readVersion } from "@/core/updates/service";
import { peekModulesReport } from "@/core/modules/updateStatus";
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
  // Modules en retard : jamais d'attente du réseau ici (menu de toutes les pages) ; la vérification se fait en arrière-plan et reste en mémoire quelques minutes.
  const modulesBehind = user.role === "owner" ? (peekModulesReport()?.outdated.length ?? 0) : 0;
  const aiWaiting = user.role === "owner" ? (await maintenanceSummary().catch(() => null))?.total ?? 0 : 0;
  const bugUrl = await adminBugReportUrl(t);
  const menu = buildMenuLayout(nav);
  const navState = parseNavState((await cookies()).get(NAV_STATE_COOKIE)?.value);
  const entryHref = (m: (typeof nav)[number]) => (m.content ? `/admin/entries?c=${m.key}` : `/admin/instances/${m.id}`);
  const entryAlso = (m: (typeof nav)[number]) => (m.content ? [`/admin/instances/${m.id}`] : []);
  const entryLink = (m: (typeof nav)[number]) => <NavLink key={m.id} href={entryHref(m)} also={entryAlso(m)} badge={m.badge} badgeLabel={t("nav.badge.todo")}>{m.icon} {m.name}</NavLink>;
  // Extensions : les mises à jour de modules, les modules à régler (à configurer ou en erreur) et les pastilles des modules qui ne sont pas épinglés au menu y remontent.
  const statuses = canManage ? await loadInstanceStatuses().catch(() => null) : null;
  const toSetUp = [...(statuses?.values() ?? [])].filter((s) => s.state === "setup" || s.state === "error").length;
  const extensions = extensionsBadge({ modulesBehind, toSetUp, unpinnedBadge: menu.unpinnedBadge });
  // Les fiches d'une extension non épinglée restent « sous » l'entrée Extensions.
  const unpinnedPages = nav.filter((m) => !menu.content.includes(m) && !menu.community.items.includes(m)).flatMap((m) => [`/admin/instances/${m.id}`, ...(m.content ? [`/admin/entries?c=${m.key}`] : [])]);

  const group = "mb-1 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-muted";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col md:flex-row">
      <MobileMenu menuLabel={t("nav.menu")} brand={<a href="/admin" className="flex flex-col px-3 leading-tight"><span className="text-lg font-bold">{config.name}</span><span className="text-xs text-muted">{t("nav.adminTagline")}</span></a>}>
        <nav aria-label="Admin">
          <div className="mt-4"><NavLink href="/admin" exact>{t("nav.dashboard")}</NavLink></div>
          {menu.content.length > 0 && (
            <div>
              <p className={group}>{t("nav.myContent")}</p>
              {menu.content.map(entryLink)}
            </div>
          )}

          {menu.community.items.length > 0 && (
            <div>
              <p className={group}>{t("nav.myCommunity")}</p>
              {menu.community.collapsible
                ? menu.community.groups.map((g) => (
                    <NavGroup key={g.id} id={g.id} title={t(`navgroup.${g.id}`)} targets={g.items.flatMap((m) => [entryHref(m), ...entryAlso(m)])} stored={navState[g.id]} openByDefault={false} badge={g.items.reduce((n, m) => n + m.badge, 0)} badgeLabel={t("nav.badge.todo")}>
                      {g.items.map(entryLink)}
                    </NavGroup>
                  ))
                : menu.community.items.map(entryLink)}
            </div>
          )}

          <p className={group}>{t("nav.mySite")}</p>
          {canManage && <NavLink href="/admin/home">{t("nav.home")}</NavLink>}
          {canManage && <NavLink href="/admin/navigation">{advanced ? t("nav.navigation") : t("nav.navigation.simple")}</NavLink>}
          {canManage && <NavLink href="/admin/settings">{advanced ? t("nav.settings") : t("nav.settings.simple")}</NavLink>}
          {canManage && <NavLink href="/admin/social">{t("nav.social")}</NavLink>}
          {canManage && <NavLink href="/admin/ai-visibility">{t("nav.aiVisibility")}</NavLink>}
          <NavLink href="/admin/redirects">{advanced ? t("nav.redirects") : t("nav.redirects.simple")}</NavLink>

          {(canManage || user.role === "owner") && (
            <>
              <p className={group}>{t("nav.admin")}</p>
              {canManage && <NavLink href={EXTENSIONS_HREF} also={["/admin/modules", ...unpinnedPages]} badge={extensions.count} badgeLabel={extensions.onlyUpdates ? t("nav.badge.updates") : t("nav.badge.todo")}>{t("nav.extensions")}</NavLink>}
              {/* Les deux entrées « assistants IA » restent côte à côte (elles seront réunies plus tard). */}
              {user.role === "owner" && <NavLink href="/admin/maintenance-ia" badge={aiWaiting} badgeLabel={t("nav.badge.ai")}>{t("nav.maintenanceAi")}</NavLink>}
              {advanced && user.role === "owner" && <NavLink href="/admin/mcp">{t("nav.mcp")}</NavLink>}
              {canManage && <NavLink href="/admin/users">{t("nav.users")}</NavLink>}
              {user.role === "owner" && <NavLink href="/admin/backup">{t("nav.backup")}</NavLink>}
              {user.role === "owner" && <NavLink href="/admin/updates" badge={updateAvailable ? 1 : 0} badgeLabel={t("nav.badge.update")}>{t("nav.updates")}</NavLink>}
              {advanced && user.role === "owner" && <NavLink href="/admin/audit">{t("nav.audit")}</NavLink>}
            </>
          )}

          <p className={group}>{t("nav.account")}</p>
          <NavLink href="/admin/account">{t("nav.myAccount")}</NavLink>
          <NavLink href="/" external>{t("nav.viewSite")} ↗</NavLink>
        </nav>
        <form action={setAdminMode.bind(null, !advanced)} className="mt-4 px-3">
          <p className="mb-1 text-xs text-muted"><a href="/admin/mode" className="hover:text-accent hover:underline">{advanced ? t("mode.advanced") : t("mode.simple")}</a></p>
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
        <p className="mt-4 px-3"><BugReportLink href={bugUrl}>🐞 {t("bugReport.link")} ↗</BugReportLink></p>
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
