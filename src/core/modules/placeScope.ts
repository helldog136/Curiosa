/**
 * PLACE SCOPE (core 0.34.0): what keeps two modules that share one place page from stepping on each other. Pure logic, no database, no React.
 *
 *  - URL parameters. A module writes `?edit=3` in its links, reads `query.edit`, and answers an action with `redirect: "?done=1"` (module contract, unchanged).
 *    On a place page several modules show side by side, so the core gives each of them its own namespace: the address carries `<instance>.edit=3`, the module
 *    reads `query.edit`, and every `?…` link the module writes is rewritten to its namespace before it is drawn. On the module's own page nothing changes.
 *  - Return address. After an action run from a place page, a `redirect: "?…"` answer comes back to THAT page (it used to go to the module page).
 *  - Field names. A setting key shows as the same field name (`s__enabled`) in the sections of two modules or two instances; the DOM ids must differ.
 */

import { parsePlace } from "./places";

/** Characters of an instance key (`twitch-bot`, `blog-2`): the same rule as the key itself. */
const NS_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** What a module may use as a parameter name once scoped. */
const PARAM_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Namespace of a module's parameters on a shared page: its instance key. */
export const queryNamespace = (instanceKey: string): string => instanceKey;

/**
 * The parameters one module sees on a place page: its own (`<instance>.name`) with the prefix removed. The unprefixed ones (old bookmarks, `?edit=3` written by hand)
 * go to a module only when it is the SOLE contributor of the page: with two modules an unprefixed parameter belongs to nobody.
 */
export function sectionQuery(all: Record<string, string>, instanceKey: string, sole: boolean): Record<string, string> {
  const prefix = `${instanceKey}.`;
  const out: Record<string, string> = {};
  if (sole) for (const [k, v] of Object.entries(all)) if (!k.includes(".") && PARAM_RE.test(k)) out[k] = v;
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(prefix)) continue;
    const name = k.slice(prefix.length);
    if (PARAM_RE.test(name)) out[name] = v;
  }
  return out;
}

/** `?edit=3&tab=x` -> `?blog.edit=3&blog.tab=x`. A bare `?` stays as it is (it clears the address). Anything that is not a query-only link is returned untouched. */
export function scopeQuery(href: string, instanceKey: string): string {
  if (!href.startsWith("?") || !NS_RE.test(instanceKey)) return href;
  const body = href.slice(1);
  if (!body) return href;
  const hash = body.indexOf("#");
  const query = hash === -1 ? body : body.slice(0, hash);
  const rest = hash === -1 ? "" : body.slice(hash);
  return `?${query.split("&").map((pair) => (pair && PARAM_RE.test(pair.split("=")[0]!) ? `${instanceKey}.${pair}` : pair)).join("&")}${rest}`;
}

/** Keys of a block whose string value is a link the module wrote (`href`, `cancelHref`, `closeHref`…). */
const LINK_KEY_RE = /href$/i;

/**
 * True when ONE module contributes to the tab (core 0.45.2: counted per tab, not per page). Only then are the old unprefixed parameters (bookmarks) read by that module:
 * on a tab where two modules show side by side an unprefixed parameter belongs to nobody.
 */
export const soleOnTab = (tab: { sections: readonly { moduleId: string }[] }): boolean => new Set(tab.sections.map((s) => s.moduleId)).size === 1;

/* ───────────── links written inside html and markdown blocks (core 0.45.2) ───────────── */

/** Separators of a query written in markup: `&amp;` first, so that `a=1&amp;b=2` is two pairs and not a pair named `amp;b`. */
const SEP_RE = /(&amp;|&)/;

/** `a=1&amp;b=2` (no `?`, no fragment) -> `<ns>.a=1&amp;<ns>.b=2`. A pair that is not a plain name (`<ns>.a`, `{id}`, `x;y`) is kept as it is: scoping twice is scoping once. */
function scopePairs(query: string, ns: string): string {
  return query.split(SEP_RE).map((part, i) => (i % 2 === 1 || !part ? part : PARAM_RE.test(part.split("=")[0]!) ? `${ns}.${part}` : part)).join("");
}

/** The value of an `href` written in markup: `?a=1#top` -> `?<ns>.a=1#top`. A bare `?`, a path, an absolute address are returned untouched. */
function scopeMarkupHref(value: string, ns: string): string {
  if (!value.startsWith("?") || value.length === 1) return value;
  const hash = value.indexOf("#");
  const query = hash === -1 ? value.slice(1) : value.slice(1, hash);
  return `?${scopePairs(query, ns)}${hash === -1 ? "" : value.slice(hash)}`;
}

/** Tags whose content is not markup: it is skipped, never rewritten. */
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);
/** Form controls whose `name` is a field of the surrounding form. */
const CONTROL_TAGS = new Set(["input", "select", "textarea", "button"]);

