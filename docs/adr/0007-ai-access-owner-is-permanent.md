# 0007. The owner of an AI access is permanent; orphans are swept

Status: Accepted
Date: 2026-11-24

## Context

An AI access can act on the site through the assistant protocol. Since core 0.46.0 every access belongs to a person and can do only what that person can do **now**, checked on every request. In 0.47.0 the "By person" table had a "Choose an owner" row menu, and an access whose owner no longer existed was **stopped** and showed "Owner removed" until someone chose a new owner (see the diff of #284 in `docs/PERSONAL-AI.md`). Core 0.47.1 (#284) made the owner a permanent fact.

## Decision

1. **The owner is set once, when the access is created, and never changes.** No screen, tool or maintenance operation gives an existing access another owner. `ApiToken.ownerId` is written in exactly three places: creation (`createToken` in `services/mcp/tokens.ts`, reached from `createAccess` and `createPersonalAccess`), the one-time step for accesses that predate owners (`personalAi/legacyOwners.ts`, rows with no owner only) and `assignOwner` (rows with no owner only; it exists only for that migration and goes with it). A source test fails on any other writer (`tests/services/ai-owner-permanent.test.mjs`). The column stays nullable and additive; the rule is in code and tests, not in a `NOT NULL`.
2. **When the owner disappears the access is revoked**, never left ownerless and never reassigned:
   - deleting a user revokes all their accesses first (`revokePersonalAccessesOf`; there is no `SetNull` on `ownerId`; `deleteMember` is the only place that deletes a user);
   - a restored backup replaces people but not accesses, so at the end of the restore every live access whose owner is not in the restored data is revoked, and the report says how many;
   - any other case (an owner row removed by hand in the database) is caught by the **safety sweep**, `sweepOrphanedAccesses` in `personalAi/lifecycle.ts`: it runs at start-up (`instrumentation.ts`), when the AI assistants page, the "By person" tab or the team list is read, and after a restore. It is cheap and idempotent (two sweeps at the same moment share one pass), it checks again right before each revoke because revocation is final, it does nothing when the user table is empty (that proves nothing about owners), and it writes one `mcp.personal.revoke` line per access with the name and the reason, never a code. Authentication itself refuses an access whose owner has no row (fail closed).
3. **Revocation has one door.** `revokeAccess` (`personalAi/revoke.ts`) expires the access's pending requests, then revokes the access, then expires again (a request created between the two steps). A test fails if any other file calls `revokeToken` (`tests/services/access-owners.test.mjs`, "only revokeAccess calls revokeToken").
4. **An access that never had an owner (`ownerId` null, created before owners existed) is never swept and never revoked.** It keeps working with a coarse ceiling (`coarseCeiling`) until the one-time migration ends; a null owner created later stays fail-closed.

## Consequences

- Any new way to delete or replace people (import, restore, a new screen) must go through `revokePersonalAccessesOf` or end with the sweep; otherwise accesses are left pointing at nobody until the next sweep.
- Any new way to remove an access must call `revokeAccess`, not `revokeToken`.
- A person who needs a different owner for an automation creates a new access under that person; there is no transfer. The cost is deliberate: nobody inherits rights they were not given.
- At the end of the migration `legacyOwners.ts`, `assignOwner` and their settings go away; the `coarseCeiling` column stays.

## Sources

`src/core/personalAi/lifecycle.ts`, `revoke.ts`, `owners.ts`, `legacyOwners.ts`; `src/core/services/mcp/ownerCeiling.ts`; `src/instrumentation.ts`; `src/core/backup/restore.ts`; [docs/PERSONAL-AI.md](../PERSONAL-AI.md) (Lifecycle, the permanent part, every writer of `ApiToken.ownerId`); `tests/services/ai-owner-permanent.test.mjs`; [GLOSSARY.md](../../GLOSSARY.md) (AI access owner).
