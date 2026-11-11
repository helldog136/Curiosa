# Offering elements for overlay pages

Since 0.5.0, the **Overlays** section of the administration lets people compose **overlay pages** for OBS: pick a resolution, then place **elements** provided by modules wherever they want. An overlay page has **one address** to paste into OBS.

Your module can offer elements. This is **voluntary**: without the `overlayElements` key in `module.json`, your module offers no element and nothing changes for it. Your current overlays (`/overlays/<key>`) keep working, with the same addresses.

A complete example, ready to read and copy, lives in `examples/overlay-demo/` (four elements: clock, board, scene, live feed).

In this guide, **overlay page** means the composition and **element** means a piece provided by a module. These are the words people who run the site see.

Since 0.8.0 an overlay page can also wear an **overlay skin** and can change skin depending on a **context** (the current game, for example). Elements need no change for this: see [OVERLAY-SKINS.md](OVERLAY-SKINS.md) and section 3 below.

## In two minutes

1. In `module.json`, add `"minCore": "0.5.0"` and an `overlayElements` list.
2. In `index.mjs`, add `overlayElements`: for each element, a function that answers **the address of the element's page**.
3. Write the element's page (a route of your module, or your current overlay): it fills the window it is given and reads its style and options from the address.
4. Run `npm run module:check -- <your folder>`: the `overlay.elements` requirement checks the contract part.
5. Add the "several readers" test if your element follows an event stream (see below).

## 1. Declare the elements (`module.json`)

```json
{
  "minCore": "0.5.0",
  "overlayElements": [
    {
      "id": "countdown",
      "label": { "fr": "Compte à rebours", "en": "Countdown" },
      "description": { "fr": "Le temps qui reste avant l'événement.", "en": "The time left before the event." },
      "fit": "scale",
      "size": { "width": 600, "height": 200 },
      "followsStyle": true,
      "demo": true,
      "options": [
        { "id": "event", "type": "choice", "label": { "fr": "Événement", "en": "Event" },
          "choices": [{ "value": "main", "label": { "fr": "Événement à la une", "en": "Featured event" } }], "default": "main" },
        { "id": "size", "type": "number", "label": { "fr": "Taille du texte", "en": "Text size" },
          "help": { "fr": "En pixels, de 20 à 200.", "en": "In pixels, from 20 to 200." }, "min": 20, "max": 200, "integer": true, "example": "96", "default": 96 }
      ]
    }
  ]
}
```

The core **refuses** a manifest that does not follow these rules (clear message, module not installed) and requires `minCore` `0.5.0` or later (an older core ignores the key).

| Key | Role |
| --- | --- |
| `id` | Identifier of the element in your module: lowercase letters, digits, dashes (41 characters at most). Never changes once published. |
| `label`, `description` | What people read in "Add an element", in French **and** English. The displayed label is "Instance name · Label". In the "Add an element" list, elements are grouped under the translated name of the module (the instance name is a hint only when the module has several instances), with a live search over group, element name and description. |
| `fit` | `scale` (default), `ratio` or `fluid`. See the next paragraph. |
| `size` | `scale`: the natural size, for example `600 × 200`. |
| `referenceHeight` | `ratio`: the height of the virtual window, for example `1080`. |
| `ratios` | `ratio` (required) and `fluid` (optional): the range of width/height ratios the element accepts, for example `{ "min": 1.3, "max": 2.4 }`. |
| `minSize` | `ratio` and `fluid`: the minimum size of the frame. Smaller, the core keeps this size and then shrinks everything. |
| `followsStyle` | `true` (default): the element follows the page's common style, **and an overlay skin applies to it**. `false`: it cannot (a 3D scene, for example) and stays as it is; the editor tells the person. |
| `options` | The options adjustable per element (see below). Twenty at most. |
| `demo` | `true`: the element can show sample content when the address receives `ov-demo=1` (test mode). |

At most **20 elements** per module.

### The three behaviours

An element picks **one**. People never see these names: the editor writes "keeps its proportions", "adapts to the frame ratio" or "adapts to the chosen size".

