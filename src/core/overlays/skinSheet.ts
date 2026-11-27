import { parseColor } from "../skins/colorParse";
import { composite, contrastRatio } from "../skins/readability";
import { KEYFRAMES } from "./skinPresets";
import { OV_TOKEN_DEFS } from "./skinTokens";
import { motionCss } from "../animate/spec";
import { fontFaceCss, type OverlayFont } from "./skinFonts";

/**
 * COMPILES AN OVERLAY SKIN INTO THE SHEET THE OVERLAY PAGE INJECTS INTO EACH ELEMENT (core 0.8.0). Pure.
 *
 * The sheet has four layers, from the weakest to the strongest:
 *  1. the tokens (`--ov-*`, with `!important`) on the document root and on the element's `data-ov-region="element"` node: they win over the
 *     element's own `:root{--ov-…}` declaration, so every element that reads the tokens follows the skin without being touched;
 *  2. the core MAPPING of the new tokens onto the reserved parts (font, shadow, accent, case…), emitted ONLY for the tokens the skin defines;
 *  3. the sanitised rules of the skin (already prefixed with `html[data-ov-skin="<id>"]`);
 *  4. the motion presets (keyframes owned by the core, only without a reduced-motion request) and the `data-ov-calm` opt-in rule of reduced motion.
 */
const heading = ["title", "name", "subtitle", "kind", "label", "badge", "tag"];
const bodyParts = ["body", "text", "message", "quote", "content", "summary"];
const containers = ["panel", "card", "bubble", "quote"];
const mutedParts = ["subtitle", "source", "foot", "footer", "author", "kind", "how"];
const sel = (id: string, parts: readonly string[]) => parts.map((p) => `html[data-ov-skin="${id}"] [data-ov-part="${p}"]`).join(",");
const root = (id: string) => `html[data-ov-skin="${id}"],html[data-ov-skin="${id}"] [data-ov-region="element"]`;

export const ANIM_CSS: Record<string, string> = {
  fade: "@keyframes ov-fade{from{opacity:0}to{opacity:1}}",
  rise: "@keyframes ov-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}",
  pop: "@keyframes ov-pop{0%{opacity:0;transform:scale(.92)}70%{opacity:1;transform:scale(1.02)}100%{transform:none}}",
  glow: "@keyframes ov-glow{from{opacity:.94}to{opacity:1}}",
};

export type SkinPayload = { id: string; version: string; css: string; /** (0.47.0) The fonts the skin embarks (contract 6): their `@font-face` rules are the first rules of `css`; the page also hands them to the loader (render.ts). Absent when the skin has none. */ fonts?: OverlayFont[]; /** (0.21.0) The colours the appearance kit takes from this skin (derived when the skin does not set them). */ colors?: SkinColors };

