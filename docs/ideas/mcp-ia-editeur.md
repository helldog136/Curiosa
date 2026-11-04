# An AI that can run the site: MCP tools to add

Status: **batch 1 and publication are coded** (branch `feat/mcp-publish-and-access`: `maintenance_my_access`, `maintenance_catalog_plan`, `maintenance_module_install { modules }`, `maintenance_instance_add`, `maintenance_skin_set_options`, `<instance>__publish` / `__unpublish`, the separate `request` field; see `docs/MAINTENANCE-IA.md`). Publication was built directly as a tool that follows the approval setting instead of the `request_publish` of section 3 (row 8); **the menu and the home page are coded** (branch `feat/mcp-navigation-and-home`: `navigation_get` / `navigation_set`, `home_sections_list` / `home_sections_set`, see the addendum of `docs/MAINTENANCE-IA.md`; the design is one "send the whole list" writer per target instead of the `*_propose` pair of section 3, row 7: it follows the approval setting and keeps a restore point); everything else below is still an idea. Everything marked "proposal" is yet to be decided; the rest describes what exists today, with the file that proves it.


**Starting decision**: an AI whose access is fully set up must be able to do **at least** what the Editorial role does in the admin, and more: install and configure modules. Without changing the security model: an AI never publishes anything, anything broad or destructive is a request that a human approves, no secret is ever read or written, everything is logged, each right is ticked separately, and everything is additive.

## 1. Current state

### 1.1 The tools that exist

Required right: the access (token) must have the "write" ceiling for a tool that writes, **and** the tool's box ticked, or the tool's default (`src/core/services/mcp/access.ts:180-186`). The "Maintenance" profile only ticks level 1 by default (`src/core/maintenance/tools.ts:157-159`).

| Tool | Level | Read / write | Granted by default | Human approval |
|---|---|---|---|---|
| `site_info` (`src/core/platform.ts:24`) | 1 | read | yes | no |
| `maintenance_status`, `_health`, `_modules`, `_updates`, `_diagnose`, `_audit`, `_request_status`, `_legacy`, `_catalog_list`, `_catalog_get`, `_skin_status`, `_skin_list`, `_content_check` (`tools.ts:61-91`) | 1 | read | Maintenance profile only | no |
| `maintenance_module_settings` (`tools.ts:100`) | 2 | read | no | no |
| `maintenance_check_updates`, `_backup_run`, `_module_reinstall`, `_module_restart`, `_content_check_run` (`tools.ts:93-97`) | 2 | safe write | no | no |
| `maintenance_module_configure`, `_module_configure_advanced` (`tools.ts:104-113`) | 2 | write, never a secret | no | no |
| `maintenance_module_install`, `_skin_install` (`tools.ts:115-124`) | 3 | request | no | **always**, even in "act without asking" mode (`actions.ts:306`) |
| `maintenance_skin_activate`, `_skin_remove`, `_font_set`, `_module_update`, `_modules_update_all`, `_core_update`, `_module_uninstall` (`tools.ts:125-143`) | 3 | request | no | yes by default; direct only if the owner chooses "act without asking" for this token |
| `redirects_list`, `_stats`, `_summary` (`src/core/redirectMcp.ts:77-96`) | 1 | read | yes | no |
| `redirects_create`, `_update` (`redirectMcp.ts:113,125`) | 2 | direct write | no | no |
| `redirects_delete` (`redirectMcp.ts:144`) | destructive | write | no | no (box with confirmation) |
| `log_list` (`src/core/journalMcp.ts:37`) | 1 | read | no | no |
| `rawg_covers_to_check`, `rawg_cover_set` (`src/core/rawgMcp.ts`) | module | read / write | per module | no |
| `<key>__list_entries`, `__get_entry` (`src/core/content/mcp.ts`) | content | read | yes | no |
| `<key>__create_draft`, `__update_draft` (`content/mcp.ts`) | content | drafts only | yes | no (publishing stays human) |
| `<key>__<action>` declared by a module (`src/core/modules/mcpProvider.ts:212-240`) | module | per `readOnly` / `destructive` | reads yes, writes no | no |

