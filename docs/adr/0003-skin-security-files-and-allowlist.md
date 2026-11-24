# 0003. Skin security: three checkers, one allowlist, no licence check

Status: Accepted
Date: 2026-11-24

## Context

A skin is **data** (JSON and CSS), never code. The CSS of a skin written by a stranger is read by every visitor of the site, so the core must make sure it can neither hide content, nor leave its scope, nor load anything from outside, nor run anything. The same checks serve the installation, every cached render, and the author's `skin:check` kit.

## Decision

1. **A real CSS parser, an allowlist, a rewrite.** `sanitize.ts` parses the sheet with PostCSS (a direct dependency of the core), applies the allowlist, and **rewrites** a safe sheet from what it understood; nothing is copied as written. It runs at installation **and again for every cached render**; the source file is never served. It is a pure library: no Next, no database, no network, no timer. Every selector is rewritten under `:root[data-skin="<id>"]`.
2. **Three files stay separate, plus the list.** Each answers one question and fails closed:
   - `selectors.ts` — is this selector allowed, and how is it rewritten? (regions and parts, listed content elements, stable state attributes, listed pseudo-classes; no class, id, `*`, bare `html`/`body`/`:root`.)
   - `declarations.ts` — is this property with this value allowed? (property by property, function and unit lists, bounds, `url(skin:…)` only, no `!important`, escapes refused; "no hiding, no leaving the screen" rules live here.)
   - `atrules.ts` — are this `@media`, `@supports` or `@container` condition and its nesting allowed? (`@import` is refused.)
   - `sanitize.ts` drives them and owns the limits (size, rules, declarations, keyframes, fonts: exceeding one is fatal and nothing is applied).
   - `allowlist.ts` is the single reference of what a skin may do: anything not listed is refused (allowlist, never denylist).
3. **A new public element or part is added to the allowlist in the same pull request**, with the bench (`testsupport/skins/bench/refresh.mjs`) and `tests/core/skins-dom.test.mjs`; the tests fail otherwise ([docs/SKINS.md](../SKINS.md) §26.1).
4. **Every refusal is a typed issue** with a stable code and a plain FR/EN message (`skins/messages.ts`, `IssueCode`): never silent.
5. **The core never judges a licence.** The `license` of a skin, and of its fonts and images, is free text (200 characters at most), displayed to the person who installs, never checked, never required (`validate.ts`: "la licence n'est jamais jugée"). The same holds for modules (`license` in `module.json` is informative) and for [personal catalogues](../PERSONAL-CATALOGUES.md) ("the core never validates a licence for a personal extension and makes no request about it"). Open-licence rules, where they exist, belong to the official catalogues' own CI, not to the core.
6. **A private repository is supported without changing any of this.** A skin or a module can come from a private repository through a read-only access code, sealed in the database and handed to git only through the environment of the child process ([docs/SKINS.md](../SKINS.md) §21.4b). The skin goes through exactly the same checks.

## Consequences

- Do not merge `selectors.ts`, `declarations.ts` and `atrules.ts` into `sanitize.ts`: the separation is what lets each rule set be tested on its own (including by fuzzing) and keeps `sanitize.ts` readable. Do not add an escape hatch ("trusted skin") to any of them.
- Loosening a rule is a security change: it needs a test that shows the old input refused and the new input safe, and a note in [docs/SKINS.md](../SKINS.md) §6.
- Adding a licence check anywhere in the install path contradicts this record; use the catalogue's CI.

## Not recorded here

"Private skins are never published in public repositories" is a practice of the site owner, not something the core enforces or documents; no source in this repository states it, so it is not a decision of this ADR.

## Sources

`src/core/skins/sanitize.ts`, `selectors.ts`, `declarations.ts`, `atrules.ts`, `allowlist.ts`, `messages.ts`, `validate.ts` (headers); [docs/SKINS.md](../SKINS.md) §6, §6.7, §21.4b, §26.1 and the `license` rows of the manifest table; [docs/PERSONAL-CATALOGUES.md](../PERSONAL-CATALOGUES.md); [docs/MODULES.md](../MODULES.md) (`license` informative).
