/**
 * ASSAINISSEMENT D'UN DESSIN SVG utilisé comme fond de page.
 *
 * Un SVG peut décrire n'importe quel décor (dégradés, trames, silhouettes, motifs) et se fabrique dans un outil de dessin. Mais c'est du code :
 * on n'en laisse passer que ce qui est connu et sans danger. Le dessin est relu élément par élément, ré-écrit à partir de ce qui a été reconnu
 * (jamais renvoyé tel quel), et utilisé comme IMAGE de fond (jamais inséré dans la page : aucun script ne s'y exécute, aucune ressource externe
 * n'y est chargée).
 *
 * Accepté : formes, chemins, dégradés, motifs (`pattern`), masques, découpes, filtres de flou/couleur, `use` vers un `#id` du même dessin.
 * Refusé (avec un message précis) : scripts, `style`, texte, images, `foreignObject`, animations, attributs d'événement, liens externes,
 * `url(...)` autre que `url(#id)`, entités XML, déclaration DOCTYPE.
 * Couleurs : `#rrggbb`, noms simples, `none`, ou un jeton du thème écrit `{accent}`, `{bg}`, `{fg}`, `{muted}`, `{surface}`, `{line}`.
 */
export const MAX_SVG_BYTES = 24_000;
const MAX_ELEMENTS = 1500;
/** Limites plus larges pour un logo (un dessin détaillé pèse plus qu'un motif de fond). */
export const LOGO_SVG_LIMITS = { maxBytes: 300_000, maxElements: 6000 } as const;

