# Overlay skins and skin per context

> Contract 3 (core 0.9.0) adds structure to skins: closed shape, frame, decoration, motion and font presets, and layout properties (section 2b). Contract 2 skins keep working unchanged.

Since core 0.8.0, an overlay page can wear an **overlay skin**: a folder of pure data (no code) that restyles every element of the page, and the page can change skin by **context** (the current game, a scene, a mood…) through a generic contract that any module may implement. The first four tokens (`--ov-fg`, `--ov-surface`, `--ov-radius`, `--ov-border`) and every existing page are unchanged: with no skin, nothing is injected.

Decisions it follows (`docs/ideas/overlays-decisions.md`): overlay skins live in the same repository as site skins (`curiosa-skins`) and declare themselves in `skin.json`; the vocabulary is distinct from the site's (`--ov-*`, `data-ov-part`, `data-ov-region`); a site skin never touches an overlay and an overlay skin never touches the public site; the elements keep working untouched.

## 1. How it works

1. The page (`/overlays/page/<secret>`) resolves the skin it wears now: the rule of the current context value, else its default skin, else none.
2. The core page embeds the compiled skin sheet. When each element's iframe has loaded, the page adopts the sheet into the element's document (same origin, constructed style sheet, so the element's own security policy is not involved) and sets `data-ov-skin="<id>"` on its root. Frames of elements that declare `followsStyle: false` are never touched. Frames are hidden until the skin is applied, so there is no flash of the unskinned element.
3. The page already polls its light `state` endpoint (about every 5 s, and stays at 5 s when a context drives the skin). The answer carries the skin key (`<id>@<version>:<fingerprint>`) and the sheet only when it differs from the one the page wears. **The page switches only when it has seen the same new key on two consecutive reads**, then fades the stage out and in (0.25 s). With `prefers-reduced-motion: reduce` the switch is instant and every motion preset is off.
4. No provider, module turned off, module slow or in error, value unknown, skin missing or altered: the **default skin** applies, then the **common style**. A page never breaks because a skin or a module is gone.

## 2. The skin format (`skin.json`, `kind: "overlay"`)

```json
{
  "skinContract": 2,
  "kind": "overlay",
  "id": "ember-hall",
  "name": { "fr": "Salle de braise", "en": "Ember hall" },
  "description": { "fr": "…", "en": "…" },
  "version": "1.0.0",
  "minCore": "0.8.0",
  "license": "MIT",
  "tags": ["dark", "epic"],
  "tokens": "tokens.json",
  "stylesheet": "skin.css",
  "previews": [{ "file": "previews/overlay-640.webp", "width": 640, "alt": { "fr": "…", "en": "…" } }]
}
```

- `skinContract: 2` is required (an older core refuses the skin as "contract newer" instead of misreading it). `modes` does not apply to an overlay skin.
- The folder rules, licences (texte libre, jamais jugé par le cœur), previews (at least one `.webp`, 150 KB at most) and fingerprint are the ones of site skins. **Images** only through a `scene` (contract 5, see OVERLAY-ANIMATIONS.md). **Fonts** only with contract 6 (see "Fonts" below); without them overlay skins use system fonts and CSS gradients.
- Install: the same pipeline as site skins (`https://github.com/<owner>/curiosa-skins#<id>/v<version>:skins/<id>`, the catalogue, personal repositories with confirmation). The registry row carries `kind: "overlay"`. The Appearance page lists only site skins; the overlay skin tab lists only overlay skins.
- Previews: `previews/overlay-640.webp` (still, 150 KB at most) and optionally `previews/overlay-anim.webp` (a looping animated webp of the same scene, 640 x 360, 450 KB at most; the catalogue entry names it in `previewAnim`). The catalogue shows the animated one when the card is on screen and the animation budget allows, and falls back to the still one; both are read once from the repository, checked on their bytes, kept on the site and served by the site itself.
- Catalogue: official overlay skins are listed in `catalogue/overlay-skins.json` of the skins repository (same entry format as `catalogue/index.json`), a separate file so that older cores never see them.
- Check with `npm run skin:check -- <folder>`: the same function (`validateSkinFolder`) serves the install, the update and the check.
- **Animation (contract 4, core 0.30.0)**: an overlay skin may add `"animation": "animation.json"` (with `"skinContract": 4` and `"minCore": "0.30.0"`) to say how animated gauges, levels and counters look in this skin: stained glass, neon tubes, a plain bar… It is data only (procedural primitives with parameters and seeds, no code, no image). Without it, those elements use a basic rendering that follows the skin's `--ov-*` tokens. The whole contract, with a worked stained-glass example: [OVERLAY-ANIMATIONS.md](OVERLAY-ANIMATIONS.md). Since core 0.33.0 (recipe contract 2) a recipe may also name motions (`"motion": { "value": "gentle" }`) and a sheet may read `var(--ov-dur-*)` in `animation-duration` and `var(--ov-ease-*)` in `animation-timing-function`: see OVERLAY-ANIMATIONS.md sections 5b and 5c.
- **Scene (contract 5, core 0.40.0)**: an overlay skin may add `"scene": "scene.json"` (with `"skinContract": 5` and `"minCore": "0.40.0"`) and its own pictures in `images/` (PNG, WebP, sanitised SVG, listed in `assets` with their licence): the core computes the abstract bar and the skin says where its pictures go and when they move. This is the only case where an overlay skin carries images; fonts stay refused. See docs/OVERLAY-ANIMATIONS.md section 10.

### `tokens.json`

```json
{ "tokens": { "--ov-fg": "#f4ecdc", "--ov-surface": "rgba(24,14,10,0.88)", "--ov-accent": "#e8a23b", "--ov-accent-fg": "#1b1008", "--ov-font": "Georgia, serif" } }
```

The vocabulary is **closed** and each value is checked by its type (`src/core/overlays/skinTokens.ts`); a value that is not understood refuses the skin.

| Token | Type | What it does | Without it |
| --- | --- | --- | --- |
| `--ov-fg` | colour | text | **required** |
| `--ov-surface` | colour (translucent allowed) | panel background | **required** |
| `--ov-surface-image` | gradient | gradient drawn over the surface | none |
| `--ov-border` | colour | border colour | transparent |
| `--ov-accent`, `--ov-accent-fg` | colour | bars, dots, badges, highlights, and the text on them | the element's own accent |
| `--ov-muted` | colour | secondary text (subtitle, source, footer, author) | the element's own |
| `--ov-radius` | length 0 to 64 px | corner radius | 12 px (common style) |
| `--ov-border-width` | length 0 to 12 px | border width of panels | the element's own |
| `--ov-shadow`, `--ov-text-shadow` | shadow (4 layers at most) | glow or shadow of panels, of text | none |
| `--ov-space` | length 3 to 40 px | spacing unit for the skin's own rules | 0.7 em |
| `--ov-font`, `--ov-font-heading` | system font stack ending with a generic family | body and heading fonts | the element's own |
| `--ov-weight`, `--ov-weight-heading` | 100 to 900 | font weights | the element's own |
| `--ov-tracking` | length -2 to 6 px | letter spacing | none |
| `--ov-heading-transform` | `none`, `uppercase`, `lowercase`, `capitalize` | case of titles, badges, tags, labels | none |
| `--ov-anim` | `none`, `fade`, `rise`, `pop`, `glow` | entrance of panels (keyframes belong to the core) | none |
| `--ov-anim-duration` | 100 ms to 4 s | duration of the entrance | 0.6 s |
| `--ov-surface-soft` (0.22.0) | colour | the skin's light panel, used by an element's "Discreet" look when it takes "the skin's colours" | `--ov-surface` (the kit sets the opacity) |
| `--ov-surface-solid` (0.22.0) | colour | the skin's solid panel ("Readable everywhere" with the skin's colours) | `--ov-surface` made solid |
| `--ov-fg-on-light`, `--ov-fg-on-dark` (0.22.0) | colour | the text the skin wants on a light / a dark panel ("Auto" text) | `#111111` / `#ffffff` |
| `--ov-outline` (0.22.0) | colour | colour of the text outline of the appearance kit | the opposite of the text |

