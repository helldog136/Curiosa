import type { MenuSectionId } from "./menuPlacement";

// The four sidebar sections (same list as MENU_SECTIONS in menuPlacement.ts; a test keeps them equal, so the two files do not import each other).
const SECTION_IDS: readonly string[] = ["content", "community", "tools", "connections"];

// Menu path of a module (manifest key `adminMenu`, core 0.13.0): "Networks.Twitch", "Réseaux.Twitch" and "reseaux.twitch" are the same place.
// The module says where its entry sits in the admin sidebar as a dot-separated path of groups (1 to 3 segments); the core builds the tree.
// Pure logic (no database, no React), tested as is. The core never imports a module: it only reads the manifest.

export const MENU_PATH_MAX_DEPTH = 3;
const SEGMENT_MAX = 40;
const ID_MAX = 24;

/** Roots a module can never extend: they belong to the core. A path starting with one of them is refused. */
const RESERVED_ROOTS: ReadonlySet<string> = new Set(["site", "admin", "administration", "account", "compte"]);

/** A well-known group: canonical id, titles, icon, and the other words (accent-free, lower case) that mean the same. */
export type KnownGroup = { id: string; en: string; fr: string; icon: string; aliases?: readonly string[] };

/** Well-known groups, in display order. A group that is not here shows its own text, with a generic icon, after these, alphabetically. */
export const KNOWN_GROUPS: readonly KnownGroup[] = [
  { id: "content", en: "Content", fr: "Contenu", icon: "📰" },
  { id: "community", en: "Community", fr: "Communauté", icon: "🙌", aliases: ["communaute"] },
  { id: "tools", en: "Tools", fr: "Outils", icon: "🧰", aliases: ["outils"] },
  { id: "connections", en: "Connections", fr: "Connexions", icon: "🔌", aliases: ["connexions"] },
  { id: "networks", en: "Networks", fr: "Réseaux", icon: "🌐", aliases: ["network", "reseaux", "reseau"] },
  { id: "twitch", en: "Twitch", fr: "Twitch", icon: "🟣" },
  { id: "youtube", en: "YouTube", fr: "YouTube", icon: "▶️" },
  { id: "discord", en: "Discord", fr: "Discord", icon: "💬" },
  { id: "instagram", en: "Instagram", fr: "Instagram", icon: "📸" },
  { id: "tiktok", en: "TikTok", fr: "TikTok", icon: "🎵" },
  { id: "x", en: "X", fr: "X", icon: "🐦", aliases: ["twitter", "x-twitter"] },
  { id: "bluesky", en: "Bluesky", fr: "Bluesky", icon: "🦋" },
  { id: "kick", en: "Kick", fr: "Kick", icon: "🟢" },
  { id: "facebook", en: "Facebook", fr: "Facebook", icon: "👥" },
  { id: "mastodon", en: "Mastodon", fr: "Mastodon", icon: "🐘" },
  { id: "reddit", en: "Reddit", fr: "Reddit", icon: "👽" },
  { id: "patreon", en: "Patreon", fr: "Patreon", icon: "🧡" },
  { id: "spotify", en: "Spotify", fr: "Spotify", icon: "🎧" },
  { id: "steam", en: "Steam", fr: "Steam", icon: "🎮" },
  { id: "github", en: "GitHub", fr: "GitHub", icon: "💻" },
];
export const GENERIC_GROUP_ICON = "📁";

const BY_WORD = new Map<string, KnownGroup>();
for (const g of KNOWN_GROUPS) for (const w of [g.id, g.en, g.fr, ...(g.aliases ?? [])]) BY_WORD.set(slug(w), g);

/** "Réseaux " -> "reseaux": no accent, no case, spaces and punctuation become single dashes. */
function slug(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export type MenuSegment = { /** Canonical id: the same for every spelling. */ id: string; /** The text the module wrote (used for the title of an unknown group). */ text: string };

/** The id a segment resolves to ("reseaux" and "Networks" are "networks"); null when nothing usable is left. */
export function segmentId(raw: string): string | null {
  const s = slug(raw);
  if (!s) return null;
  const known = BY_WORD.get(s);
  const id = (known ? known.id : s).slice(0, ID_MAX).replace(/-+$/, "");
  return /^[a-z0-9][a-z0-9-]*$/.test(id) ? id : null;
}

/** Reads "Réseaux.Twitch" -> [{id:"networks"},{id:"twitch"}]. Null when empty, deeper than 3, a segment is empty or too long, or the root belongs to the core. */
export function parseMenuPath(raw: unknown): MenuSegment[] | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(".").map((p) => p.trim());
  if (parts.length < 1 || parts.length > MENU_PATH_MAX_DEPTH || parts.some((p) => p === "" || p.length > SEGMENT_MAX)) return null;
  const out: MenuSegment[] = [];
  for (const p of parts) {
    const id = segmentId(p);
    if (!id) return null;
    out.push({ id, text: p });
  }
  if (RESERVED_ROOTS.has(out[0]!.id)) return null;
  return out;
}

const lang = (locale: string): "en" | "fr" => (/^fr/i.test(locale) ? "fr" : "en");

