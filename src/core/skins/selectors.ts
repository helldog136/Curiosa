/**
 * Sélecteurs de skin (docs/SKINS.md §6.1) : analyse stricte, validation par liste blanche, réécriture préfixée.
 *
 * Un sélecteur n'est JAMAIS recopié tel quel : il est analysé en structure (composés, attributs, pseudo-classes), validé,
 * puis réécrit à partir de cette structure sous la forme `:root[data-skin="<id>"] <sélecteur>`.
 */
import {
  CONTENT_ELEMENTS, DECOR_PARTS, DECOR_PSEUDO_ELEMENTS, DECOR_REGIONS, GLOBAL_ELEMENTS, LEGACY_PSEUDO_ELEMENTS, LOGICAL_PSEUDO_CLASSES, MODE_ATTRIBUTE, MODE_QUALIFIER_VALUES,
  MODULE_PART_RE, NTH_PSEUDO_CLASSES, PARTS, PSEUDO_CLASSES, PSEUDO_ELEMENTS, REGIONS, STATE_ATTRIBUTES, type SkinLimits,
} from "./allowlist";

export type Attr = { name: string; op: "" | "=" | "~=" | "|="; value: string };
export type Pseudo = { name: string; arg?: Complex[] | string };
export type Compound = { type: string | null; attrs: Attr[]; pseudos: Pseudo[]; pseudoElement: string | null };
export type Combinator = " " | ">" | "+" | "~";
export type Complex = {
  lead: Combinator | null;
  compounds: Compound[];
  combinators: Combinator[];
  /** Choix clair/sombre du visiteur visé (`[data-mode="light"|"dark"]` en tête, docs/SKINS.md §3.8) : posé sur la même racine que `data-skin`. */
  mode?: "light" | "dark";
};

export class SelectorError extends Error {
  readonly code: string;
  readonly params: Record<string, string | number>;
  constructor(code: string, params: Record<string, string | number> = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

export type SelectorContext = {
  skinId: string;
  limits: SkinLimits;
  /** Pièces de modules installés : `{ idDuModule: ["piece", …] }`. Absent = toute pièce bien formée est acceptée. */
  moduleParts?: Readonly<Record<string, readonly string[]>>;
};

const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isIdentChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_-]/.test(c);

class Parser {
  i = 0;
  readonly s: string;
  readonly limits: SkinLimits;
  constructor(s: string, limits: SkinLimits) {
    this.s = s;
    this.limits = limits;
  }

  peek(o = 0) {
    return this.s[this.i + o];
  }
  ws(): boolean {
    const start = this.i;
    while (isSpace(this.peek())) this.i++;
    return this.i > start;
  }
  fail(code: string, params: Record<string, string | number> = {}): never {
    throw new SelectorError(code, params);
  }
  ident(): string {
    const start = this.i;
    while (isIdentChar(this.peek())) this.i++;
    return this.s.slice(start, this.i);
  }

  list(depth: number, relative: boolean, topLevel: boolean): Complex[] {
    const out: Complex[] = [];
    for (;;) {
      out.push(this.complex(depth, relative));
      if (out.length > this.limits.maxSelectorsPerRule) this.fail("selector-list-too-long", { max: this.limits.maxSelectorsPerRule });
      this.ws();
      if (this.peek() === ",") {
        this.i++;
        continue;
      }
      break;
    }
    if (topLevel && this.i < this.s.length) this.fail("selector-syntax");
    return out;
  }

  complex(depth: number, relative: boolean): Complex {
    this.ws();
    let lead: Combinator | null = null;
    const first = this.peek();
    if (first === ">" || first === "+" || first === "~") {
      if (!relative) this.fail("selector-syntax");
      lead = first;
      this.i++;
      this.ws();
    }
    const compounds: Compound[] = [this.compound(depth)];
    const combinators: Combinator[] = [];
    for (;;) {
      const saved = this.i;
      const sawSpace = this.ws();
      const c = this.peek();
      if (c === ">" || c === "+" || c === "~") {
        this.i++;
        this.ws();
        combinators.push(c);
      } else if (sawSpace && c !== undefined && c !== "," && c !== ")") {
        combinators.push(" ");
      } else {
        this.i = saved;
        break;
      }
      compounds.push(this.compound(depth));
      if (compounds.length > this.limits.maxSelectorDepth) this.fail("selector-too-deep", { max: this.limits.maxSelectorDepth });
    }
    return { lead, compounds, combinators };
  }

