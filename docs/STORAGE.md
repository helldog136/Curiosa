# Storage: what the site takes and what is left

The **Storage** card (Administration home, for administration and for the people who look after backups and updates) answers one question: how much room does my site take, and how much is left on the server?

## What the person sees

- One sentence of purpose, then a bar and one line: `1.2 GB used by your site · 3.2 GB free on the server`.
- The state is written next to an icon: *Plenty of room*, *Getting low*, *Very low* (never colour alone).
- When the room is low, a message says what to do in plain words (delete old backups and large images you no longer use, or ask whoever runs the server). The health pill of the home page links to the card.
- **More details** (folded; open by default when the room is low): images and files, database, backups, modules and skins, other, each with its size, and when it was measured. **Refresh** measures again.
- Beside every image upload button, a quiet line: `3.2 GB free of 20 GB · See details`. Under the thresholds it becomes a warning before the file is sent. It only needs the free space, so it never starts a measurement.

## How it is computed (`src/core/storage/`)

| File | Role |
|---|---|
| `level.ts` | The thresholds, as constants, and `diskLevel()`: *very low* under 300 MB free (or under 2 % while under 2 GB free); *getting low* under 1.5 GB free (or under 8 % while under 10 GB free). The percentage rules are capped so a large disk is not "low" at 8 %. |
| `disk.ts` | Free and total bytes of the disk that holds the data folder (`statfs`, through the maintenance dependencies, so tests mock it). The only place that builds a level. |
| `usage.ts` | Bounded walk of the data folder: at most 200,000 entries and 4 seconds; beyond that the sizes are a minimum and `partial` is true. Symbolic links are counted, never followed. Categories come from the top-level entry: `uploads` and `fonts` = images and files, `backups`, `modules` and `skins` = modules and skins, `*.db*` = database, the rest = other. |
| `service.ts` | `storageInfo()`: free space on every call, the measurement cached for 10 minutes, computed once at a time and awaited for a short, caller-chosen time (a slow disk shows "measuring", the page is never held). `refresh` forces a new measurement, at most every 30 seconds. |
| `present.ts` | Words and shares for the screens, in the person's language (sizes use the locale: `3,2 Go` / `3.2 GB`). |
| `tool.ts` | The same numbers for the assistant tool `maintenance_health` (`storage` field, next to the existing `disk`). |

**Docker and bare metal** measure the same thing: the data folder (`DATA_DIR`). In the image it is the mounted data volume, so the free space is the volume's; on a host it is the disk of the data folder. `storage.install` in the tool output tells which one it is (the single read of `CURIOSA_INSTALL` stays in `scripts/install-kind.mjs`).

## What never leaves the server

No path: not in the page, not in `GET /api/admin/storage`, not in the assistant tool. Only sizes, category names and times. The route is for signed-in members and returns free space only; the breakdown and **Refresh** are limited to administration and to the people with the backup or update right. A test checks that no path appears in any output.

## Where the code is used

- Card: `StorageBlock` (`src/components/admin/dashboard/Blocks.tsx`), block `storage` of `src/core/dashboard/layout.ts`.
- Refresh: `refreshStorage` (`src/app/admin/(panel)/dashboardActions.ts`).
- Upload hint: `StorageLine` in `ImageField`, fed by `GET /api/admin/storage`.
- Assistants: `maintenance_health` (`src/core/maintenance/inspect.ts`).
- Texts: `storage.*` in `src/locales/en.json` and `fr.json`.
