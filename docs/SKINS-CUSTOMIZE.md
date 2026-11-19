# Skin customization (core 0.44.0)

A site skin can let its owner change a few things (the colour of a banner, a set of pennants, a picture, how round the corners are) **without any code**. The core is a shell: the **skin declares** what is customizable (data only, in `skin.json`), the core **draws one generic page** (Admin > Appearance > Customize) and **applies validated values** as `--sk-cz-<id>` custom properties that the skin's own style sheet reads.

This file is the reference for skin authors. The French guide [CREER-UN-SKIN.md](CREER-UN-SKIN.md) and the contract [SKINS.md](SKINS.md) describe the rest of a skin. Release A (core 0.44.0) covers **site skins**; overlay skins, sprites, tinting of drawings and the export of a look come later.

## 1. What you write

1. Set `"skinContract": 4` and `"minCore": "0.44.0"` (an older core then refuses the skin cleanly: "needs a newer Curiosa").
2. Add a `customize` section to `skin.json` (below).
3. In `skin.css`, **read** the variables: `background-color: var(--sk-cz-banner, #16235a);`. Give each a fallback equal to the value you shipped.
4. Declare every picture you offer in `assets` (with its licence), as for any skin picture.

Nothing else: no script, no page, no sentence shown to the owner (only labels and short hints). `npm run skin:check` runs the same checks as the installation.

## 2. The declaration

```jsonc
"customize": {
  "version": 1,
  "looks":  [ { "id": "crimson", "label": { "fr": "Cramoisi", "en": "Crimson" }, "values": { "banner": "crimson", "pennants": "crimson" } } ],
  "groups": [ { "id": "main", "label": { "fr": "L'essentiel", "en": "The essentials" }, "controls": [ /* controls */ ] } ]
}
```

Every label exists in **French and English**. A label is 40 characters at most, with no colon and no parentheses, and no technical word (key, token, API, identifier…); a hint is 60 at most and goes in the "?" bubble. No exclamation mark, no word in capitals.

Common keys of a control: `id` (`^[a-z][a-z0-9-]{0,24}$`, unique), `type`, `label`, `hint`, `featured` (the short path), `was` (up to two former ids: a renamed control keeps its saved value).

### Limits (fixed by the core; a skin cannot raise them)

| | |
|---|---|
| groups | 5 |
| controls per group / in total | 7 / 24 |
| `featured` controls (shown without opening anything) | 2 |
| looks | 8 |
| choices or swatches of one control | 10 (up to 4 choices are drawn as side-by-side buttons, more as chips) |
| picture alternatives of one control | 8 |
| pictures an owner may upload for one skin | 8 files, 4 MB |

The page shows the looks and the (at most two) featured controls; **every group is folded**, with a one-line summary. A skin with 24 controls still shows two fields and one row of looks.

### Controls

**`color`**: `palette` (up to 10 swatches `{ id, label, light, dark }`, a colour per mode; the skin author owns the dark mode), `default` (a swatch id, or a `#rrggbb` when there is no palette), optional `custom: { "l": [0.14, 0.34], "c": [0, 0.14], "dark": { "l": [..] } }` (a free colour inside an OKLCH lightness and chroma range; the hue is free), `contrast` (see 5). Variable: `--sk-cz-<id>` (`#rrggbb`, per mode).

**`choice`**: `values` (2 to 10 `{ id, label, tokens }`), `default`, `display` (`auto` or `chips`). `tokens` are common `--sk-*` tokens with valid values, the same as the skin's own `options` (never `--v-*` palette tokens, never a free variable name). A choice writes no variable of its own.

**`toggle`**: `default` (boolean), `on` and `off` (token maps). Variable `--sk-cz-<id>`: `1` or `0`.

**`slider`**: `min`, `max`, `step`, `unit` (`""`, `px`, `rem`, `%`, `deg`, `ms`), `default`. The core formats the value itself (`0.5rem`).

**`image`**: `alternatives` (`{ id, file, label }`, files of `images/` declared in `assets`), `default` (`none` or an alternative), `fit` (`cover`, `contain`, `tile`), optional `upload` (`formats` among `png`, `jpg`, `webp`, `gif`, `svg`; `maxKb`; `ratio`; `ratioTolerance`; `minPx`; `maxPx`; `focal`; `animated`, true by default) and `textOver: { color, min }` (a text colour drawn on the picture). Variables: `--sk-cz-<id>` (`url(...)` or `none`), `-size`, `-repeat`, `-pos`. Use them in layers: `background-image: var(--sk-cz-banner-image, none); background-size: var(--sk-cz-banner-image-size, cover);`.

**Looks** set several controls at once (values must be ones the control allows; a look never carries an upload). Applying a look changes the draft, the owner sees it, then saves or cancels.

### Reading is tolerant

An unknown control type, an unknown key, or a `customize.version` newer than the core's is **skipped with a warning**; the rest works. A known type with an out-of-bounds value is an installation error (fix it at once). `skin:check` also warns when a declared control is never read by the sheet, or the sheet reads a `--sk-cz-*` that is not declared.

## 3. What the owner can and cannot break

