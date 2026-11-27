# Administration navigation

How the sidebar of `/admin` is built, who sees which entry, and the rules that keep old addresses working. Written for people who change the navigation, add a page to it, or declare a menu entry in a module. The decisions behind it are in [ADR 0011](adr/0011-admin-redesign-vocabulary-menu-and-access.md).

## Addresses: one file

Every administration path lives in `src/core/adminLinks.ts` (constants such as `SETTINGS_HREF`, `ROLES_HREF`, `NETWORKS_HREF`, helpers such as `entriesHref(key)`, `instanceHref(id)`). Pages, actions, redirects, `revalidatePath`, mails and assistant tools import from it. `tests/core/admin-links.test.mjs` fails on a stray `"/admin/..."` literal.

Nothing disappears when a page moves in the menu: the route stays, only the position or the label changes. The administration map (`scripts/admin-map.mjs`, with its ratchet test) lists every page and every old address; a route or a menu entry is never removed unless a change says so in writing.

## One word: "module"

A piece installed from the catalogue is a **module**, in English and in French, in every text a person reads (menu, titles, buttons, journal, mails). "Extension", "plugin", "add-on" and "feature" are retired for that meaning (rule R34 of `docs/ERGONOMIE-ADMIN.md`, checked by `tests/core/r34-retired-terms.test.mjs`). Kept on purpose: the address `/admin/extensions` (and its child routes), translation keys such as `extensions.*`, manifest keys and code identifiers. A reader who finds "extension" in a URL or an identifier is looking at a kept name, not a missed one.

## The shell

The sidebar is 256 px wide and sticky: it keeps the height of the window, its links scroll inside it, and the block at the bottom never leaves the screen. Top to bottom:

1. a skip link ("Skip to content", the first focusable element of every page);
2. the site name and the menu search (`SettingsSearch`: settings and content, filtered by what the person may open);
3. the sections (below);
4. the pinned bottom block: name and role, **My account**, **View site** (opens a new tab and says so), **Report a bug** (one link in the whole admin), **Sign out**.

Every row is at least 44 px tall and has a focus outline. On a phone the same markup opens as a full-height sheet (`MobileMenu`) that the Escape key closes. Icons are thin SVG line icons drawn by `MenuIcon` from `MENU_ICONS` in `src/core/adminSidebar.ts`; emoji stay on cards only. Collapsible sections remember their state in the cookie `curiosa_nav_groups` (read by the server, so the menu does not jump); the section holding the current page opens by itself.

The model of the menu is not in `layout.tsx`: `src/core/adminSidebar.ts` (pure, tested) holds the fixed entries (`SITE_LINKS`, `CONNECTIONS_LINK`, `ADMIN_LINKS`, `ACCOUNT_LINKS`), the icon set, the pin cap (`SECTION_PIN_CAP` = 8, then "More (n)") and the helpers that give the address of a module entry (`entryHref`). The layout loads what the person may see and renders it. `scripts/admin-map.mjs` reads the lists of that file as text: keep one entry per line, in the existing shape.

## The menu tree

