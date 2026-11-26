# Glossary

Words that the code and the docs of the core use with a precise meaning. Each entry says what the word means **today** and where to read it. This file describes the code; when the code and this file disagree, fix the file in the same pull request. The words shown to people in the interface (R12 of [docs/ERGONOMIE-ADMIN.md](docs/ERGONOMIE-ADMIN.md)) are a different list: they live in [docs/TRANSLATING.md](docs/TRANSLATING.md).

The architecture decisions behind some of these words are in [docs/adr/](docs/adr/README.md).

## AI access owner

The person an AI access belongs to (`ApiToken.ownerId`). The access can do only what its owner can do **now**, checked on every request ([`ownerCeiling.ts`](src/core/services/mcp/ownerCeiling.ts)). Since core 0.47.1 the owner is **permanent**: it is set when the access is created and never changes, no screen or tool hands an access to someone else, and when the owner disappears (account deleted, backup restored without them, row removed) the access is **revoked**, never left ownerless ([`lifecycle.ts`](src/core/personalAi/lifecycle.ts), [`revoke.ts`](src/core/personalAi/revoke.ts)). The one exception is an access created before owners existed: its owner is empty, it keeps working as before and is never swept, until the one-time migration ends ([`legacyOwners.ts`](src/core/personalAi/legacyOwners.ts)). Read: [docs/PERSONAL-AI.md](docs/PERSONAL-AI.md), [ADR 0007](docs/adr/0007-ai-access-owner-is-permanent.md).

## Audit code

The technical name of an action written to the audit journal, such as `user.2fa.reset` or `module.install`. It is the `action` argument of `audit(actor, action, target, meta)` ([`permissions.ts`](src/core/permissions.ts)), stored in `AuditLog.action`. The journal shows it in plain words through the translation key `audit.action.<code>` when the code is listed in `AUDIT_ACTIONS`; module actions (`module.<instance>.<action>`) and assistant tools (`mcp.<tool>`, `mcp.maintenance.<tool>`) use one generic sentence each, and any other code is shown as written ([`auditLabels.ts`](src/core/auditLabels.ts)). Not to be confused with the language audit (`src/core/i18n/audit.mjs`, see [ADR 0005](docs/adr/0005-i18n-audit-copy-in-extras.md)) or with the issue codes of the skin checks ([`skins/messages.ts`](src/core/skins/messages.ts)).

## Install intent

Why a module is being installed. There is **no type or field called "intent"** in the code at this commit: the intent is the combination of options given to `installModule` / `installFromCatalogue` ([`installer.ts`](src/core/modules/installer.ts)). Without options (`dependencies` on, kept data restored, a first instance created) the call is an install the owner asked for. The other callers switch things off because they have their own way to do them:

| Intent | Who | Options and effect |
|---|---|---|
| owner | The owner's click in Extensions ([`extensions/add/actions.ts`](src/app/admin/%28panel%29/extensions/add/actions.ts)), a suggestion ([`suggestInstall.ts`](src/core/modules/suggestInstall.ts)) | No option: providers it needs are installed, kept data returns, a first instance is created. `confirmExtra: true` only after the owner accepted the "not verified" warning for an entry of the extra index. |
| cascade | A provider another module requires ([`installer.ts`](src/core/modules/installer.ts) `depOps`, [`dependencyInstaller.ts`](src/core/modules/dependencyInstaller.ts)) | `dependencies: false, restoreKept: false`: its own needs are resolved by the cascade, its default instance comes from the cascade journal, and the whole cascade is undone on failure. |
| seed | The target module of a data conversion ([`installSeedTarget`](src/core/modules/installer.ts), [`seeding.ts`](src/core/modules/seeding.ts)) | `dependencies: false, restoreKept: false`: no default instance (the seeded instance provides the service); its needs are satisfied afterwards with a journal. |
| restore | Backup restore ([`backup/restore.ts`](src/core/backup/restore.ts)) | `dependencies: false, restoreKept: false, confirmExtra: true`: order and dependency checks are done once for the whole backup; the owner already confirmed the restore. |
| network | Adding a social network ([`social/actions.ts`](src/app/admin/%28panel%29/social/actions.ts)) | `firstInstance: false`: the module is installed, then the caller creates its own instance with a nickname. |

