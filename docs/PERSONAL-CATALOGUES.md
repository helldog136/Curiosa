# Personal catalogues (core 0.47.0)

A **personal catalogue** is a git repository, public or **private**, that offers its own extensions to your site. You register it once (address, access code if it is private, a name); its extensions then appear in the catalogue of your site **next to the official ones**, with a **Personal** tag, in the same search and the same filters. One repository can hold many extensions, and you can register up to 5 repositories.

This page is for the owner of a site (how it works, what it does and does not do) and for the person who builds a catalogue repository (the layout, the two scripts to copy).

## For the owner

**Where.** Admin > Extensions > *My catalogues* (owner only, like every installation). One field, the address of the repository, and one button, *Check the repository*. If the repository is private, a field for the access code appears. The check tells you how many extensions the repository offers, which can be installed on this site, and which are refused and why. Nothing is registered by a check. Then one button, *Add this catalogue*.

**Private repository.** The access code is the one of private skins: a fine-grained, read-only code limited to that repository. It is tried on the repository before it is saved, stored sealed in the database, handed to git through the environment of the git process only (never in a command line, a file, a log or the journal), and shown nowhere. A code you paste while checking a repository is used from memory for that check and **saved only when the catalogue is really added**; if the add fails, a code saved by that call is removed again. One code per repository. The table of catalogues says in words whether access is *Configured*, *Degraded* (the last reading failed, with the reason) or *Needs access* (the repository refuses the reading, or the site was restored from a backup: the backup holds the code only as sealed ciphertext, which cannot be read on another server, so you enter it again).

**What a Personal extension is.**

- **Not verified.** Nobody checked it. It is code that runs on your server with the same rights as the site, so the page says so in plain words before you add the catalogue and again on the sheet of each extension. You install it yourself, on a click, after reading what it asks for (the sheet shows its permissions, data and services **before** anything is installed).
- **Installed like any other extension**, by the same installer, with the same checks: manifest, minimal core version, size, no symbolic links, a load test in a separate process, services, data conversions, and a rollback if anything fails. A personal extension is never installed or updated by a dependency, a suggestion, a scheduled task or an AI assistant.
- **An assistant cannot install, update or reinstall it, and sees nothing of a private repository.** The origin is **written on the installed extension itself** (not looked up in the catalogue), so it stays when the catalogue is removed and no assistant ever treats it as a normal extension. `maintenance_module_update`, `maintenance_modules_update_all`, `maintenance_module_reinstall` and `maintenance_updates` all say a human is needed; if the origin cannot be read, every extension counts as personal (fail closed). For a **private** repository the assistant sees no extension at all (names included). For a **public** one it sees them with `origin: "personal"`, `installable: false` and the reason. The address of a personal repository is never given to an assistant.
- **Updates** come from the catalogue: when the repository publishes a new tag, *Extensions > Updates* shows it and you apply it with a click, extension by extension. **Update all never includes a personal extension.**
- **Pinned versions only.** An entry without a pinned tag or commit is refused: a personal extension is always installed from a version someone named.
- **Slow or broken repositories do not hold the site back.** The official catalogue is read at the same time and is never kept waiting more than a few seconds for a personal one; at most 150 personal extensions are offered, so they never push official ones out. Without the official index nothing personal is offered (its ids could not be checked).
- **No licence check.** The core never validates a licence for a personal extension and makes no request about it. The only traffic is git towards the address you registered.

**Refusals, in plain words.** An extension whose id already exists in the official catalogue is not offered (the official one wins). An id already offered by a catalogue registered before is not offered twice (the first wins). An entry that points to another repository is not offered: one repository means one access code and one decision of trust.

**Remove a catalogue.** *Remove the catalogue* in the row menu. **Nothing is uninstalled**: extensions already installed from it keep running with their data, stay marked as coming from a personal catalogue whose source was removed, and stop receiving updates (the window says how many). If no other extension, skin or catalogue uses that private repository, its access code is removed with it.

