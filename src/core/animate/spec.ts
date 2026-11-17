/**
 * THE ANIMATION CONTRACT (core 0.30.0): the closed, versioned vocabulary shared by the engine (engine.ts, sent to OBS), the recipe checker (recipe.ts, run when a
 * skin is installed) and the state checker (state.ts, used by modules). ONE source of truth: `animateScript()` puts this very object, as JSON, next to the engine,
 * so the browser clamps and defaults every value with the same table the installer checked it with.
 *
 * Three words:
 *  - a GENRE is what a principle shows (`gauge`: a value towards a target, `levels`: levels with a progress inside the current one and a countdown, `counter`:
 *    a total that goes up). A module (the principle) only says which genre it uses and sends a STATE (state.ts): values, a phase, highlights. Never a shape.
 *  - a ROLE is a piece a skin draws for a genre (`frame`, `body`, `ticks`, `value`, `label`, `timer`, `step`, `burst`, `ambient`).
 *  - a PRIMITIVE is how a role is drawn: a closed list of procedural generators with bounded parameters (`mosaic` = a stained-glass window tessellated by
 *    seeded Voronoi cells, `rose` = radial segments, `tube` = a neon tube…). A skin (animation.json) only picks primitives and parameters: data, no code.
 *
 * A role a skin does not describe is drawn by the BASIC recipe of the engine (from the --ov-* tokens of the page). A contract this core does not know
 * (`animateContract` > ANIMATE_CONTRACT) disables the skin's animation: the basic recipe applies, nothing breaks.
 *
 * Parameter kinds: ["num", min, max, default] · ["int", min, max, default] · ["enum", [values], default] · ["bool", default] · ["color", default]
 * · ["colors", minCount, maxCount, default[]] · ["seed", default]. Colours are `#rrggbb` only. Every length is RELATIVE (to the body's height or the frame),
 * so a skin never assumes a size.
 */

/** Version of the recipe contract (animation.json `animateContract`) this core understands. */
export const ANIMATE_CONTRACT = 1;
/** Version of the engine text (bumped when its behaviour changes in a way a module could notice). */
export const ANIMATE_VERSION = 1;

export type ParamSpec =
  | readonly ["num", number, number, number]
  | readonly ["int", number, number, number]
  | readonly ["enum", readonly string[], string]
  | readonly ["bool", boolean]
  | readonly ["color", string]
  | readonly ["colors", number, number, readonly string[]]
  | readonly ["seed", number];

const IRREG = ["num", 0, 4, 1] as const;
const ALPHA = (d: number) => ["num", 0, 1, d] as const;

/** The genres and the roles a skin may draw for each one (in drawing order). */
export const GENRES = {
  gauge: ["frame", "body", "ticks", "value", "label", "timer", "step", "burst", "ambient"],
  levels: ["frame", "body", "value", "label", "timer", "step", "burst", "ambient"],
  counter: ["frame", "value", "label", "step", "burst", "ambient"],
} as const;
export type Genre = keyof typeof GENRES;
export type Role = (typeof GENRES)[Genre][number];

