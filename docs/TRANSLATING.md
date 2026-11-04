# Translating Curiosa

You can add a language to Curiosa **without writing any code**. You need a text editor, a free GitHub account, and about an hour for a first useful part (the setup wizard and the admin menus). Nobody expects you to translate everything at once: a language can be **partial**, and the missing texts are shown in English until someone translates them.

## How languages work

- **English and French are always supported.** Every visible text of the core and of every extension exists in both, with the same `{variables}`. They are the two **official** languages, kept by the maintainers.
- Every other language is a **community** language: contributed by people like you, by pull request, to the two repositories below. It may be partial.
- A site can offer more languages than English and French, never fewer: English and French stay available in the admin and for the public.
- When a text is missing in the requested language, Curiosa tries, in this order: **the requested language, then the main language of the site, then English**. It never shows another language by accident (never French by default).
- The admin shows the state of each language in **Settings > Languages > Translations**: `official` or `community`, and `complete` or `partial: 82%`. An AI assistant reads the same information with `maintenance_modules`.

## The two repositories

| Repository | Holds | You translate |
|---|---|---|
| `helldog136/Curiosa` (the core) | the interface: setup wizard, admin, public site | `src/locales/<code>.json` |
| `helldog136/curiosa-extras` (the extensions) | the extensions (blog, links, pages...) | `modules/<id>/locales/<code>.json` for each extension |

Start with the core: it is what a person sees first. Within the core, start with the setup wizard (`setup.`), the login screen and the main admin menus.

## Step by step

1. **Fork and clone** the repository (on GitHub: Fork, then clone your fork). On the core you also need Node.js 20 or newer and `npm ci`.
2. **Create the files from a skeleton.** From the folder of the core:

   ```
   node scripts/i18n-add-language.mjs nl
   ```

   `nl` is the two-letter code of your language (`de`, `es`, `it`, `pt`, `pl`...). The command:
   - creates `src/locales/nl.json` with **every key to translate and an empty text** (empty means "not translated yet");
   - registers the language in `src/locales/languages.json` with its name in itself (you can fix it with `--name "Nederlands"`; add `--rtl` for a right-to-left language);
   - lists the file in `src/locales/index.ts` (generated, never edit it by hand; `--sync` rebuilds it).

   To work on the setup wizard first: `node scripts/i18n-add-language.mjs nl --only setup.`. Running the command again never erases your work: it only adds the keys that are new in English.
3. **For the extensions**, in the core folder, point to your clone of the extensions:

   ```
   node scripts/i18n-add-language.mjs nl --modules ../curiosa-extras --no-core
   node scripts/i18n-add-language.mjs nl --modules ../curiosa-extras --no-core --module blog
   ```

   Each extension gets `locales/nl.json`. Its keys are either the extension's messages (`hello`) or its descriptive texts (`manifest.name`, `manifest.description`, `manifest.setting:color.label`...). The core merges the `manifest.` keys at load time, so **`module.json` is never edited** for a community language.
4. **Translate.** Open `en.json` next to your file and fill in the empty texts (see the rules below). Leave a text empty if you are not sure: English is shown until it is translated.
5. **Test.** In the core folder: `npm test -- tests/core/module-i18n.test.mjs tests/core/i18n.test.mjs`. In the extensions repository: `CURIOSA_DIR=../Curiosa npm test -- tests/module-i18n.test.mjs`. Both check that your file is valid JSON, that language codes are right, and that a translated text keeps the `{variables}` of the English text. Then look at it: `npm run dev`, open `/admin/setup` on a throwaway database, choose your language.
6. **Open a pull request** with the "New language" template (`.github/PULL_REQUEST_TEMPLATE/new-language.md`): GitHub offers it when you add `?template=new-language.md` to the "new pull request" address. One pull request per repository. A maintainer reviews it; a second speaker of the language is welcome.

## Writing the texts

- **Keep the `{variables}` exactly**: `{name}`, `{n}`, `{date}`... Move them where your grammar needs them, never rename or remove them.
- **Plural**: where a key has a `.one` twin (`setup.samples.summary` and `setup.samples.summary.one`), the `.one` text is used when the number is 1 (0 and 1 in French). If your language has other plural forms, write the most natural text for "n" and tell the maintainers in the pull request; do not use "(s)".
- **Tone**: address the person politely (the equivalent of "vous" in French, "Sie" in German, "u" in Dutch). Short sentences, 20 words at most. No exclamation marks. No "please" formula that sounds like an order. No ALL CAPS. Gender-neutral wording where the language allows it.
- **Words**: use the person's words, not the code's: no "key", "slug", "token", "webhook", "route", "payload" in what people read.
- **Labels are short** (60 characters at most, no final colon). Help texts are one line (60 characters) and, for a free field, give an example ("For example: ...").
- **Do not translate** brand names (Twitch, YouTube, Discord), file names, or what is between backticks.
- **Names and examples are invented** (`etoile_nord`, `Camille`): no real person, no real site.
- **Legal texts** (the legal pages extension: privacy notice, legal notice, terms) are different: a translation is only a draft. It stays marked **"to be reviewed by a person from the country"** and is never published automatically. Only translate the interface texts; leave the legal templates to a speaker who knows the law of the country.

## Glossary of Curiosa words

Use the same word for the same thing everywhere.

| English | Français | Meaning |
|---|---|---|
| extension | extension | a feature added to the site (blog, links, pages...) |
| entry | élément | one item of a collection: an article, a link, a code |
| overlay page | page d'overlay | a page shown in streaming software (OBS) |
| reward | récompense | what viewers get with channel points |
| draw | tirage au sort | a random pick among participants |
| admin | administration | the private part of the site |
| setup wizard | assistant d'installation | the first-run guide at `/admin/setup` |
| main language | langue principale | the language visitors see first |
| draft | brouillon | not published yet |
| redirect | redirection | a short address that leads elsewhere |

A new word must be added to this glossary (and to the repository glossary) before it is used.

## Official or community, complete or partial

| Status | Who | Rule |
|---|---|---|
| `official` | English, French | always complete; a missing text fails the tests |
| `community` | every other language | may be partial; shown as `partial: 82%` until complete |

A community language never blocks a release. The tests only check what you wrote: valid JSON, valid code, same `{variables}`, no text that is only spaces.

## For extension authors

Write every text of `module.json` as `{ "en": "...", "fr": "..." }`. A plain string has no language and is refused by the test kit (`i18n.complete`). MCP tool descriptions stay one English string (they are read by AI assistants); translate them with the optional top-level block `"i18n": { "fr": { "mcp.list_items": "..." } }`. Older cores ignore `i18n`. See [MODULES.md](MODULES.md), "Languages".
