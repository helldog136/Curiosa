# 0001. The `menu*.ts` files are split along the client/server boundary

Status: Accepted
Date: 2026-11-24

## Context

The public menu has an editor that runs in the browser (`NavEditor.tsx`, `NavPicker.tsx`, both `"use client"`) and a server side that reads and writes the database and renders the header. In Next.js a file that a client component imports as a value ends up in the browser bundle, so it must not import the database client (`prisma`), the settings store or anything that reads the server.

## Decision

`src/core/menu*.ts` is split by what each file needs to import:

| File | Imports | Role |
|---|---|---|
| `menu.ts` | nothing server-side | the model, its caps, the defensive reading of stored data, the conversion of the old menu. Its header says it is pure logic ("ni base ni React"). |
| `menuTree.ts` | `menu.ts` only | the moves of the two-level tree (up, down, into the previous submenu, out). Pure functions that the editor calls from its buttons and the tests call as they are. |
| `menuInput.ts` | `menu.ts`, `url.ts` | what the editor sends is never trusted: references must exist, addresses are validated, caps applied. Pure; the database is read beforehand by the store. |
| `menuStore.ts` | `prisma` | reading, one-time migration of the old menu, saving, adding and removing an instance. Takes the connection or transaction as a parameter. |
| `menuResolve.ts` | `prisma`, registry, settings | turns the stored menu into what the public header shows. |
| `menuCatalog.ts` | `prisma`, registry | everything that can enter the menu, searched and paged for the "Add to menu" picker. |

The client editor imports **values** only from `menu.ts` and `menuTree.ts`; from `menuCatalog.ts` it imports **types** (`import type`), which cost nothing in the bundle. The same split exists for the admin sidebar in `src/core/modules/`: `menuPath.ts` and `menuPlacement.ts` are pure and are imported by client components (`MenuTreeNav.tsx`, `NavGroup.tsx`); they do not import each other, and a test keeps their shared list of sections equal (`MENU_SECTIONS`, see the comment of `menuPath.ts`).

## Consequences

- A function that the editor needs goes in `menu.ts` or `menuTree.ts`, never in a store, resolver or catalog file. Adding an import of `prisma`, settings or the registry to `menu.ts`, `menuTree.ts` or `menuInput.ts` moves server code into the browser bundle and breaks the build or leaks logic: put that code in `menuStore.ts`.
- `tests/core/menu-model.test.mjs` exercises `menu.ts`, `menuTree.ts` and `menuInput.ts` on their own; `tests/core/menu-db.test.mjs` exercises the store and the resolver against a database. Merging the files would lose that separation.
- Six small files are the price. Do not merge them to reduce the file count.

## Sources

`src/core/menu.ts`, `menuTree.ts`, `menuInput.ts`, `menuStore.ts`, `menuResolve.ts`, `menuCatalog.ts` (header comments and imports); `src/components/admin/NavEditor.tsx` (imports); `src/core/modules/menuPath.ts` (comment on `SECTION_IDS`); [docs/PLATFORM.md](../PLATFORM.md) (menu editor, migration, catalogue and search).
