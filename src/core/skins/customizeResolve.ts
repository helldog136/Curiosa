/**
 * APPLYING CUSTOMIZATION VALUES (docs/SKINS.md "Customization"): stored values in, validated `--sk-cz-<id>` variables out. PURE (no file, database or network access).
 *
 * Nothing the owner typed (or a stored value, or an AI call) ever reaches a style sheet as text: a colour is parsed and written back as `#rrggbb`, a number is
 * clamped and formatted with a unit from a closed list, a choice or a picture is an id looked up in the skin's own declaration, an uploaded picture is a server-made
 * file name matching a strict pattern. A last filter (`safeVar`) refuses any variable whose name or value does not have one of a few exact shapes.
 * Defaults are ALWAYS written, so an untouched skin renders exactly as it was shipped.
 *
 * Legibility is never enforced here (owner decision): `computeSignals` only REPORTS a risk, for the page to show; no value is changed because of it.
 */
import { parseColor } from "./colorParse";
import { contrastRatio, relativeLuminance } from "./readability";
import { hexToRgb, oklchToRgb, rgbToHex, rgbToOklch } from "./customizeColor";
import { CZ_VAR_RE, type ColorControl, type Control, type CustomizeDecl, type ImageControl, type Mode, type SliderControl, type StoredCustom, type TokenMap, type UploadedPicture } from "./customizeSpec";

const UPLOAD_FILE_RE = /^[0-9a-f-]{36}\.(webp|png|svg)$/;
const STILL_FILE_RE = /^[0-9a-f-]{36}\.(webp|png)$/;
const FREE_HEX_RE = /^#[0-9a-fA-F]{6}$/;

const SAFE_VALUES: readonly RegExp[] = [
  /^#[0-9a-f]{6}$/,
  /^-?\d{1,6}(?:\.\d{1,4})?(?:px|rem|%|deg|ms)?$/,
  /^url\("\/skins\/[a-z][a-z0-9-]{1,40}\/[0-9A-Za-z.+-]{1,40}\/images\/[a-z0-9][a-z0-9._-]{0,63}\.(?:png|webp|avif|jpe?g|svg)"\)$/,
  /^url\("\/uploads\/[0-9a-f-]{36}\.(?:webp|png|svg)"\)$/,
  /^(?:none|cover|contain|auto|repeat|no-repeat)$/,
  /^\d{1,3}% \d{1,3}%$/,
];
/** The last line of defence: a variable is written only if its name and its value have one of the exact shapes above. */
export const safeVar = (name: string, value: string): boolean => CZ_VAR_RE.test(name) && SAFE_VALUES.some((re) => re.test(value));

const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const clamp = (n: number, a: number, b: number): number => Math.min(b, Math.max(a, n));

/** A free colour pulled inside the range the skin declares (lightness and chroma; the hue is free). A colour already inside is returned as it is. */
function clampColor(hex: string, l: [number, number], c: [number, number]): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const k = rgbToOklch(rgb);
  const eps = 0.0005;
  if (k.l >= l[0] - eps && k.l <= l[1] + eps && k.c >= c[0] - eps && k.c <= c[1] + eps) return hex;
  return rgbToHex(oklchToRgb({ l: clamp(k.l, l[0], l[1]), c: clamp(k.c, c[0], c[1]), h: k.h }));
}
function darkOf(hex: string, ctl: ColorControl): string {
  const dk = ctl.custom?.dark;
  if (!dk) return hex;
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const k = rgbToOklch(rgb);
  return rgbToHex(oklchToRgb({ ...k, l: clamp(k.l, dk.l[0], dk.l[1]) }));
}

/** The two colours (light, dark) a colour control's value stands for. */
export function colorOf(ctl: ColorControl, value: string): { light: string; dark: string } {
  const s = ctl.palette.find((p) => p.id === value);
  if (s) return { light: s.light, dark: s.dark };
  const light = ctl.custom ? clampColor(value, ctl.custom.l, ctl.custom.c) : value;
  return { light, dark: darkOf(light, ctl) };
}

export type Checked = { ok: true; value: unknown } | { ok: false };

