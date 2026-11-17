/**
 * THE RECIPE CHECKER (core 0.30.0): reads a skin's `animation.json` with the closed grammar of spec.ts. Run at install, at every reading of an installed skin
 * and by `skin:check`. Pure (no file, no network).
 *
 * A recipe is DATA: per genre, per role, one to three layers `{ "draw": <primitive>, …bounded parameters }`, an optional `colors` table (names a layer can
 * cite as `"@name"`; `"@fg"`, `"@accent"`, `"@surface"` cite the page's tokens) and optional post `effects`. Anything outside the grammar is refused with the
 * path where it is, so an author fixes it at once; a contract NEWER than this core's is not an error: the animation is switched off (`recipe: null`) and the
 * basic rendering applies, the rest of the skin installs as usual.
 */
import { ANIMATE_CONTRACT, EFFECTS, GENRES, PRIMITIVES, RECIPE_LIMITS, type ParamSpec } from "./spec";

export type RecipeIssue = { code: "shape" | "contract" | "contract-newer" | "genre" | "role" | "draw" | "param" | "color" | "text-contrast"; path: string; severity: "error" | "warning" };
export type RecipeCheck = { ok: boolean; recipe: Record<string, unknown> | null; issues: RecipeIssue[]; newer?: boolean };

const HEX = /^#[0-9a-fA-F]{6}$/;
const NAME = /^[a-z][a-z0-9-]{0,20}$/;
const TOKEN_REFS = new Set(["fg", "accent", "surface"]);
const TOP_KEYS = new Set(["animateContract", "colors", "genres", "effects", "$comment"]);

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (h: string) => { const [r, g, b] = rgb(h); return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!); };
export const contrastRatio = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function checkAnimation(raw: unknown): RecipeCheck {
  const issues: RecipeIssue[] = [];
  const err = (code: RecipeIssue["code"], path: string) => { if (issues.length < 40) issues.push({ code, path: path.slice(0, 80), severity: "error" }); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, recipe: null, issues: [{ code: "shape", path: "animation.json", severity: "error" }] };
  const r = raw as Record<string, unknown>;
  const c = r.animateContract;
  if (!Number.isInteger(c) || (c as number) < 1) return { ok: false, recipe: null, issues: [{ code: "contract", path: "animateContract", severity: "error" }] };
  if ((c as number) > ANIMATE_CONTRACT) return { ok: true, recipe: null, newer: true, issues: [{ code: "contract-newer", path: "animateContract", severity: "warning" }] };
  for (const k of Object.keys(r)) if (!TOP_KEYS.has(k)) issues.push({ code: "shape", path: k, severity: "warning" });

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
      const s = spec[k];
      if (!s) { err("param", `${path}.${k}`); continue; }
      const bad = () => err(s[0] === "color" || s[0] === "colors" ? "color" : "param", `${path}.${k}`);
      switch (s[0]) {
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

  const genres: Record<string, unknown> = {};
  if (!r.genres || typeof r.genres !== "object" || Array.isArray(r.genres)) err("shape", "genres");
  else for (const [g, roles] of Object.entries(r.genres as Record<string, unknown>)) {
    const allowed = (GENRES as Record<string, readonly string[]>)[g];
    if (!allowed) { issues.push({ code: "genre", path: `genres.${g}`, severity: "warning" }); continue; }   // a genre of a newer contract: ignored
    if (!roles || typeof roles !== "object" || Array.isArray(roles)) { err("shape", `genres.${g}`); continue; }
    for (const [role, def] of Object.entries(roles as Record<string, unknown>)) {
      const path = `genres.${g}.${role}`;
      if (!allowed.includes(role)) { err("role", path); continue; }
      const layers = Array.isArray(def) ? def : [def];
      if (layers.length < 1 || layers.length > RECIPE_LIMITS.layersPerRole) { err("shape", path); continue; }
      layers.forEach((layer, i) => {
        const lp = Array.isArray(def) ? `${path}.${i}` : path;
        if (!layer || typeof layer !== "object" || Array.isArray(layer)) { err("shape", lp); return; }
        const L = layer as Record<string, unknown>, prim = typeof L.draw === "string" ? PRIMITIVES[L.draw] : undefined;
        if (!prim || !prim.roles.includes(role)) { err("draw", `${lp}.draw`); return; }
        checkParams(prim.params, L, lp, new Set(["draw"]));
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
      if (!spec) { err("param", `effects.${name}`); continue; }
      if (!o || typeof o !== "object" || Array.isArray(o)) { err("shape", `effects.${name}`); continue; }
      checkParams(spec, o as Record<string, unknown>, `effects.${name}`, new Set());
    }
  }
  const ok = !issues.some((i) => i.severity === "error");
  return { ok, recipe: ok ? { animateContract: c, colors, genres, ...(r.effects ? { effects: r.effects } : {}) } : null, issues };
}
