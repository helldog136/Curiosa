# 0005. `i18n/audit.mjs` has a verbatim copy on the extras side

Status: Accepted
Date: 2026-11-24

## Context

The language rules are one set of pure functions (`src/core/i18n/audit.mjs`, with `audit.d.mts` for the types): the required languages (English and French, always complete), the fallback chain (requested language, then the site's main language, then English, never French by accident), the `{variables}` of a text, and the audit of dictionaries and manifests. Three places need them: the core at run time, the test kit (`testsupport/i18n.mjs`), and the modules repository, whose scripts and tests (`scripts/i18n-audit.mjs`, `scripts/rules.mjs`, `scripts/i18n-baseline.mjs`) audit every module. The modules repository depends on **no core version** and, per [ADR 0004](0004-extras-modules-share-no-helper-file.md), cannot import a file from the core.

## Decision

The core owns the file. The modules repository keeps `scripts/i18n-audit.mjs` as a **verbatim copy**: the same text, preceded by exactly two comment lines that say so ("VERBATIM COPY of src/core/i18n/audit.mjs … Change it in the core, then copy it here unchanged."). A test of the modules repository (`tests/module-i18n.test.mjs`, "the helper is a verbatim copy of the core's") strips those two lines and compares the rest with the core's file, found through `CURIOSA_DIR` (or the working directory). When the core checkout has no such file (an older core), the test compares nothing.

## Consequences

- The rule is changed in the core first, then the file is copied to the extras unchanged; never edit the copy. At the time of writing the two files are identical (apart from the two header lines).
- A change to `audit.mjs` that is not copied makes the modules repository's test fail on the next run against that core, so a divergence is noticed, not silent.
- `audit.mjs` must stay free of imports and I/O (its header: "no import, no I/O"): it has to run unchanged in both repositories.
- The core's own tests of the rules are in `tests/core/module-i18n.test.mjs`.

## Sources

`src/core/i18n/audit.mjs` (header), `src/core/i18n/audit.d.mts`; `helldog136/curiosa-extras`: `scripts/i18n-audit.mjs` (first two lines), `tests/module-i18n.test.mjs`; [docs/TRANSLATING.md](../TRANSLATING.md).