type Attr = { name: string; value: string; start: number; end: number; quote: string };

/** Reads the attributes of ONE tag (`<a href="?x=1" class=b>`), one pass, no backtracking. Only quoted values can be rewritten. */
function readAttrs(tag: string): Attr[] {
  const out: Attr[] = [];
  let i = 0;
  const n = tag.length;
  while (i < n) {
    while (i < n && /[\s/]/.test(tag[i]!)) i++;
    const nameStart = i;
    while (i < n && !/[\s=/>]/.test(tag[i]!)) i++;
    const name = tag.slice(nameStart, i).toLowerCase();
    if (!name) break;
    while (i < n && /\s/.test(tag[i]!)) i++;
    if (tag[i] !== "=") continue;
    i++;
    while (i < n && /\s/.test(tag[i]!)) i++;
    const q = tag[i];
    if (q === '"' || q === "'") {
      const close = tag.indexOf(q, i + 1);
      if (close === -1) break;
      out.push({ name, value: tag.slice(i + 1, close), start: i + 1, end: close, quote: q });
      i = close + 1;
    } else {
      const s = i;
      while (i < n && !/\s/.test(tag[i]!)) i++;
      out.push({ name, value: tag.slice(s, i), start: s, end: i, quote: "" });
    }
  }
  return out;
}

/** Index of the `>` that ends the tag whose name ends at `from`, quotes respected; -1 when the tag never closes (the rest of the string is left alone). */
function tagEnd(html: string, from: number): number {
  let q = "";
  for (let i = from; i < html.length; i++) {
    const c = html[i]!;
    if (q) { if (c === q) q = ""; } else if (c === '"' || c === "'") q = c; else if (c === ">") return i;
  }
  return -1;
}

/**
 * `href="?a=1"` of every tag of an html string, and the field names of its `<form method="get">` forms (no `action`, or an empty one), moved to the module's namespace.
 * Only markup is touched: comments, `<script>`/`<style>` content and plain text that merely contains `href="?x=1"` are left as they are. A form with another method or an
 * `action` leaves the page, so it is left alone, and so is a tag that never closes. Linear in the size of the string.
 */
export function scopeHtml(html: string, instanceKey: string): string {
  if (!NS_RE.test(instanceKey) || !html.includes("<") || html.length > 500_000) return html;
  const lower = html.replace(/[A-Z]/g, (c) => c.toLowerCase()); // ASCII only: same length, so the indexes match
  let out = "";
  let last = 0;
  let pos = 0;
  let formScoped = false;
  for (;;) {
    const lt = html.indexOf("<", pos);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const e = html.indexOf("-->", lt + 4);
      if (e === -1) break;
      pos = e + 3;
      continue;
    }
    const m = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(html.slice(lt, lt + 40));
    if (!m) { pos = lt + 1; continue; }
    const closing = m[1] === "/";
    const tagName = m[2]!.toLowerCase();
    const tagStart = lt + m[0].length;
    const end = tagEnd(html, tagStart);
    if (end === -1) break;
    if (closing) {
      if (tagName === "form") formScoped = false;
      pos = end + 1;
      continue;
    }
    const tag = html.slice(tagStart, end);
    const attrs = readAttrs(tag);
    if (tagName === "form") {
      const method = attrs.find((a) => a.name === "method")?.value.trim().toLowerCase() ?? "get";
      const action = attrs.find((a) => a.name === "action")?.value.trim() ?? "";
      formScoped = method === "get" && (action === "" || action === "?");
    }
    const edits: { a: Attr; value: string }[] = [];
    for (const a of attrs) {
      if (a.name === "href" && a.quote) { const v = scopeMarkupHref(a.value, instanceKey); if (v !== a.value) edits.push({ a, value: v }); }
      else if (a.name === "name" && formScoped && CONTROL_TAGS.has(tagName) && PARAM_RE.test(a.value)) edits.push({ a, value: `${instanceKey}.${a.value}` });
    }
    if (edits.length) {
      let t = "";
      let at = 0;
      for (const e of edits) { t += tag.slice(at, e.a.start) + e.value; at = e.a.end; }
      out += html.slice(last, tagStart) + t + tag.slice(at);
      last = end;
    }
    pos = end + 1;
    if (RAW_TEXT_TAGS.has(tagName)) {
      const close = lower.indexOf(`</${tagName}`, pos);
      if (close === -1) break;
      pos = close;
    }
  }
  return out + html.slice(last);
}

/**
 * `[label](?a=1)` of a markdown text: the destination of a link that starts with `?` moves to the module's namespace. Code (fenced blocks and inline spans) is left alone.
 * Reference-style definitions (`[x]: ?a=1`) are not rewritten: write the link inline.
 */