There is **no** core tool for: site settings, menu, home page, media, languages, SEO, roles, the first-run setup wizard.

### 1.2 Why `module_install`, `skin_install`, `skin_activate` do not show up

**It is not a code omission.** The three tools are written (`tools.ts:115-128`), registered (`src/core/platform.ts:57`: `maintenanceToolProvider` is in the provider list) and have no condition on level, token, "ask / act" mode or channel:

- The server keeps no session. It recomputes the list **on every request**: `tools/list` filters with `canUse` (`src/core/services/mcp/server.ts:55-57`) and `tools/call` repeats the same check (`server.ts:65-69`). Rights therefore change live on the server side (`docs/MODULES.md`, "Qui a accès à quoi").
- The "I approve each request / act without asking" setting is only read **at call time**, not when listing (`actions.ts:306`). It hides nothing.
- There is no level filter: `canUse` only looks at the ceiling and the box (`access.ts:185`). Level 3 tools have the same argument schema as visible tools (`module_update` and `module_reinstall` share `MODULE_ARG`), so the client is not rejecting a schema.
- The rights page does list these tools with their box (`src/app/admin/(panel)/assistants/[id]/page.tsx`).

**Most probable cause, and the only one the code allows**: the list the AI sees is **frozen at connection time**. The server announces `capabilities: { tools: { listChanged: false } }` (`server.ts:48`), only speaks POST with no stream (`src/app/api/mcp/route.ts`, GET returns 405) and therefore **can never tell** the client that a box was just ticked. The MCP client keeps the list received when it connected and never asks again. Boxes ticked after the connection stay invisible to the AI until it reconnects. One detail fits: the AI also sees the reads (granted by default) but not `redirects_create` / `_update` / `_delete` nor `log_list`, which are all unticked by default.

**Missing proof, which the owner can get without breaking anything**: (1) close and reopen the AI's connection (new `tools/list`); (2) otherwise, have the AI call `maintenance_module_install` **by name**: the call goes through if the box is ticked, even if the cached list does not show it (`server.ts:67-69`). If (1) or (2) works, the cause is proven. If neither works, the box is not really saved: `GrantToggle` reverts the box and shows "!" when `setGrantAction` answers `ok: false` (`src/components/admin/GrantToggle.tsx:20-26`), which happens if the token is "read" (`assistants/actions.ts`, ceiling). I did not call the site: this check is still to be done.

**Real defects to fix (minimal proposals)**
1. The descriptions of `catalog_get` and `skin_list` promise tools that the AI does not always see (`tools.ts:86,90`). Add: "If this tool is not in your list, ask the owner to tick its box, then reconnect."
2. After each box is ticked, the rights page says: "Reconnect the assistant so that it sees this change." (FR and EN texts in parity).
3. New read tool `maintenance_my_access` (level 1, granted by default): lists the tools that are **not granted**, with the sentence of their box, so the AI knows what to ask for instead of assuming they do not exist.
4. Requests are not "destructive" in the same way as a deletion, yet `destructive: d.level === 3` (`tools.ts:147,160`) groups them together: confirmation for every box, no batch possible. Proposal: a separate `request: true` field, so that "all requests" can be granted in one click in a profile.

## 2. What the Editorial role does, and what MCP allows

Roles: `src/core/auth/rights.ts`. Editorial (`editor`) has `core:entries.edit` and `core:entries.publish`, plus the module rights marked `default.editor`. The admin pages without a reserved right are at the `editor` tier: content, drafts, templates, **short links** (`entries/*`, `drafts`, `redirects/*`). The rest (home, menu, settings, appearance, social networks, AI visibility, extensions) is at the Administration tier (`adminCtx("admin")`). Since the decision says "and more", the matrix covers both.