// ── (0.21.0) The skin's colours for the appearance kit, and the site's retouches of a skin ─────────────────────────────────────────────────────
/** All #rrggbb: what an element's "the skin's colour" means. */
export type SkinColors = { solid: string; soft: string; onLight: string; onDark: string; outline: string | null };
const toHex = (k: { r: number; g: number; b: number }) => `#${[k.r, k.g, k.b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
/** The kit colours of a skin: its own optional tokens, else derived (solid: its panel made solid; soft: the same colour, the kit sets the opacity; text pair: #111111 / #ffffff). Null without a panel colour. */
export function skinColors(tokens: Readonly<Record<string, string>>): SkinColors | null {
  const surface = tokens["--ov-surface"] ? parseColor(tokens["--ov-surface"]) : null;
  if (!surface) return null;
  const hex = (name: string): string | null => { const c = tokens[name] ? parseColor(tokens[name]) : null; return c ? toHex(c.a >= 1 ? c : composite(c, BLACK)) : null; };
  const solidRaw = tokens["--ov-surface-solid"] ?? solidSurface(tokens["--ov-surface"]!, tokens["--ov-fg"]);
  const solidC = parseColor(solidRaw)!;
  const solid = toHex(solidC.a >= 1 ? solidC : composite(solidC, BLACK));
  const softC = tokens["--ov-surface-soft"] ? parseColor(tokens["--ov-surface-soft"]) : null;
  return { solid, soft: softC ? toHex(softC) : toHex(surface), onLight: hex("--ov-fg-on-light") ?? "#111111", onDark: hex("--ov-fg-on-dark") ?? "#ffffff", outline: hex("--ov-outline") };
}

export const TWEAK_FONTS = ["system", "serif", "rounded", "condensed", "mono", "typewriter", "display"] as const;
export type TweakFont = (typeof TWEAK_FONTS)[number];
const TWEAK_FONT_STACKS: Record<TweakFont, string> = {
  system: 'system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "Varela Round", "Nunito", system-ui, sans-serif',
  condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  typewriter: '"Courier New", Courier, "Nimbus Mono PS", monospace',
  display: 'Didot, "Bodoni MT", "Playfair Display", Georgia, serif',
};
/** The site's retouches of a skin (owner decision 4: for this site only, the shared skin is never changed). Every value is closed: a colour #rrggbb, a font from the list, round or square corners. */
export type SkinTweaks = { accent?: string; surface?: string; font?: TweakFont; corners?: "round" | "square" };
const best = (fg: string, bgs: readonly { r: number; g: number; b: number; a: number }[]) => Math.min(...bgs.map((b) => contrastRatio({ ...parseColor(fg)!, a: 1 }, b)));
/** The tokens a retouch writes over the skin's own, with the text colours that keep 4.5:1 (worst case over white and black when the panel is translucent). */
export function tweakTokens(tokens: Readonly<Record<string, string>>, t: SkinTweaks): Record<string, string> {
  const out: Record<string, string> = {};
  if (t.surface) {
    const own = tokens["--ov-surface"] ? parseColor(tokens["--ov-surface"]) : null;
    const next = { ...parseColor(t.surface)!, a: own ? own.a : 1 };
    out["--ov-surface"] = next.a >= 1 ? t.surface : `rgba(${next.r},${next.g},${next.b},${Math.round(next.a * 100) / 100})`;
    out["--ov-surface-image"] = "none";
    const backs = [composite(next, WHITE), composite(next, BLACK)];
    const fg = tokens["--ov-fg"];
    if (!fg || !parseColor(fg) || best(fg, backs) < 4.5) out["--ov-fg"] = best("#ffffff", backs) >= best("#111111", backs) ? "#ffffff" : "#111111";
    const muted = tokens["--ov-muted"];
    if (muted && parseColor(muted) && best(muted, backs) < 4.5) out["--ov-muted"] = out["--ov-fg"] ?? fg!;
  }
  if (t.accent) {
    out["--ov-accent"] = t.accent;
    const a = { ...parseColor(t.accent)!, a: 1 };
    out["--ov-accent-fg"] = contrastRatio({ r: 255, g: 255, b: 255, a: 1 }, a) >= contrastRatio({ r: 17, g: 17, b: 17, a: 1 }, a) ? "#ffffff" : "#111111";
  }
  if (t.font) { out["--ov-font"] = TWEAK_FONT_STACKS[t.font]; out["--ov-font-heading"] = TWEAK_FONT_STACKS[t.font]; }
  if (t.corners) out["--ov-radius"] = t.corners === "round" ? "12px" : "0px";
  return out;
}

/** The skin's panel colour made solid (the owner chose an opaque background): same colour, alpha 1 when that keeps the text readable, else the colour it was checked over (black under light text, white under dark text). */
export function solidSurface(surface: string, fg: string | undefined): string {
  const c = parseColor(surface), f = fg ? parseColor(fg) : null;
  if (!c || c.a >= 1) return surface;
  const hex = (k: { r: number; g: number; b: number }) => `#${[k.r, k.g, k.b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
  const plain = { ...c, a: 1 };
  if (!f) return hex(plain);
  if (contrastRatio({ ...f, a: 1 }, plain) >= 4.5) return hex(plain);
  const light = f.r * 0.299 + f.g * 0.587 + f.b * 0.114 > 140;
  return hex(composite(c, light ? BLACK : WHITE));
}

/** The opt-in hook of a module element that wants calm behaviour under reduced motion: `data-ov-calm` on the element (it applies to the element and everything in it). */
const calmTargets = (id: string): string => { const r = `html[data-ov-skin="${id}"] [data-ov-calm]`; return [r, `${r} *`, `${r}::before`, `${r}::after`, `${r} *::before`, `${r} *::after`].join(","); };

