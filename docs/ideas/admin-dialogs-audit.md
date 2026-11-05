# Admin dialogs audit: which edit screens should open in a window

Status: audit (read-only study, no code changed). Written against core `dev` at `93ad05fd` (after 0.6.10) and `curiosa-extras` `dev` at `81572e4e`.

## 1. Why this audit

Since core 0.6.7 a module (or a core page) can open the edit form of one list item in a **modal window** above the admin page: `presentation: "dialog"` on `table.rowActions[]`, `links.items[]` and `adminForm` (see `docs/MODULES.md`, "Edit dialog", and `docs/ERGONOMIE-ADMIN.md` section 11). The window is `ModalWindow.tsx`, the same one used by the extension details before an installation. The list keeps its search, filter and scroll; Esc and "Back" close it; typed values are protected by a discard question.

The owner wants this principle applied to the other admin screens that have the same problem:

- an edit or create form inserted as a **persistent section** at the top (or just below the list) of the page, which pushes the list down; or
- a **whole page** replaced by one short form (the list disappears for a 1-to-3 field edit).

Nothing in this audit changes behaviour. It is the backlog and the adoption order.

### Brick facts that drive the classification

- Shipped in **core 0.6.7** (PR #115, release `ed2b468`); still present in 0.6.8 to 0.6.10 (the published core today is 0.6.10). `docs/MODULES.md` still titles the section "next core release": stale, to fix when that file is next touched.
- It needs **no `minCore`**: an older core ignores `presentation` and shows the form in the page as before. One exception: a "New item" `links` entry with a `?...` address shows as `#` on a core older than 0.6.7 (use a `rowActions`/toolbar fallback or `minCore: 0.6.7` for that button).
- The dialog hosts **one `adminForm` only** (title, fields, one main button in a sticky footer, a discreet "Cancel"). `opensInDialog` (`src/core/adminkit/dialog.ts`) refuses a form with a `file` field, a form outside the admin panel and a form in an entry panel (`entry` scope). A success closes the window and shows a short "Saved." near the saved row.
- The window opens from a **link with an `href`** (`?edit={id}`), so the list must be a core `table` (or `links`) block, not hand-written `html`.
- Modules written for 0.6.0 and later already have the bricks that make a dialog form short: `folded` fields, `segmented`, `duration`, `period`, `datetime`, `number` with unit, `example`, row `inMenu`/`danger`, `searchable`, `filters`, `switch`, `badge`. Older modules (`minCore` below 0.6.0) need 0.6.0 to fold their rare fields anyway (kit requirement `compat.minCore`).

### Classes

- **A**: becomes a dialog. Editing one item of a list, quick create, small form (target: 2 to 7 fields, and at most 5 visible after folding, R4).
- **B**: stays a page. Long editors (blog/pages, entries), home layout, overlay builder, menu editor, step-by-step wizards, dashboards, imports (file upload), detail pages that hold several sections or sub-tables.
- **C**: already a dialog.

## 2. Totals

| Where | A (to convert) | B (stays a page) | C (already a dialog) |
|---|---|---|---|
| Core (`src/app/admin`, `src/components/admin`) | 7 forms (5 small, 2 medium; one of the medium ones blocked by a brick gap) | 24 screens | 8 windows (4 of them old native `<dialog>`, see G1) |
| `curiosa-extras`, 70 modules | **49 forms in 24 modules** (36 small, 13 medium) | about 32 screens | 0 (no module uses `presentation: "dialog"` yet) |

Module census (70 modules): 24 have at least one A form; 21 have an admin panel but only status/test/dashboard/long-editor screens (all B); 6 are content collections edited by the core entry editor (`blog`, `pages`, `links`, `codes`, `collection`, `sponsors`: B, `links` is a later candidate, see G11); 19 are settings-only (social networks, `hero`, overlays...) and have no edit screen at all.

## 3. Core screens

### 3.1 A: to convert

| # | Screen and file | Visible fields | Main action / destructive | Effort | Notes |
|---|---|---|---|---|---|
| C-A1 | New short link, `src/app/admin/(panel)/redirects/page.tsx:113` (section above the list) | 2 (address, name); 4 folded | "Add the link" / none | small | Server component: needs G1. Pushes a 200+ line list down. |
| C-A2 | Link settings, `redirects/[id]/page.tsx:118` ("Settings" section after QR code and statistics) | 3 (+2 advanced) | "Save" / "Delete the link" (already a separate section) | medium | The detail page (QR, statistics) stays B. Add an "Edit" row action on the list that opens this form. |
| C-A3 | Invite a person, `users/page.tsx:176` and `:205` (two copies of the form) | 2 (email, access level); name and first password folded | "Add the person" / none | small | Also remove the duplicated JSX. |
| C-A4 | Add an AI assistant, `users/page.tsx:201` (`McpTokenCreator`) | 2 to 3 | "Create the access" / none | medium | **Blocked** by G3: the result is a show-once secret and a connection guide, which must stay visible after the save. |
| C-A5 | New overlay page, `overlay-pages/page.tsx:38` | 2 (name, resolution) | "Create the page" / none | small | Needs G1. |
| C-A6 | Rename an overlay page, `overlay-pages/page.tsx:75` (inside a "More" `<details>` on each card) | 1 | "Rename" / "Delete the page" (menu) | small | Also replaces the "Turn on/off" button by a switch (R17) and the two buttons per card by a row menu (R16). |
| C-A7 | Edit a social network, `social/page.tsx:156` ("Edit" opens the full page `/admin/instances/{id}`) | the network's own settings (<= 5) | its own | small | Open the instance in the existing extension window (`RouteModal`) instead of a full page: add an intercepting route under `social`, like `extensions/@modal/(..)instances/[id]`. |

### 3.2 B: stays a page (24)

Entry editor (`entries/[id]`, `entries/new`, `EntryForm`: blog, pages, links...), entry templates, home layout (`HomeBuilder`), overlay page builder (`overlay-pages/[id]`), menu editor (`navigation`), header links tab, site settings tabs (`settings`), appearance, setup wizard, domain wizard (`settings/address`), updates, legacy upkeep, content check, backup, mode, account (two cards), assistants hub, assistant detail (rights editor, limits), AI visibility, team page (list, two-factor setting), redirect detail page (QR, statistics), extensions catalogue (`extensions/add`), dashboard, journal/audit. Plus the auth screens (login, choose password).

### 3.3 C: already a window (8)

- `RouteModal` over `ModalWindow`: extension details before installation (`extensions/add/@modal/(.)details`), module window (`extensions/@modal/(..)modules/[id]`), instance window (`extensions/@modal/(..)instances/[id]`).
- Native `<dialog>` (older, not `ModalWindow`): role edit and role create (`users/RolesPanel.tsx` with `FormDialog`), member roles (`MemberRoleDialog`), temporary password (`TemporaryPasswordButton`), skin preview (`appearance/PreviewDialog.tsx`, a viewer, not a form). These four edit dialogs have no history entry, no discard guard and no window stack: see G1.

## 4. Modules (`curiosa-extras`)

`Now` is the current `minCore` of the module. The dialog itself needs **no** `minCore`; the column `Needs` is what the adoption PR needs for its own sake. Effort: S = about a day, M = two to three days (list rebuilt or many fields to fold).

### Batch 1: `twitch-bot` (the original example)

**Wait for the other agent's latency PR on `modules/twitch-bot` before touching this module.** Its screens and `adminkit.mjs` change there; adopting now would conflict.

| # | Form and file | Visible fields | Main action / destructive | Effort | Now / Needs |
|---|---|---|---|---|---|
| TB1 | Command, create and edit: `commandsUi.mjs:102` (`commandForm`) | 3 (name, answer, who can use); 5 folded (other names, waits, period, repeat) | "Add the command" or "Save the command" / "Delete" (now a table in `admin.mjs:149`: move to the row menu) | M | 0.6.4 / none |
| TB2 | Timer, create: `timersAdmin.mjs:100`; edit goes through TB1 with repeat | 2 (name, text); 2 folded | "Add the timer" / "Delete" (`timersAdmin.mjs:164`) | S | 0.6.4 / none |
| TB3 | Reward, create and edit: `rewardsAdmin.mjs:91` (`rewardForm`) | 3 (title, cost, what it does); 7 folded | "Add the reward" or "Save the reward" / "Delete" already in the row menu (`rewardsAdmin.mjs:222`) | M | 0.6.4 / none |
| TB4 | Action rename: `rewardsAdmin.mjs:253` | 1 (+1 advanced) | "Save" / "Remove" in the row menu | S | 0.6.4 / none |

Why M and not S: the command and timer lists are **hand-written HTML** (`K.listShell` in `adminkit.mjs`, `commandsUi.mjs:61`, a script loaded through an image `onload`), written when core 0.5 had no live search, switch or folded zone. A dialog link needs a core `table` block; every brick the module imitated now exists in the core (`searchable`, `filters`, `badge`, `switch`, `inMenu`). The migration removes `adminkit.client.js`. Partner and network rows keep their "Open the partner file" link (R30), not a dialog. The partner-command page (`entry.mjs:50`) is an **entry panel**, which cannot host a dialog (G9): it stays a page.

### Batch 2: five modules where the form sits at the top or below the list

| # | Form and file | Visible fields | Main / destructive | Effort | Now / Needs |
|---|---|---|---|---|---|
| CD1 | `countdown`: event, quick create and full edit, `admin.mjs:98-170` (form below the list; the edit also shows a preview and three copy links) | quick 5 (title, date, time, all day, zone); full 15, 11 of them folded, including an image | "Add the event" / "Save" / "Delete" in the row menu | M | 0.6.0 / none |
| CM1 | `calendar-manual`: stream slot, `index.mjs:48` (the edit replaces the whole page, `index.mjs:70`) | 11 today; 5 after folding (title, date, start, end, games) | "Save the slot" / "Delete" in the table | M | 0.6.0 / none (G6 for repeat and until) |
| PL1 | `platform-links`: link, `index.mjs:219` (form below the list, with up/down/delete as separate forms) | 6 today; 3 after folding (platform, address, label) | "Save the link" / "Delete" with a tick box becomes a confirmed row action | S | 0.2.13 / 0.6.0 (to fold) |
| MP1 | `map`: place, `admin.mjs:47-72` (form at the **top** of the page) | 10 today; 4 after folding (name, type, address, published) | "Save the place" / "Delete" (`admin.mjs:65`, separate table) | M | 0.6.0 / none |
| MP2 | `map`: city, `admin.mjs:173`; MP3: place type, `admin.mjs:150` | 4 / 2 to 3 | "Save" / row menu | S | 0.6.0 / none |
| EV1 | `events`: quick add, `admin.mjs:55` (below the list) | 6 today; 3 after folding (title, date, time) | "Add the event" / none | S | 0.6.0 / none |
| EV2 | `events`: event type, `admin.mjs:253` | 3 to 5 (name per language, colour, icon) | "Save" / row menu | S | 0.6.0 / none (G5) |

`events` keeps its long event editor (essential, where, program, media, after-event sections, `admin.mjs:68-190`) as a page (B).

### Batch 3: five content-list modules

| # | Form and file | Visible fields | Main / destructive | Effort | Now / Needs |
|---|---|---|---|---|---|
| FQ1 | `faq`: question (and "answer a visitor question"), `admin.mjs:44` | 4 for one language, 6 for two (question and answer per language, theme, state) | "Save the question" / "Delete" in the table | M | 0.2.6 / 0.6.0 (G5) |
| FQ2 | `faq`: theme, `admin.mjs:73` | 1 per language | "Save" / row menu | S | idem |
| GA1 | `gallery`: album, `admin.mjs:41` | 6 (title, date, description, mode, link, state); 4 after folding | "Save the album" / "Delete" | S | 0.6.0 / none |
| GA2 | `gallery`: photo caption, `admin.mjs:62` | 3 | "Save" / hide switch | S | 0.6.0 / none |
| GA3 | `gallery`: add a photo by address, `admin.mjs:74` | 3 | "Add the photo" / none | S | 0.6.0 / none |
| IB1 | `idea-box`: edit an idea, `admin.mjs:67` (replaces the page) | 3 (+2 folded) | "Save the idea" / "Delete" in the row menu | S | 0.6.0 / none (merge flow: G7) |
| TS1 | `testimonials`: edit a review, `admin.mjs:119` (form at the top, with a consent record above it) | 7 today; 4 after folding | "Save the review" / "Delete" | M | 0.6.0 / none (G2, G4) |
| TS2 | `testimonials`: add a review, `admin.mjs:137` | 4 | "Add the review" / none | S | 0.6.0 / none |
| VD1 | `videos`: add, `admin.mjs:64` (form at the top) | 2 (+2) | "Add the video" / none | S | 0.6.0 / none |
| VD2 | `videos`: edit a video, `admin.mjs:122` (whole page, 11 fields, side forms publish/hide/refresh/delete) | 11 today; 4 after folding | "Save the video" / "Delete" in the row menu | M | 0.6.0 / none (G3, G4) |
| VD3 | `videos`: category add and rename, `admin.mjs:212`, `:233` | 1 per language | "Save" / row menu | S | idem (G5) |
| VD4 | `videos`: series add and rename, `admin.mjs:223`, `:243` | 3 | "Save" / row menu | S | idem |

### Batch 4: five modules with record forms

| # | Form and file | Visible fields | Main / destructive | Effort | Now / Needs |
|---|---|---|---|---|---|
| CO1 | `commissions`: formula, `admin.mjs:154` (below the list; delete is a separate table `:165`) | 6; 4 after folding | "Save the formula" / "Delete" in the row menu | S | 0.2.5 / 0.6.0 |
| PA1 | `partnerships`: new partner, `admin.mjs:31` (`partnerForm`, form below the overview) | 14 today; 3 after folding (brand, status, address) | "Add the partner" / none | M | 0.2.2 / 0.6.0 |
| PA2 | `partnerships`: edit partner, same form (replaces the page) | 14; 4 after folding | "Save the partner" / "Delete" in the row menu | M | idem (G4: logo) |
| PA3 | `partnerships`: journal entry, `admin.mjs:78` | 3 | "Add the note" / row menu | S | idem |
| CS1 | `community-stats`: manual figure, add, `admin.mjs:52` | 6; 4 visible | "Add the figure" / none | S | 0.5.0 / 0.6.0 |
| CS2 | `community-stats`: manual figure, update, `admin.mjs:45` | 2 | "Save the figure" / none | S | idem |
| SU1 | `supporters`: tier label, `admin.mjs:191` (replaces the page) | 1 per language + rank | "Save the tier" / none | S | 0.6.0 / none |
| YA1 | `youtube-live-actions`: rule, `admin.mjs:175` (below the list) | 8; 4 after folding | "Save the rule" / "Delete" in the row menu | M | 0.2.6 / 0.6.0 (G6) |

### Batch 5: five modules where a short edit replaces the page

| # | Form and file | Visible fields | Main / destructive | Effort | Now / Needs |
|---|---|---|---|---|---|
| DI1 | `directory`: category label, `admin.mjs:175` (page with up/down/remove/bind forms) | 1 per language | "Save the label" / "Remove" in the row menu | S | 0.6.0 / none |
| DI2 | `directory`: team role, `admin.mjs:258` | 1 per language | "Save the role" / "Remove" | S | idem |
| DI3 | `directory`: person profile, `admin.mjs:331` | 2 to 3 (bio per language, city) | "Save the profile" / "Hide" | S | idem |
| TW1 | `thanks-wall`: honour of the month, `admin.mjs:133` | 2 to 3 | "Save" / "Remove" | S | 0.5.0 / 0.6.0 |
| TW2 | `thanks-wall`: message, `admin.mjs:191` | 1 per language | "Save" / none | S | idem |
| MA1 | `mascot`: phrase, `admin.mjs:100` (above the list) | 6; 3 after folding (text, kind, state) | "Save the phrase" / "Delete" in the row menu | S | 0.5.0 / 0.6.0 |
| DG1 | `daily-game`: question, `admin.mjs:229` (`questionForm`; a type decides the fields) | 4 to 6 + 4 folded | "Save the question" / "Delete" (now a table, `admin.mjs:104`) | M | 0.6.0 / none (G5) |
| GS1 | `game-suggestions`: add a game, `index.mjs:309` | 2 (+2 folded) | "Add the game" / none | S | 0.6.0 / none |
| GS2 | `game-suggestions`: add several games, `index.mjs:309` | 1 | "Add the games" / none | S | idem |
| GS3 | `game-suggestions`: cover address, `index.mjs:332` | 1 (with a status paragraph above: G2) | "Save the cover" / none | S | idem |

### Batch 6: remaining forms, and the modules other agents are editing

| # | Form and file | Visible fields | Main / destructive | Effort | Now / Needs |
|---|---|---|---|---|---|
| CT1 | `contacts`: add a person from a network, `admin.mjs:210` (whole page with two tabs) | 3 | "Add the person" / none | S | 0.2.2 / 0.6.0 |
| CT2 | `contacts`: new category, `admin.mjs:298` | 2 | "Create the category" / none | S | idem |
| CT3 | `contacts`: rename a category, `admin.mjs:286` | 1 | "Rename" / "Delete" in the row menu | S | idem |
| CT4 | `contacts`: add an account to a contact, `admin.mjs:138` | 2 | "Add the account" / row menu | S | idem |
| CT5 | `contacts`: add a note, `admin.mjs:177` | 1 | "Add the note" / row menu | S | idem |
| PO1 | `polls`: create, edit, copy a poll, `index.mjs:775`, `:1129`, `:1206` (form above the list) | 6 today; 3 after folding (question, choices, end) | "Create the poll" / "Delete" (`index.mjs:1172`, a page of its own) | M | 0.5.0 / 0.6.0 |
| RA1 | `twitch-raid`: attach a pseudo to a contact, `add-admin.mjs:116` | 1 | "Attach" / none | S | 0.2.12 / 0.6.0 |

`polls` (and `audience`, which has no A form) are being edited by another agent: **do not start PO1 until their PR is merged.** The contact edit form (`contacts/admin.mjs:268`, up to 12 fields with categories) stays a page (B) for now; fold it later if wanted.

### Counts

A: 4 + 8 + 12 + 8 + 10 + 7 = **49 forms in 24 modules** (S 36, M 13). The modules, per batch: 1 (`twitch-bot`), 5, 5, 5, 5, 3 (`contacts`, `polls`, `twitch-raid`).

### B screens in modules (about 32, no dialog)

`contacts` (manual add/edit file, merge comparison, CSV import, erase), `content-planner` (idea page with three forms; the list is hand-written cards), `events` (event editor sections, CSV import), `commissions` (order detail, queue settings), `partnerships` (partner file with journal and linked contacts, CSV import), `supporters` (person page, file import), `videos` (series page with ordering, bulk add), `gallery` (album page with photo grid), `map` (types and import tools), `daily-game` (packs, import, order), `legal-pages` (wizard), `game-covers` (cover picker), `twitch-raid` (add flow and bulk paste), `home-assistant` (pairing, test), `stream-story` (studio frame), `audience` (draw, rooms), `polls` (poll detail, rounds), `mascot` (look settings with image), `planning`, `live-status`, `twitch-channel`, `twitch-connector`, `youtube-connector`, `alerts-overlay`, `calendar-ical`, `discord-announcer` (dashboards, status, test buttons), the six content collections (core entry editor), and the `twitch-bot` partner-command entry panel, log and settings tabs.

## 5. Adoption batches

0. **Core prerequisites** (one PR each, can run in parallel with batch 1 preparation): G1 (`ActionDialog` for core pages), then C-A1, C-A3, C-A5, C-A6, C-A2, C-A7. C-A4 waits for G3. Also move `FormDialog`, `MemberRoleDialog` and `TemporaryPasswordButton` to the shared window so all edit windows behave the same.
1. **`twitch-bot`**: TB1 to TB4. **Waits for the other agent's latency PR.** Includes the move of the command and timer lists from hand-written HTML to core tables.
2. `countdown`, `calendar-manual`, `platform-links`, `map`, `events`: the "form pushed under or over the list" cases, simplest first.
3. `faq`, `gallery`, `idea-box`, `testimonials`, `videos`: needs G2 (intro text) and G5 (translated field) for the best result; can start without them.
4. `commissions`, `partnerships`, `community-stats`, `supporters`, `youtube-live-actions`.
5. `directory`, `thanks-wall`, `mascot`, `daily-game`, `game-suggestions`: whole-page short edits first.
6. `contacts`, `twitch-raid`, then `polls` **after** the other agent's PR merges.

Each module PR is small (one module, tests with `tests/fixtures/edit-dialog` as a model), and follows the ergonomics rules: "Ergonomie" section, screenshots at 1280 and 390 px, `admin.ergonomics` result. Check `minCore` per module as in section 4 and add a `CHANGELOG` part for the module.

## 6. Brick gaps: core backlog

Ordered by how many A forms each one unlocks or improves.

| # | Gap | Hits | Proposal |
|---|---|---|---|
| G1 | **No dialog for core pages.** `EditDialog` is only reachable from module blocks (`AdminBlocks`); core pages are server components with `ActionForm`. Four older dialogs use native `<dialog>` without history, discard guard or window stack (`FormDialog`, `MemberRoleDialog`, `TemporaryPasswordButton`, `PreviewDialog`). | C-A1 to C-A7 | An `ActionDialog` that wraps `ActionForm` in `EditDialog`, driven by `?edit=` or `?new=1`; migrate the older dialogs to it. |
| G2 | **The dialog shows only the form.** No intro, note, banner or read-only summary above it (consent record in `testimonials`, cover state in `game-suggestions`, "place n of m" in `platform-links`, banners in `videos`). | TS1, GS3, PL1, VD2 | An optional `adminForm.intro` (one or two sentences) and `summary` lines, rendered under the title. |
| G3 | **No result panel.** A success closes the window with a one-line message. A show-once secret or link (C-A4), or the result of a test or simulation (`rewardSimulate`, home test) cannot stay on screen. | C-A4, TB3 test, VD2 refresh | A `result` in the action answer that keeps the window open on a read-only view with a copy button and a "Close" button. |
| G4 | **Image field in a dialog is unverified.** `kind: "image"` renders (`AdminBlocks.tsx:74`) but cropper, upload and window stack are not covered by a test. `kind: "file"` stays in the page by design (only imports, all B, need it). | CD1, TS1, VD2, PA2 | Test and fixture for `image` in a dialog; document the result. |
| G5 | **One notion, many fields: translated text.** Each language adds a field (question, answer, label, role, name). With two languages the dialog doubles. | FQ1, FQ2, VD3, VD4, DI1 to DI3, TW2, SU1, EV2, DG1 | A `kind: "translated"` control: one field with a language switch (R6). |
| G6 | **No conditional fields for module forms.** `ShowWhen` exists for core only. Needed to show "until" only when a repeat is chosen, a time only when not all day, a currency only for a super chat. | CM1, EV1, CD1, YA1, PL1 | A `showWhen: { field, value }` key on `adminForm` fields; until then, fold. |
| G7 | **Pick from a list inside a dialog.** Idea merge, partner-to-contact link, person pick (`directory`, `thanks-wall`), channel search (`twitch-raid`) use a searchable table with a row action. A dialog cannot host a table. | IB1 (merge), PA, DI, TW, RA | Keep as pages, or a `kind: "picker"` field (search and result list; `ChoicePicker` already exists in the core). |
| G8 | **Hand-written `html` lists cannot open a dialog.** `twitch-bot` (`adminkit`), `content-planner` cards, `gallery` photo grid, `planning`. Tables cover the first; there is no card or thumbnail grid block with row actions. | TB1, TB2, gallery photos | Move to `table` (with `image` cells); a card-grid block with `rowActions` only if the gallery needs it. |
| G9 | **Entry panels cannot open dialogs** (`opensInDialog` refuses the `entry` scope). | `twitch-bot` partner command (`entry.mjs:50`), other entry panels | Decide: keep (they are already a section of an editor page) or allow. |
| G10 | **A "New item" `links` button shows `#` on cores older than 0.6.7.** | every module using `links.items` with `?new=1` | Document in each module's adoption PR; use `minCore: 0.6.7` or a toolbar fallback. |
| G11 | **Rich text and entry editor.** No A form needs rich text. The core entry editor (blog, pages, and the short `links`, `codes`, `sponsors`) would need markdown, per-language tabs and a cover image in a window. | collections | Keep B. Revisit `links` only (title, address, icon, tags) once G4 and G5 exist. |
| G12 | **Not a brick: destructive actions.** The dialog has no destructive button by design (R3, R24). Many modules show "Delete" as a one-row table under the form (`commissions`, `map`, `daily-game`, `videos`, `gallery`, `content-planner`) or a tick box (`platform-links`). Each adoption PR moves it to a `rowActions` entry with `danger: true` and `confirm` saying what is lost. | most A forms | Counted in the effort. |
| G13 | **Not a brick: `adminForm` used as a live-search box** (`events`, `map`, `content-planner`, `thanks-wall`, `directory`, `videos`, `game-covers`, `twitch-raid`). R15 asks for `table.searchable`. Fix in the same PR as the dialog when the list is touched. | 8 modules | `table.searchable: true`. |

### Suggested core order

G1 (unlocks 7 core forms and the unification), then G2 and G5 (they remove the most folding workarounds), then G3, then G6, G4 (test only), G7. G8 to G13 need no core release.

## 7. Method and limits

Read-only static review of the two repositories at the SHAs above: every `adminPanel`, `adminForm`, `rowActions`, `links.items` and module-served admin page of the 70 modules, and every page and component under `src/app/admin` and `src/components/admin`. A small script counted the fields of each `adminForm`; the visible count was confirmed by reading the code (`folded` fields and fields built by helpers were counted by hand). Not done: no screenshots, no running site, no change to any module. Field counts "after folding" are proposals: the adoption PR decides.
