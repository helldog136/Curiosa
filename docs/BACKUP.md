# Backup and restore

A backup is **one file**, made in one click from the admin area (*Backup*, owner or technical coordinator: right `core:backup`). It holds all your data, not the framework code:

| Included | Not included |
|---|---|
| accounts (passwords **hashed**), settings (secrets included: the e-mail password, private addresses…); the RAWG key and your cover fixes are in the data of the "Game covers" module. A backup made before 0.3.0 still has them in the core settings: the restore hands them to the module (see "Old backups") | API tokens (to be created again) |
| module instances, entries (all languages, drafts included), redirects | audit log, the "Covers to check" list (it fills by itself) |
| the data of **each installed module** (their storage, their settings) | the framework and module code (reinstalled from the catalogue) |
| uploaded images and files | |
| the list of installed modules (identifier, version, repository, on or off) | |
| the **uploaded fonts** (`.woff2` files, `fonts/` folder of the archive) and the choice of fonts (settings) | the font library shipped with the core (it is in the installation, not in your data) |
| the list of installed **skins** (repository, label, version) and the chosen skin, with your appearance changes (these are settings) | the skin files (reinstalled from their repository, like modules) |

The **core** makes the backup; it also knows how to fetch what modules stored, without any code on their side.
A module can also add its own readable files (a CSV of its data, for example) with `backup.readable` (see [MODULES.md](MODULES.md)).

## Readable without the framework, and encrypted