| Section | Entries (EN / FR) | Address | Who sees it |
|---|---|---|---|
| (top) | Dashboard / Tableau de bord | `/admin` | any member |
| Content / Contenu | the modules with content (Posts, Pages, Links, Galleries, FAQ…), declared by the modules | `/admin/entries?c=<key>`, `/admin/content/*` | editors, or `<module>:open` |
| Community / Communauté | the modules for the audience (Contacts, Orders, Testimonials…), declared by the modules | `/admin/community/*` | `<module>:open` |
| Tools / Outils | pinned tool modules, then the groups **Live / En direct**, **Calendar / Agenda** and **Overlays** (two entries: **Built-in overlays / Overlays intégrés** and **Overlay pages / Pages d'overlay**) | `/admin/live/*`, `/admin/calendar/*`, `/admin/obs/*`, `/admin/overlay-pages` | administration, or `<module>:open` |
| Site | Home and menu / Accueil et menu; Appearance / Apparence; Settings / Réglages; Short links / Liens courts; **Accounts and connections / Comptes et connexions** | `/admin/home`, `/admin/appearance`, `/admin/settings`, `/admin/redirects`, `/admin/networks` | administration (Short links: editors; Accounts and connections: any member who can open something in it) |
| Administration | Modules; AI assistants / Assistants IA; Team / Équipe; **Roles / Rôles**; Maintenance / Entretien | `/admin/extensions`, `/admin/assistants`, `/admin/users`, `/admin/users/roles`, first tab of Maintenance | each entry by its right (below) |

Reading rules:

- An entry is drawn only when the person can open its page (next section). A section with no visible entry disappears.
- **Accounts and connections** replaces the former Networks group and the Connections section. Its index page (`/admin/networks`, the group page `[group]/page.tsx`) is one table (see below).
- **Live**, **Calendar** and **Overlays** are groups inside **Tools**. A group made of a single page shows that page directly. The Overlays group is the one tree of `buildMenuTree`, drawn by `MenuTreeNav`, like any other group; its core entry « Overlay pages » reaches it as a tree item with the menu path `obs`.
- The names of two entries never share a name or a first word, in both languages (R12, `tests/core/sidebar-groups.test.mjs`). At runtime the later of two clashing entries gets its group as a qualifier (`qualifyLabels`).
- The page title (`h1`), the tab title and the menu entry carry the same name (R36).

## The menu is declared by the modules

A module never draws its own entry. It declares, in its manifest, what it is and where it belongs; the core decides the rest. The keys a module may use for the menu are:

| Key | Effect |
|---|---|
| `place` / `places[]` | the vocabulary page (and tab) where its settings and lists live; the core builds the page and its entry ([PLACES.md](PLACES.md)) |
| `family`, `menuGroup` | the section of its pinned entry (`content`, `community`, `tools`, `connections`); `menuGroup` wins over `family`, which wins over the type (`defaultSection` in `core/modules/menuPlacement.ts`) |
| `adminMenuOrder` | the order inside its group |
| `menuIcon` | the SVG icon of its entry, one key of `MENU_ICONS`; absent, the icon of its section (`entryIconKey`) |
| `rights` | the access it adds (`<module>:open` opens its pages) |
| `dashboard.{tasks, quickActions, cards}` | what it adds to the dashboard; a contribution that targets a core page declares `right` (the kit advises `dashboard.coreLinkRight` when it does not) |

The sidebar never reads the emoji of a module or a free-form `adminMenu` for a new module. A legacy `adminMenu` path (`"Networks.Twitch"`) is mapped to a placement by `defaultPlacement` (`core/modules/adminNav.ts`), and the group titles it may name live in `KNOWN_GROUPS` (`core/modules/menuPath.ts`, both languages, R12). All these keys are additive: an older core ignores unknown keys, so they need no `minCore`. A brick that a module consumes does need one. Full contract: [MODULES.md](MODULES.md) ("Menu path", "Places").

A module that places everything it shows (all its settings and lists sit on place pages) leaves the sidebar; its own page stays reachable from **Modules** (dual mode, see [PLACES.md](PLACES.md)). The modules that keep their own entry (blog, pages, links…) are pinned entries of their section, one link per module.

## Who sees what: one access table

`src/core/adminAccess.ts` holds one table, `ACCESS_RULES`: a list of `{ pattern, need, files }`, one rule per line, first match wins, most specific first. It **mirrors** what each page asks of `adminCtx(need)`. `canOpen(user, href)` answers with the very gate the page applies (`accessGate`, the function behind `requireRole`), so ranks, rights, the second step and temporary passwords behave the same.

- The sidebar, the dashboard (numbers, tasks, shortcuts, module cards), the search results and the "Accounts and connections" index all ask `canOpen` and draw a link only when the answer is yes. `openable(user, items)` filters a list; `openableModuleEntries` applies the module rule (`core:entries.edit` for a module with content, `<module>:open` otherwise) and then the table, so the table can only remove an entry.
- An address the table does not know is **not** openable (deny by default). An address with an encoded character, a dot segment or a control character is refused. The public site (`/`) is always openable.
- `"instance"` is the need of `/admin/instances/:id`: it opens only when the caller says which module owns the instance (`ownersOf`), and then needs `<module>:open`.
- The place pages are one rule (`place: true`): any member opens the page, and each section is shown by right. The rule applies only when the first segment is a real place group, never a core page segment or a reserved group.
- Old addresses (`/admin/catalogue`, `/admin/mcp`…) have a row with the need of their target and no files: they redirect, and the target decides.

**The page stays the authority.** `tests/core/admin-access.test.mjs` reads every `src/app/admin/**/page.tsx` (and the view files each rule lists) and fails when an `adminCtx(...)` call says something other than the table. **A new admin page adds its row to `ACCESS_RULES`, or that test fails.** Hiding an entry is a convenience, never the protection: every page and every action keeps its own server-side check.

| Level | Sees |
|---|---|
| owner | everything |
| coordination | everything except what is reserved to the owner |
| administration | the pages that need `admin`, plus the rights granted |
| editorial | dashboard, entries and drafts, short links, the modules it holds `<module>:open` for, its account |
| custom role | exactly the pages whose right it holds; the others vanish from the menu and the dashboard |

When a person opens a page they cannot open (an old link, a bookmark), the notice names what is missing and who to ask (`denied.*` texts: "Reserved to Administration. Ask Administration for access.", "This page needs the access “Backup”…") instead of a generic banner on the dashboard.

## Roles: a first-class area

**Roles / Rôles** has its own sidebar entry under Administration, near **Team / Équipe**, and its own address, `/admin/users/roles` (right `core:roles`). The Team page (`/admin/users`) and the Roles page share a link tab bar, **Team | Roles** (`LinkTabs`, current tab `team` or `roles`; the Roles tab appears only with `core:roles`). The old client tab `/admin/users#roles` still works: the Team page maps the hash to the new address with `LegacyHash`. The add-person dialog carries a "Manage roles" link.

The Roles page lists every role with its people count, offers create, rename, duplicate and delete (a deletion names a replacement role, as before), and shows the **access matrix** (`RightsMatrix`): roles as columns, rights as rows folded by area, with a shape and a hidden word for each state. A right that is reserved to the owner is never delegable there. Presets are plain starting points of the "Create a role" form; once created, a role is an ordinary custom role with no hidden link to its preset.

## Accounts and connections: one table

`/admin/networks` (child routes kept) is the index of the group "Accounts and connections". Every account (a profile address) and every connection (a module that connects to a service) is **one row of one table** (rule R30, `ConnectionsTable`): the origin as a coloured and written pill (Connection / Address), the state as a pill (**Configured / Configuré**, **Degraded / Dégradé**, **Not configured / Non configuré**, with the reason and the way out for the last two), live search, quick filters with their counts, and one button per row whose verb depends on the state (Edit, Fix, Set up). Rows that need attention come first. A row produced by another page opens that page instead of an edit window. Editing an address opens a dialog (`EditDialog`). The table is built from the place sections of the page (`classifySections`, `components/admin/connectionsLoad.tsx`): a section that is one single address becomes a row, everything else stays a card or a "page" row with a link. The vocabulary asks for this layout with `layout: "table"` (see [PLACES.md](PLACES.md)); the core fixes it for its own page (`TABLE_PAGES`).

## One entry, several pages: the tab bar

Some entries open a page with a **tab bar made of links** (`components/admin/LinkTabs.tsx`, server-rendered, no script, at least 44 px targets, wrapping instead of scrolling on a phone). Each tab keeps its own route, so nothing is redirected and every bookmark, mail and tool message keeps working. The sidebar entry stays highlighted on all its pages (`NavLink` `also`).

| Entry (EN / FR) | Tabs (EN / FR) | Route of each tab | Who sees the tab |
|---|---|---|---|
| Maintenance / Entretien | Health check / Contrôle du site | `/admin/maintenance/content` | administration, coordination, owner |
| | Backup / Sauvegarde | `/admin/backup` | `core:backup` |
| | Updates / Mises à jour | `/admin/updates` | `core:updates` |
| | Leftovers / Restes | `/admin/maintenance/legacy` | `core:updates` |
| | Activity log / Journal d'activité | `/admin/audit` | `core:security`, advanced mode only |
| Home and menu / Accueil et menu | Home / Accueil | `/admin/home` | administration, owner |
| | Menu / Menu | `/admin/navigation` | administration, owner |
| | Link and button / Lien et bouton | `/admin/navigation/header` | administration, owner |
| | Social buttons / Boutons de réseaux | `/admin/social` | administration, owner |
| Team and roles | Team / L'équipe | `/admin/users` | `core:team` |
| | Roles / Rôles | `/admin/users/roles` | `core:roles` |
| Modules | Installed / Installés; Add / Ajouter; Updates / Mises à jour; My catalogues / Mes catalogues (advanced) | `/admin/extensions`, `/admin/extensions/add`, `/admin/extensions/updates`, `/admin/extensions/personal` | administration (Add and Updates: `core:modules.install`) |

- **Maintenance.** The model is `maintenanceTabs({ role, advanced })` in `core/modules/adminMenu.ts` (pure, tested); the bar is `MaintenanceHeader`. The entry exists as soon as the person has one tab and links to the first tab they have. Each tab shows one state and one main action; `TabIntro` gives the tab's one-line purpose (the tab bar already names the page, so the heading is kept for screen readers). The restore of a backup is a separate danger card (`RestoreDanger`).
- **Home and menu.** Four link tabs (`HomeMenuHeader`; addresses are `HOME_MENU_TAB_HREFS`), not client tabs: the home builder, the menu editor and the social catalogue are heavy. "Link and button" used to be a client tab of the menu page; `LegacyHash` maps `#header` (menu and settings pages) to it. The pages are titled "Site menu"; "Social buttons" links to Accounts and connections.
- **Modules.** The catalogue ("Add") shows what can be added first: installed modules sit behind a switch with their count (`ShowInstalledSwitch`) and modules this version of Curiosa cannot take yet are folded with a link to update. The module page (`/admin/modules/<id>`) and the instance page (`/admin/instances/<id>`) keep their tabs and are never redirected.

Module updates stay under **Modules**; the Updates tab of Maintenance links to them from its "Modules" card.

## Settings: one entry, tabs inside one page

`/admin/settings` is one page with client tabs (`components/admin/Tabs.tsx`); the open tab lives in the address as a hash, so `/admin/settings#privacy` opens that tab. Choices of two to four options are side-by-side buttons (`Segmented`), and the tabs that save together use the sticky bar at the bottom (`StickyActionBar`).

| Tab (EN / FR) | Hash | Notes |
|---|---|---|
| Name and logo / Nom et logo | `#site` | the site presentation is folded |
| Languages / Langues | `#languages` | |
| Privacy / Confidentialité | `#privacy` | |
| Search / Recherche | `#search` | |
| Background sound / Son de fond | `#sound` | |
| AI visibility / Visibilité dans les IA | `#ai` | was its own entry and page; rendered in a `Suspense` |
| E-mail | `#mail` | owner only |
| Web address / Adresse web | `#address` | advanced mode only; shows the address and a button to the guided steps |

Old addresses: `/admin/ai-visibility` redirects to `/admin/settings#ai`. `/admin/settings/address`, `/admin/settings/address/after` and `/admin/settings/rawg-covers` keep their route (linked from mails, docs and modules). A server redirect cannot see a `#`, so moved tabs use `components/admin/LegacyHash.tsx`.

## Place pages

Modules that declare **places** ([PLACES.md](PLACES.md)) get pages built by the core at `/admin/<group>/<page>[/<tab>]` (route `src/app/admin/(panel)/[group]/[page]/[[...tab]]/page.tsx`). The layout turns every visible place page into a tree item (`placeItems` in `layout.tsx`) and gives it to `buildMenuTree` with the module entries: a place group with a section id (`content`, `community`, `tools`) joins that section; `live`, `calendar` and `obs` join Tools; `networks` is the index of Accounts and connections. Core pages are registered as places (`BUILTIN_VOCABULARY`) but keep their own entries and addresses. Group ids must never equal a first segment of `/admin/...` (`ADMIN_ROUTE_SEGMENTS`, kept in sync by `tests/core/places.test.mjs`): **adding a new top-level admin route means adding it to that list.**

## Preferences in My account

The admin mode (simple or advanced) and the admin theme (auto, light, dark) are set in the **Preferences** panel of `/admin/account` (`AdminPreferences`), not in the sidebar. Each choice is a button in its own form (`setAdminMode`, `setAdminTheme` in `(panel)/mode/actions.ts`), so it works without a script. The mode is stored on the account; the theme is a cookie of the browser. `/admin/mode` explains the difference and is linked from the panel. "My account" opens with a list of links to each of its sections. The sign-in pages (sign in, invitation, forgot or reset password, first password, no access) share one frame, `AuthShell`.

## First run: three screens, then "Getting started"

The setup wizard (`/admin/setup`) asks for three things on three screens: language and first name, the name of the site, e-mail and password. The restore of a backup, the install code and the owner-once guard are unchanged. It no longer offers starting profiles, suggested modules, sample pages or first links (the code in `core/modules/starter.ts` and `profiles.ts` is kept; none of the three screens offers it).

What the wizard used to ask moves to the **Getting started** list of the dashboard (`core/dashboard/setup.ts`, drawn with `ChecklistCard`): the steps are computed from facts the site already knows, and the two optional ones, **choosing modules** and **connecting an AI assistant** (`/admin/setup/assistant`, right `core:mcp.tokens`), are shown and counted but never keep the list open on their own. The list disappears when every required step is done or when the person hides it.

## Routes that are not tabs and must never be redirected

`/api/admin/backup`, `/api/admin/backup/restore`, `/api/admin/backup/restore/apply` (backup handlers), `/api/admin/upload`, `/api/admin/skin-custom/upload`, `/admin/overlay-pages/<id>/preview` (the preview), and the detail pages `/admin/modules/<id>`, `/admin/instances/<id>`.

## Adding a page

1. Add the route to `adminLinks.ts` (or reuse the existing one).
2. Add its row to `ACCESS_RULES` in `src/core/adminAccess.ts`, with the same need as the page's `adminCtx(...)` and the page file in `files`. `tests/core/admin-access.test.mjs` fails otherwise.
3. If it is a new top-level segment, add it to `ADMIN_ROUTE_SEGMENTS` (`core/modules/places.ts`).
4. Give it a title that is the name of its menu entry (R36), a one-line purpose (R1) and an entry in the model (`adminSidebar.ts`) if it has one. Names are never shared with another entry (R12).
5. Add it to the administration map (`scripts/admin-map.mjs`) if the ratchet test asks.

## Adding a tab

1. Add the route to `adminLinks.ts` (or reuse the existing one) and to the tab model, and its row to `ACCESS_RULES`.
2. Render the shared header at the top of the page; give the page's own title `level={2}` (`PageHeader`) so the page has one `h1`.
3. Add the tab name (EN and FR, same keys) under `maint.tab.*` or the keys of its entry; short, no colon, never the same name as another sidebar entry (R12).
4. Add the page to `tests/core/maintenance-tabs.test.mjs` (or the test of its entry).
