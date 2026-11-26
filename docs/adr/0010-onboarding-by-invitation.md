# 0010. Onboarding by invitation: an e-mail and a role, a single-use link

Status: Accepted
Date: 2026-11-25

## Context

Adding a person to an editorial team meant typing a name, an e-mail and a **temporary password**, then passing that password along by some other channel. Step-0 audit, before this change:

| Question | Before |
|---|---|
| Can a person be invited by e-mail? | No. `addMember` in `src/core/auth/members.ts` created the account with a typed temporary password and `mustChangePassword`. |
| Is there a single-use link? | No token of any kind existed for accounts. |
| Can someone reset their own password? | No. Only a person holding `core:team` could set a temporary password; nobody could ask for one. |
| Can an account be paused without deleting it? | No. The only lifecycle action was `deleteMember`. |
| Is outgoing mail available? | Yes: `src/core/services/mail.ts` (optional; sending is rate limited and never throws). |
| Are failed sign-ins limited? | Yes (`docs/SECURITE.md`, "Essais ratés"). Nothing limited account links. |
| Are 2FA, passkeys, `sessionVersion`, anti-elevation (`grantableLevels`, `canManageMember`) in place? | Yes, reused unchanged. |
| Is the audit journal there? | Yes (`AuditLog`); the account actions logged only create and delete. |
| Do backups carry secrets? | A backup holds the `User` table; nothing else needed to be excluded before this change. |

The onboarding screen also asked for a name, an e-mail, a password and a role (4 fields), and showed a temporary password that people copied into chats.

## Decision

