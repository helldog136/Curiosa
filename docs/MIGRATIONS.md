# Migration policy

A data conversion ("if the old format, convert it") **runs once, during the update that needs it**, and its code is deleted soon after. The runtime never keeps
`if old format then convert` code for sites that can no longer exist.

## The support floor

`upgrade.json` (published with every release) declares `minFrom`: the **support floor**, the oldest version that can be updated to this release directly.
A site older than the floor is not broken: the supervised update (`scripts/update-lib.mjs`, `planUpdate` / `runUpdateChain`) chains it through the declared
bridge releases, restarts the server after each step and waits for it (the first start of a bridge is what converts the data), then installs the next one.
The chain is read from the `upgrade.json` of each published release, at most six steps. Example with the floor at 0.6.18:

| Site on | Steps to the next release |
|---|---|
| 0.6.18 or newer | 1 (direct) |
| 0.6.10 to 0.6.17 | 2 (0.6.18, then the release) |
| 0.2.0 to 0.6.9 | 3 (0.6.10, 0.6.18, then the release) |
| 0.1.4 to 0.1.x | 4 (0.2.0, 0.6.10, 0.6.18, then the release) |
| 0.1.1 (oldest published release) | 5 (0.1.4, 0.2.0, 0.6.10, 0.6.18, then the release) |

`tests/modules-mgmt/legacy-removal.test.mjs` simulates these paths. The Updates page shows the steps ("to follow", "in progress", "installed") and the chain note.
The CHANGELOG of a release that raises the floor says so in plain words: **"Older sites update in two steps."**

## Rules

1. A new conversion is allowed **only as an update step**: it runs at start (or in the module install/update flow) once, with a persisted marker, never on a request.
2. Each conversion is listed in `src/core/updates/migrations-registry.json` with `introducedIn` and `removableAtFloor`. Default: the **next release** after the one that introduced it.
3. The floor moves up **every release** to the oldest release that is still published as a bridge (keep the last two or three minors). The release checklist item:
   run `npm run migrations:sunset -- --floor <new floor>`, delete what it lists as EXPIRED, raise `minFrom`, move the entries to `removed`.
4. `tests/core/migration-registry.test.mjs` fails when a conversion is still present although the floor is at or above its `removableAtFloor`, when a removed one comes back, and
   when a registry entry no longer matches the code. `npm run migrations:sunset` warns about conversions older than 3 minor releases (`--strict` makes it fail).
5. Backups keep their format whatever the site version: reading an old backup is a file-format reader, listed in the registry (`legacy-off`) with its own removal floor.
6. Module data conversions (`dataVersion` in a module manifest) are a permanent contract between the core and modules, not core legacy: they run when a module is installed or updated.

## Registry

| id | Introduced in | Removable once the floor reaches | State |
|---|---|---|---|
| `startup-sweep` | 0.2.0 | permanent (module `dataVersion` contract) | runs once per state (`core.legacySweepState`), no longer on every start |
| `menu-freeze` | 0.2.6 | not removable by a floor raise (reader of old backups, rule 5) | the start-up call is gone; the freeze and the fallback remain for new instances and for restored backups made before the stored menu; removable after a backup-format decision, like `legacy-off` |
| `rawg-handover` | 0.3.0 | removed with the floor 0.6.18 | deleted (start-up hook, hook after install/update/restore, relay wait; `ctx.api.rawg` relay, the old-address redirect and the MCP short names stay) |
| `legacy-off` | 0.1.20 | 0.10.0 | present (restoring backups from before 0.1.20) |
| `placement-freeze` | 0.2.6 | removed with the floor 0.6.10 | deleted |
| `startup-menu-freeze` | 0.2.6 | removed with the floor 0.6.10 | deleted |

## What a site skipping versions experiences

Updating from any version below the floor to the latest: the update page plans the chain before downloading anything, installs the bridge, restarts, waits for the site to answer on the
bridge version (its start-up runs the conversions), then installs the next step; every step takes its own database backup and rolls back alone on failure. Without an automatic restart
(`CURIOSA_RESTART_COMMAND` / `CURIOSA_SUPERVISED`) it stops after each step: restart, then click "Install" again, the path is recomputed from the new version.
