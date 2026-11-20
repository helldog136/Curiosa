# Ceiling of personal AI assistants

**Property.** A personal AI can see and call a tool only if its owner could do what the tool does **right now**; the ordinary rules of the access (read-only ceiling, ticked boxes) still hold on top.
**Damage if broken.** A demoted, locked or switched-off person keeps a working assistant, or an assistant does something its person could not.

Files covered: `src/core/services/mcp/ownerCeiling.ts`, `src/core/services/mcp/access.ts` (`canUse`), `src/core/services/mcp/tokens.ts`, `src/core/services/mcp/server.ts`, `src/core/personalAi/{owner,policy,service,lifecycle}.ts`, `src/core/auth/{access,rights}.ts`, `src/core/maintenance/myAccess.ts`.
Last synced with: core 0.46.0, commit `57236d6`.

## Method (cheapest tool that answers each question)

| Question | Tool | Why |
|---|---|---|
| Is `canUse` for a personal access exactly "owner meets the requirement and the ordinary rules hold"? | Exhaustive enumeration of the pure functions, against an oracle written from the header comment (not from the code): 5 tiers x 8 rights x active/inert x 24 requirement shapes x scope x grants x full powers = 80,640 combinations | The logic is pure and small; no model checker needed. |
| Is that also true through the real server, resolver and database? | End-to-end matrix: 96 combinations of switch / override / lock / pause / level, each a real request; a demotion chain with every tool of the catalogue ticked | The resolver reads the database on every request; this is where "right now" is decided. |

## Invariants and results

| # | Invariant | Result | Evidence |
|---|---|---|---|
| C1 | Sound: allowed implies the owner meets the requirement now, and scope and ticked box allow it | holds | `formal-personal-ai-ceiling` test 1 (I1) |
| C2 | Complete: owner meets it and the ordinary rules allow it implies allowed (no useless closing) | holds | same (I2) |
| C3 | Fail closed: a tool nobody classified, an empty or invalid requirement, an inert owner are never allowed | holds | same (I3) + tests 3, 4, 6 |
| C4 | Full powers never reach a personal AI | holds | same (I4) + test 7 |
| C5 | Monotonic: lowering the owner (fewer rights, lower tier, inert) never allows more, over every pair of owners | holds | same (I5) |
| C6 | Demotion is immediate: at each step of owner > coordinator > admin > editor the visible set is exactly the documented one and only shrinks; a hidden tool answers "Unknown tool" although its box is ticked (a grant above the owner's rights is ignored) | holds | `formal-personal-ai-owner-matrix` test 1 |
| C7 | Revoked, paused, locked account, switch off, `deny`, missing right: the access answers nothing (401 or 403). 96 combinations, 7 answer | holds | matrix test 2 |
| C8 | A revoked access never answers again, whatever is done to it afterwards (ticks, secret address) | holds | matrix test 3 |
| C9 | `CORE_REQUIREMENTS` covers every core tool; a level 3 request is checked at execution with the same requirement as the tool that asked, for all 17 actions | holds (the first part was already tested in `personal-ai-ceiling.test.mjs`, the second is new) | matrix test 4 |
| C10 | No secret address, no full powers for a personal access | holds | already in `personal-ai-ceiling.test.mjs`, re-checked in C4/C8 |

**Anti-vacuity.** The enumeration reaches both outcomes (between 2,000 and half of the combinations are allowed). Ten mutants of `canUse` (no ceiling, unclassified tool open, empty requirement read as "none", full powers honoured, inert ignored, coordinator ranked as editor, grants ignored, read-only ignored, a grant overriding the owner, everything closed) are all caught. On the real code, five source mutations were run once by hand and each made a test fail (an undefined requirement open, `navigation_set` lowered to the editor tier, the coordinator ranked low, `maintenance_backup_run` lowered to the admin tier, the pause ignored). One mutation is **not** caught and cannot be: removing `owner.active` from `ownerCeilingAllows` changes nothing because `requirementMet` checks it again (redundant guard, equivalent mutant).

## Observations (no bug)

- `requirementMet({ none: true, right: "x" }, owner)` is true for an owner without the right: `none` wins. The header comment says several keys must all hold. Nothing builds such a requirement today (`declaredRequirement` only returns `{ right }`, the table has `none` alone), so it is latent only.
- `NEVER_UNDER_FULL_POWERS` is a default for independent accesses; a personal AI never gets full powers at all, so the list does not matter for it.

## Not covered

The composition of the real tool catalogue with every possible module (only the fixture module is used); concurrency between a request that is being handled and a demotion that lands in the middle of it (the owner state is read once per HTTP request, so a call that is already running finishes with the rights it started with, by design); the account pages (no screen yet in 0.46.0).

## Replay

```
npm test -- tests/core/formal-personal-ai-ceiling.test.mjs tests/services/formal-personal-ai-owner-matrix.test.mjs
```
