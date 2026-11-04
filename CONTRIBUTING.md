# Contributing to Curiosa

The language of the repository is **English**: documentation, code comments, identifiers, tests, commit messages and pull request descriptions. Only text shown to people (interface, help, errors, module descriptions, onboarding, e-mails) lives in the language files, in English **and** French with exact parity (same keys, same `{variables}`).

Admin pages follow [docs/ERGONOMIE-ADMIN.md](docs/ERGONOMIE-ADMIN.md); a pull request that touches one contains an "Ergonomics" section.

## Adding a language

Anyone can add a language, **with files only** (no code). English and French are the two official languages and are always complete; every other language is a community language and may be partial (missing texts are shown in English).

1. `node scripts/i18n-add-language.mjs <code>` creates the skeleton (`src/locales/<code>.json`) and registers the language.
2. Translate the texts you can; leave the others empty.
3. `npm test -- tests/core/module-i18n.test.mjs tests/core/i18n.test.mjs`
4. Open a pull request with the "New language" template (`?template=new-language.md`).

The full guide, with the glossary and the tone to use, is [docs/TRANSLATING.md](docs/TRANSLATING.md). The extensions live in `helldog136/curiosa-extras` (one `locales/<code>.json` per extension); the same command writes their skeletons with `--modules <path>`.