export function compileSkin(input: { id: string; version: string; tokens: Readonly<Record<string, string>>; css: string; /** (0.47.0) The skin's fonts (skinFonts.ts `overlayFonts`): their `@font-face` rules come first in the sheet. */ fonts?: readonly OverlayFont[]; /** The owner chose an opaque background (core 0.11.0): the skin keeps its colours, its panel is solid. */ opaque?: boolean; /** (0.21.0) The site's retouches, written over the skin's tokens and before its rules. */ tweaks?: SkinTweaks }): SkinPayload {
  const { id } = input;
  const base = input.opaque && input.tokens["--ov-surface"] ? { ...input.tokens, "--ov-surface": solidSurface(input.tokens["--ov-surface"], input.tokens["--ov-fg"]) } : input.tokens;
  const tweaked = input.tweaks && Object.keys(input.tweaks).length ? tweakTokens(base, input.tweaks) : null;
  const tokens: Readonly<Record<string, string>> = tweaked ? { ...base, ...tweaked } : base;
  const has = (n: string) => typeof tokens[n] === "string" && tokens[n] !== "";
  const out: string[] = input.fonts?.length ? input.fonts.map(fontFaceCss) : [];
  const known = OV_TOKEN_DEFS.filter((d) => has(d.name));
  out.push(`${root(id)}{${known.map((d) => `${d.name}:${d.name === "--ov-anim" ? tokens[d.name] : tokens[d.name]}!important`).join(";")}}`);
  const rule = (selector: string, decls: string[]) => { if (decls.length) out.push(`${selector}{${decls.join(";")}}`); };
  if (has("--ov-font")) rule(`${root(id)},${sel(id, [...heading, ...bodyParts, ...containers, "value", "stat", "status", "game", "clock"])}`, ["font-family:var(--ov-font)"]);
  if (has("--ov-font-heading")) rule(sel(id, heading), ["font-family:var(--ov-font-heading)"]);
  if (has("--ov-tracking")) rule(`${root(id)},${sel(id, [...heading, ...bodyParts])}`, ["letter-spacing:var(--ov-tracking)"]);
  if (has("--ov-weight")) rule(sel(id, bodyParts), ["font-weight:var(--ov-weight)"]);
  if (has("--ov-weight-heading")) rule(sel(id, ["title", "name"]), ["font-weight:var(--ov-weight-heading)"]);
  if (has("--ov-heading-transform")) rule(sel(id, ["title", "kind", "badge", "tag", "label"]), ["text-transform:var(--ov-heading-transform)"]);
  if (has("--ov-text-shadow")) rule(sel(id, [...heading, ...bodyParts, "value", "status"]), ["text-shadow:var(--ov-text-shadow)"]);
  if (has("--ov-surface-image")) rule(sel(id, containers), ["background-image:var(--ov-surface-image)"]);
  // The skin owns the pair text / surface: containers always take the skin's surface and text colour (an element that draws its own background would otherwise
  // put the skin's text colour on a colour the skin never checked), and the text parts follow the skin's text colour (the muted parts below override).
  rule(sel(id, containers), ["background-color:var(--ov-surface)", "color:var(--ov-fg)"]);
  rule(sel(id, ["title", "name", "body", "text", "message", "content", "summary", "value", "stat", "list", "label", "status", "game", "clock"]), ["color:var(--ov-fg)"]);
  if (has("--ov-muted")) rule(sel(id, mutedParts), ["color:var(--ov-muted)"]);
  const frame: string[] = [];
  if (has("--ov-border-width")) frame.push("border-style:solid", "border-width:var(--ov-border-width)");
  if (has("--ov-shadow")) frame.push("box-shadow:var(--ov-shadow)");
  rule(sel(id, containers), frame);
  if (has("--ov-accent")) {
    rule(sel(id, ["bar-fill", "dot", "badge"]), ["background-color:var(--ov-accent)"]);
    rule(sel(id, ["stars", "winner"]), ["color:var(--ov-accent)"]);
    if (has("--ov-accent-fg")) rule(sel(id, ["badge"]), ["color:var(--ov-accent-fg)"]);
  }
  // (0.33.0) the motion words (`--ov-dur-*`, `--ov-ease-*`) are defined for a skin whose rules read them; a skin that does not gets a sheet byte-identical to before
  if (/var\(--ov-(dur|ease)-/.test(input.css)) out.push(motionCss(root(id)));
  out.push(input.css);
  const anim = tokens["--ov-anim"];
  if (anim && anim !== "none" && ANIM_CSS[anim]) {
    out.push(ANIM_CSS[anim]!);
    const dur = has("--ov-anim-duration") ? "var(--ov-anim-duration)" : "0.6s";
    // The preset is the skin's own decoration: it exists only when the person has not asked for reduced motion (nothing to cut afterwards, so a module's own
    // animation on the same part is never overridden or cancelled by the core under reduced motion).
    out.push(`@media (prefers-reduced-motion:no-preference){${sel(id, containers)}{animation:ov-${anim} ${dur} ${anim === "glow" ? "ease-in-out 2.4s infinite alternate" : "ease-out both"}}}`);
  }
  // Idle motion presets of contract 3 (their rules are already inside `prefers-reduced-motion: no-preference`): the keyframes belong to the core.
  for (const [name, frames] of Object.entries(KEYFRAMES)) if (input.css.includes(`ov-${name}`)) out.push(frames);
  // Reduced motion: the core cuts ONLY what it generates itself (the entrance / glow preset above and the idle presets, both written inside
  // `prefers-reduced-motion: no-preference`). Module-authored animations and transitions are NOT touched: they carry the timing and the visibility of streamed
  // content (the preference is the streaming PC's, the viewers are the audience). An element opts into calm behaviour with `data-ov-calm`.
  out.push(`@media (prefers-reduced-motion:reduce){${calmTargets(id)}{animation:none!important;transition:none!important}}`);
  const colors = skinColors(tokens);
  return { id, version: input.version, css: out.filter(Boolean).join("\n"), ...(input.fonts?.length ? { fonts: [...input.fonts] } : {}), ...(colors ? { colors } : {}) };
}

export type TokenIssue = { code: "missing" | "contrast" | "no-shadow"; token?: string; ratio?: number; pair?: string };
const WHITE = { r: 255, g: 255, b: 255, a: 1 }, BLACK = { r: 0, g: 0, b: 0, a: 1 };
const worstOver = (fg: string, bg: string): number | null => {
  const f = parseColor(fg), b = parseColor(bg);
  if (!f || !b) return null;
  return Math.min(...[WHITE, BLACK].map((base) => { const back = composite(b, base); return contrastRatio(composite(f, back), back); }));
};

/** Contrast rules of an overlay skin (>= 4.5:1, worst case over a white and a black background for a translucent surface). */
export function checkSkinTokens(tokens: Readonly<Record<string, string>>): TokenIssue[] {
  const out: TokenIssue[] = [];
  for (const n of ["--ov-fg", "--ov-surface"]) if (!tokens[n]) out.push({ code: "missing", token: n });
  if (out.length) return out;
  const surface = parseColor(tokens["--ov-surface"]!)!;
  if (surface.a < 0.2) {
    // Text sits straight on the stream: it needs a shadow, and the text must contrast with the shadow colour it draws.
    if (!tokens["--ov-text-shadow"] || tokens["--ov-text-shadow"] === "none") out.push({ code: "no-shadow", token: "--ov-text-shadow" });
    else {
      const shadowColor = tokens["--ov-text-shadow"].split(",")[0]!.trim().split(/\s+(?![^(]*\))/).find((w) => parseColor(w));
      const r = shadowColor ? worstOver(tokens["--ov-fg"]!, shadowColor.replace(/^(.*)$/, (c) => { const p = parseColor(c)!; return `rgba(${p.r},${p.g},${p.b},1)`; })) : null;
      if (r !== null && r < 4.5) out.push({ code: "contrast", pair: "--ov-fg / --ov-text-shadow", ratio: Math.round(r * 10) / 10 });
    }
  } else {
    const r = worstOver(tokens["--ov-fg"]!, tokens["--ov-surface"]!);
    if (r !== null && r < 4.5) out.push({ code: "contrast", pair: "--ov-fg / --ov-surface", ratio: Math.round(r * 10) / 10 });
    if (tokens["--ov-muted"]) { const m = worstOver(tokens["--ov-muted"], tokens["--ov-surface"]!); if (m !== null && m < 4.5) out.push({ code: "contrast", pair: "--ov-muted / --ov-surface", ratio: Math.round(m * 10) / 10 }); }
  }
  // (0.21.0) The optional kit colours: the skin's text on its light and solid panels, and its text pair on a light and a dark panel.
  for (const n of ["--ov-surface-soft", "--ov-surface-solid"]) if (tokens[n]) {
    const r = worstOver(tokens["--ov-fg"]!, tokens[n]!);
    if (r !== null && r < 4.5) out.push({ code: "contrast", pair: `--ov-fg / ${n}`, ratio: Math.round(r * 10) / 10 });
  }
  for (const [n, back] of [["--ov-fg-on-light", "#ffffff"], ["--ov-fg-on-dark", "#000000"]] as const) if (tokens[n]) {
    const r = worstOver(tokens[n]!, back);
    if (r !== null && r < 4.5) out.push({ code: "contrast", pair: `${n} / ${back}`, ratio: Math.round(r * 10) / 10 });
  }
  if (tokens["--ov-accent"] && tokens["--ov-accent-fg"]) {
    const r = worstOver(tokens["--ov-accent-fg"], tokens["--ov-accent"]);
    if (r !== null && r < 4.5) out.push({ code: "contrast", pair: "--ov-accent-fg / --ov-accent", ratio: Math.round(r * 10) / 10 });
  }
  return out;
}