/** What each primitive draws, the roles it may serve, and its parameters. */
export const PRIMITIVES: Record<string, { roles: readonly string[]; params: Record<string, ParamSpec> }> = {
  none: { roles: ["frame", "ticks", "timer", "step", "burst", "ambient"], params: {} },
  // ---- frames
  outline: { roles: ["frame"], params: { color: ["color", "#ffffff"], alpha: ALPHA(0.6), width: ["num", 0.005, 0.08, 0.02], radius: ["num", 0, 0.5, 0.2], irregularity: IRREG, seed: ["seed", 1] } },
  lead: { roles: ["frame"], params: { color: ["color", "#120c09"], width: ["num", 0.01, 0.12, 0.05], highlight: ["color", "#8a7a6a"], irregularity: IRREG, seed: ["seed", 1], backing: ["color", "#1a0f0a"], backingAlpha: ALPHA(0) } },
  trace: { roles: ["frame"], params: { color: ["color", "#00e5ff"], alpha: ALPHA(0.45), lines: ["int", 1, 4, 2], nodes: ["int", 0, 12, 5], width: ["num", 0.004, 0.03, 0.01], seed: ["seed", 1], pulse: ALPHA(0.6) } },
  // ---- bodies
  bar: { roles: ["body"], params: { track: ["color", "#ffffff"], trackAlpha: ALPHA(0.18), fill: ["color", "#e8a23b"], fillAlpha: ALPHA(1), radius: ["num", 0, 0.5, 0.5], thickness: ["num", 0.15, 1, 0.42], gradient: ALPHA(0.25) } },
  tube: {
    roles: ["body"],
    params: { color: ["color", "#ff2bd6"], core: ["color", "#ffe6fb"], dim: ["color", "#3a1036"], dimAlpha: ALPHA(0.55), width: ["num", 0.03, 0.4, 0.14], glow: ALPHA(0.8), thickness: ["num", 0.15, 1, 0.5], shape: ["enum", ["line", "loop"], "line"], segments: ["int", 1, 24, 1] },
  },
  mosaic: {
    roles: ["body"],
    params: {
      shape: ["enum", ["rect", "arch", "roundArch", "capsule", "ellipse"], "arch"],
      pattern: ["enum", ["voronoi", "grid", "bricks"], "voronoi"],
      cells: ["int", 4, 90, 28], jitter: ["num", 0, 1, 0.7], seed: ["seed", 7], order: ["enum", ["x", "y", "center", "random"], "x"],
      palette: ["colors", 1, 8, ["#c98c51", "#e2a35e", "#8a3a1d", "#b3541f", "#e6e2d3"]],
      unlit: ["num", 0, 1, 0.3], tint: ["num", 0, 1, 0.5], bubbles: ["num", 0, 1, 0.4], streaks: ["num", 0, 1, 0.5], mottle: ["num", 0, 1, 0.5],
      light: ["color", "#fff6e0"], shade: ["color", "#1a0a05"],
      lead: ["color", "#120c09"], leadWidth: ["num", 0.004, 0.08, 0.028], leadHighlight: ["color", "#7d6e60"], irregularity: IRREG,
      thickness: ["num", 0.3, 1, 1], glow: ALPHA(0.5), glowColor: ["color", "#ffb347"],
    },
  },
  rose: {
    roles: ["body"],
    params: {
      rings: ["int", 1, 3, 2], segments: ["int", 5, 24, 9], seed: ["seed", 3], irregularity: IRREG,
      palette: ["colors", 1, 8, ["#b3541f", "#e2a35e", "#8a3a1d", "#c98c51"]], unlit: ["num", 0, 1, 0.3],
      light: ["color", "#fff6e0"], shade: ["color", "#1a0a05"], lead: ["color", "#120c09"], leadWidth: ["num", 0.004, 0.08, 0.03], leadHighlight: ["color", "#7d6e60"],
      bubbles: ["num", 0, 1, 0.3], glow: ALPHA(0.5), glowColor: ["color", "#ffb347"], center: ["color", "#e6e2d3"],
    },
  },
  cells: { roles: ["body"], params: { count: ["int", 3, 20, 5], color: ["color", "#e8a23b"], dim: ["color", "#ffffff"], dimAlpha: ALPHA(0.2), gap: ["num", 0, 0.5, 0.18], radius: ["num", 0, 0.5, 0.25], glow: ALPHA(0) } },
  // ---- ticks
  notch: { roles: ["ticks"], params: { color: ["color", "#ffffff"], alpha: ALPHA(0.7), length: ["num", 0.1, 1, 0.5] } },
  node: { roles: ["ticks"], params: { color: ["color", "#ffffff"], lit: ["color", "#ffd45e"], size: ["num", 0.02, 0.3, 0.1], irregularity: IRREG, seed: ["seed", 5] } },
  // ---- texts (the engine places them; a skin only styles them)
  text: {
    roles: ["value", "label", "timer"],
    params: {
      font: ["enum", ["skin", "sans", "serif", "rounded", "mono", "condensed"], "skin"], weight: ["int", 400, 900, 800], color: ["color", "#ffffff"],
      outline: ["color", "#000000"], outlineWidth: ["num", 0, 0.2, 0.08], glow: ALPHA(0), glowColor: ["color", "#ffffff"],
      plate: ["enum", ["none", "soft", "lead", "glass"], "none"], plateColor: ["color", "#14171c"], plateAlpha: ALPHA(0.85), plateEdge: ["color", "#120c09"],
      placement: ["enum", ["auto", "below", "above", "inside", "side"], "auto"], size: ["num", 0.6, 1.6, 1], seed: ["seed", 9],
    },
  },
  // ---- timer (countdown) track; its text uses the "text" style of the value
  gaugeline: { roles: ["timer"], params: { color: ["color", "#ffffff"], alpha: ALPHA(0.8), track: ["color", "#ffffff"], trackAlpha: ALPHA(0.2), thickness: ["num", 0.01, 0.2, 0.05] } },
  // ---- reactions
  flash: { roles: ["step", "burst"], params: { color: ["color", "#fff3c4"], strength: ALPHA(0.6), size: ["num", 0.2, 3, 1] } },
  ring: { roles: ["step", "burst"], params: { color: ["color", "#ffd45e"], width: ["num", 0.005, 0.1, 0.03], irregularity: IRREG, size: ["num", 0.3, 4, 1.6], seed: ["seed", 11] } },
  particles: {
    roles: ["step", "burst", "ambient"],
    params: { kind: ["enum", ["sparks", "embers", "shards", "dust"], "sparks"], colors: ["colors", 1, 6, ["#ffd45e", "#ff6a1a", "#fff3c4"]], count: ["int", 0, 80, 24], spread: ["num", 0.1, 3, 1], gravity: ["num", -1, 1, 0.3], size: ["num", 0.005, 0.08, 0.02], seed: ["seed", 13] },
  },
  rays: { roles: ["burst", "ambient"], params: { color: ["color", "#fff1c4"], count: ["int", 2, 12, 5], strength: ALPHA(0.25), angle: ["num", -80, 80, 25], seed: ["seed", 17] } },
  pulse: { roles: ["step", "burst"], params: { strength: ALPHA(0.5) } },
  // ---- ambient (alive at rest; off in reduced motion and at minimal quality)
  shimmer: { roles: ["ambient"], params: { color: ["color", "#ffffff"], strength: ALPHA(0.12), period: ["num", 3, 30, 7] } },
  flicker: { roles: ["ambient"], params: { strength: ALPHA(0.15), rate: ["num", 0.2, 2.5, 1] } },
  breathe: { roles: ["ambient"], params: { strength: ALPHA(0.2), period: ["num", 2, 20, 5] } },
};

