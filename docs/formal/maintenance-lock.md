# Maintenance lock and background runs

**Properties.** One maintenance operation at a time; the site is never blocked for ever; a record that says "running" is closed when its work is gone, and only then.
**Damage if broken.** Two updates or installs touching the same files and database at once, or a site that refuses every maintenance action until it restarts, or a running action shown as dead.

Files covered: `src/core/maintenance/background.ts` (`takeLock`, `currentLock`, `closeInterrupted`, `runInBackground`), `src/core/maintenance/requests.ts` (`listRequests`), `src/core/maintenance/actions.ts` (`launch`, `withLock`, `runGuarded`).
Last synced with: core 0.46.0, commit `57236d6`, plus the lease fix of this review (core 0.46.1 branch).

## Method: TLA+ with TLC

The interleaving matters (time passes, work hangs or is slow, the server restarts, a sweep runs), so a model checker is the right tool. `docs/formal/tla/MaintenanceLock.tla`: operations, a clock in ticks (`Stale` = `LOCK_STALE_MS`, `Interrupted` = `INTERRUPTED_AFTER_MS`), the lock, the set of running work, the set registered in `active()`, the records, and the actions `Start` (`takeLock` + `openRun` + `active().add`), `Finish` (`release` only if the lock is still ours, then the record), `Hang`, `Tick`, `Sweep` (`closeInterrupted`) and `Restart`. Assumption: **one server process per site** (the lock is in memory, `globalThis`).

| Run (`docs/formal/run-tlc.sh MaintenanceLock.tla <cfg>`) | Expected | Result |
|---|---|---|
| `MaintenanceLock_Code.cfg` (the code before the fix) | `AtMostOneLive` violated | violated in 6 steps (Start, four Ticks, Start), see F3 |
| `MaintenanceLock_Lease.cfg` (lock renewed by progress: **the code now**) | all hold | **no error**, 3,224 distinct states |
| `MaintenanceLock_Inline.cfg` (an operation not registered in `active()`) | `NoFalseInterrupt` violated | violated in 3 steps (Start, Tick, Sweep), see O1 |
| `MaintenanceLock_NoStaleRule.cfg` (no stale rule) | `NeverStuck` violated | violated: a hung operation blocks everyone for ever, the reason the rule exists |
| `MaintenanceLock_Vacuity_NeverTwoStarted`, `_NeverLiveWork`, `_NeverInterrupted` | each violated | violated: two operations can run in turn, live work exists, a record can be interrupted |

## Findings

### F3 (fixed): the lock of a slow but alive operation was ignored after 30 minutes
*Severity: low to medium (needs an operation that really lasts more than 30 minutes, for example updating many modules over a slow network).*
Trace (model and replay on the real code with an injected clock): 1. `modules_update_all` takes the lock and works. 2. 31 minutes pass, the work is still alive. 3. `currentLock()` finds `now - since > LOCK_STALE_MS`, ignores the lock and logs it. 4. `module_install` takes the lock: two maintenance operations run at once. (The late `release` of the first does not free the second: it releases only its own lock.)
Fix: a **lease**. `takeLock` returns `touch()`, which sets `since` to now while the lock is still ours; `runInBackground` calls it on every `ctx.step` and `ctx.setPlan`. `LOCK_STALE_MS` stays as the safety net, now meaning "no progress for 30 minutes": a truly dead or hung operation still cannot block the site for ever. No timer renews it on purpose, because a timer would keep a hung operation alive (`NoStaleRule` shows why the rule must stay). Limit: work that makes no step for 30 minutes (one single very long step) is still treated as hung.
Tests: `formal-maintenance-lock` (the old "KNOWN, reported" test now pins the lease; a second test shows a background run renews through `ctx.step`).

### O1 (observation, benign): an action run inline is shown as "failed: interrupted" while alive
`closeInterrupted` trusts `active()`, which only background actions fill (`BACKGROUND_LEVEL3`). An approved request of another action (for example `skin_activate`) that runs longer than 2 minutes is closed as interrupted by the next listing, then replaced by its real result by `finishRequest` when it ends (`Finish` overwrites). The final record is true; only the intermediate display is wrong. Pinned by test 4.

### Other checks
- Release only by the owner of the lock, twice is harmless, a late release never frees a newer lock: holds (test 1, test 2).
- A registered background action is never closed as interrupted, however long it runs: holds (test 5; model without `Inline`).
- Several processes: the lock and `active()` are per process, so the lock does **not** exclude a second process; this is the documented single-process assumption, not tested.

## Replay

```
docs/formal/run-tlc.sh MaintenanceLock.tla MaintenanceLock_Code.cfg      # expect: Invariant AtMostOneLive is violated
docs/formal/run-tlc.sh MaintenanceLock.tla MaintenanceLock_Lease.cfg     # expect: No error has been found
npm test -- tests/services/formal-maintenance-lock.test.mjs
```
TLC 2.19, Java 21, 2 workers or more; each run takes a few seconds.
