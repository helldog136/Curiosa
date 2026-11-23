import { signOut } from "@/auth";
import { CuriosaMark } from "@/components/brand/CuriosaMark";
import { CodeCopyProvider } from "@/components/site/CodeBlock";
import { codeCopyLabels } from "@/components/site/codeCopyLabels";
import { adminCtx } from "@/core/admin";
import { adminBugReportUrl } from "@/core/bugReport";
import { BugReportLink } from "@/components/admin/BugReportLink";
import { maintenanceSummary } from "@/core/maintenance/summary";
import { legacyConversionPending } from "@/core/modules/legacyReport";
import { legacyUpkeepSummary } from "@/core/modules/legacyUpkeep";
import { LegacyBanner } from "@/components/admin/LegacyBanner";
import { TwinOfferNotice } from "@/components/admin/TwinOfferNotice";
import { dismissTwinOfferAction, applyMatchingOverlaySkinAction } from "./overlay-pages/twinActions";
import { OVERLAY_NEED } from "@/core/overlays/access";
import { liveTwinState } from "@/core/overlays/twinState";
import { pendingTwinOffer } from "@/core/overlays/twinOffer";
import { NavLink } from "@/components/admin/NavLink";
import { NavGroup } from "@/components/admin/NavGroup";
import { MenuTreeNav } from "@/components/admin/MenuTreeNav";
import { buildMenuTree, nodeEntries, type TreeItem } from "@/core/modules/menuPath";
import { fullyPlacedInstances, placeIndexFor } from "@/core/modules/placesLoad";
import { placeBadges, qualifyLabels } from "@/core/modules/places";
import { SettingsSearch } from "@/components/admin/SettingsSearch";
import { settingsSearchLabels } from "@/components/admin/settingsSearchLabels";
import { NAV_STATE_COOKIE, buildMenuLayout, extensionsBadge, parseNavState } from "@/core/modules/menuPlacement";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { shortLabel } from "@/core/modules/missingSettings";
import { getAdminNav } from "@/core/modules/adminNav";
import { SIDEBAR_R12_KEYS, administrationEntries, maintenanceTabs, navItemVisible, type AdminEntry } from "@/core/modules/adminMenu";
import { overlaysUseful } from "@/core/overlays/presence";
import { can, hasRole } from "@/core/auth/access";
import { ASSISTANTS_HREF } from "@/core/services/mcp/assistantsLinks";
import { getUpdateCheck, readVersion } from "@/core/updates/service";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { MobileMenu } from "@/components/admin/MobileMenu";
import { CropLabelsProvider } from "@/components/admin/CropLabels";
import { HelpTipProvider } from "@/components/admin/HelpTip";
import { CROP_LABEL_KEYS } from "@/components/admin/cropLabelKeys";
import { cookies } from "next/headers";
import { PendingButton } from "@/components/admin/PendingButton";
import { ACCOUNT_HREF, ADMIN_HREF, APPEARANCE_HREF, HEALTH_HREF, HOME_HREF, LOGIN_HREF, MAINTENANCE_TAB_HREFS, MODULES_HREF, NAVIGATION_HEADER_HREF, NAVIGATION_HREF, OVERLAY_PAGES_HREF, REDIRECTS_HREF, SETTINGS_HREF, SOCIAL_HREF, USERS_HREF, entriesHref, instanceHref } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  // Tout accès suffit pour entrer (un rôle personnalisé peut n'ouvrir qu'un module) ; chaque page vérifie ensuite son propre palier ou droit.
  const { user, t, locale, config, advanced } = await adminCtx("member");
  // Le menu ne montre que ce que cette personne peut ouvrir (droit relu en base à chaque requête).
  // (0.31.0) A module that places everything it shows (docs/PLACES.md) leaves the sidebar: its place pages replace its own entry (its page stays in Extensions).
  const placedAway = await fullyPlacedInstances();
  // (0.47.0) The matching overlay skin, offered once after the site skin changed (one setting read when nothing is pending).
  const twin = hasRole(user, OVERLAY_NEED) ? await pendingTwinOffer(liveTwinState, locale).catch(() => null) : null;
  const allNav = (await getAdminNav(locale, config.defaultLocale)).filter((m) => navItemVisible(m, (right) => can(user, right)));
  const nav = allNav.filter((m) => !placedAway.has(m.id));
  // (0.31.0) Place pages: one entry per page with at least one section this person sees, in the groups of the vocabulary (core pages keep their own entries).
  const placeIndex = await placeIndexFor(user, advanced, locale, config.defaultLocale);
  type PlaceItem = TreeItem & { href: string; place: true; badgeTip: string };
  // (0.34.0) The badge of a module (`adminBadge`) is carried onto every place page that hosts one of its sections: a module that placed everything has no entry of its own.
  const instanceBadge = new Map(allNav.map((m) => [m.id, m.badge] as const));
  const carried = placeBadges(placeIndex, (instanceId) => instanceBadge.get(instanceId) ?? 0);
  const placeItems: PlaceItem[] = placeIndex.groups.flatMap((g) => g.pages.filter((p) => !p.core).map((p, i) => ({
    id: `place:${p.id}`, name: p.title, badge: carried.get(p.id)?.count ?? 0, badgeKeys: carried.get(p.id)?.keys, badgeTip: carried.get(p.id)?.modules.join(" ; ") ?? "", error: false, placement: "menu", menuPath: [{ id: g.id, text: g.title }], menuOrder: i, connector: false,
    groupLabels: { [g.id]: { en: g.title, fr: g.title } }, moduleId: "", href: p.href, place: true as const,
  })));
  const editor = hasRole(user, "editor");
  const canManage = hasRole(user, "admin");
  const updateAvailable = can(user, "core:updates") && (await getUpdateCheck().catch(() => null))?.available === true;
  // Modules en retard : jamais d'attente du réseau ici (menu de toutes les pages) ; la vérification se fait en arrière-plan et reste en mémoire quelques minutes.
  const modulesBehind = can(user, "core:modules.install") ? (peekModulesReport()?.outdated.length ?? 0) : 0;
  const aiWaiting = can(user, "core:mcp.tokens") ? (await maintenanceSummary().catch(() => null))?.total ?? 0 : 0;
  // Garde du démarrage (0.2.0) : un AVERTISSEMENT seulement si la mise à niveau des données n'est pas terminée (le site public reste servi, jamais bloqué : la mise à niveau reprend à chaque démarrage).
  const legacyPending = canManage ? await legacyConversionPending() : false;
  // Entretien : la pastille du menu ne compte que ce que la personne a À FAIRE ; une copie de sécurité gardée a son propre état (jamais une alerte).
  const upkeep = can(user, "core:updates") ? await legacyUpkeepSummary() : null;
  const bugUrl = await adminBugReportUrl(t);
  const menu = buildMenuLayout(nav);
  // (0.13.0) Entries whose module declares a menu path (`adminMenu`) leave their section for their own groups; without any, `tree` is empty and the sidebar is unchanged.
  type Entry = (typeof nav)[number] | PlaceItem;
  const tree = buildMenuTree<Entry>([...nav, ...placeItems], locale);
  const treeItems = [...Object.values(tree.sections).flatMap((n) => (n ? nodeEntries(n) : [])), ...tree.groups.flatMap(nodeEntries)];
  const navState = parseNavState((await cookies()).get(NAV_STATE_COOKIE)?.value);
  const isPlace = (m: Entry): m is PlaceItem => "place" in m;
  const entryHref = (m: Entry) => (isPlace(m) ? m.href : m.content ? entriesHref(m.key) : instanceHref(m.id));
  const entryAlso = (m: Entry) => (isPlace(m) ? [] : m.content ? [instanceHref(m.id)] : []);
  const entryText = (m: Entry) => (isPlace(m) ? q(m.id, m.name) : `${m.icon} ${q(m.id, m.name)}`);
  const badgeText = (m: Entry) => (isPlace(m) && m.badgeTip ? `${t("nav.badge.todo")} — ${m.badgeTip}` : t("nav.badge.todo"));
  const entryLink = (m: Entry) => <NavLink key={m.id} href={entryHref(m)} also={entryAlso(m)} badge={m.badge} badgeLabel={badgeText(m)}>{entryText(m)}</NavLink>;
  const treeTargets = (m: Entry) => [entryHref(m), ...entryAlso(m)];
  const treeEntryLink = (m: Entry) => <NavLink key={m.id} touch href={entryHref(m)} also={entryAlso(m)} badge={m.badge} badgeLabel={badgeText(m)}>{entryText(m)}</NavLink>;
  // (0.31.0) A group made of one place page shows that page directly, without a heading.
  const treeNodes = (nodes: typeof tree.groups) => nodes.map((n) => (n.children.length === 0 && n.entries.length === 1 && isPlace(n.entries[0]!)
    ? <div key={n.id} data-testid={`nav-tree-${n.id}`}>{entryLink(n.entries[0]!)}</div>
    : <MenuTreeNav key={n.id} node={n} state={navState} targets={treeTargets} renderEntry={treeEntryLink} badgeLabel={t("nav.badge.todo")} />));
  // Extensions : les mises à jour de modules, les modules à régler (à configurer ou en erreur) et les pastilles des modules qui ne sont pas épinglés au menu y remontent.
  const statuses = canManage ? await loadInstanceStatuses(locale, config.defaultLocale).catch(() => null) : null;
  const toSetUp = [...(statuses?.values() ?? [])].filter((s) => s.state === "setup" || s.state === "error").length;
  const extensions = extensionsBadge({ modulesBehind, toSetUp, unpinnedBadge: menu.unpinnedBadge });
  // Au survol (et pour les lecteurs d'écran), la pastille d'Extensions dit quoi renseigner : « Planning (Adresse du calendrier) ».
  const setupList = nav.flatMap((m) => { const s = statuses?.get(m.id); return s?.state === "setup" && s.missing.length > 0 ? [`${m.name} (${s.missing.map(shortLabel).join(", ")})`] : []; });
  const extensionsLabel = extensions.onlyUpdates ? t("nav.badge.updates") : setupList.length > 0 ? `${t("nav.badge.todo")} — ${t("nav.badge.setupFor", { list: setupList.join(" ; ") })}` : t("nav.badge.todo");
  // Les fiches d'une extension non épinglée restent « sous » l'entrée Extensions.
  const shown = new Set<Entry>([...menu.content, ...menu.community, ...menu.tools, ...menu.connections, ...treeItems]);
  const unpinnedPages = allNav.filter((m) => !shown.has(m)).flatMap((m) => [instanceHref(m.id), ...(m.content ? [entriesHref(m.key)] : [])]);

  // Administration : quelles entrées pour ce rôle et ce mode (adminMenu.ts), puis leur lien. Assistants IA : un seul lien, en mode simple comme avancé.
  const adminEntries = administrationEntries({ role: user.level, advanced, overlays: canManage ? await overlaysUseful() : false });
  // Entretien : une seule entrée pour le contrôle du site, la sauvegarde, les mises à jour, les restes d'anciennes versions et le journal d'activité ; la pastille additionne mise à jour disponible et restes à traiter.
  const maintenanceTabList = maintenanceTabs({ role: user.level, advanced });
  const maintenanceBadge = (maintenanceTabList.includes("updates") && updateAvailable ? 1 : 0) + (maintenanceTabList.includes("upkeep") && upkeep?.state === "todo" ? upkeep.todo : 0);
  // (0.31.0) R12 at runtime: no two sidebar entries share a name or a first word; the later one gets its group as a qualifier (places.ts `qualifyLabels`).
  const r12: { id: string; label: string; group: string }[] = [];
  const K = SIDEBAR_R12_KEYS;
  for (const id of ["content", "community", "tools"] as const) {
    const extra = tree.sections[id];
    for (const m of [...menu[id], ...(extra ? nodeEntries(extra) : [])]) r12.push({ id: m.id, label: m.name, group: t(K.sections[id]) });
  }
  for (const n of tree.groups) for (const m of nodeEntries(n)) r12.push({ id: m.id, label: m.name, group: n.title });
  for (const m of [...menu.connections, ...(tree.sections.connections ? nodeEntries(tree.sections.connections) : [])]) r12.push({ id: m.id, label: m.name, group: t(K.sections.connections) });
  for (const [id, key] of K.site.entries) r12.push({ id: `core:${id}`, label: t(key), group: t(K.site.heading) });
  for (const id of adminEntries) r12.push({ id: `core:${id}`, label: t(K.admin.entries[id]), group: t(K.admin.heading) });
  for (const [id, key] of K.account.entries) r12.push({ id: `core:${id}`, label: t(key), group: t(K.account.heading) });
  const qualified = qualifyLabels(r12).labels;
  function q(id: string, text: string): string { return qualified.get(id) ?? text; }

  const adminLinks: Record<AdminEntry, React.ReactNode> = {
    extensions: <NavLink key="extensions" href={EXTENSIONS_HREF} also={[MODULES_HREF, ...unpinnedPages]} badge={extensions.count} badgeLabel={extensionsLabel}>{t("nav.extensions")}</NavLink>,
    overlays: <NavLink key="overlays" href={OVERLAY_PAGES_HREF}>{q("core:overlays", t("nav.overlayPages"))}</NavLink>,
    assistants: <NavLink key="assistants" href={ASSISTANTS_HREF} badge={aiWaiting} badgeLabel={t("nav.badge.ai")}>{t("nav.assistants")}</NavLink>,
    users: <NavLink key="users" href={USERS_HREF}>{t("nav.users")}</NavLink>,
    maintenance: <NavLink key="maintenance" href={maintenanceTabList.length > 0 ? MAINTENANCE_TAB_HREFS[maintenanceTabList[0]!] : HEALTH_HREF} also={maintenanceTabList.map((id) => MAINTENANCE_TAB_HREFS[id])} badge={maintenanceBadge} badgeLabel={t("nav.badge.maintenance")}>{t("nav.maintenance")}</NavLink>,
  };

  const group = "mb-1 mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-muted";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col md:flex-row">
      <MobileMenu menuLabel={t("nav.menu")} brand={<a href={ADMIN_HREF} className="flex flex-col px-3 leading-tight"><span className="text-lg font-bold">{config.name}</span><span className="text-xs text-muted">{t("nav.adminTagline")}</span></a>}>
        <nav aria-label={t("nav.adminLabel")}>
          <div className="mt-4 px-1"><SettingsSearch variant="menu" labels={settingsSearchLabels(t)} endpoint="/api/admin/settings-search" contentEndpoint={hasRole(user, "editor") ? "/api/admin/content-search" : undefined} advancedMode={advanced} /></div>
          <div className="mt-3"><NavLink href={ADMIN_HREF} exact>{t("nav.dashboard")}</NavLink></div>
          {([["content", menu.content], ["community", menu.community], ["tools", menu.tools]] as const).map(([id, items]) => {
            const extra = tree.sections[id];
            return (items.length > 0 || extra) && (
              <div key={id} data-testid={`nav-section-${id}`}>
                <p className={group}>{t(`nav.${id}`)}</p>
                {items.map(entryLink)}
                {extra?.entries.map(treeEntryLink)}
                {extra && treeNodes(extra.children)}
              </div>
            );
          })}
          {tree.groups.length > 0 && (
            <div className="mt-6" data-testid="nav-tree">
              {treeNodes(tree.groups)}
            </div>
          )}
          {(menu.connections.length > 0 || tree.sections.connections) && (
            <div className="mt-6" data-testid="nav-section-connections">
              <NavGroup id="connections" title={t("nav.connections")} targets={[...menu.connections.flatMap(treeTargets), ...(tree.sections.connections ? nodeEntries(tree.sections.connections).flatMap(treeTargets) : [])]} stored={navState.connections} openByDefault={false} badge={menu.connections.reduce((n, m) => n + m.badge, 0) + (tree.sections.connections?.badge ?? 0)} badgeLabel={t("nav.badge.todo")}>
                {menu.connections.map(entryLink)}
                {tree.sections.connections?.entries.map(treeEntryLink)}
                {tree.sections.connections && treeNodes(tree.sections.connections.children)}
              </NavGroup>
            </div>
          )}

          <p className={group}>{t("nav.site")}</p>
          {canManage && <NavLink href={HOME_HREF} also={[NAVIGATION_HREF, NAVIGATION_HEADER_HREF, SOCIAL_HREF]}>{t("nav.homeMenu")}</NavLink>}
          {canManage && <NavLink href={APPEARANCE_HREF}>{t("nav.appearance")}</NavLink>}
          {canManage && <NavLink href={SETTINGS_HREF}>{t("nav.settings")}</NavLink>}
          {editor && <NavLink href={REDIRECTS_HREF}>{t("nav.redirects")}</NavLink>}

          {adminEntries.length > 0 && (
            <>
              <p className={group}>{t("nav.admin")}</p>
              {adminEntries.map((id) => adminLinks[id])}
            </>
          )}

          <p className={group}>{t("nav.account")}</p>
          <NavLink href={ACCOUNT_HREF}>{t("nav.myAccount")}</NavLink>
          <NavLink href="/" external>{t("nav.viewSite")} ↗</NavLink>
        </nav>
        <p className="mt-4 px-3"><BugReportLink href={bugUrl}>🐞 {t("bugReport.link")} ↗</BugReportLink></p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: LOGIN_HREF });
          }}
          className="mt-6 px-3"
        >
          <p className="mb-2 truncate text-xs text-muted">{user.name} · {user.level === "none" ? t("role.custom") : t(`role.${user.level}`)}</p>
          <PendingButton pendingLabel={t("progress.signingOut")}>{t("nav.logout")}</PendingButton>
        </form>
      </MobileMenu>
      <main className="min-w-0 flex-1 p-6 md:p-10">
        {/* Une page qui a besoin de largeur (l'éditeur de pages d'overlay) porte data-admin-wide : la zone de contenu s'élargit alors, sans toucher aux autres pages. */}
        <div className="mx-auto max-w-4xl has-[[data-admin-wide]]:max-w-[112rem]">
          {legacyPending && (
            <LegacyBanner title={t("legacy.banner.title")} text={t("legacy.banner.text")} link={can(user, "core:updates") ? t("legacy.banner.link") : null} ownerNote={can(user, "core:updates") ? null : t("legacy.banner.owner")} />
          )}
          {twin && <TwinOfferNotice text={t("appearance.twin.line", { name: twin.name })} button={t("appearance.twin.use")} dismiss={t("appearance.twin.later")} apply={applyMatchingOverlaySkinAction.bind(null, twin.skin)} notNow={dismissTwinOfferAction} />}
          <CropLabelsProvider advanced={advanced} labels={Object.fromEntries(CROP_LABEL_KEYS.map((k) => [k, t(`crop.${k}`)]))}><HelpTipProvider label={t("help.tip")}><CodeCopyProvider labels={codeCopyLabels(t)}>{children}</CodeCopyProvider></HelpTipProvider></CropLabelsProvider></div>
      </main>
      </div>
      {/* Tout en bas de la page, pour tous les rôles et dans les deux modes : crédit exigé par la licence, et numéro de version à donner pour un signalement ou une mise à jour. */}
      <footer className="border-t border-line px-4 py-3 text-center text-xs text-muted" data-testid="app-version">
        {t("site.poweredBy")} <CuriosaMark newTab /> v{readVersion()}
      </footer>
    </div>
  );
}