  compound(depth: number): Compound {
    const out: Compound = { type: null, attrs: [], pseudos: [], pseudoElement: null };
    let any = false;
    for (;;) {
      const c = this.peek();
      if (c === undefined || isSpace(c)) break;
      if (out.pseudoElement !== null && (c === "[" || c === ":" || /[A-Za-z]/.test(c))) this.fail("pseudo-element-position");
      if (c === "*") this.fail("universal-selector");
      if (c === ".") this.fail("class-selector");
      if (c === "#") this.fail("id-selector");
      if (c === "&") this.fail("nesting-selector");
      if (c === "|") this.fail("namespace-selector");
      if (c === "\\") this.fail("escape-sequence");
      if (c.charCodeAt(0) > 126 || c.charCodeAt(0) < 32) this.fail("non-ascii-char");
      if (/[A-Za-z]/.test(c)) {
        if (any) this.fail("selector-syntax");
        out.type = this.ident().toLowerCase();
        if (this.peek() === "|") this.fail("namespace-selector");
        any = true;
      } else if (c === "[") {
        out.attrs.push(this.attr());
        any = true;
      } else if (c === ":") {
        this.pseudo(out, depth);
        any = true;
      } else {
        break;
      }
    }
    if (!any) this.fail("selector-syntax");
    return out;
  }

  attr(): Attr {
    this.i++; // [
    this.ws();
    if (this.peek() === "\\") this.fail("escape-sequence");
    const name = this.ident().toLowerCase();
    if (!name) this.fail("selector-syntax");
    if (this.peek() === "|" && this.peek(1) !== "=") this.fail("namespace-selector");
    this.ws();
    let op: Attr["op"] = "";
    if (this.peek() === "]") {
      this.i++;
      return { name, op, value: "" };
    }
    const two = this.s.slice(this.i, this.i + 2);
    if (two === "~=" || two === "|=") {
      op = two;
      this.i += 2;
    } else if (this.peek() === "=") {
      op = "=";
      this.i++;
    } else {
      this.fail("attribute-operator", { name });
    }
    this.ws();
    let value: string;
    const q = this.peek();
    if (q === '"' || q === "'") {
      const end = this.s.indexOf(q, this.i + 1);
      if (end < 0) this.fail("selector-syntax");
      value = this.s.slice(this.i + 1, end);
      this.i = end + 1;
    } else {
      const start = this.i;
      while (this.peek() !== undefined && /[A-Za-z0-9_.-]/.test(this.peek()!)) this.i++;
      value = this.s.slice(start, this.i);
    }
    if (value.includes("\\")) this.fail("escape-sequence");
    if (/[^\x20-\x7e]/.test(value)) this.fail("non-ascii-char");
    this.ws();
    if (this.peek() !== "]") this.fail("attribute-operator", { name });
    this.i++;
    return { name, op, value };
  }

