import { parsePlace, placeId } from "./places";

/**
 * GLOBAL SETTINGS SEARCH (core 0.33.0), pure part: entries, the query language and the ranking. No database, no React, no network.
 * Entries come from the place index (module sections and their settings) and from the core's own sections (`coreSections.ts`); the server builds them
 * (`placeSearchLoad.ts`), the browser filters them with these same functions while the person types (no module script runs, only data).
 *
 * Query: words (every word must be found, accents and capitals do not matter) and VS Code-like filters, written in the box or chosen with the chips:
 *   `@module:alertes`   only what a module (or "core") adds            `@path:live.alerts`  only under that place (group, page or tab)
 *   `@advanced`         only advanced settings                           `@modified`          only settings that are not at their default
 */
export type SearchEntry = {
  id: string;
  kind: "section" | "setting";
  /** The setting label, or the section title. */
  title: string;
  /** The section the entry belongs to (the same text as `title` for a section). */
  sectionTitle: string;
  /** "core" for the core's own sections, else the module id. */
  moduleId: string;
  moduleName: string;
  /** « En direct › Alertes › Apparence ». */
  breadcrumb: string;
  /** `group.page[.tab]`. */
  place: string;
  /** Stable deep link: `/admin/<group>/<page>[/<tab>]#<instance>.<section>`; a core section leads to the core page. */
  href: string;
  advanced: boolean;
  modified: boolean;
  /** A short help text, searched but not shown in full. */
  help?: string;
};

export type SearchFilters = { module?: string; path?: string; advanced?: boolean; modified?: boolean };
export type ParsedSearch = { words: string[]; filters: SearchFilters; text: string };

/** No accent, no capital, single spaces. */
export const foldSearch = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Splits what was typed into words and `@filters`. An unknown `@word` stays a word (it may be part of a title). */
export function parseSearch(raw: string, extra: SearchFilters = {}): ParsedSearch {
  const filters: SearchFilters = { ...extra };
  const words: string[] = [];
  for (const token of foldSearch(raw).split(" ").filter(Boolean)) {
    const m = /^@(module|path)[:=](.{1,64})$/.exec(token);
    if (m) { if (m[1] === "module") filters.module = m[2]; else filters.path = m[2]; continue; }
    if (token === "@advanced") { filters.advanced = true; continue; }
    if (token === "@modified") { filters.modified = true; continue; }
    words.push(token);
  }
  return { words, filters, text: words.join(" ") };
}

/** Is the entry under the given place prefix (`live`, `live.alerts`, `live.alerts.look`)? */
export function underPath(place: string, prefix: string): boolean {
  const p = parsePlace(place);
  if (!p) return false;
  const q = prefix.split(".").filter(Boolean);
  const mine = [p.group, p.page, ...(p.tab ? [p.tab] : [])];
  return q.length > 0 && q.length <= mine.length && q.every((x, i) => mine[i] === x);
}

type Folded = { title: string; section: string; crumb: string; module: string; help: string };
const foldedCache = new WeakMap<SearchEntry, Folded>();
function folded(e: SearchEntry): Folded {
  let f = foldedCache.get(e);
  if (!f) { f = { title: foldSearch(e.title), section: foldSearch(e.sectionTitle), crumb: foldSearch(e.breadcrumb), module: foldSearch(`${e.moduleName} ${e.moduleId}`), help: foldSearch(e.help ?? "") }; foldedCache.set(e, f); }
  return f;
}

/** Score of one entry for the words (0 = no match). Title beats section, section beats path and module, help comes last; a section beats a setting at equal score. */
function score(e: SearchEntry, words: string[]): number {
  const f = folded(e);
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (f.title.startsWith(w) || f.title.includes(` ${w}`)) s = 6;
    else if (f.title.includes(w)) s = 5;
    else if (f.section.includes(w)) s = 4;
    else if (f.crumb.includes(w)) s = 3;
    else if (f.module.includes(w)) s = 2;
    else if (f.help.includes(w)) s = 1;
    if (s === 0) return 0;
    total += s;
  }
  return total * 2 + (e.kind === "section" ? 1 : 0);
}

/** The entries that match, best first. With no word, the filters alone decide (the order stays the one of the sidebar). */
export function searchEntries(entries: readonly SearchEntry[], q: ParsedSearch, limit = 60): SearchEntry[] {
  const f = q.filters;
  const mod = f.module ? foldSearch(f.module) : null;
  const keep = entries.filter((e) =>
    (!mod || foldSearch(e.moduleId) === mod || foldSearch(e.moduleName).includes(mod)) &&
    (!f.path || underPath(e.place, f.path)) &&
    (f.advanced === undefined || e.advanced === f.advanced) &&
    (!f.modified || e.modified));
  if (q.words.length === 0) return (f.module || f.path || f.advanced !== undefined || f.modified ? keep : []).slice(0, limit);
  return keep
    .map((e, i) => ({ e, i, s: score(e, q.words) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

/** The modules that appear in the entries, for the "module" filter (name order). */
export function searchModules(entries: readonly SearchEntry[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const e of entries) if (!seen.has(e.moduleId)) seen.set(e.moduleId, e.moduleName);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Highlights are drawn by the page; this returns the pieces of `text` that match a word (folded comparison), so no HTML is ever built from a setting label. */
export function splitMatches(text: string, words: string[]): { text: string; hit: boolean }[] {
  if (words.length === 0) return [{ text, hit: false }];
  // Folding can change the length of a character (never for the Latin accents handled here), so the positions are the same in `text` and its folded form.
  const f = text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const map: number[] = [];
  { let k = 0; for (const ch of text) { const n = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").length; for (let j = 0; j < n; j++) map.push(k); k += ch.length; } map.push(text.length); }
  const lower = f.toLowerCase();
  const hits: [number, number][] = [];
  for (const w of words) { let at = lower.indexOf(w); while (at !== -1 && w.length > 0) { hits.push([at, at + w.length]); at = lower.indexOf(w, at + w.length); } }
  hits.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const h of hits) { const last = merged[merged.length - 1]; if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]); else merged.push([...h]); }
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    const from = map[a] ?? text.length, to = map[b] ?? text.length;
    if (from > pos) out.push({ text: text.slice(pos, from), hit: false });
    if (to > from) out.push({ text: text.slice(from, to), hit: true });
    pos = Math.max(pos, to);
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

export const placeKey = placeId;