const ELEMENTS = new Set([
  "svg", "g", "defs", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "linearGradient", "radialGradient", "stop",
  "pattern", "mask", "clipPath", "use", "filter", "feGaussianBlur", "feOffset", "feFlood", "feComposite", "feMerge", "feMergeNode", "feColorMatrix", "feBlend",
]);
const ATTRIBUTES = new Set([
  "id", "viewBox", "preserveAspectRatio", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "fx", "fy", "points", "d", "transform",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit", "stroke-opacity", "fill-opacity",
  "opacity", "fill-rule", "clip-rule", "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "patternUnits", "patternContentUnits",
  "patternTransform", "maskUnits", "maskContentUnits", "clipPathUnits", "mask", "clip-path", "filter", "href", "xlink:href", "stdDeviation", "in", "in2", "result", "mode",
  "operator", "values", "type", "k1", "k2", "k3", "k4", "dx", "dy", "flood-color", "flood-opacity", "filterUnits", "xmlns", "xmlns:xlink", "version",
]);
/** Attributs qui peuvent porter `url(#id)` (et rien d'autre comme `url`). */
const URL_ATTRS = new Set(["fill", "stroke", "mask", "clip-path", "filter"]);
type Token = "accent" | "bg" | "fg" | "muted" | "surface" | "line";
const VALUE_RE = /^[A-Za-z0-9\s#.,:%()+\-_/]*$/;
const NAMED_COLORS = new Set(["none", "currentColor", "transparent", "white", "black", "red", "green", "blue", "yellow", "orange", "purple", "pink", "gray", "grey", "cyan", "magenta", "teal", "navy", "silver"]);

export type SvgResult = { ok: true; svg: string } | { ok: false; error: string };
const fail = (error: string): SvgResult => ({ ok: false, error });

/** Remplace `{accent}`… par les couleurs du thème (ou un gris neutre pour la simple validation). */
function substitute(raw: string, theme?: Partial<Record<Token, string>>): string {
  return raw.replace(/\{(accent|bg|fg|muted|surface|line)\}/g, (_, t: Token) => (/^#[0-9a-fA-F]{6}$/.test(theme?.[t] ?? "") ? theme![t]! : "#808080"));
}

export function sanitizeSvg(input: unknown, theme?: Partial<Record<Token, string>>, fit: "cover" | "contain" | "tile" = "cover", align: "left" | "center" | "right" = "center", limits: { maxBytes: number; maxElements: number } = { maxBytes: MAX_SVG_BYTES, maxElements: MAX_ELEMENTS }): SvgResult {
  if (typeof input !== "string" || input.trim() === "") return fail("dessin vide");
  if (input.length > limits.maxBytes) return fail(`dessin trop lourd (${limits.maxBytes / 1000} Ko au plus : simplifiez les tracés)`);
  const src = substitute(input, theme).replace(/^﻿/, "").replace(/<\?xml[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(src)) return fail("DOCTYPE, entités et CDATA ne sont pas acceptés");

  const out: string[] = [];
  const stack: string[] = [];
  let count = 0, rootSeen = false, i = 0;
  const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/y;
  while (i < src.length) {
    if (src[i] !== "<") {
      const next = src.indexOf("<", i);
      const text = src.slice(i, next === -1 ? src.length : next);
      if (text.trim() !== "") return fail("du texte a été trouvé dans le dessin (le texte n'est pas accepté : convertissez-le en tracés)");
      i = next === -1 ? src.length : next;
      continue;
    }
    TAG.lastIndex = i;
    const m = TAG.exec(src);
    if (!m) return fail(`balise illisible près de « ${src.slice(i, i + 24).replace(/\s+/g, " ")} »`);
    i = TAG.lastIndex;
    const [, closing, name, rawAttrs, selfClose] = m as unknown as [string, string, string, string, string];
    if (!ELEMENTS.has(name)) {
      const why = /^(script|style|image|foreignObject|text|tspan|animate\w*|set|a|iframe|switch|symbol|metadata|title|desc)$/.test(name) ? "n'est pas accepté" : "est inconnu";
      return fail(`l'élément <${name}> ${why}`);
    }
    if (closing) {
      if (stack.pop() !== name) return fail(`balise </${name}> mal placée`);
      out.push(`</${name}>`);
      continue;
    }
    if (++count > limits.maxElements) return fail(`trop d'éléments (${limits.maxElements} au plus)`);
    if (!rootSeen) { if (name !== "svg") return fail("le dessin doit commencer par <svg>"); rootSeen = true; }
    else if (name === "svg") return fail("<svg> imbriqué non accepté");

    const attrs: [string, string][] = [];
    const seenAttr = new Set<string>();
    /** Valide un attribut (ou une propriété de `style`, convertie en attribut) ; renvoie un message d'erreur ou null. */
    const accept = (key: string, value: string): string | null => {
      if (!ATTRIBUTES.has(key)) return `l'attribut « ${key} » n'est pas accepté dans <${name}>`;
      if (seenAttr.has(key)) return `attribut ${key} en double dans <${name}>`;
      seenAttr.add(key);
      if (!VALUE_RE.test(value)) return `valeur non acceptée pour ${key} (caractères spéciaux ou entités)`;
      if (/url\s*\(/i.test(value) && !(URL_ATTRS.has(key) && /^url\(#[\w-]+\)$/.test(value))) return `${key} : seul url(#identifiant) est accepté`;
      if ((key === "href" || key === "xlink:href") && !/^#[\w-]+$/.test(value)) return "les liens doivent viser un #identifiant du même dessin (pas d'adresse externe)";
      if (/javascript|expression|@import|data:/i.test(value)) return `valeur non acceptée pour ${key}`;
      if ((key === "fill" || key === "stroke" || key === "stop-color" || key === "flood-color") && !(/^#[0-9a-fA-F]{3,8}$/.test(value) || NAMED_COLORS.has(value) || /^url\(#[\w-]+\)$/.test(value) || /^(rgb|rgba|hsl|hsla)\([\d\s.,%]+\)$/.test(value)))
        return `${key} : couleur « ${value} » non reconnue`;
      attrs.push([key, value]);
      return null;
    };
    let rest = rawAttrs.trim();
    while (rest) {
      const a = /^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(rest);
      if (!a) return fail(`attribut illisible dans <${name}> (valeurs entre guillemets attendues)`);
      rest = rest.slice(a[0].length);
      const key = a[1]!, value = (a[2] ?? a[3] ?? "").trim();
      if (/^on/i.test(key)) return fail(`l'attribut ${key} (événement) n'est pas accepté`);
      if (key === "class") continue; // sans feuille de style (refusée), une classe ne change rien
      if (key === "style") {
        // Les exports d'Inkscape ou de Figma mettent la mise en forme dans `style="fill:#fff;opacity:.5"` : on la convertit en attributs, propriété par propriété.
        for (const decl of value.split(";").map((d) => d.trim()).filter(Boolean)) {
          const [prop, ...val] = decl.split(":");
          // Les propriétés qu'on ne connaît pas (background, font…) sont simplement écartées ; celles qu'on connaît sont vérifiées comme des attributs.
          if (!ATTRIBUTES.has((prop ?? "").trim())) continue;
          const error = accept((prop ?? "").trim(), val.join(":").trim());
          if (error) return fail(`style : ${error}`);
        }
        continue;
      }
      const error = accept(key, value);
      if (error) return fail(error);
    }
    if (name === "svg") {
      // Le dessin remplit toute la page : l'aspect (remplir / contenir) est fixé ici, pas par le dessin.
      const keep = attrs.filter(([k]) => !["preserveAspectRatio", "width", "height", "xmlns", "xmlns:xlink", "version"].includes(k));
      const x = align === "left" ? "xMin" : align === "right" ? "xMax" : "xMid";
      const par = `${x}YMid ${fit === "cover" ? "slice" : "meet"}`;
      // Sans viewBox mais avec des dimensions chiffrées (export courant des logiciels de dessin) : le viewBox en est déduit.
      const num = (k: string) => /^\d+(\.\d+)?(px)?$/.test(attrs.find(([a]) => a === k)?.[1] ?? "") ? parseFloat(attrs.find(([a]) => a === k)![1]) : 0;
      if (!keep.some(([k]) => k === "viewBox") && num("width") > 0 && num("height") > 0) keep.push(["viewBox", `0 0 ${num("width")} ${num("height")}`]);
      const hasBox = keep.some(([k]) => k === "viewBox");
      if (!hasBox) return fail("le dessin doit avoir un viewBox (ex. viewBox=\"0 0 1920 1080\") : exportez-le depuis votre outil de dessin avec les dimensions");
      if (!keep.find(([k]) => k === "viewBox")![1].match(/^-?[\d.]+[\s,]+-?[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+$/)) return fail("viewBox invalide (4 nombres attendus)");
      keep.push(["xmlns", "http://www.w3.org/2000/svg"], ["preserveAspectRatio", par]);
      attrs.length = 0; attrs.push(...keep);
    }
    out.push(`<${name}${attrs.map(([k, v]) => ` ${k}="${v}"`).join("")}${selfClose ? "/" : ""}>`);
    if (!selfClose) stack.push(name);
  }
  if (!rootSeen) return fail("aucun <svg> trouvé");
  if (stack.length) return fail(`balise <${stack[stack.length - 1]}> jamais fermée`);
  return { ok: true, svg: out.join("") };
}
