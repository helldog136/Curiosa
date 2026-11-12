import { parseColor } from "../skins/colorParse";
import { lengthPx } from "./skinTokens";

/**
 * CLOSED PRESETS OF OVERLAY SKINS, contract 3 (core 0.9.0). Pure.
 *
 * A skin rule may use six extra declarations whose value is a NAME from a closed list (plus an optional bounded number and colour). The core expands each name into
 * fixed CSS written here: the skin never supplies the CSS, so there is no way to write a clip-path, a pseudo-element or an animation of its own. Everything is
 * decoration or shape: no text is added (`content` is always empty), nothing is hidden, decorations never catch the pointer, motion only runs when the person
 * has not asked for reduced motion (the expansion is wrapped in `prefers-reduced-motion: no-preference`).
 *
 *   ov-shape:  slanted | slanted-both | hexagon | chevron | ticket | notch | ribbon | pill   [cut 4-28px] [flush]
 *   ov-frame:  double | dashed | inset | glow | thick                                         [colour]
 *   ov-deco:   up to 2 of brackets | hazard | scanlines | grain | halftone | glow | tape | stamp | rings | stripe | flashlight | radar | shimmer   [colour]
 *   ov-motion: drift | flicker | pulse | float
 *   ov-font:   stencil | handwritten | typewriter | condensed | wide | display | rounded | mono | serif
 *   ov-text:   outline | glow | emboss | engrave | lift                                       [colour]
 */
export const SHAPES = ["slanted", "slanted-both", "hexagon", "chevron", "ticket", "notch", "ribbon", "pill"] as const;
export const FRAMES = ["double", "dashed", "inset", "glow", "thick"] as const;
export const DECOS = ["brackets", "hazard", "scanlines", "grain", "halftone", "glow", "tape", "stamp", "rings", "stripe", "flashlight", "radar", "shimmer"] as const;
export const MOTIONS = ["drift", "flicker", "pulse", "float"] as const;
export const FONTS = ["stencil", "handwritten", "typewriter", "condensed", "wide", "display", "rounded", "mono", "serif"] as const;
export const TEXTS = ["outline", "glow", "emboss", "engrave", "lift"] as const;
export const PRESET_PROPS = ["ov-shape", "ov-frame", "ov-deco", "ov-motion", "ov-font", "ov-text"] as const;
export type PresetProp = (typeof PRESET_PROPS)[number];
export const MAX_DECOS = 2;

const FONT_STACKS: Record<(typeof FONTS)[number], string> = {
  stencil: '"Stencil Std", Stencil, Impact, "Arial Black", sans-serif',
  handwritten: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive',
  typewriter: '"Courier New", Courier, "Nimbus Mono PS", monospace',
  condensed: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
  wide: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  display: 'Didot, "Bodoni MT", "Playfair Display", Georgia, serif',
  rounded: 'ui-rounded, "Varela Round", "Nunito", system-ui, sans-serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  serif: 'Georgia, "Times New Roman", serif',
};

const colorOk = (w: string): boolean => !!parseColor(w) || /^var\(--ov-(accent|fg|border|muted|accent-fg)\)$/.test(w);
/** `name [Npx] [colour]` parsed against a closed list. */
function parseOne(v: string, names: readonly string[], opts: { cut?: boolean; color?: boolean; flush?: boolean }): { name: string; cut: number; color: string; flush: boolean } | null {
  const parts = v.trim().split(/\s+(?![^(]*\))/);
  const name = parts.shift() ?? "";
  if (!names.includes(name)) return null;
  let cut = 14, color = "var(--ov-accent, #e8a23b)", flush = false;
  for (const p of parts) {
    if (opts.flush && p === "flush" && !flush) { flush = true; continue; }
    const px = lengthPx(p);
    if (opts.cut && px !== null && /px$/.test(p) && px >= 4 && px <= 28 && cut === 14) { cut = px; continue; }
    if (opts.color && colorOk(p)) { color = p; continue; }
    return null;
  }
  return { name, cut, color, flush };
}

/**
 * A decoration is one or two BACKGROUND LAYERS of the element itself (no pseudo-element, no `position`, so it can never move or cover an element's content: the
 * layers paint behind the text). `layers` are aligned lists for background-image / position / size / repeat; `motion` names idle animations applied as one `animation` list.
 */
export type Layer = { image: string; pos: string; size: string; repeat: string };
export type Expansion = { decls: string[]; layers: Layer[]; motion: string[] };
export const emptyExpansion = (): Expansion => ({ decls: [], layers: [], motion: [] });
export const MAX_LAYERS = 12;

