# 0009. Module secrets are sealed per instance, behind a permission

Status: Accepted
Date: 2026-11-24

## Context

Before 0.48.0 a module that needed a credential (the token of a Discord bot) kept it as text: in a `secret` setting (hidden in the admin and from assistants, but readable in the `Setting` table) or in `ctx.api.store` (a JSON document). A copy of the database, or a database backup that is not the encrypted backup file, showed it. The core already seals other small secrets with `src/core/seal.ts` (the access code of a private repository in `gitAccess.ts`, the passphrase of the e-mailed backup in `backup/auto/config.ts`); modules had no way to use it.

## Decision

Modules get a small sealed store, `ctx.api.secrets` (`set`, `get`, `has`, `state`, `remove`, `names`), behind the manifest permission `secrets`.

- The value is sealed with the purpose `module-secret-seal`; the ciphertext is bound to `<instance id>\n<name>`; it lives in the setting `instance.<id>.__secret.<name>`. Reusing settings keeps the backup, restore, kept-data and removal paths as they are: the prefix `instance.<id>.` is already wiped or kept with the instance, and the sealed text travels in the backup like the access code of a private repository.
- The instance is taken from the core's closure in `makeApi`; no function accepts an instance from the module. Nothing in the core reads the rows back out; only `services/secrets.ts` and `modules/api.ts` mention them, and a test fails otherwise.
- Bounded (names, size, count, rate) and never throws. A value that cannot be opened on this server is `unreadable`, so a module can ask the owner again after a restore elsewhere.
- The `secret` setting kind is **not** changed here: it stays readable text. Sealing it needs a migration of stored values and of every reader, and is a separate decision.

## Consequences

- Copies of the database and unencrypted database backups no longer show these values. A hostile module still can: module code runs in the site process with the site secret within reach (see `docs/SECURITE.md`).
- A new place that reads all settings of an instance (an export, a report) sees only ciphertext; it must keep the `__` convention so conversion code ignores it.
- Changing the site secret makes every sealed value unreadable: the module asks again.
- Modules that use it declare `"permissions": ["secrets"]` and `"minCore": "0.48.0"`.

## Sources

`src/core/services/secrets.ts`, `src/core/modules/api.ts` (`secrets`), `src/core/seal.ts`, `src/core/gitAccess.ts`, `src/core/modules/manifest.ts` (permission), `docs/MODULES.md` ("Sealed secrets"), `docs/SECURITE.md`, `docs/BACKUP.md`, `tests/modules-mgmt/module-secrets.test.mjs`.
