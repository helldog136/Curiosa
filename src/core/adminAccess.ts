import { accessGate, can, type AdminUser, type Need } from "./auth/access";
import { ADMIN_ROUTE_SEGMENTS, BUILTIN_VOCABULARY, RESERVED_GROUPS } from "./modules/places";
import { entryHref } from "./adminSidebar";
import { navItemVisible } from "./modules/adminMenu";

// The access table of the administration (admin redesign, C2a, ADR 0011 section 3, rule R35): one list of `{ pattern, need }` that MIRRORS what each page asks of
// `adminCtx(need)`. The sidebar, the dashboard tiles, the shortcuts and the cards of the modules, and the search results ask `canOpen(user, href)` and show a link only
// when it answers yes. Hiding is a convenience, never the protection: every page and every action keeps its own server-side check, and this table never decides
// for them. It is the other way round: `tests/core/admin-access.test.mjs` reads the pages and fails when this table disagrees with a page.
//
// Rules of this file:
//  - It only ever answers with the gate of the page (`accessGate`, the function behind `requireRole`): same ranks, same rights, same two-step and temporary-password rules.
//  - An address it does not know is NOT openable (deny by default). A new page adds its row here, or the scanning test fails.
//  - A page whose gate depends on the data (a module page needs `<module>:open`) is `"instance"`: it opens only when the caller says which module the instance belongs to.

/** What a page asks: a level, any access (`member`), one right, or (an instance page) the `<module>:open` right of the module that owns the instance. */
export type AccessNeed = Need | "instance";

export type AccessRule = {
  /** A path. `:name` = one segment, a trailing `/**` = anything below (or the path itself). Query and hash are ignored. */
  pattern: string;
  need: AccessNeed;
  /** The page lets in a person who has not enrolled the required second step yet (only the account page does). */
  allowUnenrolled?: true;
  /** The sources (relative to `src/app/admin`) whose `adminCtx(...)` calls must say `need`: a page, plus the view components it delegates to. Empty: a redirect to another row. */
  files: readonly string[];
  /** The place pages row: it claims `/admin/<group>/...` only when `<group>` is a real place group (the vocabulary), never a core page segment or a reserved group. */
  place?: true;
};

