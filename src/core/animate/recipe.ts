/**
 * THE RECIPE CHECKER (core 0.30.0): reads a skin's `animation.json` with the closed grammar of spec.ts. Run at install, at every reading of an installed skin
 * and by `skin:check`. Pure (no file, no network).
 *
 * A recipe is DATA: per genre, per role, one to three layers `{ "draw": <primitive>, …bounded parameters }`, an optional `colors` table (names a layer can
 * cite as `"@name"`; `"@fg"`, `"@accent"`, `"@surface"` cite the page's tokens) and optional post `effects`. Anything outside the grammar is refused with the
 * path where it is, so an author fixes it at once; a contract NEWER than this core's is not an error: the animation is switched off (`recipe: null`) and the
 * basic rendering applies, the rest of the skin installs as usual.
 */
import { ANIMATE_CONTRACT, EFFECTS, GENRES, MOTION, PATTERN, PATTERN_PATH_RE, PRIMITIVES, RECIPE_LIMITS, SCENE_CONTRACT, type ParamSpec } from "./spec";
import type { PatternFileInfo } from "./pattern";

/**
 * Contract negotiation (core 0.33.0). A recipe says which contract it was WRITTEN FOR (`animateContract`) and, optionally, the OLDEST contract that can draw it
 * faithfully (`animateMinContract`, default = `animateContract`; a skin whose new words are only decoration may lower it).
 *  - the core understands the written contract or the minimum: it reads the recipe;
 *  - written for a LATER contract but readable by this one (minimum <= ours): read TOLERANTLY (everything it does not know is skipped, with warnings);
 *  - minimum above ours: the animation is off (`recipe: null`, `newer`), the skin installs with the basic rendering.
 * A recipe of contract 2 or more is read tolerantly by every core that understands it: an unknown role, primitive, parameter, effect or `motion` key is a
 * warning and is skipped, never an error. A contract-1 recipe keeps its strict reading.
 */
export type RecipeIssue = { code: "shape" | "contract" | "contract-newer" | "contract-ahead" | "genre" | "role" | "draw" | "param" | "color" | "text-contrast" | "motion-shape" | "motion-name" | "motion-key" | "patterns" | "pattern-source" | "pattern-missing" | "pattern-newer" | "pattern-stretch"; path: string; severity: "error" | "warning" };
export type RecipeCheck = { ok: boolean; recipe: Record<string, unknown> | null; issues: RecipeIssue[]; newer?: boolean };

const HEX = /^#[0-9a-fA-F]{6}$/;
const NAME = /^[a-z][a-z0-9-]{0,20}$/;
const TOKEN_REFS = new Set(["fg", "accent", "surface"]);
const TOP_KEYS = new Set(["animateContract", "animateMinContract", "colors", "genres", "effects", "motion", "patterns", "$comment"]);
/** Parameters added by contract 2: a contract-1 recipe does not know them (an unknown parameter, as before). */
const CONTRACT2_PARAMS = new Set(["spring", "duration"]);
/** Parameters added by contract 4: an older recipe does not know them (an unknown parameter). */
const CONTRACT4_PARAMS = new Set(["source"]);
const MOTION_WORDS = { spring: Object.keys(MOTION.springs), duration: Object.keys(MOTION.durations), tempo: Object.keys(MOTION.tempos) } as const;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h: string) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!); };
export const contrastRatio = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/**
 * `patterns` (contract 4): what the caller learned about each pattern file the skin ships, by path (read with checkPattern). A file that is not in the map is missing or
 * invalid (its own issues are reported by the caller, the recipe only says that the name cannot be used).
 */