  pseudo(out: Compound, depth: number) {
    this.i++; // :
    let double = false;
    if (this.peek() === ":") {
      double = true;
      this.i++;
    }
    if (this.peek() === "\\") this.fail("escape-sequence");
    const name = this.ident().toLowerCase();
    if (!name) this.fail("selector-syntax");
    const functional = this.peek() === "(";
    if (double || (!functional && LEGACY_PSEUDO_ELEMENTS.includes(name))) {
      if (functional || !PSEUDO_ELEMENTS.includes(name)) this.fail("pseudo-element-not-allowed", { name });
      out.pseudoElement = name;
      return;
    }
    if (functional) {
      if (LOGICAL_PSEUDO_CLASSES.includes(name)) {
        if (depth + 1 > this.limits.maxFunctionalNesting) this.fail("selector-too-nested", { max: this.limits.maxFunctionalNesting });
        this.i++;
        const arg = this.list(depth + 1, name === "has", false);
        this.ws();
        if (this.peek() !== ")") this.fail("selector-syntax");
        this.i++;
        out.pseudos.push({ name, arg });
        return;
      }
      if (NTH_PSEUDO_CLASSES.includes(name)) {
        const end = this.s.indexOf(")", this.i);
        if (end < 0) this.fail("selector-syntax");
        const arg = this.s.slice(this.i + 1, end).trim().toLowerCase();
        if (!/^(odd|even|[+-]?\d{1,3}|[+-]?\d{0,3}n(\s*[+-]\s*\d{1,3})?)$/.test(arg)) this.fail("nth-bad");
        this.i = end + 1;
        out.pseudos.push({ name, arg: arg.replace(/\s+/g, "") });
        return;
      }
      this.fail("pseudo-class-not-allowed", { name });
    }
    if (name !== "root" && !PSEUDO_CLASSES.includes(name)) this.fail("pseudo-class-not-allowed", { name });
    out.pseudos.push({ name });
  }
}

/** Analyse d'une liste de sélecteurs (texte déjà débarrassé des commentaires). */
export function parseSelectorList(src: string, limits: SkinLimits): Complex[] {
  const p = new Parser(src.trim(), limits);
  return p.list(0, false, true);
}

// ---------------------------------------------------------------------------------------------------------------------
// Validation

function partKnown(name: string, ctx: SelectorContext): boolean {
  if ((PARTS as readonly string[]).includes(name)) return true;
  if (!MODULE_PART_RE.test(name)) return false;
  if (!ctx.moduleParts) return true;
  const [mod, part] = name.split(".") as [string, string];
  return ctx.moduleParts[mod]?.includes(part) ?? false;
}

function anchorOf(c: Compound): { region?: string; part?: string } {
  const out: { region?: string; part?: string } = {};
  for (const a of c.attrs) {
    if (a.op !== "=") continue;
    if (a.name === "data-skin-region") out.region = a.value;
    if (a.name === "data-skin-part") out.part = a.value;
  }
  return out;
}

/** Vrai si le composé est ancré à une région ou une pièce (directement, ou par `:is()`/`:where()` dont chaque branche l'est). */
function isAnchored(c: Compound): boolean {
  const a = anchorOf(c);
  if (a.region !== undefined || a.part !== undefined) return true;
  return c.pseudos.some((p) => (p.name === "is" || p.name === "where") && Array.isArray(p.arg) && p.arg.length > 0 && p.arg.every((x) => x.lead === null && isAnchored(x.compounds[0]!)));
}

function validateCompound(c: Compound, ctx: SelectorContext, inner: boolean) {
  if (c.type !== null) {
    if (GLOBAL_ELEMENTS.includes(c.type)) throw new SelectorError("global-selector", { name: c.type });
    if (!CONTENT_ELEMENTS.includes(c.type)) throw new SelectorError("element-not-allowed", { name: c.type });
  }
  if (c.pseudos.some((p) => p.name === "root")) throw new SelectorError("root-selector");
  for (const a of c.attrs) {
    if (a.name === "data-skin") throw new SelectorError("wrong-scope");
    if (a.name === "data-skin-region" || a.name === "data-skin-part") {
      if (a.op !== "=") throw new SelectorError("attribute-operator", { name: a.name });
      if (a.name === "data-skin-region" && !(REGIONS as readonly string[]).includes(a.value)) throw new SelectorError("unknown-region", { name: a.value.slice(0, 40) });
      if (a.name === "data-skin-part" && !partKnown(a.value, ctx)) throw new SelectorError("unknown-part", { name: a.value.slice(0, 40) });
      continue;
    }
    const spec = STATE_ATTRIBUTES[a.name];
    if (!spec) throw new SelectorError("attribute-not-allowed", { name: a.name.slice(0, 40) });
    if (!spec.ops.includes(a.op)) throw new SelectorError("attribute-operator", { name: a.name });
    if (a.op !== "" && !spec.value!.test(a.value)) throw new SelectorError("attribute-value", { name: a.name, value: a.value.slice(0, 40) });
  }
  for (const p of c.pseudos) {
    if (!Array.isArray(p.arg)) continue;
    for (const x of p.arg) validateComplex(x, ctx, true, p.name);
  }
  if (inner && c.pseudoElement) throw new SelectorError("pseudo-element-position");
}

function validateComplex(x: Complex, ctx: SelectorContext, inner: boolean, within?: string) {
  if (within === "has") {
    if (x.compounds.length > 2) throw new SelectorError("has-too-deep");
    if (x.compounds.some((c) => c.pseudos.some((p) => p.name === "has"))) throw new SelectorError("has-too-deep");
  }
  x.compounds.forEach((c, i) => {
    if (c.pseudoElement && i !== x.compounds.length - 1) throw new SelectorError("pseudo-element-position");
    validateCompound(c, ctx, inner);
  });
}

/**
 * Valide une liste de sélecteurs d'une règle (déjà débarrassée d'un éventuel préfixe d'auteur, voir `stripAuthorScope`)
 * et la réécrit préfixée par `:root[data-skin="<id>"]`. Lève `SelectorError` (rattrapée par l'appelant).
 */
export function validateAndRewrite(list: Complex[], ctx: SelectorContext): { selectors: string[]; subjects: Subject[] } {
  const selectors: string[] = [];
  const subjects: Subject[] = [];
  for (const x of list) {
    validateComplex(x, ctx, false);
    if (!isAnchored(x.compounds[0]!)) throw new SelectorError("selector-needs-anchor");
    selectors.push(`:root[data-skin="${ctx.skinId}"]${x.mode ? `[data-mode="${x.mode}"]` : ""} ${serializeComplex(x)}`);
    subjects.push(analyzeSubject(x));
  }
  return { selectors, subjects };
}

/**
 * Retire le préfixe d'auteur exact `:root[data-skin="<id>"]` (suivi d'un espace ou de `>`) : il est ensuite remis par `validateAndRewrite`, jamais doublé.
 * Reconnaît aussi, en TÊTE seulement, le choix du visiteur : `[data-mode="light"]` / `[data-mode="dark"]` seul, ou ajouté au préfixe
 * (`:root[data-skin="<id>"][data-mode="dark"]`). Le qualificatif est retenu dans `mode` et remis à côté de `data-skin` (même élément racine).
 * Ailleurs dans le sélecteur, `data-mode` reste refusé (attribut non permis).
 */
export function stripAuthorScope(list: Complex[], skinId: string): Complex[] {
  const modeOf = (a: Attr): "light" | "dark" | null => (a.name === MODE_ATTRIBUTE && a.op === "=" && MODE_QUALIFIER_VALUES.includes(a.value) ? (a.value as "light" | "dark") : null);
  return list.map((x) => {
    const head = x.compounds[0]!;
    if (x.compounds.length < 2 || x.lead || head.type !== null || head.pseudoElement !== null) return x;
    const comb = x.combinators[0]!;
    if (comb !== " " && comb !== ">") return x;
    const rest = { lead: null, compounds: x.compounds.slice(1), combinators: x.combinators.slice(1) } as Complex;
    // `[data-mode="dark"]` seul
    if (head.pseudos.length === 0 && head.attrs.length === 1 && modeOf(head.attrs[0]!)) return { ...rest, mode: modeOf(head.attrs[0]!)! };
    // `:root[data-skin="<id>"]` éventuellement suivi de `[data-mode="…"]`
    const hasRoot = head.pseudos.length === 1 && head.pseudos[0]!.name === "root" && !head.pseudos[0]!.arg;
    if (!hasRoot) return x;
    const skinAttr = head.attrs.find((a) => a.name === "data-skin");
    const others = head.attrs.filter((a) => a !== skinAttr);
    if (!skinAttr || skinAttr.op !== "=" || skinAttr.value !== skinId) return x;
    if (others.length === 0) return rest;
    if (others.length === 1 && modeOf(others[0]!)) return { ...rest, mode: modeOf(others[0]!)! };
    return x;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Sujet de la règle (ce qui est réellement stylé) : sert aux règles « décor / contenu ».

export type Subject = {
  /** Décor : pseudo-élément `::before`/`::after`, ou à l'intérieur de la région `backdrop` / pièce `divider`. */
  decor: boolean;
  pseudoElement: string | null;
  /** Région / pièce portée par le DERNIER composé (le sujet lui-même). */
  region: string | null;
  part: string | null;
  /** Le sujet est un menu fermé : `[data-open="false"]` ou `:not([data-open="true"])`. */
  closed: boolean;
};

export function analyzeSubject(x: Complex): Subject {
  const last = x.compounds[x.compounds.length - 1]!;
  const a = anchorOf(last);
  const decorAnchor = x.compounds.some((c) => {
    const k = anchorOf(c);
    return (k.region !== undefined && DECOR_REGIONS.includes(k.region)) || (k.part !== undefined && DECOR_PARTS.includes(k.part));
  });
  const closed =
    last.attrs.some((t) => t.name === "data-open" && t.op === "=" && t.value === "false") ||
    last.pseudos.some(
      (p) => p.name === "not" && Array.isArray(p.arg) && p.arg.length === 1 && p.arg[0]!.compounds.length === 1 && p.arg[0]!.compounds[0]!.attrs.some((t) => t.name === "data-open" && t.op === "=" && t.value === "true"),
    );
  return {
    decor: decorAnchor || (last.pseudoElement !== null && DECOR_PSEUDO_ELEMENTS.includes(last.pseudoElement)),
    pseudoElement: last.pseudoElement,
    region: a.region ?? null,
    part: a.part ?? null,
    closed,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Écriture

function serializeCompound(c: Compound): string {
  let out = c.type ?? "";
  for (const a of c.attrs) out += a.op === "" ? `[${a.name}]` : `[${a.name}${a.op}"${a.value}"]`;
  for (const p of c.pseudos) {
    if (Array.isArray(p.arg)) out += `:${p.name}(${p.arg.map(serializeComplex).join(", ")})`;
    else if (typeof p.arg === "string") out += `:${p.name}(${p.arg})`;
    else out += `:${p.name}`;
  }
  if (c.pseudoElement) out += `::${c.pseudoElement}`;
  return out;
}

export function serializeComplex(x: Complex): string {
  let out = x.lead ? `${x.lead} ` : "";
  x.compounds.forEach((c, i) => {
    if (i > 0) {
      const k = x.combinators[i - 1]!;
      out += k === " " ? " " : ` ${k} `;
    }
    out += serializeCompound(c);
  });
  return out;
}
