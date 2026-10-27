/**
 * Analyseur lexical des VALEURS CSS d'un skin (docs/SKINS.md §6.3).
 *
 * Il ne comprend qu'un alphabet volontairement étroit : ASCII imprimable sans `\`, `{`, `}`, `<`, `>`, `@`, `;`, `!`, `:`
 * (sauf dans `url(skin:…)`), sans commentaire (remplacé par une espace, comme le fait un navigateur), sans échappement CSS.
 * Les chaînes entre guillemets sont décodées (les échappements `\2014 ` y sont compris) et vérifiées ensuite, propriété par propriété.
 * La valeur de sortie est RÉÉCRITE à partir des jetons : ce que le navigateur lira est exactement ce qui a été vérifié.
 *
 * Aucune exception : en cas de problème, la fonction rend `{ error }`.
 */
import { ALL_UNITS } from "./allowlist";

export type Tok =
  | { k: "ws" }
  | { k: "ident"; v: string }
  | { k: "fn"; v: string }
  | { k: "close" }
  | { k: "num"; n: number; raw: string }
  | { k: "dim"; n: number; unit: string; raw: string }
  | { k: "hash"; v: string }
  | { k: "str"; v: string }
  | { k: "url"; v: string }
  | { k: "comma" }
  | { k: "slash" }
  | { k: "op"; v: "+" | "-" | "*" }
  | { k: "lbr" }
  | { k: "rbr" };

export type LexError = { error: "non-ascii-char" | "escape-sequence" | "char-forbidden" | "unterminated" | "url-bad" | "unit-unknown" | "number-bad" | "hash-bad" | "too-long" | "too-many-tokens" | "nesting-too-deep"; at: number; char?: string };
export type LexResult = { tokens: Tok[] } | LexError;

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentChar = (c: string) => isIdentStart(c) || isDigit(c) || c === "-";
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

/** Décode une chaîne CSS (guillemets déjà retirés) ; rend `null` si elle est mal formée. */
export function decodeCssString(body: string): string | null {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== "\\") {
      if (c === "\n" || c === "\r" || c === "\f") return null;
      out += c;
      continue;
    }
    i++;
    if (i >= body.length) return null;
    const n = body[i]!;
    if (/[0-9a-fA-F]/.test(n)) {
      let hex = n;
      while (hex.length < 6 && i + 1 < body.length && /[0-9a-fA-F]/.test(body[i + 1]!)) hex += body[++i]!;
      if (i + 1 < body.length && isSpace(body[i + 1]!)) {
        i++;
        if (body[i] === "\r" && body[i + 1] === "\n") i++;
      }
      const cp = parseInt(hex, 16);
      // NUL, substituts et hors plage deviennent U+FFFD (comme un navigateur) : refusés ensuite.
      out += cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "�" : String.fromCodePoint(cp);
    } else if (n === "\n" || n === "\f") {
      // continuation de ligne : rien
    } else if (n === "\r") {
      if (body[i + 1] === "\n") i++;
    } else {
      out += n;
    }
  }
  return out;
}

/** Encode un texte en littéral CSS ASCII (`"…"`) : tout caractère hors `[A-Za-z0-9 _.,-]` devient `\HEX `. */
export function encodeCssString(text: string): string {
  let out = "";
  for (const ch of text) {
    out += /[A-Za-z0-9 _.,-]/.test(ch) ? ch : `\\${ch.codePointAt(0)!.toString(16)} `;
  }
  return `"${out}"`;
}