const CLIP = (c: number): Record<string, string> => ({
  slanted: `polygon(0 0,100% 0,calc(100% - ${c}px) 100%,0 100%)`,
  "slanted-both": `polygon(${c}px 0,100% 0,calc(100% - ${c}px) 100%,0 100%)`,
  hexagon: `polygon(${c}px 0,calc(100% - ${c}px) 0,100% 50%,calc(100% - ${c}px) 100%,${c}px 100%,0 50%)`,
  chevron: `polygon(0 0,calc(100% - ${c}px) 0,100% 50%,calc(100% - ${c}px) 100%,0 100%,${c}px 50%)`,
  ticket: `polygon(0 0,100% 0,100% calc(50% - ${c / 2}px),calc(100% - ${c / 2}px) 50%,100% calc(50% + ${c / 2}px),100% 100%,0 100%,0 calc(50% + ${c / 2}px),${c / 2}px 50%,0 calc(50% - ${c / 2}px))`,
  notch: `polygon(${c}px 0,calc(100% - ${c}px) 0,100% ${c}px,100% calc(100% - ${c}px),calc(100% - ${c}px) 100%,${c}px 100%,0 calc(100% - ${c}px),0 ${c}px)`,
  ribbon: `polygon(0 0,100% 0,calc(100% - ${c}px) 50%,100% 100%,0 100%)`,
});
const PAD = (name: string, c: number): string => {
  const side = Math.round(c * 0.7);
  if (name === "slanted" || name === "ribbon") return `padding-right:calc(${side}px + 0.6em)`;
  if (name === "pill") return "padding-left:1em;padding-right:1em";
  return `padding-left:calc(${side}px + 0.5em);padding-right:calc(${side}px + 0.5em)`;
};

