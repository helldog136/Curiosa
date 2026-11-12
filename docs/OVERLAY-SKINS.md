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
- The folder rules, licences (SPDX), previews (at least one `.webp`, 150 KB at most) and fingerprint are the ones of site skins. **No fonts and no images**: overlay skins use system fonts and CSS gradients.
- Install: the same pipeline as site skins (`https://github.com/<owner>/curiosa-skins#<id>/v<version>:skins/<id>`, the catalogue, personal repositories with confirmation). The registry row carries `kind: "overlay"`. The Appearance page lists only site skins; the overlay skin tab lists only overlay skins.
- Previews: `previews/overlay-640.webp` (still, 150 KB at most) and optionally `previews/overlay-anim.webp` (a looping animated webp of the same scene, 640 x 360, 450 KB at most; the catalogue entry names it in `previewAnim`). The catalogue shows the animated one when the card is on screen and the animation budget allows, and falls back to the still one; both are read once from the repository, checked on their bytes, kept on the site and served by the site itself.
- Catalogue: official overlay skins are listed in `catalogue/overlay-skins.json` of the skins repository (same entry format as `catalogue/index.json`), a separate file so that older cores never see them.
- Check with `npm run skin:check -- <folder>`: the same function (`validateSkinFolder`) serves the install, the update and the check.

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