| Action in the admin | Tier | MCP tool today | Missing |
|---|---|---|---|
| Read / list content | Editorial | `<key>__list_entries`, `__get_entry` | — |
| Create / edit a draft, add a language | Editorial | `__create_draft`, `__update_draft` | cover image, advanced tags, module-specific fields |
| **Publish** / unpublish / delete | Editorial | none, on purpose | publication request (3.8) |
| Upload a media file, alternative text | Editorial (`/api/admin/upload`) | none | media (3.6) |
| Short links | Editorial | `redirects_*` | nothing (already covered) |
| Site settings: name, tagline, about, languages, logos, footer | Administration | none | 3.5 |
| Menu and header links | Administration | `navigation_get`, `navigation_set` (the menu; the secondary link and button of the header are not covered) | done (3.7) |
| Home page sections | Administration | `home_sections_list`, `home_sections_set` | done (3.7) |
| Skin, colors, fonts | Administration | `skin_*` (read), `skin_activate`, `font_set` (requests, **poorly visible**, § 1.2) | 3.4 |
| Social networks shown | Administration | none | 3.7 |
| Install / remove / configure a module | `core:modules.install` | `module_*` | extra instance (3.2) |
| Contacts, polls, FAQ… | module | the module's tools | per module |
| First-run setup wizard | owner | none | 3.10 |

## 3. Tools to add (proposal, by priority)

Levels: **1** read; **2** safe, reversible write (logged with the old value); **3** request that the owner approves, run once and re-checked at execution time (model: `src/core/maintenance/actions.ts`). No tool reads or writes a secret; every output goes through `redactDeep`.

| # | Name | Does | Level | Inputs → outputs | Safeguards, what stays human |
|---|---|---|---|---|---|
| 1 | `maintenance_module_install` (exists) **to make reliable**, plus `maintenance_catalog_plan {module}` | Reads the sheet, computes the plan: required dependencies, permissions, collected data, proposed instance | 1 then 3 | `module`, `instanceKey?` → plan, `requestId` | Sheet read first (installation refused without a re-read plan). Installation always waits for a click, even in "act without asking". Official catalogue only |
| 2 | `maintenance_instance_add {module, key}` | Creates one more instance of a module with `instances: "multiple"` (`manifest.ts:239`) | 3 | `module`, `key` → `requestId` | Refused if the module is "single". Deleting an instance stays human |
| 3 | `maintenance_module_configure` (exists) + `maintenance_module_setup_status {instance}` | Says what is left to fill in for an instance to work | 1 | `instance` → list of empty required settings | Never a secret: only "to enter in the admin" with the path |
| 4 | `maintenance_skin_options {skin}` and `maintenance_skin_set_options {changes}` | Reads then sets colors and fonts **within the skin's limits** (contrast checked as in Appearance) | 2 for colors of an already active skin; 3 for a skin change | `changes` ≤ 20 keys → resulting settings + corrected colors | An unreadable color is corrected and reported. A personal skin or an uploaded font: human. Undo with Appearance's "Undo" |
| 5 | `site_settings_get`, `site_settings_set {name?, tagline?, about?, footer?, locales?}` | Site settings (`settings/actions.ts`) | 1 / 2 | texts per language ≤ 20,000 chars | No site address, time zone, security or mail settings. Removing a language: request (3) |
| 6 | `media_upload {name, dataBase64, alt}`, `media_list`, `media_set_alt` | Uploads a validated image (`sniffImage`, 5 MB, `uploads.ts`), lists it, sets its alternative text | 2 | image ≤ 5 MB → `/uploads/…` | No SVG or video in v1. Logo and brand icon: set through `site_settings_set` after checking; SVG stays human |
| 7 | `navigation_get`, `navigation_propose {items}`, `home_sections_list`, `home_sections_propose {ops}` | Reads the menu and the home page; **proposes** a full change (add, order, remove sections) | 1 / 3 | tree validated by `validateMenuInput` → preview in plain words + `requestId` | The change applies only on approval, with a before / after preview. Links to pages that do not exist: refused |
| 8 | `<key>__request_publish {id}` (in the content engine) | Asks for a draft to be published | 3 | `id` → `requestId` | Never direct publication (`content/mcp.ts`: drafts only). Unpublish / delete: human |
| 9 | `<key>__entry_seo {id, locale, title?, description?}` + `entry_translations_missing {id}` | Title and description for search engines of a draft; missing languages | 2 / 1 | texts ≤ 300 chars | Drafts only; a published entry goes through 8 |
| 10 | `redirects_*` (exist) | nothing to add; keep `delete` human through its box | — | — | — |
| 11 | `maintenance_onboarding_status`, `maintenance_onboarding_finish` | Says which wizard steps are missing; finishes with the answers already given | 1 / 3 | → steps | Owner account, password, two-step verification: never |
| 12 | `maintenance_content_check` (exists) | Add a `fix` field: the tool that fixes each remark | 1 | — | — |