The downloaded file is named `backup-<site>-<date>.tar.gz.enc`. It is **encrypted with the password chosen when the backup is made** (it is stored nowhere; without it nothing can be recovered). The encryption is the **standard OpenSSL format**: no framework software is needed to open it, even if the framework is gone. (The command below is also shown on the *Backup* page, in advanced mode.)

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in backup-my-site-2026-10-07.tar.gz.enc -out backup.tar.gz
tar xzf backup.tar.gz
```

(OpenSSL is installed on Linux and macOS; on Windows, Git for Windows or WSL provide it.) Once extracted:

```
README.txt          instructions (French and English): they are in the archive, with your data
backup.json         inventory: version, date, modules, skins (optional), SHA-256 fingerprint of each file
readable/           YOUR DATA FORMATTED FOR A HUMAN: start here
  site.txt            summary: site name, languages, modules, counters, settings (secrets masked)
  <instance>/*.md     one entry per Markdown file and per language, with a header (title, status, dates, tags, link, code…)
  modules/<instance>/ the data of each module (JSON; CSV and other files the module provides)
data/               the same data, raw, as JSON: this is what the restore reads
                    (including retired-instances.json: the KEPT data of removed modules or instances, inert; absent before 0.1.20)
                    (including upload-files.json: who owns which uploaded file, for modules that can delete them, 0.2.13; absent before: no file has an owner;
                     overlay-pages.json: the overlay pages with their elements, style and secret address, 0.5.0; absent before: no page. Test mode, which is volatile, is not in it.
                     The backup being encrypted, the secret address is written there so that the addresses pasted in OBS still work after a restore)
                    (including roles.json and user-roles.json: the roles and who has them; absent before 0.2.0: the restore then recreates the
                     predefined roles and gives each person the one of their `role` level in users.json)
uploads/            uploaded images and files
fonts/              uploaded fonts (.woff2); absent when there are none (docs/POLICES.md)
```

Everything is **text** (JSON, Markdown, CSV), except the images. To check integrity: `sha256sum uploads/* data/*.json …` and compare with `backup.json`.

### Technical format (for whoever writes their own reader)

1. File = `Salted__` (8 bytes) + salt (8 bytes) + AES-256-CBC ciphertext (PKCS#7 padding).
2. Key (32 bytes) and IV (16 bytes) = `PBKDF2-HMAC-SHA256(UTF-8 password, salt, 600000 iterations)` → 48 bytes, split in that order (this is exactly what `openssl enc -pbkdf2` does).
3. Decrypted content = a `tar.gz` archive (ustar), UTF-8 relative paths, no `..`. (The server writes and reads this archive without blocking its other requests; the format itself has not changed: an earlier backup restores, and today's reads with `openssl`.)
4. `backup.json`: `{ format: "curiosa-backup", formatVersion: 1, createdAt, frameworkVersion, site, counts, modules[], files[{path, sha256, bytes}] }`.

## Automatic backup by e-mail

*Backup > Backup by e-mail* sends the site administrator an encrypted backup on a schedule. It is off until someone switches it on.

**What is sent.** The same file as the manual backup: `backup-<site>-<date>.tar.gz.enc`, the format above, restorable with the usual restore and readable with the OpenSSL command. It is **never sent unencrypted**: the backup holds hashed passwords, every setting including secrets, and personal data, and e-mail is not a safe channel.

**The passphrase.** A scheduled run has nobody to type a password, so when the feature is switched on the core **generates a passphrase** (25 random symbols from the system random generator, in five groups, about 125 bits) and shows it **once**, with a copy button. The server keeps it **only sealed** (AES-256-GCM, key derived from the site secret `AUTH_SECRET` or `data/auth-secret`: the same mechanism as the access code of a private repository). It is never written in an e-mail, a log, an audit row, a file name, a page, a diagnostic or an assistant (MCP) answer, and nobody can read it again. The manual backup keeps asking for its own password.

- **Lose the passphrase and the e-mailed backups cannot be opened**: there is no recovery, by design. Keep it in a password manager or on paper.
- *More options > Create a new passphrase* makes a new one for the next backups. The files already e-mailed **keep the old passphrase**: keep it too.
- Switching the feature off **deletes the sealed passphrase** and stops the schedule. Switching it on again makes a new one.
- The passphrase and the feature settings are **not part of a backup** (they describe this server). After a restore the feature is off; switch it on again.

**Recipient.** By default the owner account's address. *More options* lets you choose another administrator account or type one address. The page shows it masked (`c***@example.org`).

**Frequency.** Every day, every week (default, Sunday) or every month (the 1st), at **03:MM on the site clock** (`site.timezone`, else the server's), where MM (0 to 59) comes from a hash of the site name so that sites do not all start together. The schedule survives a restart: if the server was off at the due time, **one** backup runs shortly after the next start (never one per missed slot). A run is due only for a slot later than the moment the feature was switched on. *Send a backup now* uses the same code as the schedule.

**Size.** The attachment limit is 20 MB by default (1 to 25 MB, *More options*). Many mail providers refuse a whole message above about 25 MB, and the attachment grows by a third when encoded, so a provider that refuses a file under the limit shows as "the mail server did not accept the message": lower the limit. Over the limit the e-mail is sent **without the attachment**, says it was too big and that the backup is **kept on the server**; the page then shows *Download the latest kept copy*. A backup is never split or truncated. A backup over the limit with no room on the disk to keep it is a failure, not a notice.

**Copies on the server.** Each automatic run keeps the file that was e-mailed in `data/backups/auto/`: the **5 most recent**, counted on their own. The other copies in `data/backups/` have their own rules and never count against them: database copies of the maintenance tools (`maintenance-<time>.db`, 5), copies before a restore (`pre-restore-*`, 3), the one copy before a bulk update. The manual backup is a download and keeps no copy.

**Results and failures.** Each run records its time, size, whether it was sent and attached, and a reason in plain words. A failed scheduled run is retried with growing waits (15 minutes, 1 hour, 4 hours); after the fourth failure the next slot is awaited. The feature never stops the site. States are the usual three: **Configured**, **Degraded** (last run failed, the mail settings are gone, the passphrase cannot be opened here, or the last backup was too big to attach: with the reason and what to do) and **Not configured**. The audit log gets one row per run (`autobackup.sent` or `autobackup.failed`) with a word as cause, never a server message, an address or a secret; switching on, off, changing options and creating a new passphrase are logged too. The feature cannot be switched on while no e-mail is set up: the page links to the mail settings.

**Assistants (MCP).** The maintenance report (`maintenance_health`, `maintenance_diagnose`) shows the state, frequency, last result, size limit and the masked recipient: read-only. No tool can switch it on, change the recipient or read the passphrase.

**The e-mail.** In the admin language: subject with the site name and date, what is attached with its size, "this file is encrypted; open it with the passphrase you kept when you switched the feature on", how to restore, where to turn it off. No personal data.

**Restoring from an e-mailed file.** Save the attachment, then *Backup > Restore a backup*, choose the file, type the passphrase, check the preview and confirm (see "Restore"). Without the framework, use the OpenSSL command with the passphrase.

**What an attacker can do.** With the mailbox: they hold encrypted files and the passphrase is nowhere in them, so nothing opens without it (125 bits, derived with 600000 PBKDF2 iterations). With the server (files and database): they can read the site anyway; the sealed passphrase opens with the site secret on that server, so the stored files are no further protected from someone who has it. With the mailbox **and** the passphrase kept by the owner: everything in the backup. Residual risks: a lost passphrase; a mailbox that also holds the passphrase; a recipient address typed wrongly (check the masked summary). Keep the passphrase somewhere other than that mailbox.

## Restore

*Backup > Restore a backup* (red box: the restore **replaces** the current data): choose the file, type the password, then **check the preview** before confirming.

- The file is **checked before anything else**: password, format, version, fingerprint of each file (a modified or incomplete backup is refused), presence of an owner (a restore must never lock you out).
- **Modules are reinstalled from the catalogue** (catalogue repositories). A **personal** module (unverified repository) is only reinstalled if you **confirm it, module by module**; otherwise its data is kept but the module stays to be reinstalled.
- The restore **replaces** the current data, in one transaction: all or nothing. A complete snapshot (database, images, fonts, extensions) is kept first in `data/backups/pre-restore-<time>/` (the last 3).
- Module records carry their **key** (`key`, optional). An older backup without keys restores as it is (empty key). The storage generation counter of each instance goes up (modules rebuild their in-memory indexes).
- Before a **bulk module update**, a single copy `data/backups/pre-bulk-update-<date>-<ts>.db` is taken (only one kept, never erased by the rotation of the other copies).
- Identifiers are kept: sessions, links between entries, redirects and module data stay valid.
- Modules installed here but absent from the backup stay installed (without their instances).
- **Dependencies between modules** ([MODULES.md > Dependencies](MODULES.md)): modules are reinstalled **in dependency order** (providers first), then the needs of each restored **active** module are checked. A provider absent from the backup but available (shipped, catalogue) is installed with its default instance; the report mentions it. If none is available, the module is restored **with its data**, in the "on" state of the backup, and **both the preview and the report** say "missing: …": the restore is never interrupted and no data is lost.

**On a new server**: install the framework ([INSTALL.md](INSTALL.md)) and open the site. The **first screen of the wizard offers "I already have a backup: restore it"**: same procedure (file, password, preview, confirmation of personal modules), without creating a temporary account. If `SETUP_TOKEN` is set, the same token is asked. This path exists **only while no account exists**: a live site can only be restored from the admin area, by the owner or the technical coordination (right `core:backup`). Sign in again afterwards with an account from the backup.

- **Files deleted by a module** (permission `files`, 0.2.13): a backup is a photograph. Restoring puts back the files it contains (deleted since or not) with their owner and the module data of the same date: everything stays consistent, a deletion never breaks a restore. A file deleted after the backup is no longer in the following backups; older backups keep it as long as you keep them.

## Old backups

A backup file has no expiry date: **any** backup of an older version restores (a version newer than the site is refused, before anything is installed). The network is used to find extensions. The principle is "best effort": what works is restored, what cannot be converted is **set aside**, and the report says plainly what, with the **exact path** of the readable file (see above) where the data is. You finish by hand; nothing else is blocked.

1. **The plan** (preview, before anything is written): version of the backup, core conversions that will run, path of each extension whose data is too old.
2. **Core conversions**, pure functions on the data read (`src/core/backup/conversion/coreConversions.ts`): "switched off" items from before 0.1.20 (set aside with their data, like the migration `20261118090000_drop_enabled_columns`), menu from before 0.2.6 frozen in `nav.menu`, overlay placement from before 0.2.6, RAWG takeover from before 0.3.0 (code, fixes and list handed to the "Game covers" module, installed if missing, once its data is in place; the old setting stays where it is).
3. **Extensions**: if the data is at the floor (`dataFloor`) of the catalogue version or above, the catalogue version converts it. Otherwise the restore installs the version that still converts it (the "bridge": the **last** version of the repository whose floor accepts this data, see [MIGRATIONS.md](MIGRATIONS.md)), lets it convert, starts again from the data version obtained, then moves to the catalogue version. An impossible step is reported with the folder `readable/modules/<instance>/`.
4. **Working copy**: the converted data is written to a copy of the database and checked (owner account, row counts, claimed files present, stored items readable). A problem stops everything here: the site was not touched.
5. **Swap**: a complete snapshot is already taken. The image and font folders are put in place at once (rename; file by file on a mounted volume), then the database is replaced in **one** transaction that checks the counts again before committing. If it fails, the folders come back from the snapshot and the extensions installed for the occasion are removed.
6. **After**: each extension converts its data with the code of its version; no error is swallowed, all are in the report ("Converted", "Set aside", "Not done").

The per-era test fixtures (0.1, 0.2, 0.6, 0.31, 0.38) are real backups written by the code of each published tag, with demo data: `tests/fixtures/backup-eras/generate.mjs`. A test (`tests/core/backup-conversion-coverage.test.mjs`) fails if a conversion of the migration registry, or a migration that moves data, has neither a conversion function nor an explicit refusal.

## Good to know

- The backup holds **secrets** and password fingerprints: keep the file **and** its password somewhere safe, separately.
- Make backups regularly and **try** reading one from time to time: it is the only way to be sure it works.
- Restoring a backup created by a **newer** version of the framework is refused (update it first); one from an older version is converted (see above).
- An automatic backup by e-mail exists (see above); it does not replace trying a restore from time to time.

## Skins (appearance)

Appearance settings (`theme.*`, `header.layout`) and skin settings (`skin.active`, `skin.installed`, `skin.options`) are settings like the others: they are in the backup and restored as they are. A backup made before skins has none: the site shows with the base skin, unchanged. The **files** of an installed skin are not in the backup: they are reinstalled from their repository. While they are missing, the base skin applies, nothing is lost and `skin.active` is kept: the skin turns on again as soon as it is installed again.

## Private repositories (core 0.42.0)

The access code of a private repository (a skin or a module installed from a private GitHub repository) is a setting named `git.secret.access`. It is kept **sealed** with the site secret (`AUTH_SECRET`, or `data/auth-secret`), so the backup holds only ciphertext, and the readable summary (`site.txt`) shows it masked. The site secret is **not** in the backup: after a restore on another server the ciphertext cannot be opened, the page says "Access code to enter again" next to the repository, and the owner pastes a new code (Appearance or Extensions, "Edit"). Skins and modules of that repository are reinstalled as usual once the code is entered again.
