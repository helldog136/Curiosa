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

/**
 * Version of the recipe contract (animation.json `animateContract`) this core understands. Contract 2 (core 0.33.0) is ADDITIVE over 1: the `motion` key and the
 * per-layer `spring` / `duration` parameters, and the TOLERANT READER (a contract-2 recipe may carry words this core does not know yet: they are skipped with a
 * warning, never an error). A contract-1 recipe keeps its strict reading and its exact curves.
 * Contract 4 (core 0.48.0) is ADDITIVE over 2 again: the top-level `patterns` table and the mosaic's `pattern: "file"` with its `source` (the skin's own pieces, see PATTERN).
 * Contract 3 is skipped on purpose: it is the number of the SCENE contract (SCENE_CONTRACT, scene.json), which recipes and scenes would otherwise share confusingly.
 * An older core reads a contract-4 recipe as "written for a later contract" (tolerant: the mosaic falls back to voronoi, unless the skin says `animateMinContract: 4`).
 */
export const ANIMATE_CONTRACT = 4;
/** Version of the engine text (bumped when its behaviour changes in a way a module could notice). */
export const ANIMATE_VERSION = 3;

/**
 * THE MOTION TOKENS (core 0.33.0): a closed vocabulary of NAMES. A skin writes names only (`"motion": { "value": "gentle" }`, a layer's `"spring": "bouncy"`),
 * never a raw time or constant, so retuning this table in a later core changes every skin together (the same property as the `--ov-*` tokens).
 *
 *  - SPRINGS are damped oscillators, used through their analytic STEP RESPONSE (a pure function of time, no integrator): `f` is the natural frequency in Hz,
 *    `z` the damping ratio (1 = critical: no overshoot). Springs are linear, so several pending changes add up with continuous velocity.
 *  - DURATIONS in milliseconds, for fades and the attack of light reactions.
 *  - TEMPOS scale the engine moments (`TIMING.step`, `celebration`, `ease`): brisk is quicker, stately slower. Bounded 0.6 to 1.6.
 * The values are this project's own (chosen by physics: overshoot and settling time of each spring are listed in docs/OVERLAY-ANIMATIONS.md).
 */
export const MOTION = {
  springs: {
    snappy: { f: 4, z: 0.7 },
    smooth: { f: 2, z: 1 },
    gentle: { f: 1, z: 1 },
    bouncy: { f: 2.6, z: 0.45 },
  },
  durations: { fast: 150, standard: 300, considered: 600 },
  tempos: { brisk: 0.8, steady: 1, stately: 1.35 },
  tempoRange: [0.6, 1.6],
  /** The roles of `motion`: springs for `value` (the displayed value's glide), `body` (the head of a bar), `reaction` (steps) and `celebration` (bursts); `fade` is a duration. */
  roles: { value: "spring", body: "spring", reaction: "spring", celebration: "spring", fade: "duration", tempo: "tempo" },
  /** What a role takes when `motion` is present and does not name it (the value glide of `gentle` stands for today's 0.9 s ease). */
  defaults: { value: "gentle", body: "smooth", reaction: "snappy", celebration: "bouncy", fade: "fast", tempo: "steady" },
  /** `motion: "<spring>"` as a shorthand sets these roles at once. */
  shorthand: ["value", "body", "reaction"],
  /** CSS twins for the fallback rendering (`--ov-ease-*`): cubic-bezier fits of the step responses (least squares, own work); `bouncy` overshoots about 22 %. */
  css: {
    snappy: "cubic-bezier(0.27,0.2,0.23,1.3)",
    smooth: "cubic-bezier(0.25,0.18,0.2,0.88)",
    gentle: "cubic-bezier(0.25,0.18,0.2,0.88)",
    bouncy: "cubic-bezier(0.59,2.09,0.2,0.82)",
  },
} as const;
export type SpringName = keyof typeof MOTION.springs;
export type DurationName = keyof typeof MOTION.durations;
export type TempoName = keyof typeof MOTION.tempos;

/** The same names as CSS custom properties, for the HTML parts and the fallback rendering: `--ov-dur-fast|standard|considered`, `--ov-ease-snappy|smooth|gentle|bouncy`. */
export const MOTION_CSS_VARS: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(Object.entries(MOTION.durations).map(([k, v]) => [`--ov-dur-${k}`, `${v}ms`])),
  ...Object.fromEntries(Object.entries(MOTION.css).map(([k, v]) => [`--ov-ease-${k}`, v])),
});
/** A `:root{…}` block with them (a module copies it into its element page; the core page and a skin that cites one include it). */
export const motionCss = (selector = ":root"): string => `${selector}{${Object.entries(MOTION_CSS_VARS).map(([k, v]) => `${k}:${v}`).join(";")}}`;

export type ParamSpec =
  | readonly ["num", number, number, number]
  | readonly ["int", number, number, number]
  | readonly ["enum", readonly string[], string]
  | readonly ["bool", boolean]
  | readonly ["color", string]
  | readonly ["colors", number, number, readonly string[]]
  | readonly ["seed", number]
  /** A NAME that must exist in a top-level table of the recipe (`["ref", "patterns"]`: the name of an entry of `patterns`). Empty when absent. */
  | readonly ["ref", string];

