<!-- New language. Open with: .../compare/dev...your-branch?template=new-language.md -->
## New language

- Language (two-letter code and name in itself): 
- Repository: core (`src/locales/<code>.json`) / extensions (`modules/<id>/locales/<code>.json`)  <!-- one pull request per repository -->
- Status: `community` (English and French are the only official languages)

## What is translated

- [ ] Created with `node scripts/i18n-add-language.mjs <code>` (the skeleton), not by hand.
- [ ] Share translated (the command prints it, or see Settings > Languages > Translations): ___ %. A partial language is welcome; empty texts fall back to English.
- [ ] Parts done first: setup wizard (`setup.`) / login / admin menus / other: ___

## Checks

- [ ] `{variables}` unchanged in every translated text (the tests check it).
- [ ] Polite tone, short sentences, no exclamation marks, no ALL CAPS, gender-neutral wording where possible ([TRANSLATING.md](../../docs/TRANSLATING.md)).
- [ ] Words follow the glossary of [TRANSLATING.md](../../docs/TRANSLATING.md).
- [ ] No legal text translated for publication: legal templates stay "to be reviewed by a person from the country".
- [ ] No real person's name, no real site in examples.
- [ ] Tests run: `npm test -- tests/core/module-i18n.test.mjs tests/core/i18n.test.mjs`.
- [ ] I looked at the setup wizard (`/admin/setup`) in my language on a throwaway database (screenshot welcome).

## Ergonomics

Only language files change: no page, field or control is added or moved (rules R1 to R28 are untouched). R29 (English and French in exact parity) is unaffected: English and French files are not modified.
