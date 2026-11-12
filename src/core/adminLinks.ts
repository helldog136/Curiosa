/**
 * Every address of the administration, in one place. Pages, actions, e-mails, MCP messages and the dashboard build their links from here:
 * no admin path is written anywhere else (tests/core/admin-links.test.mjs scans the sources and fails on a stray literal).
 *
 * Pure logic, no dependency (safe in server and client code). The pages of the Extensions section and of the AI assistants section keep
 * their own helpers (`modules/extensionsLinks.ts`, `services/mcp/assistantsLinks.ts`), which are built on the constants below.
 *
 * Why one file: the navigation is being compacted (several entries become tabs of one page). A moved page keeps its old address, which
 * redirects to the new place; the address a link points to is changed here, once.
 */

/** Query values as Next.js hands them to a page. */
export type RawQuery = Record<string, string | string[] | undefined>;

/** Builds `path?a=1&b=2`, dropping empty values. An array value repeats the parameter. */
export function withQuery(path: string, query: Record<string, string | number | boolean | readonly string[] | null | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) for (const one of v) params.append(k, String(one));
    else params.append(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const seg = (id: string): string => encodeURIComponent(id);

// ── Sign-in and first start (outside the panel) ────────────────────────────────────────────────────────────────────────
/** The admin start page (dashboard). */
export const ADMIN_HREF = "/admin";
export const LOGIN_HREF = "/admin/login";
export const SETUP_HREF = "/admin/setup";
export const SETUP_ASSISTANT_HREF = "/admin/setup/assistant";
export const CHOOSE_PASSWORD_HREF = "/admin/choose-password";
export const NO_ACCESS_HREF = "/admin/no-access";
/** The dashboard, with the notice that the right was refused. */
export const DENIED_HREF = "/admin?denied=1";
export const BUG_REPORT_HREF = "/admin/bug-report";

// ── Site ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const HOME_HREF = "/admin/home";
export const NAVIGATION_HREF = "/admin/navigation";
export const APPEARANCE_HREF = "/admin/appearance";
export const SETTINGS_HREF = "/admin/settings";
export const SETTINGS_ADDRESS_HREF = "/admin/settings/address";
export const SETTINGS_ADDRESS_AFTER_HREF = "/admin/settings/address/after";
// `/admin/settings/rawg-covers` (published by modules, "Not the right game?" links) keeps working: it is a route file, not a constant.
export const SOCIAL_HREF = "/admin/social";
/** Old address of "AI visibility" (now a tab of the settings): kept, it redirects to SETTINGS_AI_HREF. */
export const AI_VISIBILITY_HREF = "/admin/ai-visibility";
export const REDIRECTS_HREF = "/admin/redirects";

/** Anchors inside pages (a server redirect cannot see a `#`, see components/admin/LegacyHash). */
export const SETTINGS_SITE_HREF = `${SETTINGS_HREF}#site`;
export const SETTINGS_LANGUAGES_HREF = `${SETTINGS_HREF}#languages`;
export const SETTINGS_AI_HREF = `${SETTINGS_HREF}#ai`;
export const SETTINGS_ADDRESS_TAB_HREF = `${SETTINGS_HREF}#address`;
export const SETTINGS_PRIVACY_HREF = `${SETTINGS_HREF}#privacy`;
export const APPEARANCE_FONTS_HREF = `${APPEARANCE_HREF}#polices`;
/** The "Link and button" tab of the Home and menu entry (it used to be a client tab of the menu page: `/admin/navigation#header` is mapped here). */
export const NAVIGATION_HEADER_HREF = `${NAVIGATION_HREF}/header`;

/**
 * The tabs of the "Home and menu" entry, in display order. Each tab keeps its own address (no redirect): the sidebar entry and the tab bar link to these.
 * The three pages are heavy (home builder, menu editor, social catalogue), so they are link tabs, never client tabs that would render all panels at once.
 */
export const HOME_MENU_TAB_HREFS = { home: HOME_HREF, menu: NAVIGATION_HREF, header: NAVIGATION_HEADER_HREF, social: SOCIAL_HREF } as const;

// ── Administration ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const OVERLAY_PAGES_HREF = "/admin/overlay-pages";
export const USERS_HREF = "/admin/users";
export const ACCOUNT_HREF = "/admin/account";
/** The account page, asking the person to set up two-step sign-in. */
export const ACCOUNT_ENROLL_HREF = "/admin/account?need2fa=1";
export const MODE_HREF = "/admin/mode";
export const BACKUP_HREF = "/admin/backup";
export const UPDATES_HREF = "/admin/updates";
/** Site health (content check). */
export const HEALTH_HREF = "/admin/maintenance/content";
/** Leftovers of older versions (the "Upkeep" page). */
export const UPKEEP_HREF = "/admin/maintenance/legacy";
export const AUDIT_HREF = "/admin/audit";
/**
 * The tabs of the Maintenance entry, in display order. Each tab keeps its own address (no redirect): the sidebar entry and the tab bar link to these.
 * Not tabs, and never to be redirected: /admin/backup/restore and /admin/backup/route (handlers), /admin/upload, the overlay preview.
 */
export const MAINTENANCE_TAB_HREFS = { health: HEALTH_HREF, backup: BACKUP_HREF, updates: UPDATES_HREF, upkeep: UPKEEP_HREF, audit: AUDIT_HREF } as const;
export const DRAFTS_HREF = "/admin/drafts";
/** The storage card of the dashboard. */
export const STORAGE_HREF = "/admin#storage";

// ── Content, modules, instances ────────────────────────────────────────────────────────────────────────────────────────
export const ENTRIES_HREF = "/admin/entries";
export const EXTENSIONS_HREF = "/admin/extensions";
export const MODULES_HREF = "/admin/modules";
export const EXTENSIONS_ADD_HREF = `${EXTENSIONS_HREF}/add`;
export const EXTENSIONS_ADD_DETAILS_HREF = `${EXTENSIONS_ADD_HREF}/details`;
export const EXTENSIONS_UPDATES_HREF = `${EXTENSIONS_HREF}/updates`;
export const ASSISTANTS_HREF = "/admin/assistants";

// ── Old addresses that redirect to their new place (the route files stay: see legacyExtensionsTarget, legacyAssistantsTarget) ──
export const CATALOGUE_LEGACY_HREF = "/admin/catalogue";
export const INTEGRATIONS_LEGACY_HREF = "/admin/integrations";
export const OVERLAYS_LEGACY_HREF = "/admin/overlays";
export const MCP_LEGACY_HREF = "/admin/mcp";
export const MAINTENANCE_IA_LEGACY_HREF = "/admin/maintenance-ia";

/** The entries of a collection (module instance key), with optional filters (`state`, `q`…). */
export const entriesHref = (collectionKey: string, extra: Record<string, string | undefined> = {}): string => withQuery(ENTRIES_HREF, { c: collectionKey, ...extra });
/** The form for a new entry of a collection. */
export const entryNewHref = (collectionKey: string): string => withQuery(`${ENTRIES_HREF}/new`, { c: collectionKey });
/** The templates of a collection. */
export const entryTemplatesHref = (collectionKey: string): string => withQuery(`${ENTRIES_HREF}/templates`, { c: collectionKey });
/** One entry, optionally in a given language or with a notice (`created`). */
export const entryHref = (entryId: string, extra: Record<string, string | undefined> = {}): string => withQuery(`${ENTRIES_HREF}/${seg(entryId)}`, extra);
/** The settings page of one module instance. `?x=y` keeps working through `instanceHref(id, "?x=y")`: pass the raw suffix of an action result. */
export const instanceHref = (instanceId: string, query: Record<string, string | undefined> | string = {}): string => {
  const base = `/admin/instances/${seg(instanceId)}`;
  if (typeof query === "string") return query === "" || query === "?" ? base : `${base}${query.startsWith("?") ? query : `?${query}`}`;
  return withQuery(base, query);
};
/** The page of one installed module (all its instances). */
export const moduleHref = (moduleId: string, query: Record<string, string | undefined> = {}): string => withQuery(`${MODULES_HREF}/${seg(moduleId)}`, query);
/** One short link. */
export const redirectHref = (redirectId: string, query: Record<string, string | undefined> = {}): string => withQuery(`${REDIRECTS_HREF}/${seg(redirectId)}`, query);
/** The short links page, with optional search/view parameters. */
export const redirectsHref = (query: Record<string, string | undefined> = {}): string => withQuery(REDIRECTS_HREF, query);
/** One overlay page (its editor), and its preview (a real handler: never redirect it). */
export const overlayPageHref = (pageId: string): string => `${OVERLAY_PAGES_HREF}/${seg(pageId)}`;
export const overlayPagePreviewHref = (pageId: string, query: Record<string, string | undefined> = {}): string => withQuery(`${overlayPageHref(pageId)}/preview`, query);
/** The skin tab of an overlay page (default skin, skin per context rules), the list of known context values (JSON, for the picker) and the sample page of a skin (a real handler). */
export const overlayPageSkinHref = (pageId: string, query: Record<string, string | undefined> = {}): string => withQuery(`${overlayPageHref(pageId)}/skin`, query);
export const overlayPageValuesHref = (pageId: string): string => `${overlayPageHref(pageId)}/skin/values`;
/** Preview image of a catalogue overlay skin, served by the site itself (never from a third-party site). */
export const overlaySkinPreviewHref = (skinId: string): string => `${OVERLAY_PAGES_HREF}/skin-preview/${seg(skinId)}`;
export const overlaySkinSampleHref = (skinId: string): string => `${OVERLAY_PAGES_HREF}/skin-sample/${seg(skinId)}`;

/** True for a path inside the administration (`/admin` or `/admin/…`, never `//host`). Used to accept a redirect target that comes from a module. */
export function isAdminPath(to: string): boolean {
  return (to === ADMIN_HREF || to.startsWith("/admin/") || to.startsWith("/admin?")) && !to.startsWith("//");
}
