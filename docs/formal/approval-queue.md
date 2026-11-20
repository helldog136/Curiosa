# Level 3 approval queue

**Properties.** A request is approved at most once; a refused or expired request never runs; the plan is frozen at creation; a request that still waits is never lost; and what gets published is exactly what the owner was shown.
**Damage if broken.** An action runs twice, runs after it was refused, or the owner approves one thing and gets another.

Files covered: `src/core/maintenance/requests.ts`, `src/core/maintenance/publish.ts`, `src/core/maintenance/actions.ts` (`approveRequest`, `mayDecide`, `runGuarded`), the `closeInterrupted` part of `src/core/maintenance/background.ts`, `update_draft` in `src/core/content/mcp.ts`.
Last synced with: core 0.46.0, commit `57236d6`, plus the fixes of this review (core 0.46.1 branch: F1, F2, F4, `finishRequest` guard).

## Method

A **model-based test of the real queue** (the real functions and the real database, an injected clock): a small model of the queue, written from the header comment of `requests.ts`, runs in lockstep with the real code under 120 reproducible random sequences of 80 commands (create, claim, deny, reopen, finish, expire one owner's requests, time passing, list). After every command the whole real queue is compared with the model and the invariants are checked on the real data. TLA+ was not needed here: the queue is one JSON setting, so one process is a plain state machine; the interleavings between copies of the module and between processes (F4) were exercised directly, with two copies of the module loaded in one test and an injected foreign write.

## Invariants and results

| # | Invariant | Result | Evidence |
|---|---|---|---|
| Q1 | Approved at most once: successful claims minus reopens never exceeds 1; 8 concurrent approvals give exactly one winner | holds (one process) | `formal-approval-queue` tests 1, 3 |
| Q2 | Denied and expired are terminal | holds | tests 1, 4 |
| Q3 | A request past its time is never claimable, even if nobody swept it yet, exactly at the limit included | holds | tests 1, 4 |
| Q4 | The plan a claim returns is the plan frozen at creation | holds | test 1 |
| Q5 | At most `MAX_PENDING_PER_TOKEN` (5) wait per access; an identical pending request is returned, not duplicated | holds | test 1 |
| Q6 | Only the allowed arrows: pending to running, denied or expired; running to pending, done or failed | holds | test 1 |
| Q7 | The purge of old requests never removes a request that still waits or is running | **bug, fixed** (F1) | `formal-approval-queue-retention` |
| Q8 | What is published is what the owner was shown: any change to the draft after the request, in any field a visitor can see, makes the approval do nothing | **bug, fixed** (F2) | `formal-publish-fingerprint` |
| Q9 | An approval given after the owner lost the right never runs (the request is closed as refused); the right is the same as the one the tool asked with | holds | already in `personal-ai-lifecycle.test.mjs`; same-table check in `formal-personal-ai-owner-matrix` test 4 |
| Q10 | Two processes (or two copies of the module) cannot approve the same request twice | **bug, fixed** (F4) | `formal-approval-queue` tests 5 and 6 |

Navigation, home page and site settings plans (`change`, `site`) keep a fingerprint of the **whole state they started from** and re-check it before writing, so they do not have the F2 problem (read, not modelled).

## Findings

### F1 (fixed): a pending request can be evicted by newer finished ones
*Severity: low. Reachable by an owner who answers many requests of one noisy assistant.*
Trace on the real code: 1. `tok_quiet` creates a request (pending). 2. `tok_noisy` creates one request and the owner refuses it, sixty times. 3. `save` keeps the last 50 requests whatever their status, so the first one is cut. 4. `getRequest(quiet)` is `null`: the owner never sees it, `maintenance_request_status` answers "Unknown request", and an approval on its way answers "not found". The same happens with twelve accesses that have five requests pending each (60 > 50), and for a request that is running.
Where: `save` in `requests.ts` cut by position. Fix: only finished requests are cut (50 per class, independent and personal separately, as before); pending and running ones are always kept. They stay bounded: at most 5 per access, and each expires after 24 h, which makes it a finished one.
Test: `formal-approval-queue-retention.test.mjs` (red before the fix, three tests).
Residual: a request that finishes after 50 newer finished ones exist is cut at once (the retention is by position). Harmless for the owner (it is finished), but an assistant polling it right then gets "Unknown request". Not changed.

### F2 (fixed): the publication fingerprint ignores the link, code, tags, cover, icon and custom fields
*Severity: medium. Needs an assistant with a publication request waiting and the right to edit that draft.*
Trace on the real server: 1. an assistant creates a draft with `url: https://example.org/a`. 2. `<instance>__publish` creates a request (the owner is shown the title and languages). 3. the assistant calls `<instance>__update_draft` with another `url` (or `code`, or `tags`). 4. the owner approves; the fingerprint, which only covered the texts and the skin, is unchanged, and the entry is published pointing somewhere else. For a list of links, the link is the content.
Where: `fingerprint` in `publish.ts`. Fix: the fingerprint also covers `url`, `code`, `tags`, `cover`, `icon`, `fields` (`update_draft` can set the first three, a person can change the others in the admin). A pending request made before the update fails closed ("changed since the request, ask again"), it never publishes.
Test: `formal-publish-fingerprint.test.mjs` (red before the fix; an anti-vacuity test shows the same flow publishes when nothing changed). This changes the approval path (it only makes it stricter): review it as security-relevant; it is a separate commit and can be reverted on its own.

### F4 (fixed, conditional): the queue was a read-modify-write of one setting, serialised only inside one copy of the module
*Severity: medium if the condition holds, none otherwise. Not verified in a production Next.js build.*
`exclusive()` in `requests.ts` (and in `background.ts`) was a promise chain held in module scope, while the lock of the same file lives on `globalThis` so that every bundle shares one. With two copies of the module in one process, or two server processes on one database, two operations read the same list and the later write won.
Trace, reproduced with two copies of `requests.ts` loaded in one test: 1. a request is pending. 2. copy B claims it (running) while copy A creates another request; both read before either writes. 3. A writes its list last: the first request is **pending again**. 4. a second claim of the same request succeeds: it can run twice.
Fix, two layers. (1) The chain lives on `globalThis` (`curiosaRequestsChain`, and `curiosaRunsChain` in `background.ts`), so all copies in a process queue behind each other. (2) Every change goes through `transact`: read the raw value, compute, write with a **compare-and-swap** (`updateMany where value = the raw value read`; the first write is a create), and retry up to 12 times when another writer got in between, then fail with "the request queue is busy, try again". This covers a second process.
Tests: `formal-approval-queue` test 5 (two copies, 20 rounds of claim/create/claim: red before, one winner, nothing lost) and test 6 (a foreign write injected between read and write: one retry, no data lost). Not modelled in TLA+; the compare-and-swap is a standard pattern and the tests exercise the real database.

### Observations
- `finishRequest` used to record a result on any request, even a denied one. It now records only on a running request (or on one closed as interrupted, so the real result replaces the interruption); a late finish of a denied request changes nothing (test 4).
- `expirePendingOf` expires pending requests only; a request already running when the owner is demoted goes on (the approval was legitimate when it was given; `mayDecide` checked the right just before the claim). There is a window of two awaits between that check and the claim in `approveRequest` where a demotion would not be seen; it is not exploitable without the owner's own approval click and was not exercised.
- `runUpdate` (`scripts/update-lib.mjs`) read `state.json` for "running" and then wrote it; two starts in that window could both pass. Fixed: a short `state.claim` file created exclusively (`wx`, stale after 10 s) covers only that window; the `state.json` lifecycle is unchanged. Test in `tests/core/updates.test.mjs`. `startUpdate` only spawns this script, so it is covered by the same claim.

## Replay

```
npm test -- tests/services/formal-approval-queue.test.mjs tests/services/formal-approval-queue-retention.test.mjs tests/services/formal-publish-fingerprint.test.mjs
```

**Anti-vacuity.** The random sequences reach every status and every refusal reason and hit the per-access limit (asserted); a model whose claim ignores the status is caught; four mutations of `requests.ts` (claim without status check, claim without sweep, reopen of any status, no in-process lock) each fail the test.

## Next

A TLA+ model of two processes and the setting row with the compare-and-swap; the same fingerprint review for `skin_*`, `font_set` and `instance_add` plans (they re-read and compare in `execute`, not modelled here).
