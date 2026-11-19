# Animated gauges, levels and counters (animation recipes, contract 4; recipe contract 2; scenes, contract 5)

> Core 0.40.0 adds a second way to skin these bars: a **scene** (section 10) that places the skin's own pictures on the abstract bar. The recipes of sections 1 to 9 keep working exactly as they are.

> Core 0.30.0. A module says **what happens** (a value goes up, a level is reached, time is added); an overlay skin says **what it looks like** (stained glass, neon tubes, a plain bar). The core's engine draws one with the other, live, in the overlay element. Adding a skin restyles every animated element; adding an animated element works with every skin. Nothing here runs code from a skin.

This page is written for two readers: **skin authors** (sections 1 to 6: you only write a data file, `animation.json`) and **module authors** (section 7: you send a state). Section 8 is about performance and comfort, section 9 about what is checked.

## 1. The three words: genre, role, primitive

- A **genre** is the kind of thing an element shows. There are three, and the list is closed and versioned:
  - `gauge`: a value towards a target (a follower goal; with `format: "time"`, a countdown such as a **subathon** whose time grows with each sub or donation);
  - `levels`: a level number, the progress inside the current level and a countdown (a hype train);
  - `counter`: a total that goes up (donations or subs of the session).
- A **role** is a piece of a genre that a skin draws:

| Genre | Roles, in drawing order |
|---|---|
| `gauge` | `frame`, `body`, `ticks`, `value`, `label`, `timer`, `step`, `burst`, `ambient` |
| `levels` | `frame`, `body`, `value`, `label`, `timer`, `step`, `burst`, `ambient` |
| `counter` | `frame`, `value`, `label`, `step`, `burst`, `ambient` |

  `body` is the bar itself (lit up to the progress), `ticks` the milestones, `value` and `label` the texts, `timer` the countdown line, `step` the reaction to one event (or a merged burst of events), `burst` the celebration (milestone, level, goal reached), `ambient` the life at rest (a light that sweeps, a tube that flickers).
- A **primitive** is how a role is drawn: a **procedural generator** with bounded parameters and a seed. `mosaic` cuts a window into irregular panes of glass, `rose` builds a rose window, `tube` bends a neon tube, `bar` draws a plain bar… The list is closed (section 5). A skin never ships a picture, a font or a script: everything is drawn from numbers, so it is the same on every computer and never loads anything during a live.

A role the skin does not describe is drawn by the **basic rendering** of the core, which follows the page's `--ov-*` tokens: every overlay skin, even one without `animation.json`, already gives a readable gauge.

## 2. The file

Add `"animation": "animation.json"` to `skin.json`, declare `"skinContract": 4` and `"minCore": "0.30.0"` (`"0.33.0"` if you use `motion`, see section 5b and 5c):

```json
{
  "animateContract": 2,
  "motion": { "value": "gentle", "reaction": "snappy", "celebration": "bouncy" },
  "colors": { "amber": "#e2a35e", "lead": "#120c09" },
  "genres": {
    "gauge": {
      "body": { "draw": "mosaic", "shape": "arch", "cells": 34, "seed": 136, "palette": ["@amber", "#b3541f", "#8a1d24"], "lead": "@lead", "irregularity": 2 },
      "value": { "draw": "text", "font": "serif", "color": "#fff3e0", "outline": "@lead", "plate": "lead", "plateColor": "#1a0f0a" },
      "burst": [{ "draw": "flash" }, { "draw": "ring", "irregularity": 3 }, { "draw": "particles", "kind": "shards" }]
    }
  },
  "effects": { "glow": { "strength": 0.5 }, "vignette": { "strength": 0.2 }, "grain": { "amount": 0.05 } }
}
```

