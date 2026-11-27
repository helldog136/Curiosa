import { ACCOUNT_HREF, ADMIN_HREF, APPEARANCE_HREF, ASSISTANTS_HREF, HEALTH_HREF, HOME_HREF, MAINTENANCE_TAB_HREFS, MODULES_HREF, NAVIGATION_HEADER_HREF, NAVIGATION_HREF, NETWORKS_HREF, REDIRECTS_HREF, ROLES_HREF, SETTINGS_HREF, SOCIAL_HREF, USERS_HREF, EXTENSIONS_HREF, entriesHref, instanceHref } from "./adminLinks";
import type { MaintenanceTab, SidebarAdminEntry } from "./modules/adminMenu";
import type { MenuSectionId } from "./modules/menuPlacement";

// The model of the administration sidebar (admin redesign, C1c): everything the menu says that does not depend on a database, as plain data and pure functions.
// The layout (`src/app/admin/(panel)/layout.tsx`) loads what the person may see and renders; this file decides what each entry is (label key, address, linked
// addresses, icon, who sees it). Access filtering (C2a) and the map of the administration (`scripts/admin-map.mjs`, which READS the lists below as text:
// keep one entry per line, in this exact shape) both consume it.

// ─── Icons ──────────────────────────────────────────────────────────────────

/**
 * Line icons of the menu, 24 x 24, stroke only (drawn by `MenuIcon`). A module picks one with `menuIcon` in its manifest; the core entries have their own.
 * The paths are data, so a test can check that every key draws something.
 */
