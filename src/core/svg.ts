/**
 * SANITISING OF AN SVG DRAWING (page backgrounds, logos, images sent by an assistant).
 *
 * An SVG can describe any decoration (gradients, patterns, silhouettes) and is made in a drawing tool. But it is code: only what is known and
 * harmless gets through. The drawing is read element by element and re-written from what was recognised (never returned as received), and it is
 * used as an IMAGE (never inserted in the page: no script runs in it, no outside resource is loaded).
 *
 * Accepted: shapes, paths, gradients, patterns, masks, clips, blur/colour filters, `use` pointing to an `#id` of the same drawing, and the safe
 * accessibility features: `role` (img, presentation, none, graphics-document), `aria-label`, `aria-labelledby`, `aria-hidden`, `focusable`, and
 * `<title>` / `<desc>` holding plain text only (length-capped, no markup, no entity, written back escaped).
 * Refused (with a precise message): scripts, `style` elements, any other text, images, `foreignObject`, animations, event attributes, outside links,
 * `url(...)` other than `url(#id)`, XML entities, DOCTYPE declarations.
 * Colours: `#rrggbb`, simple names, `none`, or a theme token written `{accent}`, `{bg}`, `{fg}`, `{muted}`, `{surface}`, `{line}`.
 */
export const MAX_SVG_BYTES = 24_000;
const MAX_ELEMENTS = 1500;
/** Wider limits for a logo (a detailed drawing weighs more than a background pattern). */
export const LOGO_SVG_LIMITS = { maxBytes: 300_000, maxElements: 6000 } as const;