The setup assistant ([`starter.ts`](src/core/modules/starter.ts)) installs with the same options as cascade. Whatever the intent, an installation never skips the checks (manifest, core version, size, load check) and an entry of the extra index or of a [personal catalogue](#personal-catalogue) is never installed without `confirmExtra: true`, which only an owner action passes.

## Level-3 action

An action of the AI maintenance tools that **changes the site** and so goes through a plan, an approval and an execution, as opposed to level 1 (read) and level 2 (actions without risk: re-check, back up, reinstall, restart). The list is `LEVEL3_ACTIONS` in [`requests.ts`](src/core/maintenance/requests.ts): updates, install, uninstall, skins, fonts, extra instances, publishing, site settings, menu and home page. Three steps in [`actions.ts`](src/core/maintenance/actions.ts):

1. **prepare**: read-only. It checks the request and freezes a plan (versions, target, summary); it changes nothing.
2. **approve**: with "ask me first" (the default) the assistant's call only creates a request; a person allowed to decide it (`mayDecide`) approves or denies it. A request is approved once, expires after 24 hours, and an install of code or a new instance **always** waits for a human ([`ALWAYS_HUMAN`](src/core/maintenance/actions.ts)).
3. **execute**: runs with the same functions as the admin, after re-checking that the plan still holds.

Read: [docs/MAINTENANCE-IA.md](docs/MAINTENANCE-IA.md), [docs/formal/approval-queue.md](docs/formal/approval-queue.md).

## Managed message

A message that the Discord connector writes and keeps up to date in a Discord channel. It lives in the modules repository (`helldog136/curiosa-extras`, module `discord`), not in this one: the core has no such concept, so it is only named here.

## Module

A piece installed from the catalogue (or from a personal catalogue) that adds pages, elements or tools to the site, described by its `module.json`. It is the only word for that concept, in English and in French: never "extension", "plugin", "add-on" or "fonctionnalité". The route `/admin/extensions`, the `extensions.*` translation keys and the manifest keys keep their historical names. "Feature" in the AI settings (`aim.*`) is a different thing and is kept. See [ADR 0011](docs/adr/0011-admin-redesign-vocabulary-menu-and-access.md) and the interface glossary in [docs/TRANSLATING.md](docs/TRANSLATING.md).

## Module candidate

The version of a module that is being checked before it replaces, or becomes, what the site runs: the downloaded copy in a temporary `.incoming-*` folder of the modules directory (the `candidate` of `installModule`). It must pass, in this order, before anything is activated: a readable `module.json`, the expected id, a compatible core, the main file present, the size limit, then the **load check** in a fresh process (`preflightModule`, [`loadCheck.ts`](src/core/modules/loadCheck.ts)), then, once the files are placed, the same check inside the site process from a fresh copy (`verifyModuleLoad`, [`registry.ts`](src/core/modules/registry.ts)). A failure undoes everything: the old version stays, or nothing is installed. The same two checks guard updates and reinstalls ([`reinstall.ts`](src/core/modules/reinstall.ts)). A **dependency candidate** is a different thing: a module ranked as a possible provider of a missing service ([`dependencyPlan.ts`](src/core/modules/dependencyPlan.ts)).

## Personal catalogue

A git repository, public or private, that the owner registers so that its modules appear in the catalogue of this site next to the official ones, with a "Personal" tag. Up to 5 repositories, 150 extensions offered, each pinned on a tag or a commit, and only modules of that repository. Its modules count as **not verified** (`origin: "extra"`): installed only by the owner on a click, never by a cascade, a suggestion, a scheduled task, "update all" or an AI assistant, and the origin is written on the installed module so it stays when the catalogue is removed. The core never checks a licence for them. A private repository uses the same sealed access code as private skins. Read: [docs/PERSONAL-CATALOGUES.md](docs/PERSONAL-CATALOGUES.md), [`personalCatalogues.ts`](src/core/modules/personalCatalogues.ts).

## Same site host

Two host names that count as the same address of the site: compared without case, without a trailing dot and without a leading `www.` ([`sameSiteHost`](src/core/siteAddress.ts)). Used to tell whether the page was reached through the address configured in `SITE_URL` (`visitedAddress`); an unreadable or local address answers "unknown", never "different".

## Worn skin

The overlay skin that an overlay page, or one element of it, applies to itself **right now**. For a page it is the skin of the rule that matches the current context value (the current game, for example), else the page's default skin, else none; a rule pointing to a skin that no longer works falls back to the default ([`skinForPage`](src/core/overlays/skinLoad.ts)). An element can wear another skin than its page (`elements[].skin`: absent means the page's, `null` means none), up to 6 distinct ones per page ([`serve.ts`](src/core/overlays/serve.ts)). The skin of the public site is called the **active** skin, not the worn one. Read: [docs/OVERLAY-SKINS.md](docs/OVERLAY-SKINS.md).
