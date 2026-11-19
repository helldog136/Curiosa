/**
 * `ctx.search` (core 0.38.0): the matching rule of the live search, for a module that filters its own list on the server (`table` with `searchable: "server"`).
 * Pure functions: nothing is read or written. Same rule as the core lists: case and accents ignored, every word typed must be found (in any order, anywhere in the
 * text you pass), a single letter already filters. An older core has no `ctx.search`: a module tests `typeof ctx.search?.matches === "function"`.
 *
 *  - `fold(text)`: the text without accents or capitals ("Éléonore" -> "eleonore").
 *  - `query(raw)`: the search text of the address (`query.q`), trimmed and bounded (80 characters); "" when absent.
 *  - `matches(parts, raw)`: true when `raw` is empty or every word of it appears in `parts` (a string or a list of strings / numbers; empty values are skipped).
 */
import { matchesSearch, searchText } from "@/core/adminkit/search";
import { foldText } from "@/core/modules/installedList";
import { SERVER_SEARCH_MAX } from "@/core/adminkit/table";

export type SearchKit = {
  fold(text: string): string;
  query(raw: unknown): string;
  matches(parts: string | number | null | undefined | readonly (string | number | null | undefined | false)[], raw: unknown): boolean;
};

export const searchKit: SearchKit = Object.freeze({
  fold: (text) => foldText(String(text ?? "")),
  query: (raw) => (typeof raw === "string" ? raw.trim().slice(0, SERVER_SEARCH_MAX) : ""),
  matches: (parts, raw) => matchesSearch(searchText(Array.isArray(parts) ? parts : [parts as string | number | null | undefined]), typeof raw === "string" ? raw.slice(0, SERVER_SEARCH_MAX) : ""),
});
