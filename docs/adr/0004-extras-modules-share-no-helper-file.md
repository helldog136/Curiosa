# 0004. Modules of curiosa-extras share no helper file

Status: Accepted
Date: 2026-11-24

## Context

The modules repository (`helldog136/curiosa-extras`) holds one folder per module under `modules/<id>/`. A site installs **one folder**: the installer reads `module.json` at the root of the chosen sub-folder, and "seul ce dossier est lu, copié et installé" (`installModule` in `src/core/modules/installer.ts`; address form `…/curiosa-extras#:modules/<id>`). A module is also updated **without restarting the site**: the core replaces the files, then imports `index.mjs?v=<new version>`, and Node keeps in memory every address it has already imported.

## Decision

1. **A module is a self-contained folder** (`module.json`, `index.mjs`, `locales/`, `README.md`, and its own files). It never imports a file from outside its folder, and the repository has no folder of code shared between modules: a helper that two modules need is written in each of them. At the time of writing (`origin/dev` of the modules repository) every folder of `modules/` has its own `module.json`, no server file imports from outside its module folder (the `../` imports found stay in the same module, between its sub-folders), and files with the same name in different modules (`privacy.mjs`, `lib.mjs`, `pure.mjs`, `ops.mjs`…) have different contents.
2. **Inside a module, a neighbour file is imported with the version**, never statically: ``const v = new URL(import.meta.url).search; const { x } = await import(`./x.mjs${v}`)``. A static `import … from "./x.mjs"` would bring back the old version after a hot update and the module would become "impossible to load". Files sent to the browser keep their static imports.
3. The rule is enforced for every module by a generic test of the modules repository (`tests/hot-update-all.test.mjs`): code analysis plus a replay of the update from the previous version to the current one in a single process.

## Consequences

- Anything two modules both need is written in each of them. A common file outside the module folder would not be copied by the installer (only the module's folder is), so the installed module would not find it.
- A pure rule that the core must also use (for example the language rules) lives in the core, and the modules repository keeps a **verbatim copy** checked by a test: see [ADR 0005](0005-i18n-audit-copy-in-extras.md).
- This ADR describes the modules repository from this repository; the rule itself is written and tested there (`docs/HOT-UPDATE.md`, `CONTRIBUTING.md`, `README.md`).

## Sources

`src/core/modules/installer.ts` (`installModule`: the sub-folder is read, copied and installed alone); `helldog136/curiosa-extras`: `docs/HOT-UPDATE.md`, `README.md` ("chaque module est un dossier autonome"), `tests/hot-update-all.test.mjs`; comparison of the helper files of its modules.
