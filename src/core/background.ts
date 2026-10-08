/**
 * FOND DE PAGE — un format simple qui décrit comment dessiner le fond du site, validé puis traduit en CSS par le framework.
 *
 * Un fond est une liste de COUCHES (6 au plus), de la plus basse à la plus haute. Chaque couche est un objet JSON :
 *
 *   { "type": "linear", "angle": 90, "stops": [ { "color": "bg", "at": 0 }, { "color": "accent", "at": 100, "a": 45 } ] }
 *   { "type": "radial", "x": 20, "y": 10, "w": 60, "h": 40, "stops": [ { "color": "accent", "a": 30 }, { "color": "accent", "a": 0 } ] }
 *   { "type": "dots",   "color": "fg", "size": 2, "gap": 28, "opacity": 40, "side": "bottom", "span": 50 }
 *   { "type": "grid",   "color": "fg", "gap": 48, "opacity": 8, "side": "full" }
 *   { "type": "spots",  "count": 4, "size": 60, "variance": 30, "hue": 40, "intensity": 24, "seed": 7 }
 *   { "type": "image",  "src": "/uploads/….png", "fit": "cover", "position": "center", "opacity": 100 }
 *
 * Couleurs : « #rrggbb » ou un jeton du thème (accent, bg, fg, muted, surface, line) ; `a` = opacité en %, `hue` = décalage de teinte en degrés.
 * Aucun CSS brut n'est accepté : seules les valeurs ci-dessus, bornées, sont retenues. Les images viennent des envois du site (ou https).
 */
import { GLOW_BOUNDS, normalizeTuning, spotGradients, type GlowTuning } from "./glow";
import type { Theme } from "./color";

export const MAX_LAYERS = 6;
export const MAX_JSON_BYTES = 8_000;

export type Stop = { color: string; at?: number; a?: number; hue?: number };
type Side = "full" | "left" | "right" | "top" | "bottom";
type Edge = "soft" | "hard";
export type Layer =
  | { type: "linear"; angle: number; stops: Stop[]; opacity: number }
  | { type: "radial"; x: number; y: number; w: number; h: number; stops: Stop[]; opacity: number }
  | { type: "dots"; color: string; size: number; gap: number; opacity: number; side: Side; span: number; edge: Edge; stagger: boolean }
  | { type: "grid"; color: string; gap: number; opacity: number; side: Side; span: number }
  | ({ type: "spots"; opacity: number } & Omit<GlowTuning, "color"> & { color: string })
  | { type: "image"; src: string; fit: "cover" | "contain" | "tile"; position: string; opacity: number };

