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
import { loadInstanceStatuses } from "@/core/modules/integrations";
import { shortLabel } from "@/core/modules/missingSettings";
import { getAdminNav } from "@/core/modules/adminNav";
import { OVERLAY_CUSTOM_ORDER, SIDEBAR_R12_KEYS, administrationEntries, maintenanceTabs, navItemVisible, type SidebarAdminEntry } from "@/core/modules/adminMenu";
import { overlaysUseful } from "@/core/overlays/presence";
import { can, hasRole } from "@/core/auth/access";
import { getUpdateCheck, readVersion } from "@/core/updates/service";
import { peekModulesReport } from "@/core/modules/updateStatus";
import { MobileMenu } from "@/components/admin/MobileMenu";
import { ADMIN_MAIN_ID, SkipLink } from "@/components/admin/SkipLink";
import { CropLabelsProvider } from "@/components/admin/CropLabels";
import { HelpTipProvider } from "@/components/admin/HelpTip";
import { CROP_LABEL_KEYS } from "@/components/admin/cropLabelKeys";
import { cookies } from "next/headers";
import { PendingButton } from "@/components/admin/PendingButton";
import { MenuIcon } from "@/components/admin/MenuIcon";
import { ACCOUNT_LINKS, DASHBOARD_LINK, SECTION_STATE_ID, SECTIONS_CLOSED_BY_DEFAULT, adminLink, capEntries, entryAlso, entryHref, entryIconKey, entryTargets, groupIconKey, initialOf, moreStateId, siteLinks, unpinnedPageTargets, type MenuIconKey, type SidebarLink } from "@/core/adminSidebar";
import { ADMIN_HREF, LOGIN_HREF, OVERLAY_PAGES_HREF } from "@/core/adminLinks";

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
  type PlaceItem = TreeItem & { icon: MenuIconKey; href: string; place: true; badgeTip: string; /** The full title of a place page (its sidebar name may be shorter inside a group); absent on a core entry. */ fullName?: string };
  // (0.34.0) The badge of a module (`adminBadge`) is carried onto every place page that hosts one of its sections: a module that placed everything has no entry of its own.
  const instanceBadge = new Map(allNav.map((m) => [m.id, m.badge] as const));
  const carried = placeBadges(placeIndex, (instanceId) => instanceBadge.get(instanceId) ?? 0);
  const placeItems: PlaceItem[] = placeIndex.groups.flatMap((g) => g.pages.filter((p) => !p.core).map((p, i) => ({
    id: `place:${p.id}`, icon: groupIconKey(g.id), name: p.menuTitle, fullName: p.title, badge: carried.get(p.id)?.count ?? 0, badgeKeys: carried.get(p.id)?.keys, badgeTip: carried.get(p.id)?.modules.join(" ; ") ?? "", error: false, placement: "menu", menuPath: [{ id: g.id, text: g.title }], menuOrder: i, connector: false,
    groupLabels: { [g.id]: { en: g.title, fr: g.title } }, moduleId: "", href: p.href, place: true as const,
  })));
  const editor = hasRole(user, "editor");
  const canManage = hasRole(user, "admin");
  // Administration: which entries this role and mode get (adminMenu.ts). (0.49.0) The custom overlay pages are not listed there any more: they are the « Custom » entry of the Overlays group, next to the ready-made page of the catalogue.
  const allAdminEntries = administrationEntries({ role: user.level, advanced, overlays: canManage ? await overlaysUseful() : false });
  const adminEntries = allAdminEntries.filter((id): id is SidebarAdminEntry => id !== "overlays");
  // The core entry joins the group `obs` through the same tree as the place pages and the module paths; the group exists only while one entry is visible (nothing visible, no group).
  const overlayCustom: PlaceItem[] = allAdminEntries.includes("overlays")
    ? [{ id: "core:overlays", name: t("nav.overlayCustom"), icon: "layers" as const, badge: 0, error: false, placement: "menu", menuPath: [{ id: "obs", text: "obs" }], menuOrder: OVERLAY_CUSTOM_ORDER, connector: false, moduleId: "", href: OVERLAY_PAGES_HREF, place: true as const, badgeTip: "" }]
    : [];
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
  const tree = buildMenuTree<Entry>([...nav, ...placeItems, ...overlayCustom], locale);
  const treeItems = [...Object.values(tree.sections).flatMap((n) => (n ? nodeEntries(n) : [])), ...tree.groups.flatMap(nodeEntries)];
  const navState = parseNavState((await cookies()).get(NAV_STATE_COOKIE)?.value);
  const isPlace = (m: Entry): m is PlaceItem => "place" in m;
  const badgeText = (m: Entry) => (isPlace(m) && m.badgeTip ? `${t("nav.badge.todo")} — ${m.badgeTip}` : t("nav.badge.todo"));
  const iconOf = (m: Entry): MenuIconKey => (isPlace(m) ? m.icon : entryIconKey(m.menuIcon, m.section));
  const entryLink = (m: Entry) => <NavLink key={m.id} icon={iconOf(m)} href={entryHref(m)} also={entryAlso(m)} badge={m.badge} badgeLabel={badgeText(m)}>{q(m.id, m.name)}</NavLink>;
  const treeTargets = entryTargets;
  // (0.31.0) A group made of one place page shows that page directly, without a heading, under its full title (0.49.0). A core entry (« Custom ») keeps its group, so it is never alone without its context.
  const alone = (n: (typeof tree.groups)[number]) => n.children.length === 0 && n.entries.length === 1 && isPlace(n.entries[0]!) && n.entries[0]!.fullName !== undefined;
  const treeNodes = (nodes: typeof tree.groups) => nodes.map((n) => (alone(n)
    ? <div key={n.id} data-testid={`nav-tree-${n.id}`}>{entryLink({ ...(n.entries[0] as PlaceItem), name: (n.entries[0] as PlaceItem).fullName! })}</div>
    : <MenuTreeNav key={n.id} node={n} state={navState} targets={treeTargets} renderEntry={entryLink} badgeLabel={t("nav.badge.todo")} />));
  // Extensions : les mises à jour de modules, les modules à régler (à configurer ou en erreur) et les pastilles des modules qui ne sont pas épinglés au menu y remontent.
  const statuses = canManage ? await loadInstanceStatuses(locale, config.defaultLocale).catch(() => null) : null;
  const toSetUp = [...(statuses?.values() ?? [])].filter((s) => s.state === "setup" || s.state === "error").length;
  const extensions = extensionsBadge({ modulesBehind, toSetUp, unpinnedBadge: menu.unpinnedBadge });
  // Au survol (et pour les lecteurs d'écran), la pastille d'Extensions dit quoi renseigner : « Planning (Adresse du calendrier) ».
  const setupList = nav.flatMap((m) => { const s = statuses?.get(m.id); return s?.state === "setup" && s.missing.length > 0 ? [`${m.name} (${s.missing.map(shortLabel).join(", ")})`] : []; });
  const extensionsLabel = extensions.onlyUpdates ? t("nav.badge.updates") : setupList.length > 0 ? `${t("nav.badge.todo")} — ${t("nav.badge.setupFor", { list: setupList.join(" ; ") })}` : t("nav.badge.todo");
  // Les fiches d'une extension non épinglée restent « sous » l'entrée Extensions.
  const shown = new Set<Entry>([...menu.content, ...menu.community, ...menu.tools, ...menu.connections, ...treeItems]);
  const unpinnedPages = unpinnedPageTargets(allNav.filter((m) => !shown.has(m)));

  // Administration : les liens des entrées calculées plus haut. Assistants IA : un seul lien, en mode simple comme avancé.
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
  for (const n of tree.groups) for (const m of nodeEntries(n)) r12.push({ id: m.id, label: alone(n) ? (m as PlaceItem).fullName! : m.name, group: n.title });
  for (const m of [...menu.connections, ...(tree.sections.connections ? nodeEntries(tree.sections.connections) : [])]) r12.push({ id: m.id, label: m.name, group: t(K.sections.connections) });
  for (const [id, key] of K.site.entries) r12.push({ id: `core:${id}`, label: t(key), group: t(K.site.heading) });
  for (const id of adminEntries) r12.push({ id: `core:${id}`, label: t(K.admin.entries[id]), group: t(K.admin.heading) });
  for (const [id, key] of K.account.entries) r12.push({ id: `core:${id}`, label: t(key), group: t(K.account.heading) });
  const qualified = qualifyLabels(r12).labels;
  function q(id: string, text: string): string { return qualified.get(id) ?? text; }

  const adminBadges: Record<SidebarAdminEntry, { count: number; label: string }> = {
    extensions: { count: extensions.count, label: extensionsLabel },
    assistants: { count: aiWaiting, label: t("nav.badge.ai") },
    users: { count: 0, label: "" },
    maintenance: { count: maintenanceBadge, label: t("nav.badge.maintenance") },
  };
  const coreLink = (l: SidebarLink, badge?: { count: number; label: string }) => (
    <NavLink key={l.id} href={l.href} also={[...l.also]} icon={l.icon} badge={badge?.count ?? 0} badgeLabel={badge?.label} {...(l.exact ? { exact: true } : {})} {...(l.external ? { external: true, newTabLabel: t("nav.newTab") } : {})}>{t(l.label)}</NavLink>
  );
  const stateOf = (id: keyof typeof SECTION_STATE_ID) => navState[SECTION_STATE_ID[id]];
  const openDefault = (id: keyof typeof SECTION_STATE_ID) => !SECTIONS_CLOSED_BY_DEFAULT.includes(SECTION_STATE_ID[id]);
  const siteList = siteLinks({ canManage, editor });
  const adminList = adminEntries.map((id) => ({ id, link: adminLink(id, { tabs: maintenanceTabList, unpinnedPages }) }));
  const targetsOf = (ls: readonly { href: string; also: readonly string[] }[]) => ls.flatMap((l) => [l.href, ...l.also]);
  const sectionBadge = (items: Entry[], extra?: { badge: number }) => items.reduce((n, m) => n + m.badge, 0) + (extra?.badge ?? 0);

  const roleLabel = user.level === "none" ? t("role.custom") : t(`role.${user.level}`);
  const rowCls = "flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-[15px] transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink label={t("nav.skip")} />
      <div className="flex flex-1 flex-col md:flex-row">
      <MobileMenu
        menuLabel={t("nav.menu")}
        brand={<a href={ADMIN_HREF} className="flex min-w-0 flex-col px-3 leading-tight"><span className="truncate text-lg font-bold">{config.name}</span><span className="text-xs text-muted">{t("nav.adminTagline")}</span></a>}
        search={<SettingsSearch variant="menu" labels={settingsSearchLabels(t)} endpoint="/api/admin/settings-search" contentEndpoint={hasRole(user, "editor") ? "/api/admin/content-search" : undefined} advancedMode={advanced} />}
        footer={(
          <div role="group" aria-label={t("nav.account")}>
            <div className="mb-1 flex items-center gap-3 px-3 py-1">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-tint text-sm font-bold text-accent-text">{initialOf(user.name)}</span>
              <p className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold">{user.name}</span><span className="block truncate text-xs text-muted">{roleLabel}</span></p>
            </div>
            {ACCOUNT_LINKS.map((l) => coreLink(l))}
            <BugReportLink href={bugUrl} className={rowCls} title={t("bugReport.help")}><MenuIcon name="bug" />{t("bugReport.link")}<span className="sr-only"> ({t("nav.newTab")})</span></BugReportLink>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: LOGIN_HREF });
              }}
              className="mt-1"
            >
              <PendingButton pendingLabel={t("progress.signingOut")} className="w-full">{t("nav.logout")}</PendingButton>
            </form>
          </div>
        )}
      >
        <nav aria-label={t("nav.adminLabel")} className="pt-2">
          {coreLink(DASHBOARD_LINK)}
          {([["content", menu.content], ["community", menu.community], ["tools", menu.tools]] as const).map(([id, items]) => {
            const extra = tree.sections[id];
            if (items.length === 0 && !extra) return null;
            const { shown: first, more } = capEntries<Entry>(items);
            const targets = [...items.flatMap(treeTargets), ...(extra ? nodeEntries(extra).flatMap(treeTargets) : [])];
            return (
              <div key={id} data-testid={`nav-section-${id}`}>
                <NavGroup id={SECTION_STATE_ID[id]} title={t(`nav.${id}`)} icon={groupIconKey(id)} targets={targets} stored={stateOf(id)} openByDefault={openDefault(id)} badge={sectionBadge(items, extra)} badgeLabel={t("nav.badge.todo")}>
                  {first.map(entryLink)}
                  {more.length > 0 && (
                    <NavGroup id={moreStateId(id)} plain title={t("nav.more", { n: more.length })} icon="plus" targets={more.flatMap(treeTargets)} stored={navState[moreStateId(id)]} openByDefault={false} badge={sectionBadge(more)} badgeLabel={t("nav.badge.todo")}>
                      {more.map(entryLink)}
                    </NavGroup>
                  )}
                  {extra?.entries.map(entryLink)}
                  {extra && treeNodes(extra.children)}
                </NavGroup>
              </div>
            );
          })}
          {tree.groups.length > 0 && (
            <div data-testid="nav-tree">
              {treeNodes(tree.groups)}
            </div>
          )}
          {(menu.connections.length > 0 || tree.sections.connections) && (
            <div data-testid="nav-section-connections">
              <NavGroup id="connections" title={t("nav.connections")} icon="plug" targets={[...menu.connections.flatMap(treeTargets), ...(tree.sections.connections ? nodeEntries(tree.sections.connections).flatMap(treeTargets) : [])]} stored={navState.connections} openByDefault={false} badge={menu.connections.reduce((n, m) => n + m.badge, 0) + (tree.sections.connections?.badge ?? 0)} badgeLabel={t("nav.badge.todo")}>
                {menu.connections.map(entryLink)}
                {tree.sections.connections?.entries.map(entryLink)}
                {tree.sections.connections && treeNodes(tree.sections.connections.children)}
              </NavGroup>
            </div>
          )}

          {siteList.length > 0 && (
            <div data-testid="nav-section-site">
              <NavGroup id={SECTION_STATE_ID.site} title={t("nav.site")} icon="globe" targets={targetsOf(siteList)} stored={stateOf("site")} openByDefault badgeLabel="">
                {siteList.map((l) => coreLink(l))}
              </NavGroup>
            </div>
          )}

          {adminList.length > 0 && (
            <div data-testid="nav-section-admin">
              <NavGroup id={SECTION_STATE_ID.admin} title={t("nav.admin")} icon="shield" targets={targetsOf(adminList.map((a) => a.link))} stored={stateOf("admin")} openByDefault badge={adminList.reduce((n, a) => n + adminBadges[a.id].count, 0)} badgeLabel={t("nav.badge.todo")}>
                {adminList.map(({ id, link }) => coreLink(link, adminBadges[id]))}
              </NavGroup>
            </div>
          )}
        </nav>
      </MobileMenu>
      <div className="flex min-w-0 flex-1 flex-col">
      <main id={ADMIN_MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 p-6 outline-none md:p-10">
        {/* Une page qui a besoin de largeur (l'éditeur de pages d'overlay) porte data-admin-wide : la zone de contenu s'élargit alors, sans toucher aux autres pages. */}
        <div className="mx-auto max-w-4xl has-[[data-admin-wide]]:max-w-[112rem]">
          {legacyPending && (
            <LegacyBanner title={t("legacy.banner.title")} text={t("legacy.banner.text")} link={can(user, "core:updates") ? t("legacy.banner.link") : null} ownerNote={can(user, "core:updates") ? null : t("legacy.banner.owner")} />
          )}
          {twin && <TwinOfferNotice text={t("appearance.twin.line", { name: twin.name })} button={t("appearance.twin.use")} dismiss={t("appearance.twin.later")} apply={applyMatchingOverlaySkinAction.bind(null, twin.skin)} notNow={dismissTwinOfferAction} />}
          <CropLabelsProvider advanced={advanced} labels={Object.fromEntries(CROP_LABEL_KEYS.map((k) => [k, t(`crop.${k}`)]))}><HelpTipProvider label={t("help.tip")}><CodeCopyProvider labels={codeCopyLabels(t)}>{children}</CodeCopyProvider></HelpTipProvider></CropLabelsProvider></div>
      </main>
      {/* Tout en bas de la page, pour tous les rôles et dans les deux modes : crédit exigé par la licence, et numéro de version à donner pour un signalement ou une mise à jour. */}
      <footer className="border-t border-line px-4 py-3 text-center text-xs text-muted" data-testid="app-version">
        {t("site.poweredBy")} <CuriosaMark newTab /> v{readVersion()}
      </footer>
      </div>
      </div>
    </div>
  );
}
