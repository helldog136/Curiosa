# Personal AI assistants (core 0.46.0: backend and enforcement)

A personal AI assistant is an AI access that **belongs to one team member** and can do **only what that person can do**. An editor's assistant cannot update the site, change the menu or edit the site settings, because an editor cannot. The other kind, the **independent** access, is unchanged: it is created by a holder of `core:mcp.tokens` in Admin > AI assistants and its rights are the ones ticked there.

0.46.0 ships the rules and their enforcement. There is **no screen yet**: the account page and the admin tab come in 0.46.1, and the rights that modules declare for their tools in 0.46.2. **Nothing changes on a site until the owner turns the feature on.**

## Who may have one

`allowed = master switch ON and override is not "deny" and (override is "allow" or the person holds core:ai.personal)`

- **Master switch**: core setting `mcp.personalPolicy` = `{ "enabled": false, "allowDirect": false }` (both off by default). Switching it off makes every personal assistant inert at once; independent accesses are not concerned. Until the screen exists, a holder of `core:mcp.tokens` changes it through `setPersonalPolicyAction` (Admin actions of the assistants page) or the core settings API (`setSetting("mcp.personalPolicy", { enabled: true, allowDirect: false })`).
- **Right `core:ai.personal`** ("Have a personal AI assistant"): a delegable right of the roles system. Held by the owner, the coordinator and administrators, **not by editors**; a custom role can carry it.
- **Per-person override** `User.personalAi` = `inherit` | `allow` | `deny`, changed only by a holder of `core:mcp.tokens` (`setPersonAiOverrideAction`). `allow` never raises the person's own rights: the ceiling below still applies.
- `allowDirect`: a person may choose "act without asking" for their own assistant only when this is on. Installs and new instances always wait for a human.

## The ceiling

On **every request** (`tools/list` and `tools/call`), `canUse` (`services/mcp/access.ts`) adds one condition for a personal access: the owner may do what the tool does **now** (`services/mcp/ownerCeiling.ts`). The owner's level and rights are read from the database each time, so a demotion or a withdrawn right applies to the very next call. The ordinary rules (scope ceiling, grants) still apply on top; full powers never apply.

| Tool | The owner needs |
|---|---|
| `<instance>__list_entries`, `get_entry`, `create_draft`, `update_draft` | `core:entries.edit` |
| `<instance>__publish`, `unpublish`, `update_published_meta` | `core:entries.publish` |
| `redirects_*`, `media_*` | the editor tier |
| `navigation_*`, `home_sections_*`, `site_settings_*`, `overlay_skin*`, `maintenance_*` reads, settings, appearance, `log_list` | the admin tier |
| `maintenance_check_updates`, `core_update`, `module_update`, `modules_update_all` | `core:updates` |
| `maintenance_backup_run` | `core:backup` |
| install, uninstall, reinstall, restart, `instance_add`, skins install/remove/activate, catalogue | `core:modules.install` |
| `site_info`, `maintenance_my_access`, `maintenance_request_status` | nothing |
| a module tool | its manifest key `mcp[].right` (a local right of that module) |

- A tool with **no declared requirement is hidden** from personal assistants (fail closed). A module that has not declared `right` yet is invisible to them, never open to them. A catalogue test fails when a core tool is missing from the table.
- An owner who does not exist, a policy that is off, a paused access, a locked account (temporary password, two-factor required and missing) or a missing resolver: the assistant answers nothing, with a clear message to its owner (or "invalid token" when the owner is gone).
- `maintenance_my_access` says `above_owner_rights` for tools the owner cannot do (no box to tick: ask an administrator), and `maintenance_status` reports `reconnectNeeded` when the owner's rights changed.

## Requests and approvals

A request made by a personal assistant stores its owner (read from the access row). It is decided by **the person who owns the assistant**, or by a holder of `core:mcp.tokens`; nobody else. At approval the owner's rights are **checked again**: a request that is above what the owner may do now is refused and never runs.

## Lifecycle

| Event | Result |
|---|---|
| Demotion, right withdrawn, policy off, `deny` | Inert on the next request; nothing deleted; restored when the right comes back |
| Sign out everywhere, administrator cuts the sessions, password changed or reset, two-factor reset | The assistant is **paused**; its owner resumes it (password asked again) |
| User deleted | Every personal access of that user is **revoked** first; it never becomes independent (no `SetNull`) |

## Connection

One personal assistant per person. Creation and resuming ask for the person's password again (5 wrong answers per 15 minutes at most). The access code is shown **once**; only its hash is stored. No secret address, no full powers. Personal assistants also share a site-wide hourly budget (risky 30, content 300) on top of the per-access limits. The journal records `mcp.personal.create`, `.revoke`, `.pause`, `.resume`, `.rights`, `.inert` (once per transition) and `.policy`; names and counts only, never a code.

## Do not downgrade

An **older core ignores `ApiToken.ownerId`** and would treat a personal access as an independent one. Updates are forward only and keep a copy of the database at each step; do not restore an older core while personal assistants exist. Revoke them first.