/** One value against its control: the normalised value, or refusal. Never throws. */
export function checkValue(ctl: Control, value: unknown, opts: { allowUpload: boolean }): Checked {
  switch (ctl.type) {
    case "color": {
      if (typeof value !== "string") return { ok: false };
      if (ctl.palette.some((p) => p.id === value)) return { ok: true, value };
      if (ctl.custom && FREE_HEX_RE.test(value)) return { ok: true, value: clampColor(value.toLowerCase(), ctl.custom.l, ctl.custom.c) };
      return { ok: false };
    }
    case "choice": return typeof value === "string" && ctl.values.some((v) => v.id === value) ? { ok: true, value } : { ok: false };
    case "toggle": return typeof value === "boolean" ? { ok: true, value } : { ok: false };
    case "slider": {
      const n = typeof value === "number" ? value : NaN;
      if (!Number.isFinite(n)) return { ok: false };
      const snapped = ctl.min + Math.round((clamp(n, ctl.min, ctl.max) - ctl.min) / ctl.step) * ctl.step;
      return { ok: true, value: round4(clamp(snapped, ctl.min, ctl.max)) };
    }
    case "image": {
      if (typeof value === "string") return value === "none" || ctl.alternatives.some((a) => a.id === value) ? { ok: true, value } : { ok: false };
      if (!opts.allowUpload || !ctl.upload || !value || typeof value !== "object" || Array.isArray(value)) return { ok: false };
      const v = value as Record<string, unknown>;
      if (typeof v.upload !== "string" || !UPLOAD_FILE_RE.test(v.upload)) return { ok: false };
      const out: UploadedPicture = { upload: v.upload };
      if (v.still !== undefined) { if (typeof v.still !== "string" || !STILL_FILE_RE.test(v.still)) return { ok: false }; out.still = v.still; }
      if (v.lum !== undefined) {
        if (!Array.isArray(v.lum) || v.lum.length !== 2 || !v.lum.every((n) => typeof n === "number" && n >= 0 && n <= 1)) return { ok: false };
        out.lum = [round4(v.lum[0] as number), round4(v.lum[1] as number)];
      }
      return { ok: true, value: out };
    }
  }
}

export const defaultOf = (ctl: Control): unknown => ctl.default;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export type Resolved = {
  /** Every control with its effective value (defaults included). */
  values: Record<string, unknown>;
  /** Ids whose value differs from the skin's default. */
  changed: string[];
  /** Stored keys that no control (or former id) claims, or whose value no longer fits: ignored here, kept in storage until the next save. */
  dropped: string[];
  /** Uploaded pictures whose file is gone: the skin's own picture shows instead. */
  missing: string[];
  /** Common `--sk-*` tokens set by the chosen values and toggles (they join the token layer of the skin's own options). */
  tokens: TokenMap;
  vars: Record<Mode, Record<string, string>>;
  /** Variables that are swapped for a still picture when the visitor asks for less motion (animated pictures only). */
  stills: Record<string, string>;
};

export type ResolveContext = { skinId: string; version: string; fileExists?: (name: string) => boolean };

const FIT: Record<ImageControl["fit"], { size: string; repeat: string }> = { cover: { size: "cover", repeat: "no-repeat" }, contain: { size: "contain", repeat: "no-repeat" }, tile: { size: "auto", repeat: "repeat" } };

function pictureUrl(ctl: ImageControl, value: unknown, ctx: ResolveContext, missing: string[]): { url: string; still?: string } {
  if (typeof value === "string") {
    const alt = ctl.alternatives.find((a) => a.id === value);
    return alt ? { url: `url("/skins/${ctx.skinId}/${ctx.version}/${alt.file}")` } : { url: "none" };
  }
  const pic = value as UploadedPicture;
  if (ctx.fileExists && !ctx.fileExists(pic.upload)) {
    missing.push(ctl.id);
    return pictureUrl(ctl, ctl.default, ctx, []);
  }
  return { url: `url("/uploads/${pic.upload}")`, ...(pic.still && (!ctx.fileExists || ctx.fileExists(pic.still)) ? { still: `url("/uploads/${pic.still}")` } : {}) };
}