const TOKENS = ["accent", "bg", "fg", "muted", "surface", "line"] as const;
const SIDES: Side[] = ["full", "left", "right", "top", "bottom"];
const POSITIONS = ["center", "top", "bottom", "left", "right", "top left", "top right", "bottom left", "bottom right"];
const IMAGE_RE = /^(\/uploads\/[0-9a-f-]{36}\.(png|jpg|webp|gif)|https:\/\/[^\s"'()\\<>]{1,300})$/;

export const isBackgroundImage = (v: unknown): v is string => typeof v === "string" && IMAGE_RE.test(v);

class Bad extends Error {}
const num = (v: unknown, lo: number, hi: number, dflt: number, what: string): number => {
  if (v === undefined || v === null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Bad(`${what} : nombre attendu`);
  return Math.min(hi, Math.max(lo, n));
};
const color = (v: unknown, what: string): string => {
  if (typeof v === "string" && ((TOKENS as readonly string[]).includes(v) || /^#[0-9a-fA-F]{6}$/.test(v))) return v;
  throw new Bad(`${what} : couleur « #rrggbb » ou jeton (${TOKENS.join(", ")}) attendu`);
};
const obj = (v: unknown, what: string): Record<string, unknown> => {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  throw new Bad(`${what} : objet attendu`);
};
function stops(v: unknown, what: string): Stop[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > 6) throw new Bad(`${what} : de 2 à 6 étapes (« stops ») attendues`);
  return v.map((s, i) => {
    const o = obj(s, `${what}[${i}]`);
    return { color: color(o.color, `${what}[${i}].color`), at: o.at === undefined ? Math.round((i / (v.length - 1)) * 100) : num(o.at, 0, 100, 0, `${what}[${i}].at`), a: num(o.a, 0, 100, 100, `${what}[${i}].a`), hue: num(o.hue, -180, 180, 0, `${what}[${i}].hue`) };
  });
}

/** Valide et borne une description de fond. Jamais d'exception : `{ ok:false, error }` avec un message lisible. */
export function parseBackground(raw: unknown): { ok: true; layers: Layer[] } | { ok: false; error: string } {
  try {
    let value = raw;
    if (typeof raw === "string") {
      if (raw.trim() === "") return { ok: true, layers: [] };
      if (raw.length > MAX_JSON_BYTES) throw new Bad("description trop longue");
      try { value = JSON.parse(raw); } catch { throw new Bad("JSON invalide"); }
    }
    if (value === null || value === undefined) return { ok: true, layers: [] };
    const list = Array.isArray(value) ? value : (value && typeof value === "object" && Array.isArray((value as { layers?: unknown }).layers) ? (value as { layers: unknown[] }).layers : null);
    if (!list) throw new Bad("une liste de couches (ou { \"layers\": [...] }) est attendue");
    if (list.length > MAX_LAYERS) throw new Bad(`${MAX_LAYERS} couches au plus`);
    const layers = list.map((item, i): Layer => {
      const o = obj(item, `couche ${i + 1}`);
      const at = `couche ${i + 1}`;
      const opacity = num(o.opacity, 0, 100, 100, `${at}.opacity`);
      const edge = (v: unknown, where: string): Edge => (v === undefined || v === "soft" ? "soft" : v === "hard" ? "hard" : (() => { throw new Bad(`${where}.edge : soft ou hard`); })());
      const bool = (v: unknown, what: string): boolean => (v === undefined || v === false ? false : v === true ? true : (() => { throw new Bad(`${what} : true ou false`); })());
      const side = (v: unknown): Side => (v === undefined ? "full" : SIDES.includes(v as Side) ? (v as Side) : (() => { throw new Bad(`${at}.side : ${SIDES.join(", ")}`); })());
      switch (o.type) {
        case "linear": return { type: "linear", angle: num(o.angle, 0, 360, 180, `${at}.angle`), stops: stops(o.stops, `${at}.stops`), opacity };
        case "radial": return { type: "radial", x: num(o.x, -20, 120, 50, `${at}.x`), y: num(o.y, -20, 120, 50, `${at}.y`), w: num(o.w, 10, 200, 60, `${at}.w`), h: num(o.h, 10, 200, 40, `${at}.h`), stops: stops(o.stops, `${at}.stops`), opacity };
        case "dots": return {
          type: "dots", color: color(o.color ?? "#ffffff", `${at}.color`), size: num(o.size, 1, 12, 2, `${at}.size`), gap: num(o.gap, 8, 80, 28, `${at}.gap`), opacity,
          side: side(o.side), span: num(o.span, 5, 100, 40, `${at}.span`), edge: edge(o.edge, at), stagger: bool(o.stagger, `${at}.stagger`),
        };
        case "grid": return { type: "grid", color: color(o.color ?? "fg", `${at}.color`), gap: num(o.gap, 16, 160, 48, `${at}.gap`), opacity: num(o.opacity, 0, 100, 10, `${at}.opacity`), side: side(o.side), span: num(o.span, 5, 100, 40, `${at}.span`) };
        // `color` : « #rrggbb » ou jeton du thème ; absent = la couleur d'accent.
        case "spots": return { type: "spots", opacity, ...normalizeTuning(Object.fromEntries((Object.keys(GLOW_BOUNDS) as string[]).map((k) => [k, o[k]]))), color: o.color === undefined || o.color === null || o.color === "" ? "" : color(o.color, `${at}.color`) };
        case "image": {
          const src = String(o.src ?? "");
          if (!IMAGE_RE.test(src)) throw new Bad(`${at}.src : une image envoyée sur le site (/uploads/…) ou une adresse https`);
          const fit = o.fit === undefined ? "cover" : (["cover", "contain", "tile"] as const).find((f) => f === o.fit);
          if (!fit) throw new Bad(`${at}.fit : cover, contain ou tile`);
          const position = o.position === undefined ? "center" : POSITIONS.find((p) => p === o.position);
          if (!position) throw new Bad(`${at}.position : ${POSITIONS.join(", ")}`);
          return { type: "image", src, fit, position, opacity };
        }
        default: throw new Bad(`${at}.type : linear, radial, dots, grid, spots ou image`);
      }
    });
    return { ok: true, layers };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}

/* ───────────── couleurs ───────────── */
function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shiftHue([r, g, b]: [number, number, number], deg: number): [number, number, number] {
  if (!deg) return [r, g, b];
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min, l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  }
  const H = (((h * 60 + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((H / 60) % 2) - 1)), m = l - c / 2;
  const [r1, g1, b1] = H < 60 ? [c, x, 0] : H < 120 ? [x, c, 0] : H < 180 ? [0, c, x] : H < 240 ? [0, x, c] : H < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}
function css(c: string, theme: Theme, a = 100, hue = 0): string {
  const hex = (TOKENS as readonly string[]).includes(c) ? theme[c as keyof Theme] as string : c;
  const [r, g, b] = shiftHue(rgbOf(/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#808080"), hue);
  return `rgba(${r},${g},${b},${+(a / 100).toFixed(3)})`;
}
const stopList = (s: Stop[], theme: Theme) => s.map((x) => `${css(x.color, theme, x.a, x.hue)} ${x.at}%`).join(",");

/** Masque d'estompage d'une couche sur un côté : pleine au bord, transparente à `span` % de la largeur. */
function fade(side: Side, span: number, edge: Edge = "soft"): string {
  if (side === "full") return "";
  const dir = { left: "to right", right: "to left", top: "to bottom", bottom: "to top" }[side];
  // « soft » : s'efface progressivement jusqu'à `span` % ; « hard » : trame pleine jusqu'à `span` %, puis coupée net.
  const g = edge === "hard" ? `linear-gradient(${dir},#000 ${span}%,transparent ${span}%)` : `linear-gradient(${dir},#000 0%,transparent ${span}%)`;
  return `-webkit-mask-image:${g};mask-image:${g};`;
}

/** Couleur « #rrggbb » ou jeton du thème → « #rrggbb ». */
function hexOf(c: string, theme: Theme): string {
  const hex = (TOKENS as readonly string[]).includes(c) ? (theme[c as keyof Theme] as string) : c;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#808080";
}

/** Une couche → les déclarations CSS de son élément (jamais de valeur issue du JSON sans validation préalable). */
function layerCss(l: Layer, theme: Theme, accent: string): string {
  const op = l.opacity < 100 ? `opacity:${+(l.opacity / 100).toFixed(2)};` : "";
  switch (l.type) {
    case "linear": return `${op}background-image:linear-gradient(${Math.round(l.angle)}deg,${stopList(l.stops, theme)});`;
    case "radial": return `${op}background-image:radial-gradient(${Math.round(l.w)}rem ${Math.round(l.h)}rem at ${Math.round(l.x)}% ${Math.round(l.y)}%,${stopList(l.stops, theme)});background-repeat:no-repeat;`;
    case "dots": {
      const dot = css(l.color, theme), s = Math.round(l.size * 10) / 10, gap = Math.round(l.gap);
      const d = (at: string) => `radial-gradient(circle at ${at},${dot} ${s}px,transparent ${s + 0.5}px)`;
      // Quinconce : une tuile d'un pas de large sur deux pas de haut ; la 2e ligne est décalée d'un demi-pas (points aux bords, dupliqués à 0 % et 100 %).
      const image = l.stagger ? `${d("50% 25%")},${d("0% 75%")},${d("100% 75%")}` : d("50% 50%");
      return `${op}background-image:${image};background-size:${gap}px ${l.stagger ? gap * 2 : gap}px;${fade(l.side, Math.round(l.span), l.edge)}`;
    }
    case "grid": {
      const line = css(l.color, theme), gap = Math.round(l.gap);
      return `${op}background-image:linear-gradient(${line} 1px,transparent 1px),linear-gradient(90deg,${line} 1px,transparent 1px);background-size:${gap}px ${gap}px;${fade(l.side, Math.round(l.span))}`;
    }
    case "spots": return `${op}background-image:${spotGradients({ ...l, color: l.color ? hexOf(l.color, theme) : "" }, accent).join(",")};background-repeat:no-repeat;`;
    case "image": {
      const size = l.fit === "tile" ? "auto" : l.fit;
      return `${op}background-image:url("${l.src}");background-size:${size};background-position:${l.position};background-repeat:${l.fit === "tile" ? "repeat" : "no-repeat"};`;
    }
  }
}

/** Feuille de style du fond (éléments `.cbg > i`, un par couche) — chaîne vide s'il n'y a aucune couche. */
export function backgroundCss(layers: Layer[], theme: Theme): string {
  if (layers.length === 0) return "";
  const rules = layers.map((l, i) => `.cbg>i:nth-child(${i + 1}){${layerCss(l, theme, theme.accent)}}`);
  return `.cbg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}.cbg>i{position:absolute;inset:0;display:block}${rules.join("")}`;
}

/* ───────────── préréglages (adaptés au thème : ils utilisent les jetons accent/bg) ───────────── */
export type BackgroundPreset = "none" | "dusk" | "grid" | "custom";
export const BACKGROUND_PRESETS: Record<Exclude<BackgroundPreset, "none" | "custom">, Layer[]> = {
  // lueur d'aube : l'accent monte du bas de la page
  dusk: [
    { type: "linear", angle: 0, opacity: 100, stops: [{ color: "accent", at: 0, a: 26 }, { color: "accent", at: 55, a: 0 }] },
    { type: "radial", x: 85, y: 5, w: 70, h: 40, opacity: 100, stops: [{ color: "accent", at: 0, hue: 40, a: 16 }, { color: "accent", at: 100, hue: 40, a: 0 }] },
  ],
  // fine grille technique qui s'efface vers le bas
  grid: [{ type: "grid", color: "fg", gap: 48, opacity: 7, side: "top", span: 85 }],
};
export const isPreset = (v: unknown): v is BackgroundPreset => v === "none" || v === "custom" || (typeof v === "string" && v in BACKGROUND_PRESETS);

/** Couches effectives : préréglage ou description personnalisée, avec une image de fond éventuelle en dessous. */
export function effectiveLayers(preset: BackgroundPreset, custom: string, image: string | null): Layer[] {
  let layers: Layer[] = [];
  if (preset === "custom") { const p = parseBackground(custom); if (p.ok) layers = p.layers; }
  else if (preset !== "none") layers = BACKGROUND_PRESETS[preset];
  if (image) {
    const base = parseBackground([{ type: "image", src: image, fit: "cover", position: "center" }]);
    if (base.ok) layers = [...base.layers, ...layers].slice(0, MAX_LAYERS);
  }
  return layers;
}