export const MENU_ICONS = {
  dash: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  doc: ["M7 3h7l4 4v14H7z", "M14 3v4h4", "M9.5 12h6", "M9.5 16h6"],
  link: ["M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1", "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"],
  img: ["M4 5h16v14H4z", "M4 16l5-5 4 4 3-3 4 4", "M9 9.5h.01"],
  users: ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6", "M16 4.3a3.5 3.5 0 0 1 0 6.4", "M18 14.4c2.2.7 3.5 2.6 3.5 5.6"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"],
  tv: ["M3 6h18v12H3z", "M8 21h8", "M12 18v3"],
  video: ["M3 6h13v12H3z", "M16 10l5-3v10l-5-3"],
  radio: ["M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z", "M7.8 7.8a6 6 0 0 0 0 8.4", "M16.2 7.8a6 6 0 0 1 0 8.4", "M4.9 4.9a10 10 0 0 0 0 14.2", "M19.1 4.9a10 10 0 0 1 0 14.2"],
  calendar: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4"],
  layers: ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10", "M10 20v-6h4v6"],
  star: ["M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2l-5.6 3 1.1-6.2L3 9.6l6.2-.9z"],
  sliders: ["M4 7h10", "M18 7h2", "M4 17h2", "M10 17h10", "M16 5v4", "M8 15v4"],
  shield: ["M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"],
  box: ["M12 3l8 4.5v9L12 21l-8-4.5v-9z", "M4 7.5l8 4.5 8-4.5", "M12 12v9"],
  chat: ["M4 5h16v11H9l-5 4z"],
  wrench: ["M15 5a4 4 0 0 0-5 5l-6.5 6.5a2 2 0 0 0 3 3L13 13a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"],
  globe: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3 12h18", "M12 3c3 3 3 15 0 18", "M12 3c-3 3-3 15 0 18"],
  cart: ["M3 4h3l2 11h10l2-8H7", "M9 20h.01", "M17 20h.01"],
  info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 11v5", "M12 8h.01"],
  plug: ["M9 3v5", "M15 3v5", "M6 8h12v3a6 6 0 0 1-12 0z", "M12 17v4"],
  folder: ["M3 6h6l2 2h10v11H3z"],
  plus: ["M12 5v14", "M5 12h14"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
  logout: ["M9 4H4v16h5", "M16 8l4 4-4 4", "M20 12H9"],
  bug: ["M8 8h8v6a4 4 0 0 1-8 0z", "M12 8V5", "M4 11h4", "M16 11h4", "M5 18l3-2", "M19 18l-3-2"],
  chevron: ["M6 9l6 6 6-6"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M20 20l-4-4"],
} as const;

export type MenuIconKey = keyof typeof MENU_ICONS;
export const MENU_ICON_KEYS = Object.keys(MENU_ICONS) as [MenuIconKey, ...MenuIconKey[]];
export const isMenuIcon = (v: unknown): v is MenuIconKey => typeof v === "string" && Object.prototype.hasOwnProperty.call(MENU_ICONS, v);

/** The icon of a section of pinned modules, when the module does not choose one. */
export const SECTION_ICON: Record<MenuSectionId, MenuIconKey> = { content: "doc", community: "users", tools: "wrench", connections: "plug" };

/** The icon of a group of the module tree ("live", "calendar"...); any other group gets a folder. */
const GROUP_ICON: Record<string, MenuIconKey> = { content: "doc", community: "users", tools: "wrench", connections: "plug", live: "radio", calendar: "calendar", obs: "video" };
export const groupIconKey = (id: string): MenuIconKey => GROUP_ICON[id] ?? "folder";

/** The icon of a pinned module entry: its own `menuIcon` when valid, else the one of its section. */
export const entryIconKey = (menuIcon: unknown, section: MenuSectionId): MenuIconKey => (isMenuIcon(menuIcon) ? menuIcon : SECTION_ICON[section]);

// ─── Core entries ───────────────────────────────────────────────────────────

/** Who sees a fixed entry: any member, an editor and above, or an administrator and above. The Administration entries are filtered by `administrationEntries` (adminMenu.ts). */
export type SidebarNeed = "member" | "editor" | "admin";
export type SidebarLink = { id: string; /** Locale key of the label. */ label: string; href: string; also: readonly string[]; icon: MenuIconKey; need: SidebarNeed; exact?: true; external?: true; /** Fragments of the same page that belong to ANOTHER entry (the page is not "this entry" while one of them is open): the Team entry on the Roles tab. */ exceptHash?: readonly string[] };

// One entry per line, in this shape: scripts/admin-map.mjs reads these lists as text.
export const DASHBOARD_LINK = { id: "dashboard", label: "nav.dashboard", href: ADMIN_HREF, also: [], icon: "dash", need: "member", exact: true } as const satisfies SidebarLink;

export const SITE_LINKS = [
  { id: "homeMenu", label: "nav.homeMenu", href: HOME_HREF, also: [NAVIGATION_HREF, NAVIGATION_HEADER_HREF, SOCIAL_HREF], icon: "home", need: "admin" },
  { id: "appearance", label: "nav.appearance", href: APPEARANCE_HREF, also: [], icon: "star", need: "admin" },
  { id: "settings", label: "nav.settings", href: SETTINGS_HREF, also: [], icon: "sliders", need: "admin" },
  { id: "redirects", label: "nav.redirects", href: REDIRECTS_HREF, also: [], icon: "link", need: "editor" },
] as const satisfies readonly SidebarLink[];

/**
 * (C2b) Accounts and connections, the last entry of "Site": the index of the network pages and of the connection modules (it replaces the Networks group and the Connections section).
 * It is shown only when the index has something this person may open (the layout decides), so a person without a connection never sees an empty page.
 */
export const CONNECTIONS_LINK = { id: "connections", label: "nav.accounts", href: NETWORKS_HREF, also: [], icon: "plug", need: "member" } as const satisfies SidebarLink;

/** The Administration entries, by their id in adminMenu.ts. Maintenance points at its first visible tab and owns every tab address (`tabs`). */
export const ADMIN_LINKS = {
  extensions: { id: "extensions", label: "nav.extensions", href: EXTENSIONS_HREF, also: [MODULES_HREF], icon: "box", need: "member" },
  assistants: { id: "assistants", label: "nav.assistants", href: ASSISTANTS_HREF, also: [], icon: "chat", need: "member" },
  users: { id: "users", label: "nav.users", href: USERS_HREF, also: [], icon: "users", need: "member", exceptHash: ["roles"] },
  roles: { id: "roles", label: "nav.roles", href: ROLES_HREF, also: [], icon: "shield", need: "member" },
  maintenance: { id: "maintenance", label: "nav.maintenance", href: HEALTH_HREF, also: [], tabs: true, icon: "wrench", need: "member" },
} as const satisfies Record<SidebarAdminEntry, SidebarLink & { tabs?: true }>;

/** The account block pinned at the bottom of the sidebar (the sign-out button and the bug report link sit beside them, see `FOOTER_ACTIONS`). */
export const ACCOUNT_LINKS = [
  { id: "myAccount", label: "nav.myAccount", href: ACCOUNT_HREF, also: [], icon: "user", need: "member" },
  { id: "viewSite", label: "nav.viewSite", href: "/", also: [], icon: "external", need: "member", external: true },
] as const satisfies readonly SidebarLink[];

/** Fixed entries of "Site" that this person sees. */
export function siteLinks(role: { canManage: boolean; editor: boolean }): SidebarLink[] {
  return SITE_LINKS.filter((l) => (l.need === "admin" ? role.canManage : l.need === "editor" ? role.editor : true));
}

/** One Administration entry, ready to render: Maintenance opens its first visible tab and is "current" on every tab; Extensions also owns the pages of the modules that are not pinned. */
export function adminLink(id: SidebarAdminEntry, ctx: { tabs: readonly MaintenanceTab[]; unpinnedPages: readonly string[] }): SidebarLink {
  const l: SidebarLink & { tabs?: true } = ADMIN_LINKS[id];
  if (l.tabs) {
    const tabHrefs = ctx.tabs.map((t) => MAINTENANCE_TAB_HREFS[t]);
    return { ...l, href: tabHrefs[0] ?? HEALTH_HREF, also: tabHrefs };
  }
  return id === "extensions" ? { ...l, also: [...l.also, ...ctx.unpinnedPages] } : l;
}

// ─── Entries of the modules ─────────────────────────────────────────────────

/** What the sidebar needs to know about an entry that comes from a module (an instance) or from a place page. */
export type EntryLike = { id: string; key?: string; content?: boolean; href?: string; place?: true };

/** The address of an entry: a place page has its own; a module with content opens its list of entries; any other opens its page. */
export function entryHref(m: EntryLike): string {
  return m.place === true && m.href ? m.href : m.content ? entriesHref(m.key ?? "") : instanceHref(m.id);
}
/** Other addresses that make the entry "current" (the page of a module with content). */
export function entryAlso(m: EntryLike): string[] {
  return m.place === true ? [] : m.content ? [instanceHref(m.id)] : [];
}
/** Every address of an entry: the one it opens and those that make it current. */
export function entryTargets(m: EntryLike): string[] {
  return [entryHref(m), ...entryAlso(m)];
}

/** Pinned entries shown in a section before « More (n) » takes the rest (the one you are on is never hidden: the group opens by itself). */
export const SECTION_PIN_CAP = 8;
export function capEntries<T>(items: readonly T[], cap: number = SECTION_PIN_CAP): { shown: T[]; more: T[] } {
  return items.length <= cap + 1 ? { shown: [...items], more: [] } : { shown: items.slice(0, cap), more: items.slice(cap) };
}

/** Addresses of the pages of the modules that are not in the menu: they stay "under" the Extensions entry. */
export function unpinnedPageTargets(unpinned: readonly (EntryLike & { key: string })[]): string[] {
  return unpinned.flatMap((m) => [instanceHref(m.id), ...(m.content ? [entriesHref(m.key)] : [])]);
}

// ─── Collapsible groups ─────────────────────────────────────────────────────

/** Ids of the fixed collapsible sections of the sidebar in the cookie of remembered state (the groups of the module tree have their own `g-…` ids). `connections` keeps the id it always had. */
export const SECTION_STATE_ID = { content: "content", community: "community", tools: "tools", connections: "connections", site: "site", admin: "admin" } as const;
/** Sections that start collapsed (until the person opens them, or the page you are on is inside). */
export const SECTIONS_CLOSED_BY_DEFAULT: readonly string[] = ["connections"];
/** The « More (n) » fold of a section: its own remembered state, closed until used. */
export const moreStateId = (section: string): string => `more-${section}`;

// ─── Account footer ─────────────────────────────────────────────────────────

/** The first letter of a name, for the round mark of the account block ("?" when there is none). */
export function initialOf(name: string): string {
  const c = [...name.trim()][0];
  return c ? c.toLocaleUpperCase() : "?";
}
