# 0002. The five `dependency*.ts` files stay five

Status: Accepted
Date: 2026-11-24

## Context

Modules declare services they `offers` and `requires`. Five files in `src/core/modules/` handle that, about 800 lines in total. They look mergeable (same prefix, same subject), and a first reading suggests one `dependencies.ts`.

## Decision

Keep the five files. Each has one job, stated in its own header, and the arrows between them go one way:

| File | Job | Changes anything? |
|---|---|---|
| `dependencies.ts` | The facts: who offers what, what is missing (`requirementGaps`), who depends on whom, and the call of a service by a consumer. | no |
| `dependencyPlan.ts` | The choice: WHO will provide a missing service, with a fixed rule and no randomness (installed provider, installed but too old and updatable, then the catalogue in index order; the official catalogue before the extra index; optional needs never enter). Also the preview. Pure: the installed modules and the catalogue are passed in. | "Ne modifie rien" |
| `dependencyInstaller.ts` | The execution: installs or activates providers (depth 3 at most, a cycle is refused) and records everything in a journal so that any failure is undone in reverse. It cannot clone or delete a module: `installer.ts` lends it those gestures (`DepOps`), which avoids a circular import. | yes |
| `dependencyMessages.ts` | Plain sentences for "what is missing". Pure: the translator and the names are passed in. | no |
| `dependencyView.ts` | The data of the screens (catalogue, extension sheet, module page, list) already in plain words; components only lay it out. | no |

Dependency arrows: `dependencyView` → `dependencyPlan` → `dependencies`; `dependencyInstaller` → `dependencyPlan` and `dependencies`; `installer.ts` → `dependencyInstaller`; `dependencyMessages` depends on none of the others.

## Consequences

- Do not merge them. Merging `dependencyInstaller.ts` into the others would force it to import `installer.ts`, which already imports it (the cycle `DepOps` removes); merging the planner with the installer would lose the read-only preview shown before anything is installed.
- A new rule about WHICH provider is chosen goes in `dependencyPlan.ts` (and its tests); a new gesture (undo, journal) in `dependencyInstaller.ts`; a new sentence in `dependencyMessages.ts`.
- The line references in [docs/V2-CONTRACTS.md](../V2-CONTRACTS.md) point into these files (`dependencies.ts`, `dependencyPlan.ts`, `dependencyInstaller.ts`): update them if you move code.

## Sources

Header comments and imports of the five files; [docs/V2-CONTRACTS.md](../V2-CONTRACTS.md) (rule of choice, `MAX_DEPTH = 3`, official before extra); [GLOSSARY.md](../../GLOSSARY.md) (install intent, cascade).