**Backups.** A backup holds the access code only as sealed ciphertext (like every other setting), which cannot be read without the secret of the site it came from; on a new server you enter it again. Extensions of a personal catalogue are saved as "personal repository" ones, whatever the file says: a restore never installs one without your confirmation, extension by extension, and reinstalls it from its address. Without the code the restore does not fail: the extension is reported as *private repository: add its access code, then install it again*.

## For the builder of a catalogue repository

The layout is the one of the official catalogue (`curiosa-extras`):

```
catalogue/index.json        the list the site reads
modules/<id>/module.json    one folder per extension (the folder name = the id)
modules/<id>/index.mjs      ...and its files
scripts/build-index.mjs     (optional) writes catalogue/index.json from the folders
scripts/rules.mjs           (optional) the checks the script uses
```

- **`catalogue/index.json`** is `{ "version": 1, "modules": [ ... ] }`. Each entry has `id`, `name`, `description`, `version`, `apiVersion`, a `repo` that is **the address of this same repository**, a `subdir` (`modules/<id>`) and a `ref`: a **tag** that pins the version, for example `<id>-v1.2.0`. Optional: `requires: { "core": "0.40.0" }`, `provides`, `offers`, `requires` (services), `previews`, `places`, `i18n`. The fields are the ones of the official index; see [MODULES.md](MODULES.md) and [PUBLIER-SON-MODULE.md](PUBLIER-SON-MODULE.md).
- **Tags pin versions.** Publish a tag for each version and point the entry's `ref` at it. The site installs exactly that tag, and offers an update when you publish a newer one.
- **Generator and checks.** Copy `scripts/build-index.mjs` and `scripts/rules.mjs` from `curiosa-extras`: they read every `modules/<id>/module.json`, pin each entry on the tag `v<version>` (environment variables `REPO` and `REF` choose the address and the reference), and `node scripts/build-index.mjs --check` fails when the committed index is out of date. Run it in your own CI.
- **Only your own repository.** Every entry must point to the repository that holds the catalogue, and carry a pinned `ref`. An entry that points elsewhere, or has no `ref`, is refused by the site.
- **Not recognised as official.** Whatever the repository contains, the site marks its extensions Personal and unverified; there is no way for a catalogue to claim the official origin.

## For the developers of the core

- `src/core/modules/personalCatalogues.ts`: the list (setting `modules.catalogues`; the id of a catalogue is a hash of the normalised host, owner and repository; read-modify-write is serialised by a lock on `globalThis`), the marks (setting `modules.personal`, written by `installFromCatalogue`, kept by `removeCatalogue`; `personalIndex()` is the only question the assistant code asks, and it returns `null` when it cannot answer), the reading of each repository through `git()` / `gitWithCode()` (installer.ts, which attaches the access code, saved or pasted-and-not-yet-saved), the refusals, the status of each catalogue, add and remove. `recognized.ts` merges the entries in `readRecognized` as `catalogueOrigin: "extra"` plus `catalogueSource`, so everything that already protects "extra" entries (`confirmExtra`, no cascade, no AI install, the trust box on the sheet) applies. `moduleOrigin()` says `custom` for them, so a backup restores them with a confirmation, and `planModulesBase` never lets a backup claim `catalogue` for an extra or personal entry. `recognized.ts` keeps its memory and a generation counter on `globalThis` (a read that began before `clearRecognizedCache()` cannot write its result). Entries of personal catalogues lose `provides`, `social` and `suggested` when they become catalogue entries.
- Assistant side: `moduleUpdateRefusal({ personal })` (inspect.ts), the refusal in `doReinstall` (actions.ts), `origin` in `maintenance/catalog.ts`.
- Tests: `tests/modules-mgmt/personal-catalogues.test.mjs` (local fixture repositories mapped with `insteadOf`, a fake `git` that records what reaches git).
