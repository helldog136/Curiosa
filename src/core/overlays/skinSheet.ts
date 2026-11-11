import { parseColor } from "../skins/colorParse";
import { composite, contrastRatio } from "../skins/readability";
import { OV_TOKEN_DEFS } from "./skinTokens";

/**
 * COMPILES AN OVERLAY SKIN INTO THE SHEET THE OVERLAY PAGE INJECTS INTO EACH ELEMENT (core 0.8.0). Pure.
 *
 * The sheet has four layers, from the weakest to the strongest:
 *  1. the tokens (`--ov-*`, with `!important`) on the document root and on the element's `data-ov-region="element"` node: they win over the
 *     element's own `:root{--ov-…}` declaration, so every element that reads the tokens follows the skin without being touched;
 *  2. the core MAPPING of the new tokens onto the reserved parts (font, shadow, accent, case…), emitted ONLY for the tokens the skin defines;
 *  3. the sanitised rules of the skin (already prefixed with `html[data-ov-skin="<id>"]`);
 *  4. the motion presets (keyframes owned by the core) and the reduced-motion rule: no motion at all for people who ask for it.
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

export type SkinPayload = { id: string; version: string; css: string };

export function compileSkin(input: { id: string; version: string; tokens: Readonly<Record<string, string>>; css: string }): SkinPayload {
  const { id, tokens } = input;
  const has = (n: string) => typeof tokens[n] === "string" && tokens[n] !== "";
  const out: string[] = [];
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
  if (has("--ov-muted")) rule(sel(id, mutedParts), ["color:var(--ov-muted)"]);
  if (has("--ov-surface-image")) rule(sel(id, containers), ["background-image:var(--ov-surface-image)"]);
  const frame: string[] = [];
  if (has("--ov-border-width")) frame.push("border-style:solid", "border-width:var(--ov-border-width)");
  if (has("--ov-shadow")) frame.push("box-shadow:var(--ov-shadow)");
  rule(sel(id, containers), frame);
  if (has("--ov-accent")) {
    rule(sel(id, ["bar-fill", "dot", "badge"]), ["background-color:var(--ov-accent)"]);
    rule(sel(id, ["stars", "winner"]), ["color:var(--ov-accent)"]);
    if (has("--ov-accent-fg")) rule(sel(id, ["badge"]), ["color:var(--ov-accent-fg)"]);
  }
  out.push(input.css);
  const anim = tokens["--ov-anim"];
  if (anim && anim !== "none" && ANIM_CSS[anim]) {
    out.push(ANIM_CSS[anim]!);
    const dur = has("--ov-anim-duration") ? "var(--ov-anim-duration)" : "0.6s";
    rule(sel(id, containers), [`animation:ov-${anim} ${dur} ${anim === "glow" ? "ease-in-out 2.4s infinite alternate" : "ease-out both"}`]);
    out.push(`@media (prefers-reduced-motion:reduce){html[data-ov-skin="${id}"] *{animation:none!important;transition:none!important}}`);
  }
  return { id, version: input.version, css: out.filter(Boolean).join("\n") };
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
  if (tokens["--ov-accent"] && tokens["--ov-accent-fg"]) {
    const r = worstOver(tokens["--ov-accent-fg"], tokens["--ov-accent"]);
    if (r !== null && r < 4.5) out.push({ code: "contrast", pair: "--ov-accent-fg / --ov-accent", ratio: Math.round(r * 10) / 10 });
  }
  return out;
}