/** First match wins, most specific first. Keep one rule per line: the test reads this list as data. */
export const ACCESS_RULES: readonly AccessRule[] = [
  { pattern: "/admin", need: "member", files: ["(panel)/page.tsx"] },
  { pattern: "/admin/account", need: "member", allowUnenrolled: true, files: ["(panel)/account/page.tsx"] },
  { pattern: "/admin/mode", need: "member", files: ["(panel)/mode/page.tsx"] },
  { pattern: "/admin/search", need: "member", files: ["(panel)/search/page.tsx"] },
  { pattern: "/admin/home", need: "admin", files: ["(panel)/home/page.tsx"] },
  { pattern: "/admin/navigation/**", need: "admin", files: ["(panel)/navigation/page.tsx", "(panel)/navigation/header/page.tsx"] },
  { pattern: "/admin/social", need: "admin", files: ["(panel)/social/page.tsx"] },
  { pattern: "/admin/appearance/**", need: "admin", files: ["(panel)/appearance/page.tsx", "(panel)/appearance/customize/page.tsx"] },
  { pattern: "/admin/settings/**", need: "admin", files: ["(panel)/settings/page.tsx", "(panel)/settings/address/page.tsx", "(panel)/settings/address/after/page.tsx", "(panel)/settings/rawg-covers/page.tsx"] },
  { pattern: "/admin/redirects/**", need: "editor", files: ["(panel)/redirects/page.tsx", "(panel)/redirects/[id]/page.tsx"] },
  { pattern: "/admin/entries/**", need: "editor", files: ["(panel)/entries/page.tsx", "(panel)/entries/new/page.tsx", "(panel)/entries/[id]/page.tsx", "(panel)/entries/templates/page.tsx"] },
  { pattern: "/admin/drafts", need: "editor", files: ["(panel)/drafts/page.tsx"] },
  { pattern: "/admin/extensions/**", need: "admin", files: ["(panel)/extensions/page.tsx", "(panel)/extensions/add/page.tsx", "(panel)/extensions/add/details/DetailsView.tsx", "(panel)/extensions/personal/page.tsx", "(panel)/extensions/updates/page.tsx"] },
  { pattern: "/admin/modules/**", need: "admin", files: ["(panel)/modules/[id]/ModuleView.tsx"] },
  { pattern: "/admin/instances/:id", need: "instance", files: ["(panel)/instances/[id]/InstanceView.tsx"] },
  { pattern: "/admin/overlay-pages/**", need: "admin", files: ["(panel)/overlay-pages/page.tsx", "(panel)/overlay-pages/obs/page.tsx", "(panel)/overlay-pages/[id]/page.tsx", "(panel)/overlay-pages/[id]/skin/page.tsx"] },
  { pattern: "/admin/users", need: "admin", files: ["(panel)/users/page.tsx"] },
  { pattern: "/admin/users/roles", need: { right: "core:roles" }, files: ["(panel)/users/roles/page.tsx"] },

  { pattern: "/admin/assistants/**", need: { right: "core:mcp.tokens" }, files: ["(panel)/assistants/page.tsx", "(panel)/assistants/[id]/page.tsx"] },
  { pattern: "/admin/setup/assistant", need: { right: "core:mcp.tokens" }, files: ["(auth)/setup/assistant/page.tsx"] },
  { pattern: "/admin/maintenance", need: "member", files: ["(panel)/maintenance/page.tsx"] },
  { pattern: "/admin/maintenance/content", need: "admin", files: ["(panel)/maintenance/content/page.tsx"] },
  { pattern: "/admin/maintenance/legacy", need: { right: "core:updates" }, files: ["(panel)/maintenance/legacy/page.tsx"] },
  { pattern: "/admin/backup", need: { right: "core:backup" }, files: ["(panel)/backup/page.tsx"] },
  { pattern: "/admin/updates", need: { right: "core:updates" }, files: ["(panel)/updates/page.tsx"] },
  { pattern: "/admin/audit", need: { right: "core:security" }, files: ["(panel)/audit/page.tsx"] },
  // Old addresses: redirects to a page above, which asks its own gate (the target is what decides). Same need as the target, so that a menu never offers a dead end.
  { pattern: "/admin/catalogue/**", need: "admin", files: [] },
  { pattern: "/admin/integrations", need: "admin", files: [] },
  { pattern: "/admin/overlays", need: "admin", files: [] },
  { pattern: "/admin/ai-visibility", need: "admin", files: [] },
  { pattern: "/admin/mcp/**", need: { right: "core:mcp.tokens" }, files: [] },
  { pattern: "/admin/maintenance-ia", need: { right: "core:mcp.tokens" }, files: [] },
  // The place pages (docs/PLACES.md): `/admin/<group>/<page>[/<tab>]`. Any member opens the page; each SECTION of it is shown by right (placeIndexFor), so this row is the page, not its sections.
  // (C2b) The index of a group (`/admin/networks` is "Accounts and connections"): any member opens it, and it lists only what this person may open.
  { pattern: "/admin/:group", need: "member", place: true, files: ["(panel)/[group]/page.tsx"] },
  { pattern: "/admin/:group/:page/**", need: "member", place: true, files: ["(panel)/[group]/[page]/[[...tab]]/page.tsx"] },
];

const PUBLIC_SITE = "/";
const BUILTIN_GROUPS: readonly string[] = BUILTIN_VOCABULARY.groups.map((g) => g.id);

