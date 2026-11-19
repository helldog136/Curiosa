# Skin for this page (core 0.45.0)

One page of the site can be drawn with an **installed site skin other than the site's own**. Typical use: a showcase site with one page per skin, each a real preview of that skin. The core is a shell: it offers one small generic capability ("a content item may ask for a skin for its own rendering"); the **module** switches it on (`content.features`), and the **skin** stays what it always was (data only).

## 1. For the owner

* In the page editor, under **Options**, the select **Skin for this page** (FR: *Skin de cette page*). Default **Same as the site**, never shown as a label on a row (R14).
* The select exists **only when more than one site skin is installed** (and the extension has the feature). With one skin there is nothing to choose, and the editor shows nothing.
* The page then wears that skin everywhere: header, menu, footer, cookie tray, colours, fonts, pictures, **and the owner's saved customization of that skin** (`skin.custom.<id>`, Appearance > Customize). Light and dark follow the visitor (the skin's two modes, the device, the light/dark switch if the skin has one).
* The editor's preview box follows the choice at once (before saving), so a **draft** can be looked at. Published pages are reached at their normal address: no token is needed.
* If the chosen skin is later removed (or damaged), the page shows the **site skin** and the select says so under the field ("“x” was removed: the site skin shows"). Nothing is lost: saving the form keeps the stored value, choosing "Same as the site" clears it.

## 2. For module authors

Add `"skin"` to `content.features` of the manifest and set `"minCore": "0.45.0"` (an older core refuses the manifest cleanly instead of ignoring the feature):

```json
"content": { "features": ["cover", "summary", "body", "skin"] }
```

The owner can also switch it on or off per extension in the extension's settings (the list of "features"). Nothing else is needed: no field, no script, no adminForm. The `pages` module (1.3.0) does exactly this.

## 3. How it works (design decisions)

1. **Behaviour.** The page is rendered by the same pipeline as the preview of a skin on the Appearance page (`resolveLook` with `pageSkinId`): `composeSkin` on the skin as shipped, **plus its own customization** (`loadResolved`), through `renderSheet` and the CSS sanitizer. It does **not** carry the retouches, options, glow or background the owner set for the *site's* skin (they belong to that skin; mixing them would make the page an unfaithful preview). No new CSS path.
2. **Scope and containment.** Every address of the public site is a full document load (plain links; no client navigation, checked by `tests/core/page-skin.test.mjs`). The layout writes `<html data-skin="<id>">` and **one** style sheet per request; the sheet of a skin is scoped to `:root[data-skin="<id>"]`. So the other skin's CSS is loaded **only** on that page, never on another, and the site's own skin is **not** loaded in addition (one skin per request: the extra cost is one skin read, bounded by the skin memo). The whole frame wears the skin (a faithful preview). The legal, consent and accessibility guarantees are those of any skin: the cookie tray, the skip link, the focus ring and the minimum targets are core parts that a skin can only restyle within the allow-list (docs/SKINS.md section 9.3), and the readability check applies to the skin as shipped.
3. **Security.** The stored value is an id, never a path or a style. It is checked at **every write** (admin form, assistant tools) against the installed **site** skins (`checkPageSkin`: overlay skins, `basic`, unknown ids and free text are refused; the value already stored is accepted back unchanged), and **again at every read** (`effectivePageSkin`: an id that is not an installed site skin, or is the site's own skin, is ignored). Nothing new is exposed to visitors: the page already shows its skin's files at their public address, as the site's skin does; there is no list, no endpoint, no parameter to enumerate skins. No new XSS surface: nothing the owner or an assistant types is written into the page except through the existing sanitized sheet. Cache: pages are `force-dynamic` and the layout reads request headers, so Next answers with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` (its documented rule for dynamic pages; checked on a running site: no CDN or shared cache keeps the page, and the address, which is the only thing that picks the skin, is the cache key anyway); the in-memory sheet cache is keyed by the skin id, its files' fingerprint, its customization and the mode of use (`render.ts`).
4. **Admin.** The field is in the entry editor's folded "Options" (R2, R4, R7), listed only with at least two site skins. The preview follows the choice live.
5. **Assistants (MCP).** `create_draft` and `update_draft` of an instance with the feature take an optional `skin` (an installed site skin id; `none` or empty = the site's skin). Same check as the admin: a plain message when only one site skin is installed, when the id is unknown, or when it is an overlay skin. `get_entry` returns `skin` and `skinInstalled`. A page edit by an assistant stays a **draft**; publishing is a separate right, and the publish request names the skin ("with the skin x") and is bound to it (a draft whose skin changed after the request is not published). No upload, no other effect. A published entry cannot be changed through these tools, so its skin cannot either.
6. **Backups and restore.** `Entry.skin` is a column: backups carry it, restores read only known columns, and a backup without it restores with the default (null). A restored value whose skin is not installed is tolerated and ignored at rendering.
7. **Performance.** One more lookup of the page by address in the layout when an extension with the feature exists and more than one skin is installed; nothing otherwise. One extra skin is loaded per request at most (the page's), and the site's own skin is not.

## 4. What it does not do

* One skin per page, chosen by hand. No rule ("all pages of this extension"), no per-visitor choice, no overlay skins, no per-page retouches.
* Lists, module pages and the home page have no such setting (they are not entries). Only entries of extensions that have the `skin` feature.
* Search engines see an ordinary page: the skin changes the look, not the text, and the address stays the same.
