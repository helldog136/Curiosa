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
 * The blocks of a module, with every query-only link (`?…`) moved to the module's namespace. Walks plain JSON (objects and arrays) without changing the input;
 * depth and size are bounded (a block tree is small; a pathological one is returned as it is).
 */
export function scopeBlocks<T>(blocks: T, instanceKey: string): T {
  let budget = 20000;
  const walk = (node: unknown, depth: number): unknown => {
    if (--budget < 0 || depth > 12 || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = typeof v === "string" && LINK_KEY_RE.test(k) ? scopeQuery(v, instanceKey) : walk(v, depth + 1);
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
