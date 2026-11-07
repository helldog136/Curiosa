# Administration navigation

How the sidebar of `/admin` is built, and the rules that keep old addresses working. Written for people who change the navigation or add a page to it.

## Addresses: one file

Every administration path lives in `src/core/adminLinks.ts` (constants such as `SETTINGS_HREF`, helpers such as `entriesHref(key)`, `instanceHref(id)`). Pages, actions, redirects, `revalidatePath`, mails and assistant tools import from it. `tests/core/admin-links.test.mjs` fails on a stray `"/admin/..."` literal.

## One entry, several pages: the tab bar

Some entries of the sidebar open a page with a **tab bar made of links** (`components/admin/LinkTabs.tsx`, server-rendered, no script). Each tab keeps its own route, so nothing is redirected and every bookmark, mail and tool message keeps working. The sidebar entry stays highlighted on all its pages (`NavLink` `also`).

| Entry (EN / FR) | Tabs (EN / FR) | Route of each tab | Who sees the tab |
|---|---|---|---|
| Maintenance / Entretien | Health check / Contrôle du site | `/admin/maintenance/content` | administration, coordination, owner |
| | Backup / Sauvegarde | `/admin/backup` | `core:backup` |
| | Updates / Mises à jour | `/admin/updates` | `core:updates` |
| | Leftovers / Restes | `/admin/maintenance/legacy` | `core:updates` |
| | Activity log / Journal d'activité | `/admin/audit` | `core:security`, advanced mode only |

The model is `maintenanceTabs({ role, advanced })` in `core/modules/adminMenu.ts` (pure, tested); the bar is `components/admin/MaintenanceHeader.tsx`. The entry exists as soon as the person has one tab, and links to the first tab they have. Its badge adds "update available" and the number of leftovers to deal with.

Module updates (`/admin/extensions/updates`) stay under **Extensions**: that view has its own header and tabs, and the Updates tab of Maintenance links to it from its "Extensions" card.

## Settings: one entry, tabs inside one page

`/admin/settings` is one page with client tabs (`components/admin/Tabs.tsx`); the open tab lives in the address as a hash, so a link such as `/admin/settings#privacy` opens that tab.

| Tab (EN / FR) | Hash | Notes |
|---|---|---|
| Name and logo / Nom et logo | `#site` | was "Identity" |
| Languages / Langues | `#languages` | |
| Privacy / Confidentialité | `#privacy` | |
| Search / Recherche | `#search` | |
| AI visibility / Visibilité dans les IA | `#ai` | was its own entry and page; rendered in a `Suspense`, so it never holds the page back |
| E-mail | `#mail` | owner only |
| Web address / Adresse web | `#address` | advanced mode only; shows the address and a button to the guided steps |

Old addresses: `/admin/ai-visibility` redirects to `/admin/settings#ai`. `/admin/settings/address` and `/admin/settings/address/after` keep their route (the guided steps are real pages, linked from mails and docs) and show a "back to Settings" link; `/admin/settings/rawg-covers` is untouched (modules link to it). A server redirect cannot see a `#`, so moved tabs use `components/admin/LegacyHash.tsx` (`#appearance`, `#header`).

## Sidebar sections

Top to bottom: Dashboard; **Content**, **Community**, **Tools** (pinned module instances, one link per module); **Connections** (collapsed group of pinned connector instances); **Site** (Home and menu, Appearance, Settings, Short links); **Administration** (Extensions, Overlay pages, AI assistants, Team, Maintenance); **Account** (My account, View site). Empty module sections are hidden. The section of a module comes from `defaultSection` in `core/modules/menuPlacement.ts`: the optional manifest key `menuGroup`, then the older `family`, then the type (`social` and `integration` are Connections, a simple overlay is Tools, `content` is Content, the rest is Community). See `docs/MODULES.md` ("Rubrique d'une instance épinglée"). The Extensions list uses the same words as families (plus "OBS helpers" for overlay modules).

R12: no two sidebar entries share a name or a first word, in English and in French (`tests/core/sidebar-groups.test.mjs`). The pages of an entry that became a tab keep their address; "Redirects" is named **Short links / Liens courts** in both modes, and the address `/admin/redirects` did not change.

## Preferences in My account

The admin mode (simple or advanced) and the admin theme (auto, light, dark) are set in the **Preferences** panel of `/admin/account` (`components/admin/AdminPreferences.tsx`), not in the sidebar footer. Each choice is a button in its own form (`setAdminMode`, `setAdminTheme` in `(panel)/mode/actions.ts`), so it works without a script and applies at once. The mode is stored on the account; the theme is a cookie of the browser. `/admin/mode` (the page that explains the difference) is unchanged and linked from the panel. The sidebar footer keeps the bug report link and sign out.

## Home and menu: one entry, four link tabs

The Home page, the site menu, the header link and button, and the social buttons of the header are one sidebar entry. The tabs are **links** (`components/admin/LinkTabs.tsx`, through `components/admin/HomeMenuHeader.tsx`), not client tabs: the home builder, the menu editor and the social catalogue are heavy, and client tabs render every panel at once. Each page keeps its own route.

| Tab (EN / FR) | Route | Who sees it |
|---|---|---|
| Home / Accueil | `/admin/home` | administration, owner |
| Menu / Menu | `/admin/navigation` | administration, owner |
| Link and button / Lien et bouton | `/admin/navigation/header` | administration, owner |
| Social buttons / Boutons de réseaux | `/admin/social` | administration, owner |

The addresses are `HOME_MENU_TAB_HREFS` in `adminLinks.ts`. The sidebar link goes to `/admin/home` and stays highlighted on the other three (`NavLink` `also`). "Link and button" used to be a client tab of the menu page (`/admin/navigation#header`): it is now a page of its own, and the menu page maps the old anchor to it with `LegacyHash` (so does the old settings anchor `#header`). The pages are titled "Site menu" (one name in both modes: "Navigation" is no longer shown) and carry the tab name as a level-2 title below the shared header.

## Routes that are not tabs and must never be redirected

`/api/admin/backup`, `/api/admin/backup/restore`, `/api/admin/backup/restore/apply` (backup handlers), `/api/admin/upload`, `/admin/overlay-pages/<id>/preview` (the preview), and the detail pages `/admin/modules/<id>`, `/admin/instances/<id>`.

## Adding a tab

1. Add the route to `adminLinks.ts` (or reuse the existing one) and to the tab model.
2. Render the shared header at the top of the page; give the page's own title `level={2}` (`PageHeader`) so the page has one `h1`.
3. Add the tab name (EN and FR, same keys) under `maint.tab.*`; short, no colon, never the same name as another sidebar entry (R12).
4. Add the page to `tests/core/maintenance-tabs.test.mjs`.