1. **Invitation is the default way to add a person**: an e-mail and one role (2 visible fields, 1 click). The legacy temporary-password form stays, folded under "More options" (it is the way when mail is not configured and the owner prefers it).
2. **The link is a single-use secret.** 256 random bits (base64url, 43 characters). Only `HMAC-SHA-256(auth secret, label + token)` is stored (`src/core/auth/oneTimeToken.ts`; one label per kind, so an invitation token never validates as a reset token); compared with `timingSafeEqual`. The token sits in the URL **fragment** (`#t=`), so it is never sent to the server in a request line, never in a log or `Referer`; the page strips it from the address bar and posts it in the form body. Pages answer `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
3. **Expiry**: 72 hours by default; the person who invites may choose 24 hours, 72 hours or 7 days. 72 hours covers a weekend without leaving a week-long secret by default. A reset link lasts 45 minutes.
4. **Bound to the e-mail and the role.** The invitation stores the e-mail, the role and a snapshot of its rights. At acceptance the role is **re-validated against the inviter as they are now**: the inviter must still exist, not be suspended, still hold the team right, and still be allowed to grant that role (anti-elevation); the role must still exist, and a custom role must not have gained rights since the snapshot. For a custom role, a right added since the invitation was written is refused (`role-elevated`); a role that lost rights is accepted with its current, smaller rights. Otherwise the answer is the same generic refusal and the invitation is marked refused.
5. **Bounds**: at most 50 pending invitations; one pending invitation per e-mail (a new one replaces the old link); resend (new link, old one dead) and revoke at any time.
6. **Anti-enumeration**: the public pages give one generic answer for an unknown, used, expired, revoked or refused link; the "forgot password" request always answers "accepted", takes at least 400 ms, and sends mail in the background. Owner, suspended, unknown, invalid and ineligible (reserved right without a second factor) addresses get no row and no mail. A link made in the last five minutes is kept (no second mail). Limits are per IP for every request, and per address and for the site only when a mail really leaves, so requests that lead to nothing never use them up; per token on the pages. In memory; the map is bounded with a true LRU, the site-wide keys are never evicted, a timer sweeps.
7. **No mail configured**: the link is shown **once** to the person who invited (`ActionState.secret`), to pass on themselves. Never a temporary password in clear. The same screen is used when sending fails.
8. **Forgot password is available only when mail is configured** (the login link and the page appear only then). It keeps 2FA and passkeys, cuts every session (`sessionVersion`), pauses personal assistant accesses, clears the "must change" flag, writes an audit entry and sends a notice mail to the account.
9. **Who can use the public reset.** Never the owner (no link is made, same answer as for anyone; the owner recovers through the server, `scripts/auth-recover.mjs reset-password`), never a suspended account. An account that **holds a reserved right** (`CORE_RESERVED`: the coordinator, or any level that holds team, roles, backup, updates, module installation, assistant accesses or security) can use it **only if it has an authenticator or a passkey**; the reset keeps that factor, so a stolen mailbox alone is not enough. Without one, such an account is reset by the owner (or, for a non-coordinator, by a coordinator) with the temporary password under "More options". The check is repeated when the link is opened and when it is used, so a link made before the account gained a reserved right, or lost its factor, stops working. The public answer, its time and its wording do not change: nothing tells which case applied. A coordinator-only site is never locked out: a coordinator with a second factor uses the link, one without is reset by another coordinator or the owner.
10. **Who does what.** The short path (invite, resend, revoke, suspend, reactivate, change a role) needs only `core:team`, which a coordinator has; the owner is not needed. Only the owner touches coordinator-level accounts; nobody touches the owner (`canManageMember`). Each audit entry carries the acting level in `data.by`.
11. **Suspend and reactivate** are separate from delete. A suspended account cannot sign in by any path (password, ticket, passkey, 2FA step), loses its sessions at once and keeps its data. The owner is never suspended: nobody can suspend the owner (`canManageMember`), nor oneself, so the site always keeps its owner; a coordinator is suspended by the owner only. As a second lock, suspending an owner or coordinator account is also refused when no other active owner or coordinator would remain (`suspendMember`, reason `last`). It follows that the last coordinator can be suspended while the owner is active; the stricter rule "keep a coordinator" was not chosen because the owner can always act. Suspension is the additive column `User.suspendedAt`.
12. **Roles are generic.** The picker lists the predefined and custom roles the inviter is allowed to grant; no role name is hard-coded in any text. Role **presets** (contributor, moderator, editor in chief, reviewer) only fill the "New role" form with rights; they produce an ordinary custom role with no link back, never include reserved rights, are filtered by anti-elevation, add no built-in level, and show in the invitation picker only once created.
13. **Storage and backup**: additive migration only (one column, two tables, no foreign key). `Invitation` and `PasswordReset` are **excluded from backups**, and a restore **withdraws every waiting link** (`withdrawAllLinks`, tried twice, a failure is named in the restore report). The moment of the restore is stored (`security.lastRestoreAt`) and a link made or sent before it is refused when opened, so correctness does not depend on the cleanup having worked. Suspension survives a restore (a column of `User`). Rollback to an older core leaves the new tables and column unused; they can be dropped by hand (see the migration comment).
14. **Writes decide on one state.** Creating an invitation checks the existing account, the pending invitation to replace and the cap of 50 inside one transaction; replacing a pending invitation needs the right to revoke it (the same rule as `revokeInvitation`), otherwise the answer is "already pending". Accepting hashes the password first, then checks the grant again inside the transaction right before the conditional spend.
15. **Mail.** Core mail about people ("onboarding", "reset", "notice", 30 an hour each) has its own site-wide bucket (60 an hour), apart from the one modules share.
16. **The page forgets the token.** The one-time token held in the page's memory is cleared after a success (and on a redirect) and when the page goes away; an error keeps it so the person can correct a field.
17. **The assistant (MCP) surface cannot invite or read tokens**: no tool is registered for it, and a test fails if one appears.

## Known limits (reviewed, accepted)

- Limits are in memory and per process; a restart gives the same few tries again, and several processes do not share them.
- An invitation link that leaks before use gives the account to whoever uses it first: send it by a channel you trust, check the list, revoke in one click.
- The mailbox of an invited person is trusted for the invitation, like in any invitation flow.

## Consequences

- No temporary password is needed by default; a link that leaks after use or expiry is worthless.
- A link that leaks **before** use still gives the account to its holder: the inviter should send it through a channel they would use for the person; the list shows its state and revoking is one click.
- The auth secret now also keys these hashes: changing it kills every waiting link (people are invited again).
- In-memory limiters reset on restart and are per process: fine for one server, documented as a limit.
- Anyone changing `grantableLevels`, `LEVEL_RESERVED` or the role snapshot must re-read decision 4.

## Sources

`src/core/auth/{invitations,passwordReset,oneTimeToken,rateLimit,accountAudit,members,rolePresets}.ts`, `src/app/admin/(auth)/{invitation,forgot-password,reset-password}/`, `src/app/admin/(panel)/users/`, `src/core/backup/restore.ts`, `next.config.mjs`, `prisma/migrations/20261125090000_onboarding_invitations/`, `tests/core/onboarding-invitations.test.mjs`, `docs/SECURITE.md`.
