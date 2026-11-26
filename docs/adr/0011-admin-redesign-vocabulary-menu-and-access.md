# 0011. Admin redesign: one word for installed pieces, a declared menu, one access table

Status: Accepted
Date: 2026-11-26

## Context

An audit of the admin (core 0.50.0, 118 crawled routes, 30 findings) and an approved mockup lead to a redesign of the shell and of the pages, delivered in phases that each leave `dev` shippable. Three decisions have to be fixed before any phase touches the code, because every later phase depends on them and a reader of the code would otherwise question or undo them:

1. **Vocabulary.** The same installed piece is called "extension" in some places, "module" in others and "feature" (fonctionnalité) in others. The route is `/admin/extensions`, the menu says "Extensions", the manifest file is `module.json`, the audit journal says "Fonctionnalité installée" (`audit.action.module.*`), and the glossary of the interface ([`docs/TRANSLATING.md`](../TRANSLATING.md)) defines "extension" as "a feature added to the site". Rule R12 of [`docs/ERGONOMIE-ADMIN.md`](../ERGONOMIE-ADMIN.md) asks for one word per thing.
2. **Menu.** Each module reaches the menu through several keys (`place`/`places[]`, `family`, `menuGroup`, `adminMenu`, `adminMenuOrder`, `adminMenuLabels`; [`docs/MODULES.md`](../MODULES.md)), the module emoji, and a mapping in [`adminNav.ts`](../../src/core/modules/adminNav.ts). Nothing says what a module is allowed to declare and what the core decides.
3. **Access.** Each page checks its own need with `adminCtx(need)` ([`admin.ts`](../../src/core/admin.ts)). The sidebar, the dashboard tiles and the module-contributed shortcuts do not share one table, so a person can see an entry that leads to a refusal, and an entry can stay hidden for a person who holds the right.

Owner decisions that bind this record: the single term is "module"; the menu follows the brief and the mockup; each person sees only what they can open; a first-class "Roles" area exists; nothing disappears (no route and no menu entry is removed unless a phase says so); the core is released only when the owner says so.

## Decision

### 1. Vocabulary: "module", and only "module"

- A piece installed from the catalogue is a **module** in English and **module** in French. "Extension", "plugin", "add-on" and "fonctionnalité" are retired for that concept in everything a person reads.
- **Kept as they are**: URLs and route segments (`/admin/extensions` stays canonical, with no alias by default), stable i18n keys (`extensions.*`), manifest keys, code identifiers, and data already written to a journal. Display text of audit codes is rewritten (`audit.action.module.*` reads "Module installed" / "Module installé").
- **Kept because the meaning differs**: AI "features" (`aim.*` keys), a browser extension, and any generic use of "feature" that does not name an installed piece.
- **Titles of place pages**: "extensions" stays forbidden and "module" stays redundant in a place title; "modules" is added to both lists in [`places.ts`](../../src/core/modules/places.ts) (a page titled "Modules" under the Modules area says nothing more). `RESERVED_GROUPS` keeps "extensions" because it is a URL segment.
- The migration is a re-runnable script, run in the vocabulary phase, not here. This record and the two glossaries state the target; the kit check that fails on a retired term is added only after the migration, so that it never fails on a text nobody has had the chance to change.

### 2. Menu: declared, never hand-built

The sidebar has a fixed shape: top entry (dashboard), then the sections Content, Community, Tools, Site and Administration, then a pinned block at the bottom (person and role, my account, view the site, report a bug, sign out). Empty sections disappear. Administration holds Modules, AI assistants, Team, Roles and Maintenance.

A module may declare only: `place` / `places[]` (the vocabulary page and tab where its settings live), `family`, `menuGroup` (legacy), `adminMenuOrder`, `menuIcon` (a key of an allowed set of SVG icons; new, optional), `rights`, and `dashboard.{tasks, quickActions, cards}` with an optional `right` on each contribution. The sidebar never reads the module emoji or a free-form `adminMenu` for a new module; a legacy `adminMenu` is mapped to a placement by `defaultPlacement` ([`adminNav.ts`](../../src/core/modules/adminNav.ts)). The emoji stays on cards only.

New manifest keys are additive: an older core ignores unknown keys, so they need no `minCore` bump. A brick that a module consumes does need a `minCore` bump, and such a change in the modules repository waits until the core release that carries the brick exists.

### 3. Access: one table, consumed everywhere

One module, `src/core/adminAccess.ts`, exports `canOpen(user, href)`. It is built from one table of `{ pattern, need }` that mirrors each page's `adminCtx(need)`. Its consumers are the sidebar, the dashboard blocks, the module-contributed `tasks`, `quickActions` and `cards`, and the search results.

- A test scans the admin pages for their `adminCtx(...)` calls and fails when the table disagrees with a page. The page stays the authority; the table is checked against it, never the other way round.
- A contribution that targets a core route must declare `right`; the kit check `dashboard.valid` becomes stricter in a later phase.
- Visibility levels: the owner sees everything; a coordinator everything except owner-reserved rights; an admin the pages that need `admin` plus the rights granted; an editor the dashboard, entries and drafts, short links, the modules they hold `<module>:open` for, and their own account; a custom role exactly the pages whose right it holds. Other entries vanish from the menu and the dashboard.
- A denial on a page names who can help ("Reserved to Administration. Ask <name>.") instead of the generic banner.
- Hiding an entry is a convenience, never the protection. Every page and every action keeps its own server-side check (see [ADR 0006](0006-permissions-facade.md) for the access-check import path and [ADR 0007](0007-ai-access-owner-is-permanent.md) for what an owner holds permanently).

### 4. Rules added to the ergonomics document

R34 (vocabulary), R35 (access), R36 (page titles) and R37 (the word beside a row switch) are written in [`docs/ERGONOMIE-ADMIN.md`](../ERGONOMIE-ADMIN.md). They are review rules at first. The automatic kit is not tightened by this record; each rule gets its check in the phase that makes the code comply.

## Consequences

- Easier: one word everywhere, one place to read what a module may declare, one table that answers "can this person open this?" for the whole admin.
- Harder: a new admin page must add its row to the access table, or the scanning test fails. A new module key for the menu is a core change, not a module-local choice.
- History is not rewritten: old journal rows, URLs and i18n keys keep the old word on purpose. A reader who finds "extension" in an identifier or a URL is looking at a kept name, not a missed one.
- Before changing this: the redirect default for `/admin/extensions` (none), the list of retired words, and the claim that hiding is not protection.
- The extras repository carries an identical copy of `docs/ERGONOMIE-ADMIN.md`; it is synchronised in a separate change there, after this one is merged.

## Sources

- [`docs/ERGONOMIE-ADMIN.md`](../ERGONOMIE-ADMIN.md): R12, R14, R15, R17, R33 and the new R34 to R37.
- [`docs/TRANSLATING.md`](../TRANSLATING.md) (glossary of the interface) and [`GLOSSARY.md`](../../GLOSSARY.md) ("Module").
- [`docs/MODULES.md`](../MODULES.md): `family`, `menuGroup`, `adminMenu`, `adminMenuOrder`, `adminMenuLabels`.
- [`src/core/modules/adminNav.ts`](../../src/core/modules/adminNav.ts): `defaultPlacement` and the menu mapping.
- [`src/core/modules/places.ts`](../../src/core/modules/places.ts): `FORBIDDEN_TITLE_WORDS`, `REDUNDANT_TITLE_WORDS`, `RESERVED_GROUPS`.
- [`src/core/admin.ts`](../../src/core/admin.ts): `adminCtx`.