- **`scale`: keeps its proportions.** You declare a natural size (for example 600 × 200). The core shows your page in a window of that size, then scales it like an image (ratio locked). For: alerts, sponsor banner, countdown.
- **`ratio`: adapts to the ratio.** You declare a reference height (1080). The core gives a **virtual** window of that height whose **width follows the frame's ratio** (within your range), then scales everything: same visual scale, wider scene. For: a 3D scene that must look right in 21:9 as in 16:9.
- **`fluid`: adapts to the chosen size.** Your page gets a window with the frame's **real dimensions** and reorganises like a responsive site. For: polls, planning, statistics.

In the editor, the ratio is locked at the handle for `scale` and `ratio`, free for `fluid`; the ratio range and the minimum size apply to every input. The server applies the same rules on save.

### Options

Only four types:

| Type | Fields |
| --- | --- |
| `choice` | `choices: [{ value, label }]` (2 to 30), `default` |
| `boolean` | `default` |
| `number` | `min`, `max`, `integer`, `default` |
| `text` | `maxLength` (200 at most), `default` |

Each option has a `label` (FR/EN), an optional `help` (shown in a "?" bubble) and an optional `example` (reused in the error message under the field: "Enter a number between 20 and 200. Example: 96."). The core draws the form from this declaration.

**Aim for a minimal set of options**: people set up their element in a few seconds. Five is a guide, not a limit; a complex module can have more. Only a **hard limit of 20** protects the form, and beyond 8 options the core folds the rest under "More options".

Options also **tell two elements of the same module apart**. Example: two counters on two different events (option `event`).

## 2. Serve the elements (`index.mjs`)

```js
export default {
  overlayElements: {
    // One function per declared element. It runs SERVER side, with your module's secrets.
    countdown: (ctx, request) => ({ url: `/m/${ctx.instance.key}/element/countdown` }),
  },
  routes: { "element/:slug": (req, ctx) => { /* … the element's page … */ } },
};
```

### What the core gives you (`request`)

| Field | Content |
| --- | --- |
| `element` | The identifier of the requested element. |
| `fit` | `"scale"`, `"ratio"` or `"fluid"`. |
| `width`, `height` | The size of the window the element will be shown in: the natural size (`scale`), the virtual window (`ratio`) or the real size (`fluid`). |
| `style` | The common style `{ text, surface, corners }`, or `null` if the element does not follow it. |
| `options` | The option values, **already checked** by the core against your declaration (a missing option takes its default). |
| `lang` | The requested language. |

**Your module still validates**: it stays the owner of the meaning. An unknown value (a deleted event, for example) is **ignored without breaking anything**: show an empty state, never an error. An option you do not know is ignored.

### What you answer

`{ url: "/path" }`: a **site path** starting with `/` (a route of your module `/m/<key>/…`, or `/overlays/<key>?k=…` to reuse your overlay). Never an external address, nor `//`, `..`, `#`. Or `null` if the element is not available (empty frame). A refused address gives an empty frame.

Your module's secret (for example the `?k=` of an overlay) is added **here, server side**: it never appears in the administration. The core only hands the address to the OBS page.

The core **adds to your address** (replacing anything you put) these reserved parameters:

| Parameter | Value |
| --- | --- |
| `ov-w`, `ov-h` | The size of the window (like `width`, `height`). |
| `ov-fit` | `scale`, `ratio` or `fluid`. |
| `ov-lang` | The language. |
| `ov-text`, `ov-surface`, `ov-corners` | The common style (only if `followsStyle` is true). |
| `opt-<id>` | The value of each option (`1` / `0` for a yes/no). |
| `ov-demo` | `1` in test mode, for an element that declares `demo`. |

Your page reads these parameters, **validates them** and fills the **whole** window. The position and size settings of your current overlay are **ignored** in an overlay page: the element fills the frame it is given. What the person sets in your module (content, durations, own look) stays with you.

If your module already has an overlay, the simplest is for the function to answer that overlay's address and for the page to read the `ov-*` and `opt-*` parameters.