/** The path of an address: no query, no hash, no trailing slash, never a protocol-relative or absolute URL. Null when it is not a plain path. */
export function pathOf(href: string): string | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return null;
  const cut = href.search(/[?#]/);
  let p = cut === -1 ? href : href.slice(0, cut);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  // Next matches the DECODED path, the table the raw one: an encoded character (`%62ackup`) could name a page the table reads as another. No admin address needs one
  // (identifiers are plain), so an address with `%` is simply not openable. A dot segment or a control character never names an admin page either.
  if (p.includes("%") || /[\u0000-\u001f\u007f]/.test(p) || p.split("/").some((s) => s === ".." || s === ".")) return null;
  return p;
}

function matches(pattern: string, path: string): boolean {
  const rest = pattern.endsWith("/**");
  const want = (rest ? pattern.slice(0, -3) : pattern).split("/");
  const got = path.split("/");
  if (rest ? got.length < want.length : got.length !== want.length) return false;
  return want.every((w, i) => w.startsWith(":") ? got[i] !== "" : w === got[i]);
}

/** The row of an address, or null when the table does not know it. */
export function ruleFor(href: string, ctx: AccessContext = {}): AccessRule | null {
  const path = pathOf(href);
  if (path === null) return null;
  const group = path.split("/")[2] ?? "";
  const groups = ctx.placeGroups ?? BUILTIN_GROUPS;
  return ACCESS_RULES.find((r) => matches(r.pattern, path) && (!r.place || (groups.includes(group) && !ADMIN_ROUTE_SEGMENTS.includes(group) && !RESERVED_GROUPS.includes(group)))) ?? null;
}

/** What the page at this address asks (null: unknown address, or not an admin page). */
export function needOf(href: string): AccessNeed | null {
  return ruleFor(href)?.need ?? null;
}

/** For an instance page: which module owns the instance (null when unknown). The caller reads it from the installed instances. */
export type AccessContext = { moduleOf?: (instanceId: string) => string | null | undefined; /** The place groups that exist (vocabulary of the site); default: the core's own groups. */ placeGroups?: readonly string[] };

/**
 * May this person open the page at `href`? Exactly the answer of the gate that the page itself applies (`accessGate`, the function behind `requireRole`).
 * Unknown address (or one with an encoded character): no. The public site (`/`): yes (it is public). Never use it instead of the gate of a page or of an action.
 */
export function canOpen(user: AdminUser | null, href: string, ctx: AccessContext = {}): boolean {
  if (pathOf(href) === PUBLIC_SITE) return true;
  const rule = ruleFor(href, ctx);
  if (!rule || !user) return false;
  const opts = rule.allowUnenrolled ? { allowUnenrolled: true } : {};
  if (rule.need !== "instance") return accessGate(user, rule.need, opts) === "ok";
  const path = pathOf(href)!;
  const moduleId = ctx.moduleOf?.(path.split("/")[3] ?? "");
  return typeof moduleId === "string" && moduleId !== "" && accessGate(user, { right: `${moduleId}:open` }, opts) === "ok";
}

/** Keeps the addresses this person may open (the order is kept). */
export function openable<T extends { href: string }>(user: AdminUser | null, items: readonly T[], ctx: AccessContext = {}): T[] {
  return items.filter((i) => canOpen(user, i.href, ctx));
}

/** Which module owns each instance, from the list of installed instances: the context that lets `canOpen` answer for the page of an instance. No right is read here. */
export function ownersOf(items: readonly { id: string; moduleId: string }[], placeGroups?: readonly string[]): AccessContext {
  const owner = new Map(items.map((i) => [i.id, i.moduleId] as const));
  return { moduleOf: (id) => owner.get(id), ...(placeGroups ? { placeGroups } : {}) };
}

/**
 * The entries of the modules this person may open from the menu and the dashboard: the existing rule (`navItemVisible`: `core:entries.edit` for a module with content,
 * `<module>:open` for the others) AND the access table for the address the entry opens. Never more than before: the second test can only remove an entry.
 */
export function openableModuleEntries<T extends { id: string; key: string; content: boolean; moduleId: string }>(user: AdminUser | null, items: readonly T[], ctx: AccessContext): T[] {
  return items.filter((m) => navItemVisible(m, (right) => can(user, right)) && canOpen(user, entryHref(m), ctx));
}