**Top 10 to do first**: 1) `maintenance_my_access` + "reconnect" messages; 2) `maintenance_catalog_plan`; 3) `maintenance_instance_add`; 4) `maintenance_skin_set_options`; 5) `site_settings_get/set`; 6) `media_upload / list / set_alt`; 7) `navigation_propose`; 8) `home_sections_propose`; 9) `<key>__request_publish`; 10) `<key>__entry_seo` and `entry_translations_missing`.

## 4. Shared contract (proposal)

- **Declaration by a module**: new **top-level** manifest key `mcpRequests: [{ name, description, input, summary }]`, next to `mcp` (`src/core/modules/manifest.ts:259`). Reason: inside `mcp`, an unknown key is **silently stripped** and the action would become a direct write on an older core. An unknown top-level key is ignored as a whole: an older core exposes nothing. The module sets `minCore`.
- **Request**: the module returns a `plan` (plain text, before / after); the core creates the request, keeps it 24 h, shows it in "Requests to approve", and replays it once on approval (same mechanism as `requests.ts`; `LEVEL3_ACTIONS` becomes extensible by modules).
- **Names**: core `maintenance_*` (upkeep), `site_*`, `media_*`, `navigation_*`, `home_*`; module `<key>__<verb_object>`. Verbs: `list`, `get`, `create_draft`, `update_draft`, `request_<action>`.
- **Rights**: one `aim.tool.<name>` entry in FR and EN, the same short sentence, for every core tool (the current keys are in `src/locales/fr.json`); the existing parity test applies. Module tools keep their manifest description.
- **Levels**: 1 read; 2 safe write; 3 request (new `request` field, distinct from `destructive`).
- **Rights page** (profiles done: `src/core/services/mcp/profiles.ts`, three presets Read only / Assistant / Full setup, also offered in the setup step): simple mode = three groups "Look / Change / Request" with profiles (an "Editorial AI" profile: level 1 + 2 + drafts + publication requests); advanced mode = each tool, as today.
- **Log**: every write call records `mcp.<tool>` with the target, never the value of a secret; the old value is kept for level 2.
- **Limits**: 120 requests per minute per token (`tokens.ts:83-90`), 12 level 2-3 actions per hour (`actions.ts`, `takeSlot`); body ≤ 1 MB (`server.ts`); 20 changes per call; image ≤ 5 MB; texts ≤ 20,000 characters; pending requests ≤ 50.
- **Secrets**: no tool takes or returns a secret, token, password or secret address.
- **Compatibility**: everything is additive; unknown keys are ignored by older cores; the current tools and their names do not change.

## 5. Roadmap (proposal)

| Batch | Content | Size | Depends on |
|---|---|---|---|
| **1. Unblock installation and appearance** | Fixes of § 1.2 (texts, `maintenance_my_access`, `request` field), `catalog_plan`, `instance_add`, `skin_set_options` | small to medium | nothing |
| **2. Content and media** | `mcpRequests` + module requests, `request_publish`, `entry_seo`, translations, `media_*` | large | batch 1 (`request` field) |
| **3. Finishing** | `site_settings_*`, `navigation_propose`, `home_sections_propose`, onboarding, rights-page profiles | medium to large | batches 1 and 2 |

Each batch: update `MAINTENANCE-IA.md` and `MODULES.md`, FR / EN rights, parity tests, log, and an "Ergonomie" section in the PR for the rights page.