export function checkAnimation(raw: unknown, patterns: ReadonlyMap<string, PatternFileInfo> = new Map()): RecipeCheck {
  const issues: RecipeIssue[] = [];
  // at most 40 findings, but a warning never takes the place of an error: a full list gives its last warning's room to an error, and errors are listed first
  const room = (item: RecipeIssue) => { if (issues.length < 40) { issues.push(item); return; } if (item.severity === "error") { const w = issues.map((i) => i.severity).lastIndexOf("warning"); if (w >= 0) issues.splice(w, 1, item); } };
  const err = (code: RecipeIssue["code"], path: string) => room({ code, path: path.slice(0, 80), severity: "error" });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, recipe: null, issues: [{ code: "shape", path: "animation.json", severity: "error" }] };
  const r = raw as Record<string, unknown>;
  const c = r.animateContract as number;
  // 3 is the number of the scene contract (scene.json), never a recipe's: refused, so a scene-style number cannot switch an animation on by accident
  if (!Number.isInteger(c) || c < 1 || c === SCENE_CONTRACT) return { ok: false, recipe: null, issues: [{ code: "contract", path: "animateContract", severity: "error" }] };
  const minC = r.animateMinContract === undefined ? c : r.animateMinContract;
  if (!Number.isInteger(minC) || (minC as number) < 1 || (minC as number) > c || minC === SCENE_CONTRACT) return { ok: false, recipe: null, issues: [{ code: "contract", path: "animateMinContract", severity: "error" }] };
  if ((minC as number) > ANIMATE_CONTRACT) return { ok: true, recipe: null, newer: true, issues: [{ code: "contract-newer", path: "animateContract", severity: "warning" }] };
  /** Written for a later contract than ours: whatever is outside what we know is skipped with a warning, even a value out of its bounds. */
  const ahead = c > ANIMATE_CONTRACT, tolerant = c >= 2;
  if (ahead) issues.push({ code: "contract-ahead", path: "animateContract", severity: "warning" });
  for (const k of Object.keys(r)) if (!TOP_KEYS.has(k) || (k === "motion" && c < 2) || (k === "animateMinContract" && c < 2) || (k === "patterns" && c < 4)) issues.push({ code: "shape", path: k, severity: "warning" });
  /** A refusal in a strict reading, a warning when tolerant (the thing is skipped). */
  const soft = (code: RecipeIssue["code"], path: string, tol = tolerant) => room({ code, path: path.slice(0, 80), severity: tol ? "warning" : "error" });

  // colours of the recipe
  const colors: Record<string, string> = {};
  if (r.colors !== undefined) {
    if (!r.colors || typeof r.colors !== "object" || Array.isArray(r.colors) || Object.keys(r.colors).length > 16) err("shape", "colors");
    else for (const [k, v] of Object.entries(r.colors as Record<string, unknown>)) { if (!NAME.test(k) || TOKEN_REFS.has(k) || typeof v !== "string" || !HEX.test(v)) err("color", `colors.${k}`); else colors[k] = v.toLowerCase(); }
  }
  const colorOk = (v: unknown): boolean => typeof v === "string" && (HEX.test(v) || (v.startsWith("@") && (TOKEN_REFS.has(v.slice(1)) || v.slice(1) in colors)));
  /** The colour as #rrggbb when it can be known at install (a token reference cannot: the page's tokens are checked by their own rules). */
  const known = (v: unknown, d: string): string | null => (typeof v !== "string" ? d : HEX.test(v) ? v.toLowerCase() : v.startsWith("@") && v.slice(1) in colors ? colors[v.slice(1)]! : null);

  const checkParams = (spec: Record<string, ParamSpec>, o: Record<string, unknown>, path: string, skip: Set<string>) => {
    for (const [k, v] of Object.entries(o)) {
      if (skip.has(k)) continue;
      const s = (c < 2 && CONTRACT2_PARAMS.has(k)) || (c < 4 && CONTRACT4_PARAMS.has(k)) ? undefined : spec[k];
      if (!s) { soft("param", `${path}.${k}`); continue; }   // an unknown parameter: an error in contract 1, skipped with a warning from contract 2
      const bad = () => { if (CONTRACT2_PARAMS.has(k)) soft("motion-name", `${path}.${k}`, ahead); else if (ahead) soft("param", `${path}.${k}`, true); else err(s[0] === "color" || s[0] === "colors" ? "color" : "param", `${path}.${k}`); };
      if (k === "pattern" && v === "file" && c < 4) { bad(); continue; }   // the skin's own pieces are a contract-4 word
      switch (s[0]) {
        case "ref": if (typeof v !== "string" || !NAME.test(v)) bad(); break;
        case "num": if (typeof v !== "number" || !isFinite(v) || v < s[1] || v > s[2]) bad(); break;
        case "int": if (!Number.isInteger(v) || (v as number) < s[1] || (v as number) > s[2]) bad(); break;
        case "seed": if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 999999) bad(); break;
        case "enum": if (typeof v !== "string" || !s[1].includes(v)) bad(); break;
        case "bool": if (typeof v !== "boolean") bad(); break;
        case "color": if (!colorOk(v)) bad(); break;
        case "colors": if (!Array.isArray(v) || v.length < s[1] || v.length > s[2] || !v.every(colorOk)) bad(); break;
      }
    }
  };

  // (contract 4) the `patterns` table: names of the skin's own pieces, each one a file or a few variants of the same pattern (an aspect ratio each)
  const patternTable: Record<string, { file: string }[]> = {};
  if (c >= 4 && r.patterns !== undefined) {
    const tbl = r.patterns;
    if (!tbl || typeof tbl !== "object" || Array.isArray(tbl) || Object.keys(tbl).length > PATTERN.maxNames) err("patterns", "patterns");
    else for (const [name, def] of Object.entries(tbl as Record<string, unknown>)) {
      const np = `patterns.${name}`;
      if (!NAME.test(name)) { err("patterns", np); continue; }
      const list = Array.isArray(def) ? def : [def];
      if (list.length < 1 || list.length > PATTERN.maxVariants) { err("patterns", np); continue; }
      const ok: { file: string }[] = [];
      list.forEach((v, i) => {
        const vp = Array.isArray(def) ? `${np}.${i}` : np;
        if (!v || typeof v !== "object" || Array.isArray(v) || typeof (v as { file?: unknown }).file !== "string" || !PATTERN_PATH_RE.test((v as { file: string }).file)) { err("patterns", `${vp}.file`); return; }
        for (const k of Object.keys(v as object)) if (k !== "file" && k !== "$comment") issues.push({ code: "patterns", path: `${vp}.${k}`.slice(0, 80), severity: "warning" });
        const file = (v as { file: string }).file, info = patterns.get(file);
        if (!info) { err("pattern-missing", file); return; }
        if ("newer" in info) { issues.push({ code: "pattern-newer", path: file.slice(0, 80), severity: "warning" }); return; }   // written for a newer pattern contract: this variant is skipped
        ok.push({ file });
      });
      // two neighbouring variants must not be so far apart in shape that the body is stretched by more than the limit
      const doms = ok.map((v) => patterns.get(v.file) as { w: number; h: number }).sort((a, b) => a.w / a.h - b.w / b.h);
      for (let i = 1; i < doms.length; i++) if (Math.sqrt((doms[i]!.w / doms[i]!.h) / (doms[i - 1]!.w / doms[i - 1]!.h)) > PATTERN.stretch) issues.push({ code: "pattern-stretch", path: np.slice(0, 80), severity: "warning" });
      if (ok.length) patternTable[name] = ok;
    }
  }

  const genres: Record<string, unknown> = {};
  if (!r.genres || typeof r.genres !== "object" || Array.isArray(r.genres)) err("shape", "genres");
  else for (const [g, roles] of Object.entries(r.genres as Record<string, unknown>)) {
    const allowed = (GENRES as Record<string, readonly string[]>)[g];
    if (!allowed) { issues.push({ code: "genre", path: `genres.${g}`, severity: "warning" }); continue; }   // a genre of a later contract: ignored
    if (!roles || typeof roles !== "object" || Array.isArray(roles)) { err("shape", `genres.${g}`); continue; }
    for (const [role, def] of Object.entries(roles as Record<string, unknown>)) {
      const path = `genres.${g}.${role}`;
      if (!allowed.includes(role)) { soft("role", path); continue; }   // a role of a later contract: skipped
      const layers = Array.isArray(def) ? def : [def];
      if (layers.length < 1 || layers.length > RECIPE_LIMITS.layersPerRole) { err("shape", path); continue; }
      layers.forEach((layer, i) => {
        const lp = Array.isArray(def) ? `${path}.${i}` : path;
        if (!layer || typeof layer !== "object" || Array.isArray(layer)) { err("shape", lp); return; }
        const L = layer as Record<string, unknown>, prim = typeof L.draw === "string" ? PRIMITIVES[L.draw] : undefined;
        if (!prim || !prim.roles.includes(role)) { soft("draw", `${lp}.draw`); return; }   // a primitive of a later contract: the layer is skipped
        checkParams(prim.params, L, lp, new Set(["draw"]));
        if (L.draw === "mosaic" && L.pattern === "file" && c >= 4 && !(typeof L.source === "string" && Object.prototype.hasOwnProperty.call(patternTable, L.source))) soft("pattern-source", `${lp}.source`, ahead);   // `file` names an entry of the table
        if (L.draw === "text") {
          // readability, decided at install when the colours are known: an outline wide enough and contrasted, or an opaque plate that contrasts
          const color = known(L.color, "#ffffff"), outline = known(L.outline, "#000000"), plateColor = known(L.plateColor, "#14171c");
          const ow = typeof L.outlineWidth === "number" ? L.outlineWidth : 0.08, plate = typeof L.plate === "string" ? L.plate : "none", plateAlpha = typeof L.plateAlpha === "number" ? L.plateAlpha : 0.85;
          if (color && outline && plateColor) {
            const viaOutline = ow >= 0.04 && contrastRatio(color, outline) >= 4.5, viaPlate = plate !== "none" && plateAlpha >= 0.8 && contrastRatio(color, plateColor) >= 4.5;
            if (!viaOutline && !viaPlate) err("text-contrast", lp);
          }
        }
      });
    }
    genres[g] = roles;
  }
  if (r.effects !== undefined) {
    if (!r.effects || typeof r.effects !== "object" || Array.isArray(r.effects)) err("shape", "effects");
    else for (const [name, o] of Object.entries(r.effects as Record<string, unknown>)) {
      const spec = EFFECTS[name];
      if (!spec) { soft("param", `effects.${name}`); continue; }   // an effect of a later contract: skipped
      if (!o || typeof o !== "object" || Array.isArray(o)) { err("shape", `effects.${name}`); continue; }
      checkParams(spec, o as Record<string, unknown>, `effects.${name}`, new Set());
    }
  }
  // (contract 2) the motion tokens: names only, from the closed table of spec.ts (MOTION)
  let motion: Record<string, string> | undefined;
  if (c >= 2 && r.motion !== undefined) {
    const m = r.motion, word = (kind: "spring" | "duration" | "tempo", v: unknown, path: string): string | null => {
      if (typeof v === "string" && (MOTION_WORDS[kind] as readonly string[]).includes(v)) return v;
      soft("motion-name", path, ahead);   // a name of a later vocabulary: warning (the role keeps its default), a typo of this one: error
      return null;
    };
    if (typeof m === "string") {
      const sp = word("spring", m, "motion");
      if (sp) { motion = {}; for (const k of MOTION.shorthand) motion[k] = sp; }
    } else if (m && typeof m === "object" && !Array.isArray(m)) {
      motion = {};
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        const kind = (MOTION.roles as Record<string, string>)[k] as "spring" | "duration" | "tempo" | undefined;
        if (!kind) { issues.push({ code: "motion-key", path: `motion.${k}`.slice(0, 80), severity: "warning" }); continue; }   // a role of a later vocabulary: skipped
        const w = word(kind, v, `motion.${k}`);
        if (w) motion[k] = w;
      }
    } else err("motion-shape", "motion");
  }
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));   // errors first: the caller shows the first few
  const ok = !issues.some((i) => i.severity === "error");
  return { ok, recipe: ok ? { animateContract: Math.min(c, ANIMATE_CONTRACT), colors, genres, ...(r.effects ? { effects: r.effects } : {}), ...(motion ? { motion } : {}), ...(Object.keys(patternTable).length ? { patterns: patternTable } : {}) } : null, issues };
}