function titleCase(text: string): string {
  const words = text.trim().replace(/[-_]+/g, " ").split(/\s+/).filter(Boolean);
  return words.map((w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join(" ");
}

export type GroupLabels = Record<string, { en?: string; fr?: string }>;

/** Title of a group: the label a module gave (`adminMenuLabels`), else the well-known title in the language, else the segment's own text, title-cased. */
export function groupTitle(seg: MenuSegment, locale: string, labels: GroupLabels = {}): string {
  const l = lang(locale);
  const custom = labels[seg.id];
  const own = custom?.[l] ?? custom?.en;
  if (own) return own;
  const known = BY_WORD.get(seg.id);
  if (known && known.id === seg.id) return known[l];
  return titleCase(seg.text);
}

export const groupIcon = (id: string): string => KNOWN_GROUPS.find((g) => g.id === id)?.icon ?? GENERIC_GROUP_ICON;

/** The cookie id of a group's open/closed state (letters, digits, dashes; 31 characters at most; a hash tail keeps long paths apart). */
export function groupStateId(ids: readonly string[]): string {
  const joined = `g-${ids.join("-")}`;
  if (joined.length <= 31) return joined;
  let h = 0;
  for (const c of joined) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `${joined.slice(0, 24)}-${h.toString(36).slice(0, 6)}`.slice(0, 31);
}

// ─── Tree ───────────────────────────────────────────────────────────────────

export type TreeItem = { id: string; name: string; badge: number; error: boolean; placement: string; menuPath?: MenuSegment[] | null; menuOrder?: number; connector?: boolean; groupLabels?: GroupLabels; moduleId?: string };
export type MenuNode<T extends TreeItem> = { id: string; /** Ids from the root to this group. */ path: string[]; title: string; icon: string; entries: T[]; children: MenuNode<T>[]; badge: number; count: number };
export type MenuTree<T extends TreeItem> = {
  /** Groups whose root is one of the existing sections: they are added inside that section (after its own entries). `entries` are the entries declared with the section alone. */
  sections: Partial<Record<MenuSectionId, MenuNode<T>>>;
  /** Every other root group: the new top-level collapsible groups, in display order. */
  groups: MenuNode<T>[];
};

const KNOWN_ORDER = new Map(KNOWN_GROUPS.map((g, i) => [g.id, i]));
const DEFAULT_ORDER = 100;

/** Entries of one group: `adminMenuOrder` first, then connectors (the connection comes before the rest), then alphabetical. */
export function sortEntries<T extends TreeItem>(items: readonly T[], locale: string): T[] {
  return [...items].sort((a, b) => (a.menuOrder ?? DEFAULT_ORDER) - (b.menuOrder ?? DEFAULT_ORDER) || Number(!!b.connector) - Number(!!a.connector) || a.name.localeCompare(b.name, locale, { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));
}

/** Well-known groups in their fixed order, the others alphabetical after them. */
function sortGroups<T extends TreeItem>(nodes: MenuNode<T>[], locale: string): MenuNode<T>[] {
  return nodes.sort((a, b) => (KNOWN_ORDER.get(a.id) ?? 1e6) - (KNOWN_ORDER.get(b.id) ?? 1e6) || a.title.localeCompare(b.title, locale, { sensitivity: "base" }));
}

/**
 * Builds the sidebar tree from the declared paths. Only pinned instances that run take part; an instance without a path is not here (it keeps its section).
 * A group exists as soon as it holds an entry, directly or below. Nothing is hard-coded to networks.
 */
export function buildMenuTree<T extends TreeItem>(items: readonly T[], locale: string, isPinned: (placement: string) => boolean = (p) => p === "menu"): MenuTree<T> {
  const withPath = items.filter((i) => i.menuPath && i.menuPath.length > 0 && !i.error && isPinned(i.placement));
  // Stable: the labels and the text of an unknown group come from the first module in id order, never from the order of the database.
  const ordered = [...withPath].sort((a, b) => (a.moduleId ?? "").localeCompare(b.moduleId ?? "") || a.id.localeCompare(b.id));
  const labels: GroupLabels = {};
  const texts = new Map<string, MenuSegment>();
  for (const i of ordered) {
    for (const [k, v] of Object.entries(i.groupLabels ?? {})) labels[k] = { ...v, ...labels[k] };
    for (const s of i.menuPath!) if (!texts.has(s.id)) texts.set(s.id, s);
  }
  const root: MenuNode<T> = { id: "", path: [], title: "", icon: "", entries: [], children: [], badge: 0, count: 0 };
  for (const item of ordered) {
    let node = root;
    const path: string[] = [];
    for (const seg of item.menuPath!) {
      path.push(seg.id);
      let child = node.children.find((c) => c.id === seg.id);
      if (!child) {
        child = { id: seg.id, path: [...path], title: groupTitle(texts.get(seg.id) ?? seg, locale, labels), icon: groupIcon(seg.id), entries: [], children: [], badge: 0, count: 0 };
        node.children.push(child);
      }
      node = child;
    }
    node.entries.push(item);
  }
  const finish = (n: MenuNode<T>): void => {
    n.entries = sortEntries(n.entries, locale);
    n.children.forEach(finish);
    sortGroups(n.children, locale);
    n.badge = n.entries.reduce((s, e) => s + e.badge, 0) + n.children.reduce((s, c) => s + c.badge, 0);
    n.count = n.entries.length + n.children.reduce((s, c) => s + c.count, 0);
  };
  finish(root);
  const sections: MenuTree<T>["sections"] = {};
  const groups: MenuNode<T>[] = [];
  for (const c of root.children) {
    if (SECTION_IDS.includes(c.id)) sections[c.id as MenuSectionId] = c;
    else groups.push(c);
  }
  return { sections, groups: sortGroups(groups, locale) };
}

/** Every address-bearing entry below a node, for "is the current page in this group". */
export function nodeEntries<T extends TreeItem>(n: MenuNode<T>): T[] {
  return [...n.entries, ...n.children.flatMap(nodeEntries)];
}
