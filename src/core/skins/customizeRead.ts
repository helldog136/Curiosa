/**
 * READING THE `customize` SECTION of a site skin (docs/SKINS.md "Customization"): a tolerant reader. PURE (no file, database or network access).
 *
 * Rules:
 *  - what is unknown (a control type, a key, a later `version`) is SKIPPED with a warning: the rest of the skin works, a growing contract breaks nobody;
 *  - what is known but out of bounds (a limit, a missing French or English label, a bad colour, a default that is not a choice) is an ERROR: the author fixes it at once;
 *  - the result is the CLEANED declaration: only what is known and valid, with every default made explicit. That object is what the page and the composer get.
 * The limits are fixed by the core (CUSTOMIZE_LIMITS): a skin cannot raise them, which keeps the generic page inside the ergonomics budgets whatever it declares.
 */
import { parseColor } from "./colorParse";
import { makeIssue, type Params, type SkinIssue } from "./messages";
import { validateTokenValue } from "./tokens";
import {
  CONTROL_ID_RE, CUSTOMIZE_LIMITS as LIM, CUSTOMIZE_VERSION, PALETTE_REF_RE, SLIDER_UNITS, VALUE_ID_RE,
  varNamesOf, type ColorControl, type ContrastPair, type Control, type CustomizeDecl, type FreeRange, type Group, type ImageControl, type Loc, type Look, type SliderUnit, type TokenMap, type UploadRule,
} from "./customizeSpec";
import { checkValue } from "./customizeResolve";
import { IMAGE_PATH_RE } from "./allowlist";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** R9: words a person must not read in a label or hint (the list of testsupport/ergonomics.mjs; a test keeps both in step). */
export const CUSTOMIZE_FORBIDDEN_WORDS: readonly string[] = [
  "clé", "clés", "clef", "clefs", "slug", "slugs", "instance", "instances", "topic", "topics", "sujet", "sujets", "token", "tokens", "jeton", "jetons",
  "webhook", "webhooks", "eventsub", "route", "routes", "service", "services", "identifiant", "identifiants", "payload", "api", "json", "cache", "hash", "sse", "oauth",
  "key", "keys", "identifier", "identifiers",
];
const plain = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const FORBIDDEN = new Set(CUSTOMIZE_FORBIDDEN_WORDS.map(plain));

/** The first rule a text breaks (R9, R10, R13), or null. */
export function wordingProblem(text: string, max: number): string | null {
  if (text.length > max) return "length";
  if (/:\s*$/.test(text) || /[()（）]/.test(text)) return "punctuation";
  if (/!/.test(text) || /\bveuillez\b/i.test(text)) return "tone";
  if (/\p{Lu}{4,}/u.test(text)) return "capitals";
  for (const w of plain(text).split(/[^\p{L}\p{N}]+/u)) if (w && FORBIDDEN.has(w)) return w;
  return null;
}

type Ctx = { issues: SkinIssue[]; ids: Set<string>; vars: Set<string> };
const add = (c: Ctx, code: string, params: Params = {}, severity?: "error" | "warning") => { c.issues.push(makeIssue(code, params, severity)); };
const warn = (c: Ctx, what: string) => add(c, "customize-unknown", { what: what.slice(0, 40) }, "warning");

/** A label or hint in both languages. null (with an issue) when it breaks a rule. */
function loc(c: Ctx, raw: unknown, field: string, max: number, required: boolean): Loc | undefined | null {
  if (raw === undefined && !required) return undefined;
  if (!isObj(raw) || typeof raw.fr !== "string" || typeof raw.en !== "string" || !raw.fr.trim() || !raw.en.trim()) { add(c, "customize-label", { field }); return null; }
  const fr = raw.fr.trim(), en = raw.en.trim();
  for (const t of [fr, en]) {
    const p = wordingProblem(t, max);
    if (p === "length" || p === "punctuation") { add(c, "customize-label", { field }); return null; }
    if (p) { add(c, "customize-wording", { word: p }); return null; }
  }
  return { fr, en };
}

function hexOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((x) => x + x).join("") : h}`;
}

function newId(c: Ctx, raw: unknown, re: RegExp, bag: Set<string>): string | null {
  if (typeof raw !== "string" || !re.test(raw) || bag.has(raw)) { add(c, "customize-id", { id: String(raw).slice(0, 30) }); return null; }
  bag.add(raw);
  return raw;
}

function range(raw: unknown, lo: number, hi: number): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2 || !isNum(raw[0]) || !isNum(raw[1]) || raw[0] < lo || raw[1] > hi || raw[0] > raw[1]) return null;
  return [raw[0], raw[1]];
}

function contrast(c: Ctx, raw: unknown, field: string): ContrastPair[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > LIM.contrastPairs) { add(c, "customize-limit", { what: "contrast", max: LIM.contrastPairs }); return null; }
  const out: ContrastPair[] = [];
  for (const p of raw) {
    if (!isObj(p) || !isNum(p.min) || p.min < 1 || p.min > 21) { add(c, "customize-field", { field: `${field}.contrast` }); return null; }
    if (typeof p.text === "string") {
      const hex = hexOf(p.text);
      if (hex) out.push({ kind: "text", text: hex, min: p.min });
      else if (PALETTE_REF_RE.test(p.text)) out.push({ kind: "text", text: p.text, min: p.min });
      else { add(c, "customize-field", { field: `${field}.contrast` }); return null; }
    } else if (Array.isArray(p.against) && p.against.length >= 1 && p.against.length <= 3 && p.against.every((a) => typeof a === "string" && PALETTE_REF_RE.test(a))) {
      out.push({ kind: "against", against: p.against as string[], min: p.min });
    } else { add(c, "customize-field", { field: `${field}.contrast` }); return null; }
  }
  return out;
}

/** The token maps of a choice value or a toggle side: common `--sk-*` tokens only, each with a valid value (the same checks as a skin's own tokens). */
function tokens(c: Ctx, raw: unknown, field: string, skinTokenCheck = true): TokenMap | null {
  if (raw === undefined) return {};
  if (!isObj(raw) || Object.keys(raw).length > LIM.tokens) { add(c, "customize-limit", { what: "tokens", max: LIM.tokens }); return null; }
  const out: TokenMap = {};
  for (const [name, value] of Object.entries(raw)) {
    const r = /^--sk-[a-z0-9][a-z0-9-]{0,60}$/.test(name) && !name.startsWith("--sk-cz-") && skinTokenCheck ? validateTokenValue(name, value) : null;
    if (!r || !r.ok) {
      if (r && "unknown" in r && r.unknown) { warn(c, name); continue; }
      add(c, "customize-token", { token: name.slice(0, 40) });
      return null;
    }
    out[name] = r.value;
  }
  return out;
}

const COMMON = new Set(["id", "type", "label", "hint", "featured", "was"]);
function common(c: Ctx, raw: Obj, extra: readonly string[], field: string): { id: string; label: Loc; hint?: Loc; featured: boolean; was: string[] } | null {
  for (const k of Object.keys(raw)) if (!COMMON.has(k) && !extra.includes(k)) warn(c, `${field}.${k}`);
  const id = newId(c, raw.id, CONTROL_ID_RE, c.ids);
  const label = loc(c, raw.label, `${field}.label`, LIM.label, true);
  const hint = loc(c, raw.hint, `${field}.hint`, LIM.hint, false);
  if (!id || !label || hint === null) return null;
  let was: string[] = [];
  if (raw.was !== undefined) {
    if (!Array.isArray(raw.was) || raw.was.length > LIM.was || !raw.was.every((w) => typeof w === "string" && CONTROL_ID_RE.test(w))) { add(c, "customize-field", { field: `${field}.was` }); return null; }
    was = raw.was as string[];
  }
  return { id, label, ...(hint ? { hint } : {}), featured: raw.featured === true, was };
}

function color(c: Ctx, raw: Obj, field: string): ColorControl | null {
  const base = common(c, raw, ["palette", "default", "custom", "contrast"], field);
  if (!base) return null;
  const palette: ColorControl["palette"] = [];
  const ids = new Set<string>();
  if (raw.palette !== undefined) {
    if (!Array.isArray(raw.palette) || raw.palette.length > LIM.choices) { add(c, "customize-limit", { what: "palette", max: LIM.choices }); return null; }
    for (const s of raw.palette) {
      if (!isObj(s)) { add(c, "customize-field", { field: `${field}.palette` }); return null; }
      const id = newId(c, s.id, VALUE_ID_RE, ids);
      const label = loc(c, s.label, `${field}.palette.label`, LIM.label, true);
      const light = hexOf(s.light), dark = hexOf(s.dark);
      if (!id || !label || !light || !dark) { if (id && label) add(c, "customize-field", { field: `${field}.palette` }); return null; }
      palette.push({ id, label, light, dark });
    }
  }
  let custom: FreeRange | undefined;
  if (raw.custom !== undefined) {
    const cu = raw.custom;
    const l = isObj(cu) ? range(cu.l, 0, 1) : null, ch = isObj(cu) ? range(cu.c, 0, 0.4) : null;
    let dk: { l: [number, number] } | undefined;
    if (isObj(cu) && cu.dark !== undefined) { const dl = isObj(cu.dark) ? range(cu.dark.l, 0, 1) : null; if (!dl) { add(c, "customize-field", { field: `${field}.custom` }); return null; } dk = { l: dl }; }
    if (!l || !ch) { add(c, "customize-field", { field: `${field}.custom` }); return null; }
    custom = { l, c: ch, ...(dk ? { dark: dk } : {}) };
  }
  if (palette.length === 0 && !custom) { add(c, "customize-field", { field: `${field}.palette` }); return null; }
  let def: string;
  if (palette.length > 0) {
    if (typeof raw.default !== "string" || !palette.some((p) => p.id === raw.default)) { add(c, "customize-field", { field: `${field}.default` }); return null; }
    def = raw.default;
  } else {
    const hex = hexOf(raw.default);
    if (!hex) { add(c, "customize-field", { field: `${field}.default` }); return null; }
    def = hex;
  }
  const pairs = contrast(c, raw.contrast, field);
  if (!pairs) return null;
  return { ...base, type: "color", palette, default: def, ...(custom ? { custom } : {}), contrast: pairs };
}

function choice(c: Ctx, raw: Obj, field: string): Control | null {
  const base = common(c, raw, ["display", "values", "default"], field);
  if (!base) return null;
  if (!Array.isArray(raw.values) || raw.values.length < 2 || raw.values.length > LIM.choices) { add(c, "customize-limit", { what: "choices", max: LIM.choices }); return null; }
  const ids = new Set<string>();
  const values: { id: string; label: Loc; tokens: TokenMap }[] = [];
  for (const v of raw.values) {
    if (!isObj(v)) { add(c, "customize-field", { field: `${field}.values` }); return null; }
    const id = newId(c, v.id, VALUE_ID_RE, ids);
    const label = loc(c, v.label, `${field}.values.label`, LIM.label, true);
    const tk = tokens(c, v.tokens, `${field}.values.tokens`);
    if (!id || !label || !tk) return null;
    values.push({ id, label, tokens: tk });
  }
  if (typeof raw.default !== "string" || !ids.has(raw.default)) { add(c, "customize-field", { field: `${field}.default` }); return null; }
  return { ...base, type: "choice", display: raw.display === "chips" ? "chips" : "auto", values, default: raw.default };
}

function toggle(c: Ctx, raw: Obj, field: string): Control | null {
  const base = common(c, raw, ["default", "on", "off"], field);
  if (!base) return null;
  if (typeof raw.default !== "boolean") { add(c, "customize-field", { field: `${field}.default` }); return null; }
  const on = tokens(c, raw.on, `${field}.on`), off = tokens(c, raw.off, `${field}.off`);
  if (!on || !off) return null;
  return { ...base, type: "toggle", default: raw.default, on, off };
}

function slider(c: Ctx, raw: Obj, field: string): Control | null {
  const base = common(c, raw, ["min", "max", "step", "unit", "default"], field);
  if (!base) return null;
  const unit = raw.unit === undefined ? "" : raw.unit;
  if (!isNum(raw.min) || !isNum(raw.max) || !isNum(raw.step) || !isNum(raw.default) || raw.min >= raw.max || raw.step <= 0 || (raw.max - raw.min) / raw.step > 1000
    || raw.default < raw.min || raw.default > raw.max || Math.abs(raw.min) > 100000 || Math.abs(raw.max) > 100000 || !(SLIDER_UNITS as readonly unknown[]).includes(unit)) {
    add(c, "customize-field", { field }); return null;
  }
  return { ...base, type: "slider", min: raw.min, max: raw.max, step: raw.step, unit: unit as SliderUnit, default: raw.default };
}

const FORMATS = ["png", "jpg", "webp", "gif", "svg"] as const;
function upload(c: Ctx, raw: unknown, field: string): UploadRule | null | undefined {
  if (raw === undefined) return undefined;
  if (!isObj(raw)) { add(c, "customize-field", { field: `${field}.upload` }); return null; }
  for (const k of Object.keys(raw)) if (!["formats", "maxKb", "ratio", "ratioTolerance", "minPx", "maxPx", "focal", "animated"].includes(k)) warn(c, `${field}.upload.${k}`);
  const formats = Array.isArray(raw.formats) && raw.formats.length >= 1 && raw.formats.every((f) => (FORMATS as readonly unknown[]).includes(f)) ? [...new Set(raw.formats as UploadRule["formats"])] : null;
  const ratio = Array.isArray(raw.ratio) && raw.ratio.length === 2 && raw.ratio.every((n) => isNum(n) && n >= 1 && n <= 100) ? (raw.ratio as [number, number]) : null;
  const tol = raw.ratioTolerance === undefined ? 0.03 : raw.ratioTolerance;
  const minPx = Array.isArray(raw.minPx) && raw.minPx.length === 2 && raw.minPx.every((n) => isNum(n) && n >= 16 && n <= 4096) ? (raw.minPx as [number, number]) : null;
  const maxPx = Array.isArray(raw.maxPx) && raw.maxPx.length === 2 && raw.maxPx.every((n) => isNum(n) && n >= 16 && n <= 4096) ? (raw.maxPx as [number, number]) : null;
  if (!formats || !ratio || !minPx || !maxPx || !isNum(tol) || tol < 0 || tol > 0.2 || !isNum(raw.maxKb) || raw.maxKb < 5 || raw.maxKb > 1024 || minPx[0] > maxPx[0] || minPx[1] > maxPx[1]) {
    add(c, "customize-field", { field: `${field}.upload` });
    return null;
  }
  return { formats, maxKb: raw.maxKb, ratio, ratioTolerance: tol, minPx, maxPx, focal: raw.focal === true, animated: raw.animated !== false };
}

function image(c: Ctx, raw: Obj, field: string): Control | null {
  const base = common(c, raw, ["fit", "default", "alternatives", "upload", "textOver"], field);
  if (!base) return null;
  const fit = raw.fit === undefined ? "cover" : raw.fit;
  if (fit !== "cover" && fit !== "contain" && fit !== "tile") { add(c, "customize-field", { field: `${field}.fit` }); return null; }
  const alts: ImageControl["alternatives"] = [];
  const ids = new Set<string>(["none", "upload"]);
  if (raw.alternatives !== undefined) {
    if (!Array.isArray(raw.alternatives) || raw.alternatives.length > LIM.alternatives) { add(c, "customize-limit", { what: "alternatives", max: LIM.alternatives }); return null; }
    for (const a of raw.alternatives) {
      if (!isObj(a)) { add(c, "customize-field", { field: `${field}.alternatives` }); return null; }
      const id = newId(c, a.id, VALUE_ID_RE, ids);
      const label = loc(c, a.label, `${field}.alternatives.label`, LIM.label, true);
      if (!id || !label) return null;
      if (typeof a.file !== "string" || !IMAGE_PATH_RE.test(a.file)) { add(c, "customize-asset", { file: String(a.file).slice(0, 60) }); return null; }
      alts.push({ id, label, file: a.file });
    }
  }
  const up = upload(c, raw.upload, field);
  if (up === null) return null;
  const def = raw.default === undefined ? "none" : raw.default;
  if (typeof def !== "string" || (def !== "none" && !alts.some((a) => a.id === def))) { add(c, "customize-field", { field: `${field}.default` }); return null; }
  if (alts.length === 0 && !up) { add(c, "customize-field", { field: `${field}.alternatives` }); return null; }
  let textOver: ImageControl["textOver"];
  if (raw.textOver !== undefined) {
    const o = raw.textOver;
    const col = isObj(o) ? hexOf(o.color) : null;
    if (!isObj(o) || !col || !isNum(o.min) || o.min < 1 || o.min > 21) { add(c, "customize-field", { field: `${field}.textOver` }); return null; }
    textOver = { color: col, min: o.min };
  }
  return { ...base, type: "image", fit, default: def, alternatives: alts, ...(up ? { upload: up } : {}), ...(textOver ? { textOver } : {}) };
}

function control(c: Ctx, raw: unknown, field: string): Control | null {
  if (!isObj(raw)) { add(c, "customize-field", { field }); return null; }
  let out: Control | null;
  switch (raw.type) {
    case "color": out = color(c, raw, field); break;
    case "choice": out = choice(c, raw, field); break;
    case "toggle": out = toggle(c, raw, field); break;
    case "slider": out = slider(c, raw, field); break;
    case "image": out = image(c, raw, field); break;
    default: warn(c, `${field}.type`); return null;   // an unknown type: skipped, the rest works
  }
  if (!out) return null;
  for (const v of varNamesOf(out)) { if (c.vars.has(v)) { add(c, "customize-id", { id: out.id }); return null; } c.vars.add(v); }
  return out;
}

/** Reads the `customize` value of a skin.json. `decl` is null when there is nothing usable; `issues` holds every error and warning. */
export function readCustomize(raw: unknown): { decl: CustomizeDecl | null; issues: SkinIssue[] } {
  const c: Ctx = { issues: [], ids: new Set(), vars: new Set() };
  if (raw === undefined) return { decl: null, issues: [] };
  if (!isObj(raw)) { add(c, "customize-field", { field: "customize" }); return { decl: null, issues: c.issues }; }
  const version = raw.version === undefined ? 1 : raw.version;
  if (!Number.isInteger(version) || (version as number) < 1) { add(c, "customize-field", { field: "customize.version" }); return { decl: null, issues: c.issues }; }
  if ((version as number) > CUSTOMIZE_VERSION) { add(c, "customize-version-ahead", {}, "warning"); return { decl: null, issues: c.issues }; }
  for (const k of Object.keys(raw)) if (!["version", "looks", "groups"].includes(k)) warn(c, `customize.${k}`);
  if (!Array.isArray(raw.groups) || raw.groups.length === 0) { add(c, "customize-field", { field: "customize.groups" }); return { decl: null, issues: c.issues }; }
  if (raw.groups.length > LIM.groups) { add(c, "customize-limit", { what: "groups", max: LIM.groups }); return { decl: null, issues: c.issues }; }
  const groupIds = new Set<string>();
  const groups: Group[] = [];
  let total = 0;
  for (const [gi, g] of raw.groups.entries()) {
    const field = `groups.${gi}`;
    if (!isObj(g)) { add(c, "customize-field", { field }); continue; }
    for (const k of Object.keys(g)) if (!["id", "label", "folded", "controls"].includes(k)) warn(c, `${field}.${k}`);
    const id = newId(c, g.id, CONTROL_ID_RE, groupIds);
    const label = loc(c, g.label, `${field}.label`, LIM.label, true);
    if (!Array.isArray(g.controls)) { add(c, "customize-field", { field: `${field}.controls` }); continue; }
    if (g.controls.length > LIM.perGroup) { add(c, "customize-limit", { what: "controls per group", max: LIM.perGroup }); continue; }
    const controls: Control[] = [];
    for (const [ci, raw1] of g.controls.entries()) { total++; const ctl = control(c, raw1, `${field}.controls.${ci}`); if (ctl) controls.push(ctl); }
    if (id && label) groups.push({ id, label, folded: g.folded !== false, controls });
  }
  if (total > LIM.controls) add(c, "customize-limit", { what: "controls", max: LIM.controls });
  const all = groups.flatMap((g) => g.controls);
  if (all.filter((x) => x.featured).length > LIM.featured) add(c, "customize-limit", { what: "featured controls", max: LIM.featured });
  // looks: whole states; every value must be one the control allows
  const looks: Look[] = [];
  if (raw.looks !== undefined) {
    if (!Array.isArray(raw.looks) || raw.looks.length > LIM.looks) add(c, "customize-limit", { what: "looks", max: LIM.looks });
    else {
      const lookIds = new Set<string>();
      for (const l of raw.looks) {
        if (!isObj(l)) { add(c, "customize-field", { field: "looks" }); continue; }
        const id = newId(c, l.id, VALUE_ID_RE, lookIds);
        const label = loc(c, l.label, "looks.label", LIM.label, true);
        if (!id || !label) continue;
        const values: Record<string, unknown> = {};
        let ok = isObj(l.values) && Object.keys(l.values).length > 0;
        if (ok) for (const [k, v] of Object.entries(l.values as Obj)) {
          const ctl = all.find((x) => x.id === k);
          const checked = ctl ? checkValue(ctl, v, { allowUpload: false }) : { ok: false as const };
          if (!checked.ok) { ok = false; break; }
          values[k] = checked.value;
        }
        if (!ok) { add(c, "customize-look", { id }); continue; }
        looks.push({ id, label, values });
      }
    }
  }
  if (c.issues.some((i) => i.severity === "error")) return { decl: null, issues: c.issues };
  if (all.length === 0) { add(c, "customize-field", { field: "customize.groups" }); return { decl: null, issues: c.issues }; }
  return { decl: { version: CUSTOMIZE_VERSION, looks, groups: groups.filter((g) => g.controls.length > 0) }, issues: c.issues };
}

/** Checks a read declaration against the skin it belongs to: pictures are declared assets, text colours parse, variables read by the sheet are declared. */
export function checkCustomizeAgainstSkin(decl: CustomizeDecl, skin: { contract: number; imageFiles: ReadonlySet<string>; css: string }): SkinIssue[] {
  const issues: SkinIssue[] = [];
  const push = (code: string, params: Params, sev?: "error" | "warning") => issues.push(makeIssue(code, params, sev));
  if (skin.contract < 4) push("customize-contract", { need: 4 });
  const declared = new Set<string>();
  for (const g of decl.groups) for (const ctl of g.controls) {
    for (const v of varNamesOf(ctl)) declared.add(v);
    if (ctl.type === "image") for (const a of ctl.alternatives) if (!skin.imageFiles.has(a.file)) push("customize-asset", { file: a.file });
    if (ctl.type === "color") for (const p of ctl.contrast) if (p.kind === "text" && p.text.startsWith("#") && !parseColor(p.text)) push("customize-field", { field: "contrast" });
  }
  // The variables the sheet reads and the controls it declares must match (warnings: a hint for the author, never a refusal).
  const used = new Set([...skin.css.matchAll(/var\(\s*(--sk-cz-[a-z0-9-]+)/g)].map((m) => m[1]!));
  for (const g of decl.groups) for (const ctl of g.controls) if (ctl.type !== "choice" && ctl.type !== "toggle" || varNamesOf(ctl).length) {
    const names = varNamesOf(ctl);
    if (ctl.type === "choice" || (ctl.type === "toggle" && Object.keys({ ...ctl.on, ...ctl.off }).length > 0)) continue;   // these set common tokens, not their own variable
    if (!names.some((n) => used.has(n))) push("customize-unused", { id: ctl.id }, "warning");
  }
  for (const name of used) if (!declared.has(name)) push("customize-undeclared", { name }, "warning");
  return issues;
}
