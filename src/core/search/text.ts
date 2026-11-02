/**
 * RECHERCHE DANS LE SITE — le texte (pur : ni base de données, ni horloge, ni réseau ; testé sans navigateur).
 *
 * Une seule idée : comparer des textes « pliés » (sans accents ni majuscules) dont la LONGUEUR ne change jamais. Ainsi une position trouvée dans le texte
 * plié est aussi la position dans le texte d'origine : on peut couper un extrait et mettre le terme en évidence sans jamais perdre un accent.
 * Rien ici n'est une expression régulière construite avec la saisie du visiteur : la recherche est un simple `indexOf`.
 */

/** La requête d'un visiteur est bornée : 100 caractères, 6 mots, 40 caractères par mot. Au-delà, le reste est ignoré (et la page le dit). */
export const QUERY_MAX_CHARS = 100;
export const QUERY_MAX_WORDS = 6;
export const WORD_MAX_CHARS = 40;
/** Le texte d'une fiche qu'on cherche : les 3 000 premiers caractères du corps (brut). L'index et l'extrait coupent au même endroit. */
export const BODY_CHARS = 3000;

/** Lettres qui ne se décomposent pas en « lettre + accent » : repliées à la main (une seule lettre, pour garder la longueur). */
const SPECIAL: Record<string, string> = { ł: "l", Ł: "l", ø: "o", Ø: "o", đ: "d", Đ: "d", ß: "s", ı: "i", "’": "'", "‘": "'", " ": " ", " ": " " };
const MARKS = /[̀-ͯ]/g;
const memo = new Map<string, string>();

/** Un caractère non ASCII, plié en UN caractère de même longueur (repli : le caractère minuscule, ou tel quel). */
function foldOne(ch: string): string {
  const known = memo.get(ch);
  if (known !== undefined) return known;
  let out = SPECIAL[ch] ?? ch.normalize("NFD").replace(MARKS, "").toLowerCase();
  if (out.length !== ch.length) {
    const lower = ch.toLowerCase();
    out = lower.length === ch.length ? lower : ch;
  }
  if (memo.size < 4096) memo.set(ch, out);
  return out;
}

/** Texte plié : minuscules, sans accents, MÊME LONGUEUR que l'entrée (position pour position). Déterministe, sans état. */
export function fold(text: string): string {
  return text.replace(/[^\x00-\x7f]/gu, foldOne).toLowerCase();
}

/** Texte brut d'un contenu Markdown : sans symboles de mise en forme, images, code ni balises ; les espaces sont réduits. Pur et sans coupe. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ParsedQuery =
  /** Rien à chercher (champ vide, ou seulement des espaces et des signes sans valeur). */
  | { kind: "empty" }
  /** `shown` : ce que la page remet dans le champ ; `words` : les mots pliés (sans doublon) ; `trimmed` : la saisie a été raccourcie. */
  | { kind: "query"; shown: string; words: string[]; trimmed: boolean };

/**
 * Lit le paramètre `q` d'une adresse (n'importe quoi peut arriver : absent, répété, très long, caractères de contrôle). Jamais d'exception.
 * Un paramètre répété (`?q=a&q=b`) ne garde que le premier.
 */
export function parseQuery(raw: unknown): ParsedQuery {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return { kind: "empty" };
  // Les caractères de contrôle et les guillemets ne servent à rien dans une recherche par mots : ils séparent.
  const cleaned = first.slice(0, QUERY_MAX_CHARS * 4).replace(/[\u0000-\u001f\u007f-\u009f"“”«»]/g, " ").replace(/\s+/g, " ").trim();
  let trimmed = cleaned.length > QUERY_MAX_CHARS;
  const shown = trimmed ? cleaned.slice(0, QUERY_MAX_CHARS).trim() : cleaned;
  const seen = new Set<string>();
  const words: string[] = [];
  for (const w of shown.split(" ")) {
    const folded = fold(w.slice(0, WORD_MAX_CHARS));
    if (folded === "" || !/[\p{L}\p{N}]/u.test(folded) || seen.has(folded)) continue;
    if (words.length === QUERY_MAX_WORDS) { trimmed = true; break; }
    seen.add(folded);
    words.push(folded);
  }
  return words.length === 0 ? { kind: "empty" } : { kind: "query", shown, words, trimmed };
}

/** Un morceau de texte, mis en évidence ou non. La page en fait du texte ordinaire et des `<mark>` : jamais de HTML construit à la main. */
export type Segment = { text: string; hit: boolean };

/** Découpe `text` selon les endroits où l'un des `words` (déjà pliés) apparaît. Les chevauchements sont fusionnés ; le texte d'origine est conservé tel quel. */
export function highlight(text: string, words: readonly string[]): Segment[] {
  if (text === "") return [];
  const folded = fold(text);
  const ranges: [number, number][] = [];
  for (const w of words) {
    if (w === "") continue;
    for (let at = folded.indexOf(w); at !== -1; at = folded.indexOf(w, at + w.length)) ranges.push([at, at + w.length]);
  }
  if (ranges.length === 0) return [{ text, hit: false }];
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: Segment[] = [];
  let cursor = 0;
  for (const [from, to] of merged) {
    if (from > cursor) out.push({ text: text.slice(cursor, from), hit: false });
    out.push({ text: text.slice(from, to), hit: true });
    cursor = to;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

/** Longueur d'un extrait (caractères). */
export const SNIPPET_CHARS = 200;

/**
 * Un extrait de `plain` (texte brut) autour de la première occurrence d'un des `words`, coupé aux espaces, avec « … » aux coupes, puis mis en évidence.
 * Sans occurrence : le début du texte. Texte vide : liste vide.
 */
export function snippet(plain: string, words: readonly string[], max = SNIPPET_CHARS): Segment[] {
  const text = plain.replace(/\s+/g, " ").trim();
  if (text === "") return [];
  const folded = fold(text);
  let first = -1;
  for (const w of words) {
    const at = w === "" ? -1 : folded.indexOf(w);
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  let start = first === -1 ? 0 : Math.max(0, first - Math.floor(max / 4));
  if (start > 0) { const space = text.indexOf(" ", start); start = space !== -1 && space - start < 25 ? space + 1 : start; }
  let end = Math.min(text.length, start + max);
  if (end < text.length) { const space = text.lastIndexOf(" ", end); end = space > start + max / 2 ? space : end; }
  const cut = text.slice(start, end).trim();
  const segments = highlight(cut, words);
  if (start > 0) segments.unshift({ text: "… ", hit: false });
  if (end < text.length) segments.push({ text: " …", hit: false });
  return segments;
}