/** Post effects of a skin (whole element), each switched off by the quality setting as listed in QUALITY. */
export const EFFECTS: Record<string, Record<string, ParamSpec>> = {
  glow: { strength: ALPHA(0.5) },
  bloom: { strength: ALPHA(0.3) },
  vignette: { strength: ALPHA(0.25), color: ["color", "#000000"] },
  /** `rate` 0 (default): a still grain (no extra frame); above 0, a grain that changes `rate` times a second (costly: the flattened layers are rebuilt each time). */
  grain: { amount: ALPHA(0.06), rate: ["num", 0, 12, 0] },
  edgeFade: { left: ["num", 0, 0.2, 0], right: ["num", 0, 0.2, 0], bottom: ["num", 0, 0.3, 0] },
};

/** What each quality level keeps. `light` keeps glows drawn with gradients (cheap) but no canvas blur; `minimal` draws flat, without particles or effects. */
export const QUALITY = {
  full: { blur: true, bloom: true, grain: true, vignette: true, rays: true, particles: 1, details: 1, ambient: true },
  light: { blur: false, bloom: false, grain: false, vignette: true, rays: false, particles: 0.5, details: 0.6, ambient: true },
  minimal: { blur: false, bloom: false, grain: false, vignette: false, rays: false, particles: 0, details: 0, ambient: false },
} as const;
export type Quality = keyof typeof QUALITY;

/** Timing rules of the principles (ms): the same for every module, so five follows in two seconds never make five celebrations. */
export const TIMING = {
  /** Highlights closer than this are merged into one (their amounts add up, the intensity grows, capped). */
  burstWindow: 1500,
  step: 900,
  celebration: 2600,
  /** At most this many celebrations wait in line; older ones are dropped (the value is never lost, only the show). */
  queue: 3,
  /** How long the displayed value takes to reach a new value (an increment, a recalibration). */
  ease: 900,
  /** Highlights a state may carry (the most recent ones). */
  maxHighlights: 40,
  /** Above this frequency nothing blinks (reduced-motion and photosensitivity rule). */
  maxFlashHz: 3,
} as const;

/** Highlight kinds a principle may send, from the weakest to the strongest (a merged burst takes the strongest kind). */
export const HIGHLIGHTS = ["drop", "step", "extend", "milestone", "complete"] as const;
export type HighlightKind = (typeof HIGHLIGHTS)[number];
export const PHASES = ["rest", "filling", "draining", "milestone", "complete", "overflow", "ended"] as const;
export const FORMATS = ["count", "time", "money", "percent"] as const;

/** Size caps of a recipe file. */
export const RECIPE_LIMITS = { bytes: 24 * 1024, layersPerRole: 3 } as const;

/** The whole table, as sent to the browser with the engine. */
export const ANIMATE_SPEC = { contract: ANIMATE_CONTRACT, version: ANIMATE_VERSION, genres: GENRES, primitives: PRIMITIVES, effects: EFFECTS, quality: QUALITY, timing: TIMING, highlights: HIGHLIGHTS, phases: PHASES, formats: FORMATS };
export type AnimateSpec = typeof ANIMATE_SPEC;