* Untouched, a skin renders **exactly as shipped**: the defaults are always written.
* Every value is validated again at each read, whoever sent it (the page, an assistant, a restored backup): a colour is parsed and written back as `#rrggbb`; a number is clamped, snapped to its step and written with a unit from the closed list; a choice, a look and a picture alternative are ids looked up in your declaration; an uploaded picture is a server-made name `^[0-9a-f-]{36}\.(webp|png|svg)$`. A last filter writes a variable only if its name and its value have one of a few exact shapes. There is **no free text** anywhere.
* **`--sk-cz-*` variables paint, nothing else.** The sheet may read them only in colour, background, border and outline properties (and not through another custom property). Anywhere else (`display`, sizes, fonts, opacity, positions) the skin is refused (`var-name-not-allowed`): the sheet cannot see the owner's value, so a fallback could not be checked.
* **Legibility is never enforced.** There is no refusal at installation and no correction at rendering. The page only **signals** a risk, next to the control, when the owner's value breaks a pair you declared ("Hard to read: contrast 2.1 instead of 4.5"); nothing is shown when all is fine, nor for your own default.

## 4. Storage and versions

* One setting per skin, `skin.custom.<skinId>`: only the differences from your defaults (4 KB at most). It is **kept when the owner switches skins** and when the skin is removed.
* A stored key that no control (or former `was` id) claims, or whose value no longer fits, is **ignored** and kept in storage until the next save, so going back to a previous version of the skin finds it again.
* A picture the owner stops using (another choice, a reset) is kept for one day, then deleted; the assistant's approval summary says so. A renamed picture control keeps its picture through `was`.
* Backups carry the setting and the pictures (`uploads/`, with their owner `skin:<id>:<control>` in `upload-files.json`).

## 5. Contrast pairs and signals

`"contrast": [ { "text": "#f8efd6", "min": 4.5 }, { "text": "--v-fg", "min": 4.5 }, { "against": ["--v-bg"], "min": 3 } ]`

`text`: text of that colour sits ON this control's colour (a hex, or a common colour of the skin in the mode being checked). `against`: this colour sits on the page, as an interface element. For a picture, `textOver` is compared with the brightest (light text) or darkest (dark text) part of the uploaded picture, measured at upload.

## 6. Pictures an owner uploads

`POST /api/admin/skin-custom/upload` (not `/api/admin/upload`): Administration role, same site only, a slot the skin declares. The file is **never stored as received**: type from the bytes, 5 MB and 40 million pixels at most (checked from the header), 45 s deadline, two jobs at a time, EXIF orientation applied, cropped to the slot's shape around the chosen focal point, scaled down to the slot's largest size, **re-encoded** (WebP; EXIF, GPS, XMP and anything after the image are gone), under the slot's `maxKb`. SVG goes through the same sanitiser as logos. **Animated pictures are allowed** (GIF, animated WebP, APNG): at most 100 frames and 24 million pixels in all, never cropped (their shape must fit), and a still (first frame) is made and swapped in under `prefers-reduced-motion`. An animated PNG keeps its frames through a chunk whitelist rewrite, and its frame count, sequence numbers and sizes are counted from its own chunks, never taken from its header.

## 7. Assistants

`maintenance_skin_customize` (level 3: a request the owner approves) sets values, a look or a reset on the skin in use, with the same validation. Bundled alternatives only; **no upload** by an assistant. See [MAINTENANCE-IA.md](MAINTENANCE-IA.md).

## 8. A short worked example

```json
{
  "skinContract": 4, "minCore": "0.44.0",
  "assets": [ { "file": "images/ecu.svg", "kind": "image", "license": "CC0-1.0", "licenseFile": "LICENSES/images-CC0.txt", "author": "Example", "source": "https://example.org" } ],
  "customize": {
    "version": 1,
    "looks": [ { "id": "royal", "label": { "fr": "Bleu royal", "en": "Royal blue" }, "values": { "banner": "royal" } } ],
    "groups": [ { "id": "main", "label": { "fr": "L'essentiel", "en": "The essentials" }, "controls": [
      { "id": "banner", "type": "color", "featured": true, "label": { "fr": "Couleur de la bannière", "en": "Banner colour" },
        "palette": [ { "id": "royal", "label": { "fr": "Bleu royal", "en": "Royal blue" }, "light": "#16235a", "dark": "#16235a" },
                     { "id": "crimson", "label": { "fr": "Cramoisi", "en": "Crimson" }, "light": "#5e1414", "dark": "#4a1010" } ],
        "default": "royal", "contrast": [ { "text": "#f8efd6", "min": 4.5 } ] },
      { "id": "corner", "type": "slider", "label": { "fr": "Rayon des coins", "en": "Corner radius" }, "min": 0, "max": 1.5, "step": 0.05, "unit": "rem", "default": 0.2 }
    ] } ]
  }
}
```

```css
[data-skin-region="header"] { background-color: var(--sk-cz-banner, #16235a); }
[data-skin-region="content"] { border-radius: var(--sk-cz-corner, 0.2rem); }
```

The reference skin is `feodal` (banner colour, pennant set, banner picture and shield with upload, parchment tone, corner radius, a trim colour in an advanced group, four looks); the core keeps a copy in `tests/fixtures/skins/customizable`.