const IRREG = ["num", 0, 4, 1] as const;
const ALPHA = (d: number) => ["num", 0, 1, d] as const;
/** (contract 2) Per-layer motion words: `inherit` follows the recipe's `motion` (or today's curve when there is none). */
const SPRING = ["enum", ["inherit", ...Object.keys(MOTION.springs)], "inherit"] as const;
const DURATION = ["enum", ["inherit", ...Object.keys(MOTION.durations)], "inherit"] as const;

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
  bar: { roles: ["body"], params: { track: ["color", "#ffffff"], trackAlpha: ALPHA(0.18), fill: ["color", "#e8a23b"], fillAlpha: ALPHA(1), radius: ["num", 0, 0.5, 0.5], thickness: ["num", 0.15, 1, 0.42], gradient: ALPHA(0.25), spring: SPRING } },
  tube: {
    roles: ["body"],
    params: { color: ["color", "#ff2bd6"], core: ["color", "#ffe6fb"], dim: ["color", "#3a1036"], dimAlpha: ALPHA(0.55), width: ["num", 0.03, 0.4, 0.14], glow: ALPHA(0.8), thickness: ["num", 0.15, 1, 0.5], shape: ["enum", ["line", "loop"], "line"], segments: ["int", 1, 24, 1] },
  },
  mosaic: {
    roles: ["body"],
    params: {
      shape: ["enum", ["rect", "arch", "roundArch", "capsule", "ellipse"], "arch"],
      pattern: ["enum", ["voronoi", "grid", "bricks", "file"], "voronoi"],
      /** With `pattern: "file"`: the name of an entry of the recipe's `patterns` table (the skin's own pieces). `shape` is then ignored: the union of the pieces is the window. */
      source: ["ref", "patterns"],
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
  flash: { roles: ["step", "burst"], params: { color: ["color", "#fff3c4"], strength: ALPHA(0.6), size: ["num", 0.2, 3, 1], spring: SPRING, duration: DURATION } },
  ring: { roles: ["step", "burst"], params: { color: ["color", "#ffd45e"], width: ["num", 0.005, 0.1, 0.03], irregularity: IRREG, size: ["num", 0.3, 4, 1.6], seed: ["seed", 11], spring: SPRING } },
  particles: {
    roles: ["step", "burst", "ambient"],
    params: { kind: ["enum", ["sparks", "embers", "shards", "dust"], "sparks"], colors: ["colors", 1, 6, ["#ffd45e", "#ff6a1a", "#fff3c4"]], count: ["int", 0, 80, 24], spread: ["num", 0.1, 3, 1], gravity: ["num", -1, 1, 0.3], size: ["num", 0.005, 0.08, 0.02], seed: ["seed", 13], spring: SPRING },
  },
  rays: { roles: ["burst", "ambient"], params: { color: ["color", "#fff1c4"], count: ["int", 2, 12, 5], strength: ALPHA(0.25), angle: ["num", -80, 80, 25], seed: ["seed", 17], duration: DURATION } },
  pulse: { roles: ["step", "burst"], params: { strength: ALPHA(0.5), spring: SPRING, duration: DURATION } },
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


/**
 * THE SCENE CONTRACT (core 0.40.0, `animateContract` 3): the second way for an overlay skin to draw an animated bar. A recipe (contract 1 and 2, above) picks
 * procedural PRIMITIVES from the core; a SCENE ships its own pictures (PNG, WebP, sanitised SVG: `images/`) and says only where they go on the ABSTRACT BAR
 * and when they move. The core stays a shell: it computes the bar (`view()`: progress, phase, bursts, milestones), exposes ANCHORS and EVENTS, and offers
 * generic mechanisms (a picture placed at an anchor, a wipe reveal, a keyframe or spring timeline, a seeded emitter). What a "lantern" or a "petal" looks like
 * is in the skin's pictures, never in the core. Values are drawn last by the core, with its own readability rule, whatever the pictures are.
 *
 * Everything bounded lives in this one table (sent to the browser and used by the installer: second lock). Contract 3 reads TOLERANTLY from its first day: a word
 * this core does not know (an anchor, a reveal mode, an event, a property, a kit) is skipped with a warning, never an error; a known word with a value out of its
 * bounds is an error. A layer whose picture cannot load is skipped, and the basic look of the core shows in its place (a role without any layer left).
 */
export const SCENE_CONTRACT = 3;
export const SCENE = {
  contract: SCENE_CONTRACT,
  /** The bar kinds a scene may draw. `levels` and `counter` are reserved: a scene's kit for them is skipped (the basic look applies). */
  kits: ["gauge"],
  /** Where a layer is placed: the bar body, the filled part, the head of the fill, one place per milestone. */
  anchors: ["track", "fill", "head", "tick"],
  /** What the basic look draws in place of a role that has no loaded layer. `deco` has no fallback (decoration only). */
  roles: ["track", "fill", "head", "deco"],
  /** What the core detected on the bar: a step (also an extension or a drop), a milestone, the goal reached. */
  events: ["step", "milestone", "complete"],
  /** Where an emitter starts: at the head of the fill, at the centre of the bar. */
  emitAt: ["head", "center"],
  /** The only properties a timeline may move (x and y in track heights, scale as a factor, rot in degrees, alpha 0..1, frame of a sprite sheet). */
  props: ["x", "y", "scale", "rot", "alpha", "frame"],
  reveals: ["wipe"],
  fits: ["stretch", "tile", "contain"],
  blends: ["normal", "add"],
  /** The lowest effects level that draws a layer: `minimal` (always), `light`, `full`. */
  tiers: ["minimal", "light", "full"],
  eases: ["linear", "out", "inOut"],
  /** [min, max, default] of every number a scene may write. */
  bounds: {
    thickness: [0.15, 1, 0.5], sizeH: [0.05, 6, 1], sizeW: [0.05, 60, 0], offset: [-3, 3, 0], pivot: [0, 1, 0.5], alpha: [0, 1, 1], alphaUnlit: [0, 1, 0.5], rot: [-180, 180, 0],
    every: [0.2, 8, 1], fps: [1, 8, 4], calmFrame: [0, 63, 0], keyU: [0, 1, 0], keyX: [-6, 6, 0], keyScale: [0, 4, 1], keyRot: [-720, 720, 0], keyAlpha: [0, 1, 1], keyFrame: [0, 63, 0],
    count: [1, 40, 12], delay: [0, 0.6, 0.2], life: [0.1, 1, 0.6], speed: [0, 3, 1], angle: [-360, 720, 0], gravity: [-2, 2, 0.5], spin: [-4, 4, 0], size: [0.05, 3, 0.5], seed: [0, 999999, 1],
  },
  limits: { bytes: 48 * 1024, layers: 16, timelines: 12, keys: 12, emitters: 4, particles: 40, live: 120, sprites: 200, assets: 12, side: 2048, pixels: 4_000_000, totalPixels: 16_000_000, frames: 64, grid: 8 },
} as const;

/**
 * THE PATTERN CONTRACT (core 0.48.0): a skin may bring its own PIECES for a `mosaic` (`pattern: "file"`). The principle: a skin gets more power over HOW an element is
 * drawn, never over DATA. A pattern file carries only numbers (the geometry of the pieces and a tone each); it is never served raw, holds no code and no address,
 * and reads or changes nothing of the site. The core normalises it (patternGraph.ts: shared vertices, T-junctions split, straight leads joined) and hands the
 * engine a graph of numbers, which the engine re-bounds with this table (second lock).
 */
export const PATTERN = {
  contract: 1,
  /** Pieces drawn per element: above this a pattern is not drawn (the voronoi mosaic stands in). To be confirmed by the bench (scripts/visual/animate-bench.mjs). */
  maxPieces: 120,
  /** Bounds the engine applies to a normalised graph it is given (vertices and sub-edges after the T-junction split, vertices of a piece). */
  maxVertices: 4000, maxEdges: 6000, maxLoop: 64,
  // ---- what the installer accepts in a pattern FILE (pattern.ts; the engine never sees the file, only the graph made from it)
  /** Largest file, and the largest sum of the pattern files a skin inlines into its page. */
  fileBytes: 32 * 1024, totalBytes: 96 * 1024,
  /** Pieces and vertices of one file; vertices of one piece (`minPieceVertices`, `maxPieceVertices`). */
  maxCellsFile: 160, maxVerticesFile: 1500, minPieceVertices: 3, maxPieceVertices: 12,
  /** The domain (the file's own units, never pixels) and its width / height. */
  domainMin: 50, domainMax: 20000, aspectMin: 0.2, aspectMax: 20,
  /** Coordinates may overshoot the domain by this fraction (then they are clamped). A piece must cover more than `minArea` of the domain. */
  margin: 0.005, minArea: 0.0005,
  /** Sharpest interior angle of a piece, in degrees: a warning under `angleWarn`, an error under `angleError`. */
  angleWarn: 12, angleError: 3,
  /** A window covering less of its domain than this is warned about. */
  coverage: 0.97,
  /** Variants of one pattern name, names in a `patterns` table, and the largest stretch between two neighbouring variants (the body is stretched by at most about this). */
  maxVariants: 4, maxNames: 12, stretch: 1.4,
} as const;

/** Where a skin's pattern file may be: one folder, a lower-case name (the same shape as the other skin files; the folder is declared in `assets` with `kind: "pattern"`). */
export const PATTERN_PATH_RE = /^patterns\/[a-z0-9][a-z0-9._-]{0,63}\.json$/;

/** The whole table, as sent to the browser with the engine. */
export const ANIMATE_SPEC = { contract: ANIMATE_CONTRACT, version: ANIMATE_VERSION, pattern: PATTERN, genres: GENRES, primitives: PRIMITIVES, effects: EFFECTS, quality: QUALITY, timing: TIMING, motion: MOTION, highlights: HIGHLIGHTS, phases: PHASES, formats: FORMATS, scene: SCENE };
export type AnimateSpec = typeof ANIMATE_SPEC;