- `animateContract` (required): the version of this vocabulary the recipe was written for (1 or 2 today). A core that does not know it switches the skin's animation off and uses the basic rendering; the rest of the skin (tokens, sheet) keeps working. Section 5c explains how contracts are negotiated.
- `animateMinContract` (optional, contract 2): the oldest contract that can draw the recipe faithfully; defaults to `animateContract`.
- `motion` (optional, contract 2): named springs, durations and a tempo (section 5b). Without it the curves are exactly those of core 0.30 to 0.32.
- `colors` (optional, 16 at most): names you can cite as `"@name"` in any colour parameter. `"@fg"`, `"@accent"` and `"@surface"` cite the page's own tokens (so an animation can follow the skin's tokens or the site's retouches).
- `genres`: per genre, per role, one layer `{ "draw": …, …parameters }` or a list of up to **three** layers drawn in order. `{ "draw": "none" }` draws nothing on purpose (no basic rendering for that role).
- `effects` (optional): post effects of the whole element (section 5, "Effects").
- Every length is **relative** (to the body's height or to the frame), so a skin never assumes a size: the same recipe fills a 1764 × 717 frame or a 400 × 120 one.
- Colours are `#rrggbb`. Numbers outside their bounds, unknown parameters and primitives used for a role they do not serve are refused at installation, with the path where they are.

## 3. Texts are the engine's, not the skin's

The engine places the value and the label, formats them (thousands separators by language, `h:mm:ss` for time, currency) and sizes them, never under the TV minimum of the page (24 px on a 1080 canvas, times the `ov-tv` factor). A skin chooses a **style** only: font family from a closed list (`skin` = the skin's `--ov-font`, `sans`, `serif`, `rounded`, `mono`, `condensed`), weight, colour, outline, glow, an optional plate (`soft`, `lead`, `glass`) and `placement` (`auto`, `below`, `above`, `inside`, `side`).

**Readability is checked twice.** At installation, a text layer whose colours are known must have an outline of at least 4 % of the size with a contrast of 4.5:1, or an opaque plate (alpha 0.8 or more) with a contrast of 4.5:1. At drawing time, the engine applies the same rule to whatever reaches it and puts a black or white outline when it fails. A text is never scaled on one axis, skewed or rotated: a bent lead line is art, a bent digit is a bug.

## 4. How a mosaic window is expressed (worked example)

A mosaic window is **only a more complex drawing structure**, built from the same primitives as a neon tube. Here is how the sample recipe of the test fixtures (`tests/fixtures/animate/mosaic-sample.json`, a neutral recipe written for the tests) reads, piece by piece:

1. **The window is a tessellation.** `body: { "draw": "mosaic", "shape": "roundArch", "pattern": "grid", "cells": 28, "jitter": 0.5, "seed": 4107 }`. The engine scatters 28 seeded sites inside the shape (`rect`, `arch` = a pointed gothic arch, `roundArch`, `capsule`, `ellipse`), cuts the shape into Voronoi cells (each cell = the shape clipped by the bisectors of its neighbours), and **welds** the shared vertices so two neighbouring panes share exactly the same lead line. `pattern: "grid"` or `"bricks"` gives more regular panes; `jitter` sets how far the sites wander.
2. **The lead is hand-cut.** Each unique edge is drawn **once**, as a stroke of variable thickness (`leadWidth`, relative to the body's height) along a line that is **bowed and wiggled** by its own seed (`irregularity` 0 to 4: 0 = ruler-straight, 2 = hand-cut, 4 = very loose). Long lines wander less than short ones, the way a hand does. The outer border is 1.5 times thicker. A thin `leadHighlight` stroke gives the metal its edge.
3. **The glass is lit from behind.** Each pane takes a colour of `palette` by its seed, shifted by `tint` toward `light` or `shade`. A lit pane is filled with its colour, then a radial gradient from `light` at its upper centre to `shade` at its edge, some seeded `mottle` (soft blotches), `bubbles` (small defects) and, on some panes, a `streaks` reflection. An unlit pane is a dim mix of its colour and `shade` (`unlit` sets how dim).
4. **Progress lights the window pane by pane.** `order: "x"` lights from left to right (`"y"` bottom to top, `"center"` from the middle out, `"random"`). The front is slightly perturbed, so it is never a straight line. The pane being lit fades in; one more follow lights one more piece of glass.
5. **The light.** `glow` / `glowColor` give each lit pane a warm halo (a canvas blur in quality "full", a cheap gradient otherwise). `effects.bloom` adds a soft bloom of the lit glass, `effects.vignette` darkens the edges of what is drawn (never the empty background), `effects.grain` adds a still film grain, `effects.edgeFade` softens the left, right and bottom edges for a window that is not full screen. `ambient` adds slow life: a `shimmer` of light that sweeps the glass every few seconds and faint `rays` crossing it.
6. **The celebration.** `burst: [flash, ring, particles(kind: "shards")]`: a halo (never a rectangle), an irregular shock ring (level 3) and shards of coloured glass that fly out and fall.
7. **Levels become a rose window.** `levels.body: { "draw": "rose", "rings": 3, "segments": 9 }`: a centre medallion (where the level number is written) and rings of segments of unequal widths, on circles that are slightly irregular; segments light one by one with the progress of the level, and the palette shifts with each new level.
8. **The counter is a lead cartouche.** `counter.frame: { "draw": "lead", "backingAlpha": 0.88 }`: a dark glass plate in a hand-cut lead frame, the number written sharp on it, a shard burst at each increment.

Changing `seed` gives another window with the same character; changing `irregularity` changes the hand, not the structure. Same seed, same instant: same image, on every computer.

The simple reference skin `night-neon` uses the same contract with three primitives: `body: tube` (a dim tube that lights up to the progress, with a white core and a glow), `frame: trace` (circuit traces with nodes and a travelling pulse), `ambient: flicker` (a slow, smooth flicker, never above 3 Hz).

## 5. Reference: primitives and effects

`seed` parameters change the drawing, never its size. `irregularity` is the hand: 0 (exact) to 4 (very loose).

#### `outline` — roles: `frame`

| Parameter | Value |
|---|---|
| `color` | colour (default `#ffffff`) |
| `alpha` | number 0 to 1, default 0.6 |
| `width` | number 0.005 to 0.08, default 0.02 |
| `radius` | number 0 to 0.5, default 0.2 |
| `irregularity` | number 0 to 4, default 1 |
| `seed` | seed, integer 0 to 999999 (default 1) |

#### `lead` — roles: `frame`

| Parameter | Value |
|---|---|
| `color` | colour (default `#120c09`) |
| `width` | number 0.01 to 0.12, default 0.05 |
| `highlight` | colour (default `#8a7a6a`) |
| `irregularity` | number 0 to 4, default 1 |
| `seed` | seed, integer 0 to 999999 (default 1) |
| `backing` | colour (default `#1a0f0a`) |
| `backingAlpha` | number 0 to 1, default 0 |

#### `trace` — roles: `frame`

| Parameter | Value |
|---|---|
| `color` | colour (default `#00e5ff`) |
| `alpha` | number 0 to 1, default 0.45 |
| `lines` | integer 1 to 4, default 2 |
| `nodes` | integer 0 to 12, default 5 |
| `width` | number 0.004 to 0.03, default 0.01 |
| `seed` | seed, integer 0 to 999999 (default 1) |
| `pulse` | number 0 to 1, default 0.6 |

#### `bar` — roles: `body`

| Parameter | Value |
|---|---|
| `track` | colour (default `#ffffff`) |
| `trackAlpha` | number 0 to 1, default 0.18 |
| `fill` | colour (default `#e8a23b`) |
| `fillAlpha` | number 0 to 1, default 1 |
| `radius` | number 0 to 0.5, default 0.5 |
| `thickness` | number 0.15 to 1, default 0.42 |
| `gradient` | number 0 to 1, default 0.25 |
| `spring` | `inherit` (default: the recipe's `motion`, else today's curve), `snappy`, `smooth`, `gentle`, `bouncy` |

#### `tube` — roles: `body`

| Parameter | Value |
|---|---|
| `color` | colour (default `#ff2bd6`) |
| `core` | colour (default `#ffe6fb`) |
| `dim` | colour (default `#3a1036`) |
| `dimAlpha` | number 0 to 1, default 0.55 |
| `width` | number 0.03 to 0.4, default 0.14 |
| `glow` | number 0 to 1, default 0.8 |
| `thickness` | number 0.15 to 1, default 0.5 |
| `shape` | `line` · `loop` (default `line`) |
| `segments` | integer 1 to 24, default 1 |

#### `mosaic` — roles: `body`

| Parameter | Value |
|---|---|
| `shape` | `rect` · `arch` · `roundArch` · `capsule` · `ellipse` (default `arch`) |
| `pattern` | `voronoi` · `grid` · `bricks` (default `voronoi`) |
| `cells` | integer 4 to 90, default 28 |
| `jitter` | number 0 to 1, default 0.7 |
| `seed` | seed, integer 0 to 999999 (default 7) |
| `order` | `x` · `y` · `center` · `random` (default `x`) |
| `palette` | 1 to 8 colours |
| `unlit` | number 0 to 1, default 0.3 |
| `tint` | number 0 to 1, default 0.5 |
| `bubbles` | number 0 to 1, default 0.4 |
| `streaks` | number 0 to 1, default 0.5 |
| `mottle` | number 0 to 1, default 0.5 |
| `light` | colour (default `#fff6e0`) |
| `shade` | colour (default `#1a0a05`) |
| `lead` | colour (default `#120c09`) |
| `leadWidth` | number 0.004 to 0.08, default 0.028 |
| `leadHighlight` | colour (default `#7d6e60`) |
| `irregularity` | number 0 to 4, default 1 |
| `thickness` | number 0.3 to 1, default 1 |
| `glow` | number 0 to 1, default 0.5 |
| `glowColor` | colour (default `#ffb347`) |

#### `rose` — roles: `body`

| Parameter | Value |
|---|---|
| `rings` | integer 1 to 3, default 2 |
| `segments` | integer 5 to 24, default 9 |
| `seed` | seed, integer 0 to 999999 (default 3) |
| `irregularity` | number 0 to 4, default 1 |
| `palette` | 1 to 8 colours |
| `unlit` | number 0 to 1, default 0.3 |
| `light` | colour (default `#fff6e0`) |
| `shade` | colour (default `#1a0a05`) |
| `lead` | colour (default `#120c09`) |
| `leadWidth` | number 0.004 to 0.08, default 0.03 |
| `leadHighlight` | colour (default `#7d6e60`) |
| `bubbles` | number 0 to 1, default 0.3 |
| `glow` | number 0 to 1, default 0.5 |
| `glowColor` | colour (default `#ffb347`) |
| `center` | colour (default `#e6e2d3`) |

#### `cells` — roles: `body`

| Parameter | Value |
|---|---|
| `count` | integer 3 to 20, default 5 |
| `color` | colour (default `#e8a23b`) |
| `dim` | colour (default `#ffffff`) |
| `dimAlpha` | number 0 to 1, default 0.2 |
| `gap` | number 0 to 0.5, default 0.18 |
| `radius` | number 0 to 0.5, default 0.25 |
| `glow` | number 0 to 1, default 0 |

#### `notch` — roles: `ticks`

| Parameter | Value |
|---|---|
| `color` | colour (default `#ffffff`) |
| `alpha` | number 0 to 1, default 0.7 |
| `length` | number 0.1 to 1, default 0.5 |

#### `node` — roles: `ticks`

| Parameter | Value |
|---|---|
| `color` | colour (default `#ffffff`) |
| `lit` | colour (default `#ffd45e`) |
| `size` | number 0.02 to 0.3, default 0.1 |
| `irregularity` | number 0 to 4, default 1 |
| `seed` | seed, integer 0 to 999999 (default 5) |

#### `text` — roles: `value`, `label`, `timer`

| Parameter | Value |
|---|---|
| `font` | `skin` · `sans` · `serif` · `rounded` · `mono` · `condensed` (default `skin`) |
| `weight` | integer 400 to 900, default 800 |
| `color` | colour (default `#ffffff`) |
| `outline` | colour (default `#000000`) |
| `outlineWidth` | number 0 to 0.2, default 0.08 |
| `glow` | number 0 to 1, default 0 |
| `glowColor` | colour (default `#ffffff`) |
| `plate` | `none` · `soft` · `lead` · `glass` (default `none`) |
| `plateColor` | colour (default `#14171c`) |
| `plateAlpha` | number 0 to 1, default 0.85 |
| `plateEdge` | colour (default `#120c09`) |
| `placement` | `auto` · `below` · `above` · `inside` · `side` (default `auto`) |
| `size` | number 0.6 to 1.6, default 1 |
| `seed` | seed, integer 0 to 999999 (default 9) |

#### `gaugeline` — roles: `timer`

| Parameter | Value |
|---|---|
| `color` | colour (default `#ffffff`) |
| `alpha` | number 0 to 1, default 0.8 |
| `track` | colour (default `#ffffff`) |
| `trackAlpha` | number 0 to 1, default 0.2 |
| `thickness` | number 0.01 to 0.2, default 0.05 |

#### `flash` — roles: `step`, `burst`

| Parameter | Value |
|---|---|
| `color` | colour (default `#fff3c4`) |
| `strength` | number 0 to 1, default 0.6 |
| `size` | number 0.2 to 3, default 1 |
| `spring` | `inherit` (default: the recipe's `motion`, else today's curve), `snappy`, `smooth`, `gentle`, `bouncy` |
| `duration` | `inherit` (default), `fast`, `standard`, `considered` |

#### `ring` — roles: `step`, `burst`

| Parameter | Value |
|---|---|
| `color` | colour (default `#ffd45e`) |
| `width` | number 0.005 to 0.1, default 0.03 |
| `irregularity` | number 0 to 4, default 1 |
| `size` | number 0.3 to 4, default 1.6 |
| `seed` | seed, integer 0 to 999999 (default 11) |
| `spring` | `inherit` (default: the recipe's `motion`, else today's curve), `snappy`, `smooth`, `gentle`, `bouncy` |

#### `particles` — roles: `step`, `burst`, `ambient`

| Parameter | Value |
|---|---|
| `kind` | `sparks` · `embers` · `shards` · `dust` (default `sparks`) |
| `colors` | 1 to 6 colours |
| `count` | integer 0 to 80, default 24 |
| `spread` | number 0.1 to 3, default 1 |
| `gravity` | number -1 to 1, default 0.3 |
| `size` | number 0.005 to 0.08, default 0.02 |
| `seed` | seed, integer 0 to 999999 (default 13) |
| `spring` | `inherit` (default: the recipe's `motion`, else today's curve), `snappy`, `smooth`, `gentle`, `bouncy` |

#### `rays` — roles: `burst`, `ambient`

| Parameter | Value |
|---|---|
| `color` | colour (default `#fff1c4`) |
| `count` | integer 2 to 12, default 5 |
| `strength` | number 0 to 1, default 0.25 |
| `angle` | number -80 to 80, default 25 |
| `seed` | seed, integer 0 to 999999 (default 17) |
| `duration` | `inherit` (default), `fast`, `standard`, `considered` |

#### `pulse` — roles: `step`, `burst`

| Parameter | Value |
|---|---|
| `strength` | number 0 to 1, default 0.5 |
| `spring` | `inherit` (default: the recipe's `motion`, else today's curve), `snappy`, `smooth`, `gentle`, `bouncy` |
| `duration` | `inherit` (default), `fast`, `standard`, `considered` |

#### `shimmer` — roles: `ambient`

| Parameter | Value |
|---|---|
| `color` | colour (default `#ffffff`) |
| `strength` | number 0 to 1, default 0.12 |
| `period` | number 3 to 30, default 7 |

#### `flicker` — roles: `ambient`

| Parameter | Value |
|---|---|
| `strength` | number 0 to 1, default 0.15 |
| `rate` | number 0.2 to 2.5, default 1 |

#### `breathe` — roles: `ambient`

| Parameter | Value |
|---|---|
| `strength` | number 0 to 1, default 0.2 |
| `period` | number 2 to 20, default 5 |

### Effects

- `glow`: `strength` number 0 to 1, default 0.5
- `bloom`: `strength` number 0 to 1, default 0.3
- `vignette`: `strength` number 0 to 1, default 0.25; `color` colour (default `#000000`)
- `grain`: `amount` number 0 to 1, default 0.06; `rate` number 0 to 12, default 0
- `edgeFade`: `left` number 0 to 0.2, default 0; `right` number 0 to 0.2, default 0; `bottom` number 0 to 0.3, default 0

Quality levels (an element option, section 8): `full` keeps everything; `light` drops canvas blurs (glows become gradients), bloom, grain and rays, and halves particles; `minimal` draws flat: no details, no particles, no ambient life, no effects.

## 5b. Motion: named springs, durations and tempo (contract 2, core 0.33.0)

A skin never writes a raw time or constant for motion, only **names** from a closed table. Retuning the table in a later core changes every skin together, like the `--ov-*` tokens. A recipe **without `motion`** (and without a per-layer `spring` or `duration`) keeps **exactly** the curves of core 0.30 to 0.32: a test compares 810 frames before and after.

| Spring | Frequency | Damping | Overshoot | Settles within 2 % | Meant for |
|---|---|---|---|---|---|
| `snappy` | 4 Hz | 0.70 | about 4.6 % | about 0.23 s | steps, nudges, the head of a bar, pulses |
| `smooth` | 2 Hz | 1.00 (critical) | none | about 0.46 s | bar fill, a quick value glide |
| `gentle` | 1 Hz | 1.00 (critical) | none | about 0.93 s | the default value glide (close to today's 0.9 s ease), calm movements |
| `bouncy` | 2.6 Hz | 0.45 | about 20 % | about 0.55 s | celebrations, ring and shard launch, playful skins |

| Duration | Value | Meant for |
|---|---|---|
| `fast` | 150 ms | the attack of a reaction (a flash coming on) |
| `standard` | 300 ms | fades, colour changes, calm replacements for movement |
| `considered` | 600 ms | slow fades and crossfades |

| Tempo | Factor | Effect |
|---|---|---|
| `brisk` | 0.8 | step 720 ms, celebration 2 080 ms, glide 720 ms |
| `steady` | 1 | today's step 900 ms, celebration 2 600 ms, glide 900 ms |
| `stately` | 1.35 | slower and weightier (epic skins) |

The values are this project's own, chosen by physics. A spring is used through its analytic **step response** (a pure function of time, no integrator), so a displayed value stays a function of the instant: two overlay pages show the same frame and a reload mid-glide shows the exact current frame. Springs are linear: when a second highlight arrives mid-glide the amounts add up and the velocity stays continuous.

**The `motion` key.** Roles: `value` (the glide of the displayed value), `body` (the head of a bar), `reaction` (steps), `celebration` (milestones and goals), all springs; `fade` (a duration: the attack of flashes, rays and pulses), `tempo`. A role you leave out takes `value: gentle`, `body: smooth`, `reaction: snappy`, `celebration: bouncy`, `fade: fast`, `tempo: steady`. Shorthand: `"motion": "snappy"` sets `value`, `body` and `reaction` at once.

```json
{ "animateContract": 2, "motion": { "value": "gentle", "body": "smooth", "reaction": "snappy", "celebration": "bouncy", "fade": "standard", "tempo": "steady" }, "genres": { "gauge": {
  "burst": [{ "draw": "flash", "duration": "fast" }, { "draw": "ring", "spring": "bouncy" }, { "draw": "particles", "spring": "bouncy" }] } } }
```

**Per layer.** `spring` (on `bar`, `flash`, `ring`, `particles`, `pulse`) and `duration` (on `flash`, `rays`, `pulse`) override the role for that layer only. `inherit` (the default) follows the recipe's `motion`, or today's curve when there is none.

**What may overshoot.** Never a number: the displayed value and the progress used for texts are held between the old and the new value, whatever the spring. Only decoration moves past its target: the head of a bar (at most 5 % of the body, always inside its track), the size of a ring or a flash, the launch of pieces.

**Calm mode** (`animCalm`, or `prefers-reduced-motion`): every spring becomes critically damped (same frequency, no overshoot), `fast` becomes `standard`, `tempo` is forced to `steady`, and movements stay removed as before (rings, flying pieces, sweeps), replaced by fades.

**The same words in CSS.** The core defines `--ov-dur-fast`, `--ov-dur-standard`, `--ov-dur-considered` (150, 300, 600 ms) and `--ov-ease-snappy`, `--ov-ease-smooth`, `--ov-ease-gentle`, `--ov-ease-bouncy` (cubic-bezier fits of the springs; `bouncy` overshoots about 22 %). An overlay skin sheet may read them in `animation-duration` and `animation-timing-function` (and nowhere else, never define them): the core then adds them to the skin's sheet (pages and skins that do not read them are byte-identical to before). A module's own element copies them with `ctx.overlay.animateMotionCss()`; the table itself is `ctx.overlay.animateMotion`.

## 5c. Contract 2 and the tolerant reader

`animateContract` goes from 1 to 2 **additively**: contract 2 adds `motion`, `animateMinContract` and the per-layer `spring` / `duration`; everything of contract 1 keeps its meaning. `skinContract` stays 4.

- A **contract-1** recipe keeps its strict reading (unknown role, primitive, parameter or effect is an error). It does not know `motion` (a warning) nor `spring` / `duration` (unknown parameters).
- A recipe of **contract 2 or later** is read **tolerantly**: an unknown genre, role, primitive, parameter, effect or `motion` key is a **warning** and is skipped (the role then falls back to the basic rendering). Known words stay strict: a number out of its bounds, a bad colour, an unreadable text or an unknown spring name is still an error (an unknown name is a warning only when the recipe is written for a later contract).
- **Negotiation.** `animateContract` is the contract the recipe was written for; `animateMinContract` (default: the same) the oldest one that can draw it faithfully. This core reads a recipe when its minimum is at most 2; if the recipe was written for a later contract it is read tolerantly (warning `animation-contract-ahead`, out-of-bounds values clamped); if the minimum is above 2 the animation is off and the skin installs with the basic rendering (`animation-contract-newer`). A skin written for contract 2 installs on core 0.30 to 0.32 with its animation off, and on 0.33 and later with everything it uses.
- Checks have codes (EN and FR texts): `animation-motion-name` (a name that does not exist, with its path), `animation-motion-shape`, `animation-contract-ahead`, `animation-ignored` (skipped part).

## 6. Checking your skin

- `npm run skin:check -- <folder>` (core repository) runs the same checks as the installation, `animation.json` included: grammar, bounds, colours, readability of texts.
- Look at your recipe on every genre at key instants: `node --import ./tests/helpers/register.mjs scripts/visual/animate-bench.mjs shots <dir> <your animation.json>` writes still frames (at rest, during a burst, after; full and minimal quality) over a busy "stream" background.
- `ctx.overlay.animateKitPage({ state, recipe, width, height, at })` (or `CuriosaAnimate.frame(...)` in a page) gives the same pictures for any state.
- Keep `previews/*.webp` of the animated elements in your skin: the gallery shows them.

## 7. For module authors: the principle

A module never draws. It builds a **state** for each animated element and lets the core's engine draw it in the page's skin.

```js
// in the element's page (the module's own route), after the core's engine:
// <script>${ctx.overlay.animateScript()}</script>
const o = CuriosaAnimate.optionsFromQuery(location.search);          // opt-animQuality, opt-animCalm, ov-lang, ov-tv
const h = CuriosaAnimate.mount(document.getElementById("stage"), { ...o, state: { genre: "gauge" } });
h.setClock(serverNow);                                                // the server's clock: every overlay page draws the same instant
h.setState({ genre: "gauge", value: 63, target: 100, label: "Follower goal", milestones: [50, 75],
  highlights: [{ id: "evt-123", at: 1763400000000, kind: "step", amount: 1 }] });
```

**The state** (checked by `ctx.overlay.checkAnimateState(state)`, the same rules the engine applies):

| Key | Meaning |
|---|---|
| `genre` | `gauge`, `levels` or `counter` |
| `format` | `count` (default), `time` (seconds: the value is the time left), `money` (with `currency`, 4 characters), `percent` |
| `value`, `target`, `min` | the value and the span; progress = (value − min) / (target − min), clamped; above the target is **overflow** (phase `overflow`, no extra celebration) |
| `level` | `levels` only: the level number (`value`/`target` = the progress inside it) |
| `milestones` | up to 12 values drawn as ticks |
| `timer` | `{ endsAt, total?, pausedAt? }` in server milliseconds: a countdown (hype train, subathon). Paused, it holds. |
| `rebase` | `{ from, at }`: the value was recalibrated (a fresh reading): it glides from `from` to `value` without any highlight; it may go down, which is never celebrated |
| `highlights` | `[{ id, at, kind, amount?, intensity? }]`, the 40 most recent; `kind`: `step`, `extend` (time added), `milestone`, `complete`, `drop` |
| `label` | your words (60 characters), written as given |
| `ended` | the event is over (phase `ended`) |

**What the engine guarantees** (so your module stays simple):

- **Pure in time**: the picture is a function of the state and the instant. Two overlay pages open at once show the same thing; a page reloaded during a live shows the current state at once, and highlights older than their duration are already over: **nothing is replayed**. Give each highlight a **stable `id`** (the event's own id).
- **Bursts merge**: highlights closer than 1.5 s become one (amounts add up, the strongest kind wins, the intensity grows and is capped). Five follows in two seconds = one reaction "+5".
- **One celebration at a time**: celebrations wait in line; one that would wait longer than three celebrations is skipped (the value is kept, only the show is dropped).
- **The "+N" stays in the frame**: the amount written by the value rises (gauge, levels) or falls (counter) from the value, but its box is clamped inside the frame at any size or aspect ratio. The counter lays out its label, total and "+N" in three lanes of the frame.
- **Every phase ends**: `rest`, `filling`, `draining`, `milestone`, `complete`, `overflow`, `ended`; steps last 0.9 s (plus the length of their burst), celebrations 2.6 s, value changes glide in 0.9 s (recalibrations in 1.8 s).
- **The subathon gauge**: `format: "time"`, `timer.endsAt` = when it ends, `target` = the longest span shown (for example the cap). Each sub or donation moves `endsAt` by the time it buys (your rules, your settings) and sends `{ kind: "extend", amount: seconds }`: the bar grows smoothly and "+5:00" is written by the value.

**Options**: copy `ctx.overlay.animateOptions()` into your element's `options` in `module.json` (ids `animQuality`, `animCalm`): the same two settings, with the same words, on every animated element. The engine reads them from the element's address (`opt-animQuality`, `opt-animCalm`).

**The skin reaches your element by itself**: when the overlay page wears a skin with `animation.json` (or a context rule switches to one, or the element wears its own skin), the core page hands the recipe to every element that follows the style (`followsStyle`, the default). You do nothing: changing the page's skin changes the look of your element with no other setting.

The example module `examples/overlay-demo` has an `animated` element: a gauge, a countdown gauge, levels or a counter, moved by the module's feed live, and a scripted scenario in test mode (a burst of five steps, a milestone, the goal reached, time added).

## 8. Performance and comfort

- **30 frames a second at most, none at rest.** The loop draws only while something moves (a highlight, a value gliding, a countdown, ambient life). A bar at rest costs nothing.
- **Layers are cached.** The unlit window, the lit panes and the lead are kept as bitmaps; one more follow paints one more pane on the cached layer. Bloom, vignette and grain are flattened once into one bitmap; a frame during a burst repaints only the moving pieces.
- **Quality**: `auto` (default of `animateOptions()`) starts at `full` and steps down once to `light`, then to `minimal`, if frames cost more than 14 ms on average on that computer. `full`, `light`, `minimal` force a level.
- **Calm motion**: the element option `animCalm`, or `prefers-reduced-motion` on the computer that runs OBS, removes rings, flying pieces, sweeps, flickers and rays; flashes become soft fades, the amount written stays. Nothing blinks above 3 Hz in any mode.
- **Measured** in headless Chromium (software rendering, no GPU) on a 4-core 2.1 GHz Xeon: see the table below (`scripts/visual/animate-bench.mjs bench`, a busy scene: a highlight every 0.4 s). OBS is not measured here: check the Stats dock of OBS (render lag, skipped frames) on the streaming computer.

| Skin | Element size | Quality | Frames/s | Frame cost avg / p95 (ms) | Same, CPU slowed 4× (fps, avg / p95 ms) |
|---|---|---|---|---|---|
| basic | 1764 × 717 | full | 30.7 | 0.73 / 0.8 | 29 fps, 3.22 / 4.6 |
| basic | 1764 × 717 | light | 30.5 | 0.72 / 0.8 | 30.2 fps, 2.68 / 3.8 |
| basic | 1764 × 717 | minimal | 30.5 | 0.7 / 0.9 | 30 fps, 2.63 / 3.2 |
| basic | 3440 × 1440 | full | 30.2 | 0.99 / 0.8 | 10.8 fps, 8.59 / 5.2 |
| basic | 3440 × 1440 | light | 30.2 | 0.97 / 0.8 | 11 fps, 7.56 / 5.1 |
| basic | 3440 × 1440 | minimal | 30 | 0.91 / 0.7 | 11.3 fps, 7.21 / 4 |
| mosaic-sample | 1764 × 717 | full | 30.5 | 1.98 / 2 | 18.8 fps, 13.09 / 90.7 |
| mosaic-sample | 1764 × 717 | light | 30.5 | 1.69 / 2.3 | 21.7 fps, 9.02 / 15.8 |
| mosaic-sample | 1764 × 717 | minimal | 30.5 | 1.32 / 1.9 | 28.2 fps, 5.96 / 9.2 |
| mosaic-sample | 3440 × 1440 | full | 26.3 | 5.57 / 5.3 | 5.2 fps, 151.8 / 420.7 |
| mosaic-sample | 3440 × 1440 | light | 26.7 | 3.61 / 3.8 | 6.8 fps, 51.35 / 171.5 |
| mosaic-sample | 3440 × 1440 | minimal | 28.8 | 2.32 / 2.1 | 8.8 fps, 26.33 / 80.9 |

The `mosaic-sample` rows were measured with the earlier mosaic recipe of the same family (same primitives, a few more panes); the 0.42.0 sample recipe is neutral and was only spot-checked, with the same order of cost.
| night-neon | 1764 × 717 | full | 30.3 | 1.28 / 2.7 | 29 fps, 4.12 / 11.5 |
| night-neon | 1764 × 717 | light | 30.5 | 0.91 / 2.6 | 29.8 fps, 3.55 / 4.9 |
| night-neon | 1764 × 717 | minimal | 30.2 | 0.71 / 0.7 | 28.8 fps, 3.24 / 7 |
| night-neon | 3440 × 1440 | full | 29 | 1.03 / 0.9 | 9 fps, 15.36 / 21 |
| night-neon | 3440 × 1440 | light | 30 | 2.31 / 7.4 | 12.7 fps, 14.89 / 38.4 |
| night-neon | 3440 × 1440 | minimal | 30.3 | 1.06 / 0.8 | 14.2 fps, 6.93 / 6.6 |

- **Motion costs nothing measurable** (core 0.33.0): building the draw list of a busy gauge takes about 0.06 to 0.10 ms with or without `motion` (a few `exp`, `cos` and `sin` per pending highlight, 40 at most). The browser bench with and without `motion` on both reference skins stays inside the table's noise (1764 × 717, full: neon 1.2 to 2.0 ms, stained glass 3.1 to 3.6 ms on a shared machine).

Reading: at the real size of the brief (an element of 1764 × 717 on a 3440 × 1440 page), every skin holds 30 frames a second with about 1 to 2 ms per frame; a whole 3440 × 1440 element of stained glass costs more (choose "light" there, or let "auto" do it). With the CPU slowed four times (a stand-in for a computer busy with a game; another job shared the machine during that run, so those numbers are pessimistic), the stained glass needs "light" or "minimal" to keep 25-30 frames a second, which "auto" picks by itself. These figures come from software rendering in headless Chromium; OBS with a GPU usually does better, but it was **not** measured here.

## 9. What is checked, and security

- `animation.json` is **data**: a closed grammar, bounded numbers, colours as `#rrggbb`. No code, no address, no file is ever read from it; it cannot add a text, hide a number or change what is counted. Third parties may publish animated skins with the same status as today's overlay skins.
- Installation refuses a recipe out of grammar (`animation-invalid`, with its path), an unreadable one, an unreadable text (`animation-text-contrast`), a missing file, a skin that uses `animation` without contract 4 (`overlay-contract-v4`) or a site skin with an animation (`animation-overlay-only`). A recipe whose minimum contract is newer only warns (`animation-contract-newer`) and installs the skin without its animation; a motion name that does not exist is refused (`animation-motion-name`).
- The engine clamps and defaults every value again with the same table (`src/core/animate/spec.ts`, sent with the engine), so a recipe that slipped through can never draw outside its bounds.
- The engine reads nothing from the network, the page or the storage; it only draws on its canvas.

## 10. Scenes: the skin's own pictures on the abstract bar (animateContract 3, skinContract 5, core 0.40.0)

A recipe picks procedural primitives that live **in the core**. A scene goes the other way: the core only computes the abstract bar and offers a few generic mechanisms, and the **skin ships the pictures** and says where they go and when they move. What a lantern, a petal or a vine looks like is in the skin's files, never in the core. A skin without a scene is drawn as before; an element a scene does not draw is drawn by the basic look.

What the core gives a scene (all computed by `view()` from the module's unchanged state, so **no module change is needed**: `stream-goals` was checked, it sends the same state and milestone events):

| | Words |
|---|---|
| **Anchors** (where a picture goes) | `track` (the bar body), `fill` (the filled part), `head` (the end of the fill), `tick` (one place per milestone) |
| **Events** (what the core detected) | `step` (a step, an extension or a drop), `milestone`, `complete` |
| **Mechanisms** | a picture at an anchor; a **wipe** reveal (the picture is shown up to the progress); **sprites along the fill**; a **sprite sheet** (`grid`) with a looping `frame`; a **timeline** on `x y scale rot alpha frame` (keyframes with an ease, or a spring); a seeded **emitter** (at most 40 sprites) |
| **Never the skin's** | the clock and the event windows (a timeline runs over the window the core gives it: 0.9 s for a step, 2.6 s for a celebration, merged and queued by the core), the texts, the effects levels, calm mode |

### A minimal scene

`skin.json`: `"skinContract": 5`, `"minCore": "0.40.0"`, `"scene": "scene.json"`, and every picture listed in `assets` with `"kind": "image"` and its licence (as for a site skin). `scene.json`:

```json
{
  "animateContract": 3,
  "assets": {
    "rail": { "file": "images/rail.png" },
    "bar":  { "file": "images/bar.png" },
    "head": { "file": "images/head.png" },
    "spark": { "file": "images/sparks.png", "grid": [4, 2] }
  },
  "kits": {
    "gauge": {
      "thickness": 0.5,
      "layers": [
        { "role": "track", "src": "rail", "at": "track" },
        { "role": "fill", "src": "bar", "at": "track", "reveal": { "mode": "wipe" } },
        { "role": "head", "src": "head", "at": "head", "size": { "h": 1.6 }, "on": { "step": "pop" } }
      ],
      "on": { "milestone": [{ "emit": "burst", "at": "head" }] }
    }
  },
  "timelines": { "pop": { "spring": "bouncy", "tracks": { "scale": [[0, 1], [0.35, 1.3], [1, 1]] } } },
  "emitters": { "burst": { "src": "spark", "count": 20, "angle": [200, 340], "gravity": 0.6, "size": 0.4 } }
}
```

Lengths are in **track heights** (`size.h: 1.6` is 1.6 times the height of the bar). A complete, drawn example is the test skin `tests/fixtures/scene-skins/lantern-vine/` (a vine that grows, a lantern at its head, lamps at the milestones, petals).

### Reference

- **Layer** (`kits.gauge.layers[]`, at most 16, drawn in the order written): `src` (a picture of `assets`), `at` (an anchor), `role` (`track`, `fill`, `head` or `deco`, default `deco`: see "Fallbacks"), `fit` (`stretch`, `tile`, `contain`; default `stretch` on `track` and `fill`, `contain` on `head` and `tick`), `size` (`h`, `w`: for `head`, `tick` and `along`), `offset` and `pivot` (two numbers), `rot` (degrees), `alpha`, `alphaUnlit` (a `tick` not reached yet), `blend` (`normal`, `add`), `tier` (the lowest effects level that draws it: `minimal` by default, `light`, `full`), `reveal` (`{ "mode": "wipe" }`, on `track` only), `along` (`{ "every": 2.4 }`, on `fill` only: a row of sprites that grows with the fill), `loop` (`{ "fps": 4 }`, 1 to 8: plays the frames of a sheet), `calmFrame` (the frame a loop rests on), `on` (`{ "step": "<timeline>", "milestone": …, "complete": … }`).
- **Pictures** (`assets`, at most 12): `file` (in `images/`), `grid` (`[columns, rows]` of a sheet, at most 64 frames). The head never leaves the element: at 100 % it stays inside.
- **Timeline** (`timelines`, at most 12): `tracks` of 2 to 12 keys `[u, value]` (`u` from 0 to 1 over the event's window, rising) for `x`, `y` (track heights), `scale` (a factor), `rot` (degrees), `alpha` (0 to 1), `frame`; `ease` (`linear`, `out`, `inOut`) or `spring` (a name of the motion table: `snappy`, `smooth`, `gentle`, `bouncy`; the step response runs over each segment). Several events add their `x`, `y`, `rot` and `scale - 1`; `alpha` takes the largest. An event's intensity scales it.
- **Emitter** (`emitters`, at most 4): `src`, `count` (1 to 40), `delay` (fraction of the window), `life`, `speed` and `angle` (`[min, max]`; 0 degrees to the right, 270 up), `gravity`, `spin` (turns), `size`, `scale` and `alpha` (keys over the life of a piece), `blend`, `frame` (`random` or a number), `seed`. Everything is **analytic and seeded**: the same event shows the same pieces at the same instant on every computer (no random number, no state carried from frame to frame). At most 120 pieces live and 200 sprites are drawn per frame.
- **Texts**: `kits.gauge.text.value` and `.label` take the words of the `text` primitive (`font`, `weight`, `color`, `outline`, `outlineWidth`, `plate`…). The **core draws them last**, never under a picture, with its readability rule (a contrasted outline or an opaque plate): the installer refuses a style that cannot be read (`scene-text-contrast`) and the engine raises the outline of one that slipped through.
- **Events fire emitters** in `kits.gauge.on` (`{ "emit": "<emitter>", "at": "head" | "center" }`).

### Pictures: formats and limits

PNG, WebP (lossless or lossy) and **sanitised SVG** only. Not allowed: GIF, APNG, animated WebP, AVIF, JPEG, video, fonts. Animation is a **sheet of still frames** with a declared `grid`. The existing ceilings of site skins apply and are not raised: 200 KB a raster picture, 30 KB an SVG, 12 pictures, 1.2 MB of pictures, 2 MB the skin; the scene file at most 48 KB. The **decoded** size is what costs memory, so it is read from the file's header at install (never by decoding): at most 2048 px a side and 4 million pixels a picture, 16 million in all. A vector picture is drawn once by the core as a PNG at twice its natural size (`GET /skins/<id>/<version>/images/<name>.svg?raster=1`, 2048 px at most); it needs a `viewBox`. Pictures are served by the existing skin route (same address as site skins, immutable cache, `nosniff`) and covered by the skin's fingerprint like every other file.

### Loading, fallbacks, and what a failure looks like

- The engine loads the pictures with `fetch` then `createImageBitmap`, **not** with an `<img>`: an element page may forbid images in its security policy (`stream-goals` does: `default-src 'none'; connect-src 'self'`) and a bitmap decoded from a fetched blob is not an image load. Five seconds, 400 KB and the decoded caps are enforced again in the browser. Without `fetch` or `createImageBitmap`, every picture fails.
- A layer whose picture is loading, failed, missing or unknown is **skipped**. A role (`track`, `fill`) with no layer left is drawn by the **basic look** of the core in its place (a flat track, a flat fill from the page's colours); the texts and the countdown line are always there. A kit the scene does not draw (`levels` and `counter` in this contract) uses the basic recipe. A failure is remembered for the session; nothing blanks and nothing shows an error.
- **Tolerant reader**: an anchor, a reveal mode, an event, a property, a kit or a key this core does not know is skipped with a warning (`scene-ignored`), never an error. A known word with a value out of its bounds, an undeclared picture or a timeline that does not exist is refused with its path (`scene-invalid`). A scene written for a later contract (`animateContract` above 3, `animateMinContract` not above 3) is read as far as this core knows it and only warns (`scene-contract-ahead`); a minimum above 3 installs the skin without its scene (`scene-contract-newer`).
- A skin with `scene` must declare `skinContract: 5` (`overlay-contract-v5`); an older core refuses it cleanly ("contract newer"). The images gate (`overlay-no-assets`) stays for every skin without a scene, and fonts stay refused. If a skin has both `animation` and `scene`, this core uses the scene.

### Calm mode, effects levels, cost

- **Calm** (reduced motion, or the element option) is a **mechanical transform** that does not depend on the skin being careful: no emitters, timelines keep only `alpha` and `frame`, loops rest on `calmFrame`, springs are critical; the reveal and the value glide stay.
- **Levels**: `full` draws everything; `light` drops layers marked `full`, halves emitters, refuses additive blending and plays loops at 4 frames a second at most; `minimal` draws the layers that need no level only (no loop, no timeline motion, no emitter). `auto` and its measured step-down are unchanged.
- At rest nothing is drawn (0 %); a looping layer keeps the element drawing. Measured by `scripts/visual/scene-bench.mjs bench` on the test skin (software rendering, 30 fps, a busy scene with a highlight every 400 ms): about **0.9 ms a frame** at 1280 x 360 and 1764 x 717 (full), 0.6 to 0.8 ms in light and minimal.
- **Not built, on purpose**: no flash governor, no luminance audit of pictures, no pause when the page is hidden (OBS's `visibilityState` could not be checked, and a source stuck on "hidden" would blank the overlay).

### Checking your scene

`npm run skin:check -- <folder>` runs the same checks as the install. `node --import ./tests/helpers/register.mjs scripts/visual/scene-bench.mjs shots <dir> <folder>` draws the bar of your skin at key instants (light and dark backgrounds, every effects level, calm) through a local server that reproduces the strict policy of a module element page, so a picture that cannot arrive that way shows up at once.

### Captures of the test skin

`docs/captures/scene-lantern-vine-*.png` (1280 px wide, rest, steps, milestone, goal reached; dark and light backgrounds; effects levels `light` and `minimal`; calm) and `docs/captures/scene-lantern-vine-full.webm` / `-calm.webm` (6 s at 15 frames a second), produced by `scene-bench.mjs shots` and `clip`.

### Open points

- **OBS**: `createImageBitmap` and `fetch` exist in the Chromium used for the tests (153); the CEF of the OBS you run is **not verified**. If either is missing, the skin shows its basic look.
- **One catalogue entry per skin id**: the catalogue picks no version by core version (`requires.core` and `skinContract` mark the entry incompatible on an older core, `minCore` refuses the install). A skin that must keep working on older cores needs another id, or a `ref` the owner chooses.