export function tokenizeValue(src: string, opts: { maxLength: number; maxTokens: number; maxNesting: number }): LexResult {
  if (src.length > opts.maxLength) return { error: "too-long", at: 0 };
  const tokens: Tok[] = [];
  let depth = 0;
  let i = 0;
  const n = src.length;
  const push = (t: Tok) => {
    if (t.k === "ws" && (tokens.length === 0 || tokens[tokens.length - 1]!.k === "ws")) return;
    tokens.push(t);
  };
  while (i < n) {
    if (tokens.length > opts.maxTokens) return { error: "too-many-tokens", at: i };
    const c = src[i]!;
    const code = src.charCodeAt(i);
    // commentaire : équivaut à une espace
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end < 0) return { error: "unterminated", at: i };
      push({ k: "ws" });
      i = end + 2;
      continue;
    }
    if (isSpace(c)) {
      push({ k: "ws" });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = src[j]!;
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          break;
        }
        if (d === "\n" || d === "\r" || d === "\f") return { error: "unterminated", at: i };
        j++;
      }
      if (!closed) return { error: "unterminated", at: i };
      const decoded = decodeCssString(src.slice(i + 1, j));
      if (decoded === null) return { error: "unterminated", at: i };
      push({ k: "str", v: decoded });
      i = j + 1;
      continue;
    }
    if (code < 32 || code > 126) return { error: "non-ascii-char", at: i, char: c };
    if (c === "\\") return { error: "escape-sequence", at: i };
    if (isDigit(c) || (c === "." && isDigit(src[i + 1] ?? "")) || ((c === "-" || c === "+") && (isDigit(src[i + 1] ?? "") || (src[i + 1] === "." && isDigit(src[i + 2] ?? ""))))) {
      const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
      if (!m) return { error: "number-bad", at: i };
      const raw = m[0];
      const value = Number(raw);
      if (!Number.isFinite(value) || raw.length > 24) return { error: "number-bad", at: i };
      i += raw.length;
      if (src[i] === "%") {
        push({ k: "dim", n: value, unit: "%", raw: raw + "%" });
        i++;
      } else if (i < n && isIdentStart(src[i]!)) {
        let j = i;
        while (j < n && isIdentChar(src[j]!)) j++;
        const unit = src.slice(i, j).toLowerCase();
        if (!ALL_UNITS.has(unit)) return { error: "unit-unknown", at: i };
        push({ k: "dim", n: value, unit, raw: raw + unit });
        i = j;
      } else {
        push({ k: "num", n: value, raw });
      }
      continue;
    }
    if (isIdentStart(c) || (c === "-" && (isIdentStart(src[i + 1] ?? "") || src[i + 1] === "-"))) {
      let j = i;
      while (j < n && isIdentChar(src[j]!)) j++;
      const name = src.slice(i, j);
      i = j;
      if (src[i] === "(") {
        i++;
        if (name.toLowerCase() === "url") {
          // jeton `url(` : lecture spéciale, aucun commentaire ni échappement dedans
          while (i < n && isSpace(src[i]!)) i++;
          let path: string;
          if (src[i] === '"' || src[i] === "'") {
            const q = src[i]!;
            const end = src.indexOf(q, i + 1);
            if (end < 0) return { error: "url-bad", at: i };
            const inner = src.slice(i + 1, end);
            if (!/^[A-Za-z0-9._:/-]*$/.test(inner)) return { error: "url-bad", at: i };
            path = inner;
            i = end + 1;
          } else {
            const end = src.indexOf(")", i);
            if (end < 0) return { error: "url-bad", at: i };
            const inner = src.slice(i, end).replace(/[ \t\n\r\f]+$/, "");
            if (!/^[A-Za-z0-9._:/-]*$/.test(inner)) return { error: "url-bad", at: i };
            path = inner;
            i = end;
          }
          while (i < n && isSpace(src[i]!)) i++;
          if (src[i] !== ")") return { error: "url-bad", at: i };
          i++;
          push({ k: "url", v: path });
          continue;
        }
        depth++;
        if (depth > opts.maxNesting) return { error: "nesting-too-deep", at: i };
        push({ k: "fn", v: name.toLowerCase() });
        continue;
      }
      push({ k: "ident", v: name });
      continue;
    }
    switch (c) {
      case "#": {
        let j = i + 1;
        while (j < n && isIdentChar(src[j]!)) j++;
        const h = src.slice(i + 1, j);
        if (!/^[0-9a-fA-F]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return { error: "hash-bad", at: i };
        push({ k: "hash", v: h.toLowerCase() });
        i = j;
        continue;
      }
      case "(":
        depth++;
        if (depth > opts.maxNesting) return { error: "nesting-too-deep", at: i };
        push({ k: "fn", v: "" });
        i++;
        continue;
      case ")":
        depth--;
        if (depth < 0) return { error: "char-forbidden", at: i, char: c };
        push({ k: "close" });
        i++;
        continue;
      case ",":
        push({ k: "comma" });
        i++;
        continue;
      case "/":
        push({ k: "slash" });
        i++;
        continue;
      case "+":
      case "-":
      case "*":
        push({ k: "op", v: c });
        i++;
        continue;
      case "[":
        push({ k: "lbr" });
        i++;
        continue;
      case "]":
        push({ k: "rbr" });
        i++;
        continue;
      default:
        return { error: "char-forbidden", at: i, char: c };
    }
  }
  if (depth !== 0) return { error: "unterminated", at: n };
  while (tokens.length && tokens[tokens.length - 1]!.k === "ws") tokens.pop();
  return { tokens };
}

/** Réécrit les jetons en texte CSS. `url` est confié à `urlOut` (qui décide du chemin servi). */
export function serializeTokens(tokens: readonly Tok[], urlOut: (path: string) => string): string {
  let out = "";
  let last: Tok | null = null;
  let space = false;
  for (const t of tokens) {
    if (t.k === "ws") {
      space = true;
      continue;
    }
    const noSpaceBefore = t.k === "close" || t.k === "comma" || t.k === "rbr";
    const noSpaceAfter = last !== null && (last.k === "fn" || last.k === "lbr");
    if (space && last && !noSpaceBefore && !noSpaceAfter) out += " ";
    space = false;
    switch (t.k) {
      case "ident": out += t.v; break;
      case "fn": out += `${t.v}(`; break;
      case "close": out += ")"; break;
      case "num": case "dim": out += t.raw; break;
      case "hash": out += `#${t.v}`; break;
      case "str": out += encodeCssString(t.v); break;
      case "url": out += urlOut(t.v); break;
      case "comma": out += ","; break;
      case "slash": out += "/"; break;
      case "op": out += t.v; break;
      case "lbr": out += "["; break;
      case "rbr": out += "]"; break;
    }
    last = t;
  }
  return out;
}
