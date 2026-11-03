import { BODY_CHARS, fold, plainText, snippet, type Segment } from "./text";

/**
 * L'extrait d'un résultat (pur) : le résumé s'il contient un des mots, sinon le passage du corps qui le contient ; à défaut, le début du résumé, puis du corps.
 * `body` est le corps Markdown d'origine (vide pour un élément de module).
 */
export function excerptFor(summary: string, body: string, words: readonly string[]): Segment[] {
  const has = (text: string) => { const f = fold(text); return words.some((w) => f.includes(w)); };
  if (summary !== "" && has(summary)) return snippet(summary, words);
  const plain = body === "" ? "" : plainText(body).slice(0, BODY_CHARS);
  if (plain !== "" && has(plain)) return snippet(plain, words);
  return snippet(summary !== "" ? summary : plain, words);
}