/** Expands one declaration of the closed list; null = the value is not understood (the rule is refused with a precise code). */
export function expandPreset(prop: PresetProp, value: string, into: Expansion): boolean {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v || v.length > 120 || /[;{}<>\\"']|url\s*\(|!important|@/i.test(v)) return false;
  if (prop === "ov-shape") {
    const p = parseOne(v, SHAPES, { cut: true, flush: true });
    if (!p) return false;
    // `flush`: no extra inner padding (for small things that hold no text: avatars, bars).
    if (p.name === "pill") { into.decls.push("border-radius:999px"); if (!p.flush) into.decls.push(PAD("pill", p.cut)); return true; }
    into.decls.push(`clip-path:${CLIP(p.cut)[p.name]}`); if (!p.flush) into.decls.push(PAD(p.name, p.cut));
    return true;
  }
  if (prop === "ov-frame") {
    const p = parseOne(v, FRAMES, { color: true });
    if (!p) return false;
    const c = p.color;
    into.decls.push(
      p.name === "double" ? `outline:1px solid ${c};outline-offset:-5px`
        : p.name === "dashed" ? `outline:1px dashed ${c};outline-offset:-4px`
          : p.name === "inset" ? `box-shadow:inset 0 0 0 3px ${c}`
            : p.name === "thick" ? `outline:3px solid ${c};outline-offset:-3px`
              : `box-shadow:0 0 0 1px ${c},0 0 20px color-mix(in srgb,${c} 55%,transparent)`,
    );
    return true;
  }
  if (prop === "ov-font") {
    const p = parseOne(v, FONTS, {});
    if (!p) return false;
    into.decls.push(`font-family:${FONT_STACKS[p.name as keyof typeof FONT_STACKS]}`);
    if (p.name === "condensed") into.decls.push("font-stretch:condensed");
    if (p.name === "wide") into.decls.push("font-stretch:expanded", "letter-spacing:0.12em");
    return true;
  }
  if (prop === "ov-text") {
    const p = parseOne(v, TEXTS, { color: true });
    if (!p) return false;
    const c = p.color;
    into.decls.push(
      p.name === "outline" ? `-webkit-text-stroke:1px ${c};paint-order:stroke fill`
        : p.name === "glow" ? `text-shadow:0 0 6px ${c},0 0 14px color-mix(in srgb,${c} 60%,transparent)`
          : p.name === "emboss" ? `text-shadow:0 1px 0 rgba(255,255,255,0.35),0 -1px 0 rgba(0,0,0,0.5)`
            : p.name === "engrave" ? `text-shadow:0 1px 0 rgba(255,255,255,0.25),0 -1px 1px rgba(0,0,0,0.6)`
              : "text-shadow:0 2px 0 rgba(0,0,0,0.55),0 6px 10px rgba(0,0,0,0.35)",
    );
    return true;
  }
  if (prop === "ov-motion") {
    const p = parseOne(v, MOTIONS, {});
    if (!p) return false;
    into.motion.push(p.name);
    return true;
  }
  // ov-deco: up to two names, separated by commas.
  const items = v.split(",").map((x) => x.trim()).filter(Boolean);
  if (items.length < 1 || items.length > MAX_DECOS) return false;
  for (const item of items) {
    const p = parseOne(item, DECOS, { color: true });
    if (!p) return false;
    const c = p.color;
    const L = (image: string, pos: string, size: string, repeat = "no-repeat") => into.layers.push({ image, pos, size, repeat });
    const solid = (col: string) => `linear-gradient(${col},${col})`;
    switch (p.name) {
      case "brackets":
        for (const [pos, w, h] of [["0 0", "16px", "2px"], ["0 0", "2px", "16px"], ["100% 0", "16px", "2px"], ["100% 0", "2px", "16px"], ["0 100%", "16px", "2px"], ["0 100%", "2px", "16px"], ["100% 100%", "16px", "2px"], ["100% 100%", "2px", "16px"]] as const) L(solid(c), pos, `${w} ${h}`);
        break;
      case "hazard": L(`repeating-linear-gradient(135deg,${c} 0 8px,#101010 8px 16px)`, "0 100%", "100% 7px"); break;
      case "scanlines": L("repeating-linear-gradient(0deg,rgba(0,0,0,0.2) 0 1px,transparent 1px 3px)", "0 0", "100% 100%", "repeat"); break;
      case "grain": L("repeating-conic-gradient(rgba(255,255,255,0.08) 0 25%,rgba(0,0,0,0.08) 0 50%)", "0 0", "3px 3px", "repeat"); break;
      case "halftone": L(`radial-gradient(circle,color-mix(in srgb,${c} 22%,transparent) 1.3px,transparent 1.8px)`, "100% 0", "8px 8px", "repeat"); break;
      case "glow": into.decls.push(`box-shadow:0 0 22px 3px color-mix(in srgb,${c} 60%,transparent)`); break;
      case "tape": L("linear-gradient(rgba(255,238,170,0.85),rgba(255,238,170,0.85))", "50% 0", "56px 12px"); break;
      case "stamp": L(`radial-gradient(circle at 50% 50%,transparent 9px,${c} 9px 11px,transparent 11px)`, "calc(100% - 8px) 8px", "26px 26px"); break;
      case "rings": L(`repeating-radial-gradient(circle at 100% 100%,transparent 0 14px,color-mix(in srgb,${c} 30%,transparent) 14px 15px)`, "0 0", "100% 100%"); break;
      case "stripe": L(solid(c), "0 0", "6px 100%"); break;
      case "flashlight": L(`radial-gradient(ellipse 70% 120% at 0% 0%,color-mix(in srgb,${c} 38%,transparent),transparent 70%)`, "0 0", "100% 100%"); break;
      case "radar": L(`conic-gradient(from 200deg at 100% 100%,transparent 0deg,color-mix(in srgb,${c} 45%,transparent) 40deg,transparent 41deg)`, "0 0", "100% 100%"); L(`repeating-radial-gradient(circle at 100% 100%,transparent 0 16px,color-mix(in srgb,${c} 35%,transparent) 16px 17px)`, "0 0", "100% 100%"); break;
      case "shimmer": L("linear-gradient(100deg,transparent 40%,rgba(255,255,255,0.22) 50%,transparent 60%)", "var(--ov-shimmer-x,150%) 0", "250% 100%"); into.motion.push("shimmer"); break;
    }
  }
  if (into.layers.length > MAX_LAYERS) return false;
  return true;
}

/** The decorations of a rule as the four aligned background lists. */
export function layerDecls(layers: readonly Layer[]): string[] {
  if (!layers.length) return [];
  return [`background-image:${layers.map((l) => l.image).join(",")}`, `background-position:${layers.map((l) => l.pos).join(",")}`, `background-size:${layers.map((l) => l.size).join(",")}`, `background-repeat:${layers.map((l) => l.repeat).join(",")}`];
}

/** The `animation` list of the idle motions (each name once; shimmer sweeps a registered custom property so it never touches the other layers). */
export const MOTION_TIMING: Record<string, string> = { drift: "9s ease-in-out infinite", float: "7s ease-in-out infinite", pulse: "2.6s ease-in-out infinite", flicker: "3.4s steps(1,end) infinite", shimmer: "5.5s ease-in-out infinite" };
export const KEYFRAMES: Record<string, string> = {
  drift: "@keyframes ov-drift{0%,100%{translate:0 0}50%{translate:0 -3px}}",
  float: "@keyframes ov-float{0%,100%{translate:0 0;rotate:0deg}50%{translate:2px -3px;rotate:0.4deg}}",
  pulse: "@keyframes ov-pulse{0%,100%{scale:1}50%{scale:1.015}}",
  flicker: "@keyframes ov-flicker{0%,100%{opacity:1}7%{opacity:0.9}9%{opacity:1}47%{opacity:1}49%{opacity:0.88}52%{opacity:1}83%{opacity:0.94}86%{opacity:1}}",
  shimmer: "@property --ov-shimmer-x{syntax:'<percentage>';inherits:false;initial-value:150%}@keyframes ov-shimmer{0%{--ov-shimmer-x:150%}60%,100%{--ov-shimmer-x:-50%}}",
};
