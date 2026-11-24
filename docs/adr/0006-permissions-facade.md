# 0006. `permissions.ts` stays as the one import path for access checks

Status: Accepted
Date: 2026-11-24

## Context

The model of who may do what lives in `src/core/auth/access.ts` (types `Role`, `AdminUser`, `Need`, `Level`; `can`, `hasRole`, `isOwner`, `isMember`, `loadAdminUser`, `accessGate`…), with `rights.ts` and `sessions.ts` beside it. `src/core/permissions.ts` (48 lines) sits in front of it. It is **mostly** a façade, not only one:

- it **re-exports** the access model that pages and actions use: `Role`, `AdminUser`, `Need`, `Level`, `can`, `isOwner`, `isMember`, `hasRole`;
- it **adds** the three things that need the session and the framework and so cannot live in the pure model: `currentUser` (reads the session, closes a forced-password session), `requireRole` (denies, journals the refusal, redirects with `next/navigation`) and `audit` / `auditDenied` (write the audit journal, see "audit code" in the [glossary](../../GLOSSARY.md)).

At the time of writing, 75 files import `@/core/permissions` and 42 import `@/core/auth/access`.

## Decision

`permissions.ts` stays, with that shape. Today the code divides as follows: pages, actions and services import `@/core/permissions` for `requireRole`, `currentUser`, `audit` and the access types; the model itself (rights computation, gates) is imported from `@/core/auth/access`. The re-exports are not removed by rewriting the 75 imports, and the session-bound functions are not moved into `access.ts`, which would make the model depend on `next/navigation` and `@/auth`.

## Consequences

- Moving `requireRole`, `currentUser` or `audit` breaks source-level tests that read the file: `tests/core/sessions.test.mjs` (the `loadAdminUser(session?.user?.id, session?.user?.sv)` call), `tests/core/team-password.test.mjs`, `tests/core/roles-security.test.mjs` (no role read from the session or token in `permissions.ts`, `admin.ts`, `auth/access.ts`).
- The one place that decides "forced sessions count as signed out everywhere" is `currentUser` here; routes that forget the rule are closed by default.
- If the façade is ever removed, do it in one change: update the imports and those tests together.

## Sources

`src/core/permissions.ts`, `src/core/auth/access.ts` (exports and header comments); the tests named above; import counts taken with `grep` on `src/` at commit 400f640a (core 0.47.x, `dev`). This repository holds no earlier text that gives the reason for the façade; the reason above is what the code and its tests show.