**The five kit tokens (core 0.22.0) are optional and additive (still contract 3).** A skin that uses one sets `"minCore": "0.22.0"`: an older core reads `minCore` before the tokens and refuses the skin as "needs a newer core", never as "unknown token". Checks: `--ov-fg` over `--ov-surface-soft` and over `--ov-surface-solid`, `--ov-fg-on-light` over white and `--ov-fg-on-dark` over black, all at 4.5:1 in the worst case. Without them the core derives the same values (`skinColors` in `src/core/overlays/skinSheet.ts`), so the 14 skins of the repository work unchanged.

**Skin per element and site retouches (core 0.22.0).** An element may wear another skin than its page (`elements[].skin`: absent = the page's, `null` = none); it keeps it when the page changes skin per context. The page's skin may be **retouched for this site** (`look.tweaks`: accent, panel colour, font among closed system stacks, corners): the retouch is written over the skin's tokens and before its rules, the text colour is corrected when a panel colour would drop below 4.5:1, and the installed skin is never changed. Retouches apply to the page's skin only, never to an element's own skin. Priority, from the weakest: module fallback < skin < site retouch < page style < element style.

Elements should still read every token with a fallback (`var(--ov-font, system-ui)`), like the first four. A token the skin does not define maps to nothing, so the element keeps its own look.

**Readability (>= 4.5:1).** `--ov-fg` over `--ov-surface` is judged in the worst case: a translucent surface is composited over white AND over black. `--ov-muted` over the surface and `--ov-accent-fg` over `--ov-accent` too. A transparent surface (alpha below 0.2) requires `--ov-text-shadow`, and the text must contrast with the shadow colour. A rule of the sheet that sets both `color` and a background colour must also reach 4.5:1, and text colours below 70 % opacity are refused.

### `skin.css`

Only flat rules (24 KB, 90 rules, 14 declarations per rule). The grammar is closed and every selector is **re-written** under `html[data-ov-skin="<id>"]`:

- selectors: one to three `[data-ov-part="x"]` / `[data-ov-region="x"]` compounds separated by a space (descendant), each with an optional `:first-child` or `:last-child`, ending with an optional decorative `::before` / `::after`; six selectors per rule at most; `x` is `[a-z][a-z0-9-]{0,30}` (a part the element does not have simply matches nothing);
- properties: colours, `background` (colour or gradient only), borders and radius, `box-shadow`, `text-shadow`, `font-family` (system stack), `font-size` (60 to 160 %), `font-weight`, `font-style`, `letter-spacing`, `line-height`, `text-transform`, `padding`, `opacity` (0.4 to 1), `backdrop-filter: blur()` (24 px at most), `animation-name` / `-duration` / `-delay` (core presets `ov-fade`, `ov-rise`, `ov-pop`, `ov-glow`), `text-align`; and, only on `::before` / `::after`, `content` (empty or one ornament character), `position`, size, offsets, `z-index`;
- values may read a token: `var(--ov-accent, #e8a23b)`; `var()` of anything else is refused;
- **forbidden**: at-rules (`@import`, `@media`, `@keyframes`, `@font-face`), `url()`, `!important`, classes, ids, tag selectors, `*`, `:root`, pseudo-classes other than the two above, combinators other than a space, `display`, `visibility`, `clip`, `margin`, `transform`, `filter`, `overflow`, `float`, and anything that hides content. A skin can restyle; it cannot hide, add or change text.

Any refusal is a precise message in French and English (`overlay-*` codes of `src/core/skins/messages.ts`); nothing is ever copied as is.

### 2b. Contract 3: structure, not only colours (core 0.9.0)

With tokens alone, every skin is the same panels recoloured. Contract 3 lets a rule change the **composition** of the parts, still as pure data: six declarations take a **name from a closed list** (plus an optional bounded number and colour) and the core expands each into fixed CSS. The skin never writes a `clip-path`, a gradient list, a pseudo-element or an animation of its own. A sheet that uses any of this (or the layout properties below) must declare `"skinContract": 3` and `"minCore": "0.9.0"`; an older core refuses it as "contract newer".

| Declaration | Names (closed) | Optional | What the core writes |
| --- | --- | --- | --- |
| `ov-shape` | `slanted`, `slanted-both`, `hexagon`, `chevron`, `ticket`, `notch`, `ribbon`, `pill` | cut `4px` to `28px`, `flush` | a `clip-path` polygon (or a pill radius) and inner padding so text is never cut; `flush` removes the padding for avatars and bars |
| `ov-frame` | `double`, `dashed`, `inset`, `glow`, `thick` | colour | an outline, an inset ring or a glow |
| `ov-deco` | `brackets`, `hazard`, `scanlines`, `grain`, `halftone`, `glow`, `tape`, `stamp`, `rings`, `stripe`, `flashlight`, `radar`, `shimmer` (two at most, comma separated) | colour | **background layers of the element itself**: no pseudo-element and no `position`, so a decoration paints behind the text and can never move or cover content |
| `ov-motion` | `drift`, `flicker`, `pulse`, `float` | none | one idle animation, wrapped in `prefers-reduced-motion: no-preference` (`shimmer` of `ov-deco` also moves) |
| `ov-font` | `stencil`, `handwritten`, `typewriter`, `condensed`, `wide`, `display`, `rounded`, `mono`, `serif` | none | a system font stack (and stretch or tracking for `condensed` and `wide`) |
| `ov-text` | `outline`, `glow`, `emboss`, `engrave`, `lift` | colour | a text stroke or text shadow |

Layout and shape properties added to the allowed list (all bounded): `flex-direction`, `order`, `align-items`, `justify-content`, `gap`, `margin` (-4 px to 32 px), `max-width` (50 % to 100 %), `transform` (only `rotate()` up to 8 degrees, `skewX()` or `skewY()` up to 10), `font-variant-caps`, `word-spacing`. Flex properties only matter on parts that are flex containers; they never change what a part contains.

Rules of thumb: a shape clips the element's own shadow and border at the cut (use `ov-frame` or a token shadow on parts without a shape); a `hazard` strip or a `tape` needs a little extra `padding-bottom` or `padding-top` on that part; idle motion replaces the entrance preset on the same part (one `animation` list per rule). The sample scene and the real elements are the test: decorations stay behind the text, shapes keep the text inside.

The core also guarantees the text/surface pair: for every skin, containers (`panel`, `card`, `bubble`, `quote`) take `--ov-surface` as background and `--ov-fg` as text, and the text parts (`title`, `name`, `body`, `text`, `message`, `value`, `label`…) follow `--ov-fg`, so an element that draws its own colours cannot put the skin's text on a colour the skin never checked.

## 3. What the core maps for you

For the tokens a skin defines, the core adds (before the skin's own rules, so a rule can refine them): font and tracking on the element root and on the shared parts, heading font and weight on `title`, `name`, `subtitle`, `kind`, `label`, `badge`, `tag`; case on `title`, `kind`, `badge`, `tag`, `label`; text shadow; muted colour on `subtitle`, `source`, `foot`, `footer`, `author`, `kind`, `how`; surface gradient, border style and width, shadow on `panel`, `card`, `bubble`, `quote`; accent on `bar-fill`, `dot`, `badge` (and `stars`, `winner` text) with `--ov-accent-fg` on badges; and the motion preset on the same containers, switched off for reduced motion.

## 4. The generic overlay context contract

The core never names a module. A module that can tell "what is going on" declares it:

```json
{ "minCore": "0.8.0",
  "overlayContexts": [ { "id": "game",
    "label": { "fr": "Jeu", "en": "Game" },
    "switchLabel": { "fr": "Un skin par jeu", "en": "Skin per game" },
    "example": { "fr": "un jeu de course", "en": "a racing game" } } ] }
```

```js
export default {
  overlayContexts: {
    game: {
      // The value now, or null (nothing known, offline…). Runs server side with the module's secrets, 8 s at most.
      current: async (ctx) => ({ id: "1234", name: "Some game" }),
      // The values known so far, for the picker (searchable). Optional. Return at most `limit`.
      values: async (ctx, { search, limit }) => [{ id: "1234", name: "Some game" }],
    },
  },
};
```

- `id` is what rules store (a printable string, 120 characters at most); `name` is what people read. Answers are cleaned and bounded by the core; duplicates are dropped.
- `label` is the noun (column title and picker label), `switchLabel` the text of the switch ("Skin per game"), `example` fills the empty state ("For example: a racing game"). They are the module's words: the core adds no word of its own about games.
- `current` is read at most every 4 s per context, however many pages are open. A thrown error, a timeout or an invalid answer means "no value": the default skin applies. The error message is never logged.
- A page uses one context at a time (chosen in the folded "More options" when several are offered). Changing the context clears its rules, which were about another one.
- Future modules can drive skins by other contexts (scene, mood, event) with no change to the core.
- `npm run module:check` verifies the shape (`current` and `values` must be functions).

## 5. In the administration

**Overlays > an overlay page > Skin** (the Layout and Skin tabs):

- the **gallery**: the common style and every installed overlay skin with a live, animated sample (a fixed scene drawn by the core, `/admin/overlay-pages/skin-sample/<id>`, no real data): an alert, a counter, a list, a featured card and a banner, with a short looping scenario (alert in and out, counter tick, new row, featured card change, banner change) that shows the skin's entrance and idle motion. The scene runs only while it is on screen, at most six at a time, never with `prefers-reduced-motion: reduce` (a still frame), not while the tab is hidden, and a "Pause the animations" button stops them all; one click on "Use this skin". skins of the catalogue are shown in "Get more skins" as regular cards (live search, same height, the Install button always in the same place) with their 640 x 360 preview, read once from the repository when the card comes into view, kept on the site (`data/cache`) and served by the site itself, with a neutral placeholder when it is unavailable;
- **Skin by situation**: a switch whose text comes from the module ("Skin per game"), off by default, shown only when a module offers a context. When on: a searchable table (live, no button) "value → skin" with an empty state that gives an example, "Add a rule", and "Edit" opening the core dialog: a searchable picker of the values the module has seen (nothing is typed as a key), a skin list and a live preview of the skin. "Everything else uses: <default skin>" says what happens in the other cases.

## 6. AI tools (MCP)

| Tool | Kind | Granted by default |
| --- | --- | --- |
| `overlay_skins_list` | read | yes |
| `overlay_skin_rules_list` | read | yes |
| `overlay_skin_rules_create` | write | no |
| `overlay_skin_rules_update` | write | no |

They use the same validation as the administration (`overlays/lookService.ts`): a skin must be installed and working, a context must be offered by an active module, a value must be one the module knows (an id, or its unique name). No tool deletes anything: a rule is neutralised by pointing it at another skin and removed in the administration. In the rights presets, the reads belong to "read" and the writes to "full".

## 7. Backup and upgrades

Overlay pages keep their look (`OverlayPage.look`, one column added by the migration `20261111090000_overlay_skins`, bounded JSON, read without ever throwing) in `data/overlay-pages.json`. Installed skins are in the skin registry (`kind: "overlay"`) and restored like site skins (reinstalled from their repository, the contract decides). The support floor (`upgrade.json`) does not change: the migration only adds a column with a default and no data conversion exists.

## TV legibility, text size and the opaque background (core 0.11.0)

Overlays are watched like TV. Two settings of the **page owner** sit above every skin:

- **Text size** (50 to 300 %, "TV (recommended)" is 200 %). It is applied by the core to the element's frame, outside the element's document: a skin cannot read it, override it or fight it. Skin `font-size` rules remain **relative** to the element's own size (60 to 160 % or 0.6 to 1.6 em), so they follow the owner's size.
- **Background: Opaque** (next to Transparent and Semi-transparent). The skin keeps its colours, its `--ov-surface` becomes solid (the same colour with alpha 1; if that would make the text less readable, the colour it was checked over: black under light text, white under dark text), so the text contrast of the skin is kept (4.5:1 minimum, see the contrast checks). Without a skin, the core sets the solid panel colour itself (`#14171c` under light text, `#f7f7f5` under dark text). A rule of your sheet that sets its own `background-color` on a part is a decoration of that part and stays; the panel token is what the owner's choice changes.

**Guidance for skins.** On a 1920x1080 canvas nothing should be below 24 px and body text should be 28 to 32 px or more; use strong contrast and no hairline weights (`--ov-weight` 400 or more for body). A `font-size` below 100 % (or 1em) in a rule makes text smaller than the element chose: the check reports a **warning** (`overlay-text-small`), not an error, so published skins keep working; avoid it.

## Fonts (core 0.47.0, skin contract 6)

An overlay skin may ship up to four **woff2** fonts. The skin never writes `@font-face` or `url()`: it declares the files and the core writes the rules.

```json
{
  "skinContract": 6, "kind": "overlay", "minCore": "0.47.0",
  "assets": [
    { "file": "fonts/fredoka.woff2", "kind": "font", "family": "Fredoka", "weight": "400", "style": "normal",
      "license": "SIL Open Font License 1.1", "author": "The Fredoka Project Authors", "source": "https://example.invalid/fredoka" }
  ]
}
```

- **Contract and core**: a skin with a font declares `skinContract: 6` (`overlay-contract-v6`) and `minCore` of at least `0.47.0` (`overlay-font-mincore`). An older core refuses it cleanly as "contract newer". Contracts 2 to 5 behave byte for byte as before (a regression test pins the compiled sheet and the rendered page of each).
- **Files**: `fonts/<name>.woff2` only (lower case, `[a-z0-9._-]`); ttf, otf, woff, eot and svg are refused (`asset-bad-path`). The bytes are checked: `wOF2` signature, a sane header and a length that matches the file (`asset-signature`, `overlay-font-invalid`). Limits, the same as site skin fonts: 4 files, 150 KB each, 400 KB together, inside the 2 MB / 60 files of a skin. Fonts are part of the fingerprint.
- **`family`** (required, `[A-Za-z0-9 _-]`, 41 characters at most), `weight` (`100`..`900`, a range such as `300 500`, `normal`, `bold`; default `400`) and `style` (`normal` or `italic`). `license`, `author` and `source` are free text for the credits: the core never judges a licence and never copies them into a sheet.
- **Using the font**: name the declared family in `--ov-font`, `--ov-font-heading` or `font-family`, **then a generic family last**: `"Fredoka", Georgia, serif`. Allowed in a list: a declared family, a system font from the core's list (Georgia, Arial, Segoe UI, ...) or a generic family, 2 to 7 entries. Any other name is refused (`overlay-font-undeclared`), and a list that does not end with a generic family too (`overlay-font-fallback`). Contracts 2 to 5 keep their older, looser rule.
- **Scoped names**: the core rewrites each declared family to `ov-<skin id>-<family in lower case with dashes>` (`ov-emma-skin-fredoka`), so two skins never share a family and a skin cannot restyle the text of another. `@font-face`, `@import` and `url()` stay refused in `skin.css` and in the tokens.
- **The rule the core writes**: `@font-face{font-family:"ov-...";src:url("/skins/<id>/<version>/fonts/<file>.woff2") format("woff2");font-weight:W;font-style:S;font-display:fallback}`, escaped by the same encoder as every other string. `font-display: fallback`: invisible for 100 ms at most, then the fallback stack; a late font never makes a live alert jump after the first seconds.
- **Loading**: the overlay page fetches the font bytes itself (`connect-src 'self'`, unchanged) and hands them to each element frame as a `FontFace`, so an element page with a strict policy (`default-src 'none'`) needs no `font-src`. The frame stays hidden until its sheet and fonts are ready, for 2.5 s at most: if a font cannot be fetched, the frame is shown with the fallback stack and nothing shows an error. The page policy is unchanged (`font-src 'none'`); the gallery sample page gets the fonts as `data:` addresses and `font-src data:` only when it has any.
- **Check**: `npm run skin:check -- <folder> --core-version 0.47.0`.

## Patterns: the skin's own mosaic pieces (core 0.48.0, skin contract 7)

A skin gets more power over HOW an element is drawn, never over DATA. A `mosaic` (the stained-glass drawing of the animation recipe, docs/OVERLAY-ANIMATIONS.md "Patterns") may take its pieces from files of the skin: a **pattern file** is a list of polygons and tones, **numbers only**. It has no code, no URL and no text; it is never served as a file; and it cannot read or change anything of the site: the engine reads the numbers and draws, nothing else.

```json
{
  "skinContract": 7, "kind": "overlay", "minCore": "0.48.0", "animation": "animation.json",
  "assets": [
    { "file": "patterns/wide.json", "kind": "pattern", "license": "CC0-1.0", "author": "Your name", "source": "Drawn by hand" }
  ]
}
```

- **Contract and core**: a skin that ships a pattern declares `skinContract: 7` (`overlay-contract-v7`) and `minCore` of at least `0.48.0` (`overlay-pattern-mincore`). An older core refuses it cleanly as "contract newer". Only an overlay skin may ship patterns (`pattern-overlay-only`).
- **Files**: `patterns/<name>.json` only (lower case, `[a-z0-9._-]`), each declared in `assets` with `kind: "pattern"`, 48 files at most (`patterns-too-many`), 32 KB each (`pattern-too-large`). `license`, `author` and `source` are free text for the credits: the core never judges a licence. A file under `patterns/` that is not declared is refused like any unlisted file (`skin-file-unlisted`).
- **The recipe names them**: the `patterns` table of `animation.json` (recipe contract 4) maps a name to one to four variants of different proportions, and a mosaic asks for `"pattern": "file"` with `"source": "<name>"`. The engine picks the variant whose proportions are closest to the element and stretches it to fit. A pattern the recipe names but the skin does not ship is refused (`pattern-missing`).
- **Checks**: every file goes through the pattern checker (docs/OVERLAY-ANIMATIONS.md "Patterns" lists the limits and the codes). Errors refuse the skin; warnings (very sharp corners, less than 97 % coverage, more than 120 pieces, extra keys) keep it and say what will look wrong. A file written for a newer pattern contract is skipped with a warning: the simple pattern draws instead.
- **Hand-off**: the validated numbers (the normalised pieces, at most 96 KB for all the patterns of a skin, `patterns-total-too-large`) travel inside the recipe handed to the overlay page. The page never fetches a pattern file, and `/skins/<id>/<version>/patterns/...` is not served.
- **Check**: `npm run skin:check -- <folder> --core-version 0.48.0`. A complete example skin (neutral geometry invented for the tests) is `tests/fixtures/pattern-skins/slate-panes`.

## `twinOf`: a twin of a site skin (core 0.47.0)

An overlay skin may name the **site skin** it was drawn to go with: `"twinOf": "<site skin id>"` in `skin.json`, and the same field in its entry of `catalogue/overlay-skins.json`. It is metadata only: no contract change, an older core ignores it (unknown keys are warnings), and it is refused only on a site skin (`twin-overlay-only`) or when it names the skin itself or `basic` (`twin-self`).

- The overlay skin gallery shows a badge "Matches your site skin" **only** when the active site skin is the twin, and a quiet line "Twin of <name>" when the twin is installed but not active. Nothing otherwise.
- After the person changes their site skin, and only if an installed overlay skin is a twin of the new one and some overlay page does not wear it, the administration offers one button "Use the matching overlay skin" (6 hours, or "Not now"). It is **never applied on its own**.