### Sound

An element that plays a sound does it in its iframe (`allow="autoplay"`). Sound control stays OBS's ("Control audio via OBS").

## 3. Look: common style, skins and the `--ov-*` tokens

Each overlay page has a **common style** (light or dark text, transparent or semi-transparent background, rounded or square corners). The core hands it to the element as parameters; the element's page derives the **tokens** from them:

| Parameter | Token | Values |
| --- | --- | --- |
| `ov-text` = `light` / `dark` | `--ov-fg` | `#ffffff` / `#111111` |
| `ov-surface` = `transparent` / `soft` | `--ov-surface` | `transparent` / `rgba(0,0,0,.55)` (light text) or `rgba(255,255,255,.7)` (dark text) |
| `ov-corners` = `round` / `square` | `--ov-radius` | `12px` / `0px` |
| (derived from the background) | `--ov-border` | `transparent` or a discreet outline |

Write your CSS with these tokens and a **fallback** (`color: var(--ov-fg, #fff)`), and put attributes on your pieces: `data-ov-part="panel"`, `data-ov-region="element"`. **Style through tokens and attributes, not hard-coded classes.**

**Overlay skins (0.8.0).** When a page wears an overlay skin, the core injects the skin into your element's page once it has loaded (the iframe is same-origin, and a skin is only data: tokens and a sanitised sheet of rules, adopted with a constructed style sheet; nothing is executed). The skin then:

1. overrides the `--ov-*` tokens on the document root and on your `data-ov-region="element"` node, so everything that reads them follows the skin;
2. sets the **extended tokens** (accent, muted text, fonts, border width, shadow, text shadow, case, motion preset) and the core maps them onto the reserved parts, only for the tokens the skin defines;
3. restyles your pieces through `[data-ov-part="…"]` rules.

So **an element needs no change** to follow a skin, as long as it declares `followsStyle: true` and marks its pieces with `data-ov-part`. The more of the shared part names it uses (`panel`, `card`, `bubble`, `quote`, `title`, `subtitle`, `name`, `body`, `text`, `message`, `label`, `value`, `badge`, `tag`, `kind`, `status`, `avatar`, `track`, `bar-fill`, `dot`, `stars`, `winner`, `source`, `foot`, `footer`, `author`), the better skins look. Tokens are overridden on the document root and on the `data-ov-region="element"` node: declare yours there (`:root{--ov-…}` or on the region node), not on a node deeper inside, which a skin cannot reach. The full vocabulary, the rule grammar and the contrast checks are in [OVERLAY-SKINS.md](OVERLAY-SKINS.md).

The core **reserves** the names `--ov-*`, `data-ov-part`, `data-ov-region`, `data-ov-skin` and the `ov-*` parameters. Around each element, the core page emits `data-ov-region="element"` and `data-ov-part="frame"`, `test-frame`, `label`, `empty`.

**Sealing.** An element's page **never** loads the site skin, and you use neither `--sk-*` nor `data-skin-*` on it. An overlay skin never touches the public site, and a site skin never touches an overlay. The common style **does not** reuse the site skin. An element that cannot follow the style (a 3D scene) declares `followsStyle: false`: no skin is injected into it.

## 4. Test mode

The person turns on **test mode** for an overlay page: in OBS, a **coloured frame drawn by the core** appears around each element, with "module · element · size in pixels". Your content stays visible underneath; if you declare `demo: true`, it receives `ov-demo=1` and can show sample content (a clock at 12:34:56, a demo list…). The OBS page notices by itself (a light poll, every 5 seconds at first then more and more spaced, never a server-side timer). Test mode **stops by itself after 30 minutes** (checked when read).

This frame does not replace a preview mode that would be specific to your module.

## 5. Several readers of the same element

An overlay page can appear in several pages, and an element can appear twice: **several readers therefore read the same stream at the same time**, and all must show the same information at the same instant. Rule:

> **Each reader has its own marker in the event stream. Never a shared queue that the first reader would empty.**

