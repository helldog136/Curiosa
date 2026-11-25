# AI accesses that belong to a person (core 0.46.0 backend, 0.47.0 screens and the owner rule, 0.47.1 permanent owner)

**Every AI access belongs to a person** and can do **only what that person can do**, checked on every request. An editor's access cannot update the site, change the menu or edit the site settings, because an editor cannot. There is no longer a second kind of access without an owner: the one word is **access** (EN "AI access", FR "accès IA"), and an access has an **owner**, a **level** (look only, look and prepare, site upkeep) and a **state** (active, paused, stopped, no owner). A person may own **several** accesses, each with its own level, never above what the person can do. **The owner of an access is a permanent fact (0.47.1):** it is set when the access is created and **can never change**. There is no exchange of accesses between people, and no "choose another owner" anywhere; the only owner ever given afterwards is the first one, to an access that never had one (the temporary migration below). When the owner disappears, the access is revoked with them. (The filename keeps its old name so that links keep working.)

## Where the screens are

| Screen | Who | What |
|---|---|---|
| Account page, block "My AI accesses" | a person who may own an access (or already owns one) | Create an access: name, password again, level (3 fields, folded under "New access"; R2 deviation: the password is required here). A different level replaces any custom rights and turns full powers off; saving the same level changes nothing. The access code is shown **once**, above the form. Each row: name, level, state, a switch to pause or resume (resuming asks for the password again), a "..." menu (change the level within what you can do, remove with a confirmation that says what is lost). Nothing is shown to a person who may not own one. |
| Admin > AI assistants > "By person" | holders of `core:mcp.tokens` (owner, technical coordination) | One table of every access: access, owner, level, state. Search always present; filters by state and, with a few owners, by owner. Row: a Pause button and the "..." menu (remove). **No control changes the owner.** |
| Admin > Users, "..." menu of a person | holders of `core:mcp.tokens` | "AI accesses": Default / Allowed / Not allowed, the effective result in words and how many accesses the person owns. Never a field of the invitation form. |
| Admin > Users > add an assistant | holders of `core:mcp.tokens` | The new access **belongs to you** (one summary line); another owner can be chosen under "More options". |
| Admin > AI assistants (any tab) | holders of `core:mcp.tokens` | A short notice with a button **only while** at least one access has never had an owner. |

## Who may own an access

`allowed = override is not "deny" and (override is "allow" or the person holds the right core:ai.personal)`

- **Right `core:ai.personal`** ("Have an AI access"): a delegable right. Held by the owner, the coordinator and administrators, **not by editors**; a custom role can carry it.
- **Per-person override** `User.personalAi` = `inherit` | `allow` | `deny`, changed only by a holder of `core:mcp.tokens` (`setPersonAiOverrideAction`). `allow` never raises the person's own rights: the ceiling still applies.
- **No master switch any more (0.47.0).** The old setting `mcp.personalPolicy.enabled` is ignored and always read as true; the global AI switch is `mcp.enabled` ("Pause all assistants"). `allowDirect` (default off) is kept: a person may choose "act without asking" for an access only when it is on. It has no screen yet (the service function `setOwnPersonalApproval` exists). Installs and new instances always wait for a human.

## The ceiling

On **every request** (`tools/list` and `tools/call`), `canUse` (`services/mcp/access.ts`) adds one condition: the owner may do what the tool does **now** (`services/mcp/ownerCeiling.ts`). The owner's level and rights are read from the database each time, so a demotion or a withdrawn right applies to the very next call. The ordinary rules (scope ceiling, grants) still apply on top.

| Tool | The owner needs |
|---|---|
| `<instance>__list_entries`, `get_entry`, `create_draft`, `update_draft` | `core:entries.edit` |
| `<instance>__publish`, `unpublish`, `update_published_meta` | `core:entries.publish` |
| `redirects_*`, `media_*` | the editor tier |
| `navigation_*`, `home_sections_*`, `site_settings_*`, `overlay_skin*`, `maintenance_*` reads, settings, appearance, `log_list` | the admin tier |
| `maintenance_check_updates`, `core_update`, `module_update`, `modules_update_all` | `core:updates` |
| `maintenance_backup_run` | `core:backup` |
| install, uninstall, reinstall, restart, `instance_add`, skins install/remove/activate, catalogue | `core:modules.install` |
| `site_info`, `maintenance_my_access`, `maintenance_available_operations`, `maintenance_request_status` | nothing |
| a module tool | its manifest key `mcp[].right` (a local right of that module) |

