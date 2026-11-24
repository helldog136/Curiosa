/**
 * Anchor ids for the headings of a Markdown body, so in-page links such as `[lexicon](#lexicon)` land somewhere.
 * Pure functions, no dependency. The slug follows GitHub's rules: lowercase, accents kept, spaces become hyphens,
 * punctuation is dropped (letters, digits, `_` and `-` stay), duplicates get `-1`, `-2`... The browser decodes
 * percent-encoded fragments, so the ids stay UTF-8.
 */

/** Longest id (in characters) before it is cut: a very long heading must not give an unreadable address. */
export const HEADING_ID_MAX = 80;

/** Used when a heading has no letter or digit left (empty heading, only punctuation or emoji). */
export const HEADING_ID_FALLBACK = "section";

/**
 * Ids already used by the site's own markup (skip link target, menu, search fields, cookie tray, privacy page). A heading whose slug equals one of them
 * is treated like a duplicate and gets a numeric suffix (`content` becomes `content-1`), so a link `#content` always reaches the main area.
 * A test checks that every literal `id="..."` of the site components is listed here.
 */
export const RESERVED_HEADING_IDS: ReadonlySet<string> = new Set([
  "content", "cookies", "site-menu", "site-search-header", "site-search-footer", "site-search-page", "entry-search-input", "entry-search-none",
  "cookie-tray", "cookie-tray-title", "cookie-tray-desc", "cookie-accept", "cookie-refuse", "cookie-settings", "cookie-withdraw", "cookie-close", "cookie-status",
  "code-copy-status", "collage", "credit", "feed-link", "header-button", "header-socials", "hero-video", "news-dot", "panel", "panel-tabs",
  "privacy-cookie-control", "privacy-link", "sound-control",
]);

/** GitHub-style slug of a heading text. Never empty. */
export function headingSlug(text: string): string {
  const slug = text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "") // drops , ' ? : ’ « » ( ) and emoji; keeps accents, digits, _ and -
    .trim()
    .replace(/\s/gu, "-");
  const cut = Array.from(slug).slice(0, HEADING_ID_MAX).join("").replace(/-+$/u, "");
  return cut || HEADING_ID_FALLBACK;
}

/** One slugger per document: remembers the ids handed out so duplicates (and reserved ids) get `-1`, `-2`... */
export function createHeadingSlugger(reserved: ReadonlySet<string> = RESERVED_HEADING_IDS): (text: string) => string {
  const used = new Set<string>(reserved);
  return (text) => {
    const base = headingSlug(text);
    let id = base;
    for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
}

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/** Visible text of a heading: text and inline code, link labels included, images and raw nodes ignored. */
export function headingText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "element" && node.tagName === "img") return "";
  return (node.children ?? []).map(headingText).join("");
}

/** rehype plugin: sets `properties.id` on every h1 to h6 of the tree, in document order (without remark-rehype's `user-content-` prefix). */
export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const slug = createHeadingSlugger();
    const walk = (node: HastNode) => {
      if (node.type === "element" && node.tagName && /^h[1-6]$/.test(node.tagName)) {
        node.properties = { ...node.properties, id: slug(headingText(node)) };
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}