Concretely: if your element follows events (alerts, messages), the reader keeps a **cursor** (the last event seen) and sends it back on each read; your module remembers nothing about it and does not delete an event because it was read. A new reader starts "at the end" of the stream (`now`). Always read **in bounded chunks** (50 events, for example).

`examples/overlay-demo/index.mjs` shows a complete stream (`readFeed`, `publish`). The reusable test is in the test kit:

```js
import { assertMultiReaders } from "<core folder>/testsupport/index.mjs";

test("several readers get the same events", async () => {
  await assertMultiReaders({
    publish: async (event) => { /* adds an event to your stream */ },
    open: async () => {
      let cursor = (await readFeed(ctx, "now")).cursor;           // the marker is taken RIGHT AWAY
      return { read: async () => { const r = await readFeed(ctx, cursor); cursor = r.cursor; return r.events; } };
    },
    readers: 4,
  });
});
```

The test opens several readers, publishes events, reads them out of order, at the same time and in reverse order, opens a late reader, then checks that **each reader received all events, in order, exactly once**. A shared queue is detected with a message that says what to fix.

## 6. What the core does (and does not do)

- **The core owns overlay pages** (one source of truth): name, resolution, elements with position, size, order, visible or hidden, options, common style, skin and skin rules (0.8.0), active or not, test mode. You never see the composition, only the size of your frame. Pages are part of backups.
- **An element whose module has disappeared** stays in place, empty ("This element is no longer available"); the page does not break.
- **An element that fails** (error, no answer within 8 s, refused address) gives an **empty and silent** frame live; the detail only appears in test mode and in the administration. A module error message is never logged (it could contain a secret).
- **Page security**: each element is an `iframe` with `sandbox="allow-scripts allow-same-origin"` (no form, no window, no top navigation, no download). The security header only allows as iframes the exact addresses of the page's elements; no cookie, no tracking, no third-party loading. The page address never leaves through "Referer". Your element page is served by your module: give it its own security policy (see the example). A skin is injected from the core page by script and never loads anything.
- **Hard limits**: 20 overlay pages, 10 active, 30 elements per page, 20 options per element, 20 elements per module.
- **Rights**: composing overlay pages needs the "Administration" tier or above. No new right to declare.
- **Nothing is read without a bound** and no timer runs in the background.

## 7. Adoption checklist

Tick before publishing the version of your module that offers elements:

- [ ] `module.json`: `"minCore": "0.5.0"`, one `overlayElements` entry per element, labels and descriptions in French **and** English.
- [ ] The right behaviour: `scale` (natural size), `ratio` (reference height **and** ratio range) or `fluid` (minimum size).
- [ ] A **minimal** set of options; each option has a label, a help text if useful and an **example** for numbers and texts.
- [ ] `index.mjs`: one `overlayElements.<id>` function per declared element, and the reverse. It answers a site path, or `null`.
- [ ] The element page **fills the whole window** (`ov-w` × `ov-h`), ignores the placement settings of the module's overlay, and stays readable at every allowed size.
- [ ] The received options (`opt-<id>`) are **validated**; an unknown value is ignored without error, an empty state is shown properly.
- [ ] Style: `--ov-*` tokens with a fallback, `data-ov-part` attributes using the shared part names, **no** hard-coded class for text colour or background; otherwise `followsStyle: false`.
- [ ] No `--sk-*` nor `data-skin-*` on the element page; no third-party loading; text from elsewhere **escaped**.
- [ ] Several readers: one cursor per reader, bounded reads, `assertMultiReaders` test written if the element follows a stream.
- [ ] `demo: true` if the element can show sample content, for test mode.
- [ ] Sound, if any, plays inside the element (OBS control).
- [ ] `npm run module:check -- <folder>`: the `overlay.elements` requirement passes.
- [ ] A minor version bump (`1.4.0` → `1.5.0`) and a mention in the module's README.
- [ ] You tried it in OBS: an overlay page in 3440×1440, test mode on, elements resized, page turned off, and an overlay skin worn.