- **A new access hides a tool with no declared requirement** (fail closed). A catalogue test fails when a core tool is missing from the table.
- **The coarse fallback (0.47.0).** An access that existed before every access had an owner carries `ApiToken.coarseCeiling = true`. For a **module tool that declares no `right`** its requirement is the **admin tier** (`COARSE_FALLBACK` in `ownerCeiling.ts`): the level of the people who could create those accesses. Why: many modules do not declare `right` yet; hiding their tools would switch off every access on upgrade. An owner who is an administrator or above keeps every such tool; an editor does not. Tools with a declared requirement and **every core tool keep the table above**: so an access given to an administrator loses only the tools that need a reserved right (updates, backup, installs). Full powers granted before the change keep working for such an access (and for it only), and so does its secret address; the ceiling always comes first. A new access never has the fallback, full powers or a secret address. **The marker is written only by `legacyOwners.ts`** (at start-up, on every access that has no owner): choosing an owner later (`assignOwner`) never changes it, so an access created after the feature that lost its owner stays fail-closed, and `setFullPowers` refuses it. A migrated (coarse) access also keeps its stored "act without asking" choice and its own hourly limits exactly as before; only a newer access follows `allowDirect` and shares the site-wide hourly budget.
- An owner who does not exist, a paused access, a locked account (temporary password, two-factor required and missing) or a missing resolver: the access answers nothing, with a clear message (or "invalid token" when the owner no longer exists: the access is revoked by the next sweep).
- `maintenance_my_access` reports `access.owner` (the owner's name, or "no owner" with what to do), `above_owner_rights` for tools the owner cannot do (no box to tick) and `reconnectNeeded` when the owner's rights changed. `maintenance_health` reports one number, `accessesWithoutOwner` (never had an owner: they work as before; `maintenance_diagnose` lists it as an info item that needs a human); all read only. There is no "owner removed" count any more: such an access is revoked (0.47.1).

## What the AI can learn about what it lacks

`maintenance_available_operations` (level 1, read, `src/core/maintenance/operations.ts`) is always listed for every valid access (`ALWAYS_LISTED` in `access.ts`: not revocable, no owner right needed, never a request, no side effect). It returns the **live** list of every operation of the installed and enabled modules and of the core, grouped by module, each with its kind (`read`, `draft`, `write`, `publish`, `request`, `delete`), the right it needs (`needs`; `needsAssumed: true` when the module declared none and the coarse fallback is shown), a one-line text of 120 characters at most, and its state for **this** access:

| `status` | Meaning for the AI |
|---|---|
| `allowed` | It can do it now. |
| `needs_approval` | A request the owner approves each time (the access asks first, or the action always waits: installs, new instance). |
| `not_granted` | The owner can grant it (`why`: `box_not_ticked` or `access_is_read_only`); `howToGrant` says where (Account > My AI accesses > Change the level for a personal access; Admin > AI assistants for an access without an owner). |
| `above_owner_ceiling` | The owner cannot grant it (`why: module_declares_no_right` for a new access and a module that declared no right). The AI must say so and not suggest granting it. |

Filters: `module` (module id, instance key, or `core`), `status`, `limit` (150 by default, 300 at most) and `offset` (the answer says `truncated.nextOffset`). `counts` always describe the whole picture. It is a sibling of `maintenance_my_access`, which keeps describing the access itself (ceiling, approval setting, limits, uploads, reconnection). Names, one-liners and flags only: no input schema, no setting value, no secret, nothing about other accesses. The server `instructions` point to it.

## Choosing owners (temporary page: removed in 0.50.0)

- **One account on the site** (a row of the user table; an invited person who has not signed in is a row too, so an owner plus a pending invitation counts as two): at start-up, every live access without an owner is given to that account, **only if that account may own an access and is not locked** (a locked account, an override "deny" or a level without the right would make every automation stop): otherwise the accesses stay without an owner and keep working, and `maintenance_diagnose` says so. Idempotent; a journal row `mcp.personal.assign` per access (actor "system", the access name and the person's e-mail, never a code). Nothing to do on screen.
- **Several accounts:** nothing is assigned. Every access that never had an owner **keeps working exactly as before** and shows **No owner**. It cannot be given new rights (only turned off) until it has an owner. A holder of `core:mcp.tokens` opens Admin > AI assistants > By person: a panel **"Choose who owns each access"** lists them (search, one select and "Assign" per row, and "Give all to this person" with a confirmation that says what changes). **The panel is shown only while an access has never had an owner** (no empty panel, no link, no notice otherwise). Who may be chosen: the people allowed to own an access (right or override) and **never above the level of the person choosing** (a coordinator cannot hand the site owner's ceiling to anyone, or take it by naming the owner); this applies to creation and to this one-time assignment. **The choice is final** (the panel and its confirmation say so): `assignOwner` and "give all" work **only** for an access whose `ownerId` is null and answer `already_owned` for any other, whether its owner still exists or not, and even for the same person; the write itself carries `ownerId: null` in its condition, so two simultaneous calls cannot both succeed.
- **Permanent part:** the rule that **no access is created without an owner** and that **the owner never changes** (enforced in code and by source tests, not by a NOT NULL column: the column stays additive and nullable), the "No owner" state for the legacy accesses, and the revocation of an access whose owner disappears. `assignOwner` (`personalAi/owners.ts`) exists only for the temporary migration and goes with it at the sunset.
- **Every place that writes `ApiToken.ownerId`** (a test fails on any other): creation (`createToken`, `services/mcp/tokens.ts`, reached from `createAccess` and `createPersonalAccess`), the one-time legacy step (`legacyOwners.ts`, `ownerId: null` rows only) and `assignOwner` (null rows only). A restore does not write accesses, user deletion and the sweep only revoke, and no screen, tool or maintenance operation takes an owner for an existing access.
- **Sunset: 0.50.0.** Delete `src/core/personalAi/legacyOwners.ts`, its call in `src/instrumentation.ts` and the folder `src/app/admin/(panel)/assistants/assign-owners/` (plus its import in `OwnersTab.tsx`, the locale keys `owners.assign.*` and the test `the single-account step and its page are temporary` of `tests/services/access-owners.test.mjs`, which fails once `package.json` reaches 0.49.0 while they exist). The migration registry of `docs/MIGRATIONS.md` works by support floor, not by version, so it does not fit; the test is the reminder.
- **Marking is one-time.** The first start-up marks `coarseCeiling` on the accesses that have no owner and were created before that moment (`ai.legacyCutoff`, kept across a retry), then writes `ai.legacyMarked`; nothing is ever marked again, and the single-account step gives only marked accesses. An ownerless access created later stays fail-closed. At the sunset the two settings, `legacyOwners.ts` and its call go away, but **the `coarseCeiling` column stays**, and the rows that carry it keep their behaviour (coarse fallback, secret address, full powers) until they are revoked.
- **Rollback by hand** (an operator on the database, never a screen), only for the rows the migration marked (`coarseCeiling = 1`): `UPDATE ApiToken SET ownerId = NULL, pausedAt = NULL WHERE coarseCeiling = 1;` `pausedAt` must be cleared too, because an access without an owner ignores it and would otherwise start working again (revoke the paused ones first if that is not wanted). Accesses created later have `coarseCeiling = 0` and are not touched.

## Requests and approvals

A request made by an access stores its owner (read from the access row). It is decided by **the person who owns the access**, or by a holder of `core:mcp.tokens`; nobody else. At approval the owner's rights are **checked again**: a request above what the owner may do now is refused and never runs. A request of an access with no owner is decided by a holder of `core:mcp.tokens` only, as before.

## Lifecycle

| Event | Result |
|---|---|
| Demotion, right withdrawn, `deny` | Stopped on the next request; nothing deleted; restored when the right comes back |
| Sign out everywhere, administrator cuts the sessions, password changed or reset, two-factor reset | Every access of that person is **paused**; the owner resumes it (password asked again). This is a compromise signal and is kept: on a one-account site, changing the password pauses every migrated automation until it is resumed from the Account page (the block says so in its "?" tip) |
| User deleted | Every access of that user is **revoked** first (pending requests expire, one `mcp.personal.revoke` line per access: the name, never a code); it never becomes ownerless (no `SetNull`). Same path for an invited person who has not signed in (a user row too) and for every deletion (`deleteMember` is the only place that deletes a user). |
| Backup restored | Accesses are not part of a backup, but people are replaced: at the end of the restore every live access whose owner is not in the restored data is **revoked** (same cleanup, journal actor = the person who restored) and the restore report says how many ("N AI accesses removed: their owner is not in this backup"). |
| Owner row missing for any other reason (a person removed by hand in the database) | The **safety sweep** (`sweepOrphanedAccesses`, `personalAi/lifecycle.ts`) revokes the access. It runs at start-up, when the AI assistants page, the By person tab or the team list is read, and after a restore. Cheap, idempotent (a revoked access is not looked at again, simultaneous runs share one pass), journal `mcp.personal.revoke` with the target `<name>: owner removed`. |
| Access that never had an owner (`ownerId` null) | **Never swept, never revoked**: it works as before until the migration ends. |

## Creating, pausing, removing

Creation on the **Account page** and resuming ask for the person's password again (5 wrong answers per 15 minutes at most). **Exception:** an administrator who creates an access from Users > add an assistant, or in the setup step, is already signed in as an administrator and is not asked again (this keeps the short path without a password field). The access code is shown **once**; only its hash is stored. No secret address and no full powers for a new access. Newer accesses share a site-wide hourly budget (risky 30, content 300) on top of the per-access limits; migrated (coarse) accesses keep only their own limits, as before. Removing an access, from any screen, expires the pending requests of **that access** only. A holder of `core:mcp.tokens` can pause or remove any access; only its owner resumes it. The journal records `mcp.personal.create`, `.assign`, `.revoke`, `.pause`, `.resume`, `.rename`, `.rights`, `.inert` (once per transition) and `.policy`; names and counts, never a code.

## Do not downgrade

An **older core ignores `ApiToken.ownerId`** and would treat an owned access as one without an owner (no ceiling). Updates are forward only and keep a copy of the database at each step; do not restore an older core while accesses have owners.