const ELEMENTS = new Set([
  "svg", "g", "defs", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "linearGradient", "radialGradient", "stop",
  "pattern", "mask", "clipPath", "use", "filter", "feGaussianBlur", "feOffset", "feFlood", "feComposite", "feMerge", "feMergeNode", "feColorMatrix", "feBlend",
  "title", "desc",
]);
/** `<title>` and `<desc>`: plain text only, at most this many characters. */
const TEXT_ELEMENTS: Record<string, number> = { title: 200, desc: 500 };
/** The only accepted `role` values (what a logo needs; nothing that makes the drawing behave like a control). */
const ROLES = new Set(["img", "presentation", "none", "graphics-document"]);
/** Characters never accepted in accessibility text: markup, entities, quotes, control and invisible/bidirectional characters. */
const UNSAFE_TEXT = /[\p{C}<>&"]/u;
const MAX_LABEL = 120;
/** Accessibility attributes: each one has its own strict check (they carry text, not drawing values). */
const A11Y: Record<string, (value: string) => string | null> = {
  "role": (v) => (ROLES.has(v) ? null : `the role “${v.slice(0, 30)}” is not accepted (${[...ROLES].join(", ")})`),
  "aria-label": (v) => (v.length > MAX_LABEL ? `aria-label is too long (${MAX_LABEL} characters at most)` : UNSAFE_TEXT.test(v) ? "aria-label must be plain text (no markup, entity, quote or control character)" : null),
  "aria-labelledby": (v) => (v.length <= 200 && /^[\w-]+(\s+[\w-]+)*$/.test(v) ? null : "aria-labelledby must list ids of this drawing, separated by spaces"),
  "aria-hidden": (v) => (v === "true" || v === "false" ? null : "aria-hidden must be true or false"),
  "focusable": (v) => (v === "true" || v === "false" || v === "auto" ? null : "focusable must be true, false or auto"),
};
const escapeText = (v: string): string => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ATTRIBUTES = new Set([
  "id", "viewBox", "preserveAspectRatio", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "fx", "fy", "points", "d", "transform",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "stroke-opacity", "fill-opacity",
  "opacity", "fill-rule", "clip-rule", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "patternUnits", "patternContentUnits",
  "patternTransform", "maskUnits", "maskContentUnits", "clipPathUnits", "mask", "clip-path", "filter", "href", "xlink:href", "stdDeviation", "in", "in2", "result", "mode",
  "operator", "values", "type", "k1", "k2", "k3", "k4", "dx", "dy", "flood-color", "flood-opacity", "filterUnits", "xmlns", "xmlns:xlink", "version",
]);
/** Attributes that may carry `url(#id)` (and no other kind of `url`). */
const URL_ATTRS = new Set(["fill", "stroke", "mask", "clip-path", "filter"]);
type Token = "accent" | "bg" | "fg" | "muted" | "surface" | "line";
const VALUE_RE = /^[A-Za-z0-9\s#.,:%()+\-_/]*$/;
const NAMED_COLORS = new Set(["none", "currentColor", "transparent", "white", "black", "red", "green", "blue", "yellow", "orange", "purple", "pink", "gray", "grey", "cyan", "magenta", "teal", "navy", "silver"]);

export type SvgResult = { ok: true; svg: string } | { ok: false; error: string };
const fail = (error: string): SvgResult => ({ ok: false, error });

/** Replaces `{accent}`… by the theme colours (or a neutral grey for plain validation). */
function substitute(raw: string, theme?: Partial<Record<Token, string>>): string {
  return raw.replace(/\{(accent|bg|fg|muted|surface|line)\}/g, (_, t: Token) => (/^#[0-9a-fA-F]{6}$/.test(theme?.[t] ?? "") ? theme![t]! : "#808080"));
}

export function sanitizeSvg(input: unknown, theme?: Partial<Record<Token, string>>, fit: "cover" | "contain" | "tile" = "cover", align: "left" | "center" | "right" = "center", limits: { maxBytes: number; maxElements: number } = { maxBytes: MAX_SVG_BYTES, maxElements: MAX_ELEMENTS }): SvgResult {
  if (typeof input !== "string" || input.trim() === "") return fail("the drawing is empty");
  if (input.length > limits.maxBytes) return fail(`the drawing is too heavy (${limits.maxBytes / 1000} KB at most: simplify the paths)`);
  const src = substitute(input, theme).replace(/^﻿/, "").replace(/<\?xml[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(src)) return fail("DOCTYPE, entities and CDATA are not accepted");

  const out: string[] = [];
  const stack: string[] = [];
  let count = 0, rootSeen = false, i = 0;
  const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/y;
  while (i < src.length) {
    if (src[i] !== "<") {
      const next = src.indexOf("<", i);
      const text = src.slice(i, next === -1 ? src.length : next);
      if (text.trim() !== "") return fail("text was found in the drawing (text is not accepted: convert it to paths)");
      i = next === -1 ? src.length : next;
      continue;
    }
    TAG.lastIndex = i;
    const m = TAG.exec(src);
    if (!m) return fail(`unreadable tag near “${src.slice(i, i + 24).replace(/\s+/g, " ")}”`);
    i = TAG.lastIndex;
    const [, closing, name, rawAttrs, selfClose] = m as unknown as [string, string, string, string, string];
    if (!ELEMENTS.has(name)) {
      const why = /^(script|style|image|foreignObject|text|tspan|animate\w*|set|a|iframe|switch|symbol|metadata)$/.test(name) ? "is not accepted" : "is unknown";
      return fail(`the <${name}> element ${why}`);
    }
    if (closing) {
      if (stack.pop() !== name) return fail(`the </${name}> tag is misplaced`);
      out.push(`</${name}>`);
      continue;
    }
    if (++count > limits.maxElements) return fail(`too many elements (${limits.maxElements} at most)`);
    if (!rootSeen) { if (name !== "svg") return fail("the drawing must start with <svg>"); rootSeen = true; }
    else if (name === "svg") return fail("a nested <svg> is not accepted");

    const attrs: [string, string][] = [];
    const seenAttr = new Set<string>();
    /** Checks an attribute (or a `style` property, converted to an attribute); returns an error message or null. */
    const accept = (key: string, value: string): string | null => {
      const a11y = A11Y[key];
      if (!a11y && !ATTRIBUTES.has(key)) return `the attribute “${key}” is not accepted in <${name}>`;
      if (seenAttr.has(key)) return `duplicate attribute ${key} in <${name}>`;
      seenAttr.add(key);
      if (a11y) {
        const problem = a11y(value);
        if (problem) return problem;
        attrs.push([key, value]);
        return null;
      }
      if (!VALUE_RE.test(value)) return `value not accepted for ${key} (special characters or entities)`;
      if (/url\s*\(/i.test(value) && !(URL_ATTRS.has(key) && /^url\(#[\w-]+\)$/.test(value))) return `${key}: only url(#id) is accepted`;
      if ((key === "href" || key === "xlink:href") && !/^#[\w-]+$/.test(value)) return "links must point to an #id of the same drawing (no outside address)";
      if (/javascript|expression|@import|data:/i.test(value)) return `value not accepted for ${key}`;
      if ((key === "fill" || key === "stroke" || key === "stop-color" || key === "flood-color") && !(/^#[0-9a-fA-F]{3,8}$/.test(value) || NAMED_COLORS.has(value) || /^url\(#[\w-]+\)$/.test(value) || /^(rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/.test(value)))
        return `${key}: colour “${value}” not recognised`;
      attrs.push([key, value]);
      return null;
    };
    let rest = rawAttrs.trim();
    while (rest) {
      const a = /^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(rest);
      if (!a) return fail(`unreadable attribute in <${name}> (quoted values expected)`);
      rest = rest.slice(a[0].length);
      const key = a[1]!, value = (a[2] ?? a[3] ?? "").trim();
      if (/^on/i.test(key)) return fail(`the attribute ${key} (event) is not accepted`);
      if (key === "class") continue; // without a style sheet (refused), a class changes nothing
      if (key === "style") {
        // Inkscape and Figma exports put the formatting in `style="fill:#fff;opacity:.5"`: it is converted to attributes, property by property.
        for (const decl of value.split(";").map((d) => d.trim()).filter(Boolean)) {
          const [prop, ...val] = decl.split(":");
          // Unknown properties (background, font…) are simply dropped; known ones are checked like attributes.
          if (!ATTRIBUTES.has((prop ?? "").trim())) continue;
          const error = accept((prop ?? "").trim(), val.join(":").trim());
          if (error) return fail(`style: ${error}`);
        }
        continue;
      }
      const error = accept(key, value);
      if (error) return fail(error);
    }
    if (name === "svg") {
      // The drawing fills the whole area: the aspect (fill / contain) is set here, not by the drawing.
      const keep = attrs.filter(([k]) => !["preserveAspectRatio", "width", "height", "xmlns", "xmlns:xlink", "version"].includes(k));
      const x = align === "left" ? "xMin" : align === "right" ? "xMax" : "xMid";
      const par = `${x}YMid ${fit === "cover" ? "slice" : "meet"}`;
      // No viewBox but numeric dimensions (common export of drawing tools): the viewBox is deduced from them.
      const num = (k: string) => /^\d+(\.\d+)?(px)?$/.test(attrs.find(([a]) => a === k)?.[1] ?? "") ? parseFloat(attrs.find(([a]) => a === k)![1]) : 0;
      if (!keep.some(([k]) => k === "viewBox") && num("width") > 0 && num("height") > 0) keep.push(["viewBox", `0 0 ${num("width")} ${num("height")}`]);
      const hasBox = keep.some(([k]) => k === "viewBox");
      if (!hasBox) return fail("the drawing must have a viewBox (for example viewBox=\"0 0 1920 1080\"): export it from your drawing tool with its dimensions");
      if (!keep.find(([k]) => k === "viewBox")![1].match(/^-?[\d.]+[\s,]+-?[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+$/)) return fail("invalid viewBox (4 numbers expected)");
      keep.push(["xmlns", "http://www.w3.org/2000/svg"], ["preserveAspectRatio", par]);
      attrs.length = 0; attrs.push(...keep);
    }
    out.push(`<${name}${attrs.map(([k, v]) => ` ${k}="${escapeText(v)}"`).join("")}${selfClose ? "/" : ""}>`);
    if (!selfClose) {
      if (name in TEXT_ELEMENTS) {
        // <title> / <desc>: plain text up to the closing tag. Anything else in between (a tag, an entity, a control character) is refused.
        const end = src.indexOf("<", i);
        const close = end === -1 ? null : new RegExp(`^</${name}\\s*>`).exec(src.slice(end, end + name.length + 12));
        if (!close) return fail(`<${name}> may only hold plain text (no markup inside)`);
        const text = src.slice(i, end).replace(/\s+/g, " ").trim();
        if (text.length > TEXT_ELEMENTS[name]!) return fail(`<${name}> is too long (${TEXT_ELEMENTS[name]} characters at most)`);
        if (UNSAFE_TEXT.test(text)) return fail(`<${name}> must be plain text (no markup, entity, quote or control character)`);
        i = end + close[0].length;
        if (text) out.push(escapeText(text), `</${name}>`); else out.pop();
        continue;
      }
      stack.push(name);
    }
  }
  if (!rootSeen) return fail("no <svg> found");
  if (stack.length) return fail(`the <${stack[stack.length - 1]}> tag is never closed`);
  return { ok: true, svg: out.join("") };
}