/** Stored values and the skin's declaration in; the effective values and the variables out. Defaults are always present. */
export function resolveValues(decl: CustomizeDecl, stored: StoredCustom | null | undefined, ctx: ResolveContext): Resolved {
  const raw = stored && typeof stored === "object" && stored.values && typeof stored.values === "object" && !Array.isArray(stored.values) ? stored.values : {};
  const claimed = new Set<string>();
  const out: Resolved = { values: {}, changed: [], dropped: [], missing: [], tokens: {}, vars: { light: {}, dark: {} }, stills: {} };
  const put = (name: string, value: string, modes: Mode[] = ["light", "dark"]) => { if (safeVar(name, value)) for (const m of modes) out.vars[m][name] = value; };
  for (const g of decl.groups) for (const ctl of g.controls) {
    const key = [ctl.id, ...ctl.was].find((k) => Object.hasOwn(raw, k));
    let value: unknown = ctl.default;
    if (key !== undefined) {
      claimed.add(key);
      const r = checkValue(ctl, raw[key], { allowUpload: true });
      if (r.ok) value = r.value; else out.dropped.push(key);
    }
    out.values[ctl.id] = value;
    if (!same(value, ctl.default)) out.changed.push(ctl.id);
    const name = `--sk-cz-${ctl.id}`;
    switch (ctl.type) {
      case "color": {
        const c = colorOf(ctl, value as string);
        put(name, c.light, ["light"]); put(name, c.dark, ["dark"]);
        break;
      }
      case "slider": put(name, `${value}${(ctl as SliderControl).unit}`); break;
      case "toggle": {
        put(name, value ? "1" : "0");
        Object.assign(out.tokens, value ? ctl.on : ctl.off);
        break;
      }
      case "choice": Object.assign(out.tokens, ctl.values.find((v) => v.id === value)?.tokens ?? {}); break;
      case "image": {
        const p = pictureUrl(ctl, value, ctx, out.missing);
        put(name, p.url);
        put(`${name}-size`, FIT[ctl.fit].size); put(`${name}-repeat`, FIT[ctl.fit].repeat); put(`${name}-pos`, "50% 50%");
        if (p.still && safeVar(name, p.still)) out.stills[name] = p.still;
        break;
      }
    }
  }
  for (const k of Object.keys(raw)) if (!claimed.has(k)) out.dropped.push(k);
  return out;
}

// ── Legibility: a signal, never a correction ────────────────────────────────────────────────────────────────────

export type Signal = { control: string; mode: Mode; ratio: number; min: number };

const lumOfHex = (hex: string): number | null => { const c = parseColor(hex); return c ? relativeLuminance(c) : null; };
const ratioOf = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The legibility risks of the CHANGED controls, per mode, on the colours the page really shows (`effective`: the composed tokens of each mode).
 * Computed from the pairs the skin declares ("text of this colour sits on this control" or "this control sits on the page"). A control left at the skin's own
 * value is never reported: that is the author's choice. Nothing here changes a value.
 */
export function computeSignals(decl: CustomizeDecl, resolved: Resolved, effective: Partial<Record<Mode, Record<string, string>>>): Signal[] {
  const out: Signal[] = [];
  const modes: Mode[] = (["light", "dark"] as const).filter((m) => effective[m] !== undefined);
  const resolveRef = (ref: string, mode: Mode): ReturnType<typeof parseColor> => (ref.startsWith("#") ? parseColor(ref) : parseColor(effective[mode]?.[ref] ?? ""));
  for (const g of decl.groups) for (const ctl of g.controls) {
    if (!resolved.changed.includes(ctl.id)) continue;
    if (ctl.type === "color") {
      for (const mode of modes) {
        const mine = parseColor(resolved.vars[mode][`--sk-cz-${ctl.id}`] ?? "");
        if (!mine) continue;
        for (const pair of ctl.contrast) {
          const others = pair.kind === "text" ? [pair.text] : pair.against;
          let worst: number | null = null;
          for (const ref of others) { const o = resolveRef(ref, mode); if (o && o.a >= 1) { const r = contrastRatio(o, mine); if (worst === null || r < worst) worst = r; } }
          if (worst !== null && worst < pair.min) out.push({ control: ctl.id, mode, ratio: Math.floor(worst * 10) / 10, min: pair.min });
        }
      }
    } else if (ctl.type === "image" && ctl.textOver) {
      const v = resolved.values[ctl.id] as UploadedPicture | string;
      if (typeof v === "object" && v.lum) {
        const text = lumOfHex(ctl.textOver.color);
        if (text !== null) {
          // light text is read against the brightest part of the picture, dark text against the darkest
          const worstBg = text > 0.5 ? v.lum[1] : v.lum[0];
          const r = ratioOf(text, worstBg);
          if (r < ctl.textOver.min) for (const mode of modes.length ? modes : (["light"] as Mode[])) out.push({ control: ctl.id, mode, ratio: Math.floor(r * 10) / 10, min: ctl.textOver.min });
        }
      }
    }
  }
  return out;
}
