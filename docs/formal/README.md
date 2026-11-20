# Formal review of the core

Small formal models and exhaustive or model-based tests that check the promises of the core that ordinary example tests reach badly: who may do what **right now**, what an approval really approves, and what happens when two things happen in an unlucky order. Each zone has one page here (the property, the model, the result, the files it covers, the commit it was last synced with).

| Zone | Page | Tools | Where the checks live |
|---|---|---|---|
| Ceiling of personal AI assistants | [personal-ai-ceiling.md](personal-ai-ceiling.md) | exhaustive enumeration, end-to-end matrix on the real server | `tests/core/formal-personal-ai-ceiling.test.mjs`, `tests/services/formal-personal-ai-owner-matrix.test.mjs` |
| Level 3 approval queue (approve once, retention, publication fingerprint) | [approval-queue.md](approval-queue.md) | model-based test of the real queue, regression tests | `tests/services/formal-approval-queue*.test.mjs`, `tests/services/formal-publish-fingerprint.test.mjs` |
| Maintenance lock and background runs | [maintenance-lock.md](maintenance-lock.md) | TLA+ (TLC), replay of its traces on the real code | `docs/formal/tla/MaintenanceLock*`, `tests/services/formal-maintenance-lock.test.mjs` |

## How it is used

- **The tests run in `npm test`** (node:test, no extra dependency, fixed seeds, an injected clock). A failure message names the seed and the last commands.
- **The TLA+ models are run by hand**, they are not part of `npm test` (they need Java and a 2 MB jar): `docs/formal/run-tlc.sh MaintenanceLock.tla MaintenanceLock_Code.cfg`. Each `.cfg` says in its first line whether TLC is EXPECTED to find a violation. TLC writes its working files to a temporary folder, never into the repository.
- **Every check must be able to fail.** Each zone has an anti-vacuity part: mutants of the code or of the model that the checks must catch, and "interesting state is reachable" checks. A check that cannot fail is removed, not kept.
- **A model is not the code.** The pages say what each action of a model corresponds to (`file:function`) and which traces were replayed on the real code.

## Keeping a page true

When a file listed under "Files covered" changes, read the page before merging and move its "Last synced with" line to the new commit. If a rule changes on purpose (for example the lock gets a lease), change the model and the test that pins the old behaviour in the same pull request.

## Not covered yet

The core update flow after a crash at each step (`scripts/update-lib.mjs`, `src/core/updates/service.ts`), module installation, migration and uninstall dependencies (`src/core/modules/`), and the token lifecycle beyond what the ceiling pages check. See the "Next" part of each page.