export function scopeMarkdown(text: string, instanceKey: string): string {
  if (!NS_RE.test(instanceKey) || !text.includes("](?") || text.length > 500_000) return text;
  let fenced = false;
  return text.split("\n").map((line) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    if (fenced || !line.includes("](?")) return line;
    return line.split("`").map((seg, i) => {
      if (i % 2 === 1 || !seg.includes("](?")) return seg;
      let res = "";
      let at = 0;
      for (let f = seg.indexOf("](?", at); f !== -1; f = seg.indexOf("](?", at)) {
        const start = f + 2;
        let e = start;
        while (e < seg.length && seg[e] !== ")" && !/\s/.test(seg[e]!)) e++;
        res += seg.slice(at, start) + scopeMarkupHref(seg.slice(start, e), instanceKey);
        at = e;
      }
      return res + seg.slice(at);
    }).join("`");
  }).join("\n");
}

/**
 * The blocks of a module, with every query-only link (`?…`; since 0.45.2 also those written in html and markdown blocks, and the fields of GET forms) moved to the module's namespace. Walks plain JSON (objects and arrays) without changing the input;
 * depth and size are bounded (a block tree is small; a pathological one is returned as it is).
 */
export function scopeBlocks<T>(blocks: T, instanceKey: string): T {
  let budget = 20000;
  const walk = (node: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > 12 || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    const type = (node as Record<string, unknown>).type;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      // (core 0.45.2) The markup a module writes itself: the `html` of an html block, the `text` of a markdown block.
      out[k] = typeof v !== "string" ? walk(v, depth + 1)
        : LINK_KEY_RE.test(k) ? scopeQuery(v, instanceKey)
        : k === "html" && type === "html" ? scopeHtml(v, instanceKey)
        : k === "text" && type === "markdown" ? scopeMarkdown(v, instanceKey)
        : v;
    }
    // (core 0.38.0) A table with a server search: its search parameter and the paging parameters it drops belong to the module's namespace too.
    if (out.type === "table" && out.searchable === "server" && NS_RE.test(instanceKey)) {
      const own = (n: unknown, fallback: string): string => `${instanceKey}.${typeof n === "string" && PARAM_RE.test(n) ? n : fallback}`;
      out.searchParam = own(out.searchParam, "q");
      out.searchReset = (Array.isArray(out.searchReset) ? out.searchReset : ["page"]).filter((r): r is string => typeof r === "string" && PARAM_RE.test(r)).map((r) => own(r, "page"));
    }
    return out;
  };
  return walk(blocks, 0) as T;
}

/**
 * Where an action run from a place page goes back to: the page's own address (`/admin/<group>/<page>[/<tab>]`, or the address of a core page that hosts the
 * section) with the module's scoped parameters. `base` comes from the browser, so it is re-checked here: an admin address, nothing else, no query, no fragment.
 */
export function returnTarget(base: unknown, redirect: string, instanceKey: string): string | null {
  if (typeof base !== "string" || base.length > 200 || !/^\/admin(?:\/[a-z0-9-]{1,24}){1,3}$/.test(base)) return null;
  if (redirect.startsWith("?")) return `${base}${scopeQuery(redirect, instanceKey)}`;
  return null;
}

/** True when the place page address is one the core builds (`/admin/<group>/<page>[/<tab>]`): used to decide the base given to the section's forms. */
export const isPlaceAddress = (path: string): boolean => {
  const m = /^\/admin\/([a-z0-9-]+)\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(path);
  return !!m && !!parsePlace(`${m[1]}.${m[2]}${m[3] ? `.${m[3]}` : ""}`);
};

/**
 * DOM ids and field names of a section's form. The server saves with the plain names (`s__enabled`); the form uses a prefix that is unique per
 * (instance, section), so two sections that show the same setting key on one page never share an `id`, a `for` or an `aria-describedby`.
 */
export const fieldNamespace = (instanceKey: string, sectionId: string): string => `p_${instanceKey.replace(/[^a-z0-9]/g, "_")}_${sectionId.replace(/[^a-z0-9]/g, "_")}__`;

/** Removes the namespace from the names of a posted form (`p_blog_main__s__title` -> `s__title`). Names without the prefix are kept as they are. */
export function stripFieldNamespace(entries: Iterable<[string, FormDataEntryValue]>, ns: string): FormData {
  const out = new FormData();
  for (const [k, v] of entries) out.append(k.startsWith(ns) ? k.slice(ns.length) : k, v);
  return out;
}

/** Adds the namespace back to the names of a server answer (field errors), so that the message lands under the right field. */
export function addFieldNamespace(errors: Record<string, string> | undefined, ns: string): Record<string, string> | undefined {
  if (!errors) return errors;
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [`${ns}${k}`, v]));
}
