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

### Routes that are not tabs and must never be redirected

`/api/admin/backup`, `/api/admin/backup/restore`, `/api/admin/backup/restore/apply` (backup handlers), `/api/admin/upload`, `/admin/overlay-pages/<id>/preview` (the preview), and the detail pages `/admin/modules/<id>`, `/admin/instances/<id>`.

## Adding a tab

1. Add the route to `adminLinks.ts` (or reuse the existing one) and to the tab model.
2. Render the shared header at the top of the page; give the page's own title `level={2}` (`PageHeader`) so the page has one `h1`.
3. Add the tab name (EN and FR, same keys) under `maint.tab.*`; short, no colon, never the same name as another sidebar entry (R12).
4. Add the page to `tests/core/maintenance-tabs.test.mjs`.
