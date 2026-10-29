import { signOut } from "@/auth";
import { wordmark } from "@/components/brand/wordmark";
import { adminCtx } from "@/core/admin";
import { adminBugReportUrl } from "@/core/bugReport";
import { CREDIT_URL } from "@/core/credit";
import { BugReportLink } from "@/components/admin/BugReportLink";
import { maintenanceSummary } from "@/core/maintenance/summary";
import { legacyConversionPending } from "@/core/modules/legacyReport";
import { LegacyBanner } from "@/components/admin/LegacyBanner";
import { NavLink } from "@/components/admin/NavLink";
import { NavGroup } from "@/components/admin/NavGroup";
import { NAV_STATE_COOKIE, buildMenuLayout, extensionsBadge, parseNavState } from "@/core/modules/menuPlacement";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { shortLabel } from "@/core/modules/missingSettings";
import { getAdminNav } from "@/core/modules/adminNav";
import { administrationEntries, navItemVisible, type AdminEntry } from "@/core/modules/adminMenu";
import { can, hasRole } from "@/core/auth/access";
import { ASSISTANTS_HREF } from "@/core/services/mcp/assistantsLinks";
import { getUpdateCheck, readVersion } from "@/core/updates/service";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { MobileMenu } from "@/components/admin/MobileMenu";
import { CropLabelsProvider } from "@/components/admin/CropLabels";
import { HelpTipProvider } from "@/components/admin/HelpTip";
import { CROP_LABEL_KEYS } from "@/components/admin/cropLabelKeys";
import { cookies } from "next/headers";
import { ADMIN_THEMES, ADMIN_THEME_COOKIE, parseAdminTheme } from "@/core/adminTheme";
import { setAdminMode, setAdminTheme } from "./mode/actions";
import { PendingButton } from "@/components/admin/PendingButton";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // Tout accès suffit pour entrer (un rôle personnalisé peut n'ouvrir qu'un module) ; chaque page vérifie ensuite son propre palier ou droit.
  const { user, t, locale, config, advanced } = await adminCtx("member");
  // Le menu ne montre que ce que cette personne peut ouvrir (droit relu en base à chaque requête).
  const nav = (await getAdminNav(locale, config.defaultLocale)).filter((m) => navItemVisible(m, (right) => can(user, right)));
  const editor = hasRole(user, "editor");
  const theme = parseAdminTheme((await cookies()).get(ADMIN_THEME_COOKIE)?.value);
  const canManage = hasRole(user, "admin");
  const updateAvailable = can(user, "core:updates") && (await getUpdateCheck().catch(() => null))?.available === true;
  // Modules en retard : jamais d'attente du réseau ici (menu de toutes les pages) ; la vérification se fait en arrière-plan et reste en mémoire quelques minutes.
  const modulesBehind = can(user, "core:modules.install") ? (peekModulesReport()?.outdated.length ?? 0) : 0;
  const aiWaiting = can(user, "core:mcp.tokens") ? (await maintenanceSummary().catch(() => null))?.total ?? 0 : 0;
  // Garde du démarrage (0.2.0) : un AVERTISSEMENT seulement si la mise à niveau des données n'est pas terminée (le site public reste servi ; bloquant en phase 3).
  const legacyPending = canManage ? await legacyConversionPending() : false;
  const bugUrl = await adminBugReportUrl(t);
  const menu = buildMenuLayout(nav);
  const navState = parseNavState((await cookies()).get(NAV_STATE_COOKIE)?.value);
  const entryHref = (m: (typeof nav)[number]) => (m.content ? `/admin/entries?c=${m.key}` : `/admin/instances/${m.id}`);
  const entryAlso = (m: (typeof nav)[number]) => (m.content ? [`/admin/instances/${m.id}`] : []);
  const entryLink = (m: (typeof nav)[number]) => <NavLink key={m.id} href={entryHref(m)} also={entryAlso(m)} badge={m.badge} badgeLabel={t("nav.badge.todo")}>{m.icon} {m.name}</NavLink>;
  // Extensions : les mises à jour de modules, les modules à régler (à configurer ou en erreur) et les pastilles des modules qui ne sont pas épinglés au menu y remontent.
  const statuses = canManage ? await loadInstanceStatuses(locale, config.defaultLocale).catch(() => null) : null;
  const toSetUp = [...(statuses?.values() ?? [])].filter((s) => s.state === "setup" || s.state === "error").length;
  const extensions = extensionsBadge({ modulesBehind, toSetUp, unpinnedBadge: menu.unpinnedBadge });
  // Au survol (et pour les lecteurs d'écran), la pastille d'Extensions dit quoi renseigner : « Planning (Adresse du calendrier) ».
  const setupList = nav.flatMap((m) => { const s = statuses?.get(m.id); return s?.state === "setup" && s.missing.length > 0 ? [`${m.name} (${s.missing.map(shortLabel).join(", ")})`] : []; });
  const extensionsLabel = extensions.onlyUpdates ? t("nav.badge.updates") : setupList.length > 0 ? `${t("nav.badge.todo")} — ${t("nav.badge.setupFor", { list: setupList.join(" ; ") })}` : t("nav.badge.todo");
  // Les fiches d'une extension non épinglée restent « sous » l'entrée Extensions.
  const unpinnedPages = nav.filter((m) => !menu.content.includes(m) && !menu.community.items.includes(m)).flatMap((m) => [`/admin/instances/${m.id}`, ...(m.content ? [`/admin/entries?c=${m.key}`] : [])]);

  // Administration : quelles entrées pour ce rôle et ce mode (adminMenu.ts), puis leur lien. Assistants IA : un seul lien, en mode simple comme avancé.
  const adminEntries = administrationEntries({ role: user.level, advanced });
  const adminLinks: Record<AdminEntry, React.ReactNode> = {
    extensions: <NavLink key="extensions" href={EXTENSIONS_HREF} also={["/admin/modules", ...unpinnedPages]} badge={extensions.count} badgeLabel={extensionsLabel}>{t("nav.extensions")}</NavLink>,
    assistants: <NavLink key="assistants" href={ASSISTANTS_HREF} badge={aiWaiting} badgeLabel={t("nav.badge.ai")}>{t("nav.assistants")}</NavLink>,
    users: <NavLink key="users" href="/admin/users">{t("nav.users")}</NavLink>,
    health: <NavLink key="health" href="/admin/maintenance/content">{t("nav.health")}</NavLink>,
    backup: <NavLink key="backup" href="/admin/backup">{t("nav.backup")}</NavLink>,
    updates: <NavLink key="updates" href="/admin/updates" badge={updateAvailable ? 1 : 0} badgeLabel={t("nav.badge.update")}>{t("nav.updates")}</NavLink>,
    audit: <NavLink key="audit" href="/admin/audit">{t("nav.audit")}</NavLink>,
  };

  const group = "mb-1 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-muted";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col md:flex-row">
      <MobileMenu menuLabel={t("nav.menu")} brand={<a href="/admin" className="flex flex-col px-3 leading-tight"><span className="text-lg font-bold">{config.name}</span><span className="text-xs text-muted">{t("nav.adminTagline")}</span></a>}>
        <nav aria-label={t("nav.adminLabel")}>
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
          {canManage && <NavLink href="/admin/appearance">{t("nav.appearance")}</NavLink>}
          {canManage && <NavLink href="/admin/settings">{advanced ? t("nav.settings") : t("nav.settings.simple")}</NavLink>}
          {canManage && <NavLink href="/admin/social">{t("nav.social")}</NavLink>}
          {canManage && <NavLink href="/admin/ai-visibility">{t("nav.aiVisibility")}</NavLink>}
          {editor && <NavLink href="/admin/redirects">{advanced ? t("nav.redirects") : t("nav.redirects.simple")}</NavLink>}

          {adminEntries.length > 0 && (
            <>
              <p className={group}>{t("nav.admin")}</p>
              {adminEntries.map((id) => adminLinks[id])}
            </>
          )}

          <p className={group}>{t("nav.account")}</p>
          <NavLink href="/admin/account">{t("nav.myAccount")}</NavLink>
          <NavLink href="/" external>{t("nav.viewSite")} ↗</NavLink>
        </nav>
        <form action={setAdminMode.bind(null, !advanced)} className="mt-4 px-3">
          <p className="mb-1 text-xs text-muted"><a href="/admin/mode" className="hover:text-accent hover:underline">{advanced ? t("mode.advanced") : t("mode.simple")}</a></p>
          <PendingButton title={t("mode.help")}>{advanced ? t("mode.switchToSimple") : t("mode.switchToAdvanced")}</PendingButton>
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
          <p className="mb-2 truncate text-xs text-muted">{user.name} · {user.level === "none" ? t("role.custom") : t(`role.${user.level}`)}</p>
          <PendingButton pendingLabel={t("progress.signingOut")}>{t("nav.logout")}</PendingButton>
        </form>
      </MobileMenu>
      <main className="min-w-0 flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-4xl">
          {legacyPending && (
            <LegacyBanner title={t("legacy.banner.title")} text={t("legacy.banner.text")} link={can(user, "core:updates") ? t("legacy.banner.link") : null} ownerNote={can(user, "core:updates") ? null : t("legacy.banner.owner")} />
          )}
          <CropLabelsProvider advanced={advanced} labels={Object.fromEntries(CROP_LABEL_KEYS.map((k) => [k, t(`crop.${k}`)]))}><HelpTipProvider label={t("help.tip")}>{children}</HelpTipProvider></CropLabelsProvider></div>
      </main>
      </div>
      {/* Tout en bas de la page, pour tous les rôles et dans les deux modes : crédit exigé par la licence, et numéro de version à donner pour un signalement ou une mise à jour. */}
      <footer className="border-t border-line px-4 py-3 text-center text-xs text-muted" data-testid="app-version">
        {t("site.poweredBy")} <a href={CREDIT_URL} target="_blank" rel="noopener" className={`${wordmark.className} text-[1.15em] underline underline-offset-2 hover:text-fg`}>Curiosa</a> v{readVersion()}
      </footer>
    </div>
  );
}
