// Menu du site (en-tête public) : le modèle, ses plafonds, la lecture défensive de ce qui est stocké et la conversion de l'ancien menu.
// Logique PURE (ni base ni React) : testée telle quelle ; la base est dans menuStore.ts, le rendu public dans menuResolve.ts, la recherche dans menuCatalog.ts.

/** Réglage où vit le menu (JSON `{ version, items }`). L'ancien réglage `nav.custom` n'est JAMAIS modifié ni supprimé : revenir à un cœur plus ancien reste possible. */
export const MENU_SETTING = "nav.menu";
export const MENU_VERSION = 1;

/** Plafonds (documentés dans docs/PLATFORM.md) : 40 éléments au total (sous-menus compris), 8 par sous-menu, deux niveaux, 80 caractères par libellé. */
export const MENU_MAX_TOTAL = 40;
export const MENU_MAX_CHILDREN = 8;
export const MENU_LABEL_MAX = 80;

/**
 * Ce qui peut entrer dans le menu :
 *  - `system` : une page du cœur (accueil, confidentialité) ;
 *  - `instance` : la page d'une instance de module (une par instance qui a une page) ;
 *  - `entry` : une entrée de contenu publiée (page, article…) ;
 *  - `redirect` : un raccourci de lien (la redirection) ;
 *  - `link` : un lien libre (adresse du site ou adresse complète) ;
 *  - `group` : un sous-menu qui n'est pas une page (un titre seul).
 */
export const MENU_KINDS = ["system", "instance", "entry", "redirect", "link", "group"] as const;
export type MenuKind = (typeof MENU_KINDS)[number];
export const isRefKind = (k: MenuKind): k is "system" | "instance" | "entry" | "redirect" => k !== "link" && k !== "group";

/** Pages du cœur proposées au menu. Une page de module (recherche, contact…) est une instance : elle vient du catalogue des instances. */
export const SYSTEM_PAGES = [
  { key: "home", href: "/", label: "menu.system.home" },
  { key: "privacy", href: "/privacy", label: "menu.system.privacy" },
] as const;
export type SystemKey = (typeof SYSTEM_PAGES)[number]["key"];
export const systemPage = (key: string) => SYSTEM_PAGES.find((p) => p.key === key);

export type MenuLabel = Record<string, string>;
export type MenuNode = {
  kind: MenuKind;
  /** Identifiant de la chose désignée (clé de page système, id d'instance, d'entrée ou de redirection) ; absent pour un lien libre et un sous-menu. */
  ref?: string;
  /** Lien libre seulement. */
  href?: string;
  /** Lien libre et sous-menu : obligatoire (au moins une langue). Autres éléments : facultatif, remplace le nom d'origine dans la langue donnée. */
  label?: MenuLabel;
  /** Sous-menu (un seul niveau sous un élément du menu principal). */
  children?: MenuNode[];
};
export type StoredMenu = { version: number; items: MenuNode[] };

/** Clé d'identité d'un élément qui désigne quelque chose (`instance:abc`) ; null pour un lien libre et un sous-menu. */
export const refKey = (n: Pick<MenuNode, "kind" | "ref">): string | null => (isRefKind(n.kind) && n.ref ? `${n.kind}:${n.ref}` : null);

export const countNodes = (items: readonly MenuNode[]): number => items.reduce((n, i) => n + 1 + (i.children?.length ?? 0), 0);

/** Toutes les clés d'identité présentes dans le menu (tous niveaux). */
export function menuRefKeys(items: readonly MenuNode[]): Set<string> {
  const out = new Set<string>();
  for (const i of items) {
    const k = refKey(i);
    if (k) out.add(k);
    for (const c of i.children ?? []) { const kc = refKey(c); if (kc) out.add(kc); }
  }
  return out;
}

/** Adresses internes (chemin sans langue ni barre finale) des liens libres : un lien libre vers `/blog` compte comme « déjà dans le menu » pour la page /blog. */
export const internalPath = (href: string): string | null => {
  const v = href.trim();
  if (!v.startsWith("/") || v.startsWith("//")) return null;
  const path = (v.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  return path === "" ? "/" : path;
};
export function menuLinkPaths(items: readonly MenuNode[]): Set<string> {
  const out = new Set<string>();
  const add = (n: MenuNode) => { if (n.kind === "link" && n.href) { const p = internalPath(n.href); if (p) out.add(p); } };
  for (const i of items) { add(i); for (const c of i.children ?? []) add(c); }
  return out;
}

/** Cette page est-elle déjà au menu ? Par sa référence, ou parce qu'un lien libre mène à la même adresse. */
export const alreadyInMenu = (item: { kind: string; ref: string; path: string }, items: readonly MenuNode[]): boolean => {
  if (menuRefKeys(items).has(`${item.kind}:${item.ref}`)) return true;
  const p = internalPath(item.path);
  return !!p && menuLinkPaths(items).has(p);
};

// ─── Lecture défensive ──────────────────────────────────────────────────────

const REF_RE = /^[A-Za-z0-9_-]{1,64}$/;

function cleanLabel(raw: unknown): MenuLabel | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: MenuLabel = {};
  for (const [locale, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(locale) || typeof v !== "string") continue;
    const text = v.trim().slice(0, MENU_LABEL_MAX);
    if (text) out[locale] = text;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanNode(raw: unknown, depth: number): MenuNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = (MENU_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as MenuKind) : null;
  if (!kind) return null;
  const node: MenuNode = { kind };
  const label = cleanLabel(r.label);
  if (label) node.label = label;
  if (isRefKind(kind)) {
    if (typeof r.ref !== "string" || !REF_RE.test(r.ref)) return null;
    node.ref = r.ref;
  } else if (kind === "link") {
    if (typeof r.href !== "string" || !r.href.trim()) return null;
    node.href = r.href.trim().slice(0, 2000);
  }
  if (depth === 0 && Array.isArray(r.children)) {
    const kids = r.children.slice(0, MENU_MAX_TOTAL).map((c) => cleanNode(c, 1)).filter((c): c is MenuNode => c !== null && c.kind !== "group");
    if (kids.length) node.children = kids;
  }
  return node;
}

/** Ce qui est stocké, assaini : `null` si le réglage est absent ou d'une version inconnue (le cœur retombe alors sur l'état d'avant, voir `legacyMenu`). Ne lève jamais. */
export function parseStoredMenu(raw: unknown): MenuNode[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== MENU_VERSION || !Array.isArray(r.items)) return null;
  const items = r.items.slice(0, MENU_MAX_TOTAL).map((n) => cleanNode(n, 0)).filter((n): n is MenuNode => n !== null);
  // Un sous-menu sans titre ni page n'a rien à montrer : retiré. Le total est repris en main après coup.
  return capTotal(items.filter((n) => n.kind !== "group" || (n.children?.length ?? 0) > 0));
}

/** Garde au plus MENU_MAX_TOTAL éléments (parents compris) en coupant la fin : protège le rendu d'un réglage trafiqué ou trop gros. */
function capTotal(items: MenuNode[]): MenuNode[] {
  let left = MENU_MAX_TOTAL;
  const out: MenuNode[] = [];
  for (const i of items) {
    if (left <= 0) break;
    left--;
    const kids = (i.children ?? []).slice(0, left);
    left -= kids.length;
    const { children: _drop, ...rest } = i;
    void _drop;
    out.push(kids.length ? { ...rest, children: kids } : rest);
  }
  return out;
}

export const serializeMenu = (items: readonly MenuNode[]): StoredMenu => ({ version: MENU_VERSION, items: items.map((n) => ({ ...n })) });

// ─── Migration : l'ancien menu devient le nouveau, sans changer ce que voient les visiteurs ─────────────

/** Une entrée de l'ancien réglage `nav.custom` (lien, ou menu déroulant : `children`, `href` vide). */
export type LegacyNavItem = { label?: Record<string, string>; href?: string; children?: { label?: Record<string, string>; href?: string }[] };

/**
 * Ce que montrait l'en-tête avant ce lot : d'abord les instances « affichées dans le menu » qui ont une page propre (chemin non vide ; dans l'ordre `navOrder`), puis les entrées de
 * `nav.custom` dans leur ordre. `instances` arrive DÉJÀ trié ; `entryByHref` dit quelles adresses internes de `nav.custom` sont des pages publiées (elles
 * deviennent des pages du site qui suivent leur adresse, le libellé enregistré étant gardé tel quel). Le résultat est figé : les modules installés plus tard n'y entrent pas.
 */
export function legacyMenu(opts: {
  instances: readonly { id: string; basePath: string | null; showInNav: boolean }[];
  custom: readonly LegacyNavItem[];
  entryByHref?: ReadonlyMap<string, string>;
}): MenuNode[] {
  const leaf = (n: { label?: Record<string, string>; href?: string }): MenuNode | null => {
    const href = String(n.href ?? "").trim();
    if (!href) return null;
    const label = cleanLabel(n.label);
    const entry = opts.entryByHref?.get(href);
    if (entry) return { kind: "entry", ref: entry, ...(label ? { label } : {}) };
    return { kind: "link", href: href.slice(0, 2000), ...(label ? { label } : {}) };
  };
  const out: MenuNode[] = opts.instances.filter((i) => i.showInNav && !!i.basePath).map((i) => ({ kind: "instance", ref: i.id }));
  for (const item of opts.custom) {
    if (Array.isArray(item.children)) {
      const kids = item.children.map(leaf).filter((c): c is MenuNode => c !== null);
      const label = cleanLabel(item.label);
      if (kids.length && label) out.push({ kind: "group", label, children: kids });
      continue;
    }
    const node = leaf(item);
    if (node) out.push(node);
  }
  return capTotal(out);
}

// ─── Validation à l'enregistrement ──────────────────────────────────────────

/** Une erreur : `path` désigne l'élément (`items.2`, `items.1.items.0`) ; `code` est une clé de message (voir fr.json) ; `values` remplit ses `{}`. */
export type MenuIssue = { path: string; code: "label" | "children" | "total" | "nested"; values?: Record<string, string | number> };

/** Vérifie les plafonds d'un menu composé (le contrôle des adresses et des références est fait par l'action, qui connaît la base). */
export function checkCaps(items: readonly MenuNode[], nameOf: (n: MenuNode) => string = () => ""): MenuIssue[] {
  const issues: MenuIssue[] = [];
  const total = countNodes(items);
  if (total > MENU_MAX_TOTAL) issues.push({ path: "", code: "total", values: { count: total, max: MENU_MAX_TOTAL } });
  items.forEach((n, i) => {
    const kids = n.children?.length ?? 0;
    if (kids > MENU_MAX_CHILDREN) issues.push({ path: `items.${i}`, code: "children", values: { name: nameOf(n), count: kids, max: MENU_MAX_CHILDREN } });
  });
  return issues;
}

// ─── Recherche (accents et majuscules ignorés) ──────────────────────────────

/** Texte comparable : sans accents, en minuscules, espaces normalisés. */
export const foldText = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Chaque mot de la recherche doit se trouver quelque part dans l'un des textes. Recherche vide : tout correspond. */
export function matchesQuery(query: string, ...texts: (string | null | undefined)[]): boolean {
  const words = foldText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const hay = foldText(texts.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

/**
 * Lit une source PAR PAQUETS jusqu'à trouver `limit` résultats ou avoir regardé `maxScan` lignes : jamais tout en mémoire. `fetch(cursor)` rend les
 * lignes suivantes (vide = fin) ; `cursorOf` donne le repère de la dernière ligne lue. Le `next` rendu reprend là où l'on s'est arrêté (sinon null : tout vu).
 */
export async function scanMatches<T>(opts: {
  fetch: (cursor: string | null) => Promise<T[]>;
  cursorOf: (row: T) => string;
  match: (row: T) => boolean;
  limit: number;
  maxScan: number;
  cursor?: string | null;
}): Promise<{ rows: T[]; next: string | null }> {
  const rows: T[] = [];
  let cursor = opts.cursor ?? null;
  let scanned = 0;
  while (scanned < opts.maxScan && rows.length < opts.limit) {
    const batch = await opts.fetch(cursor);
    if (batch.length === 0) return { rows, next: null };
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]!;
      scanned++;
      cursor = opts.cursorOf(row);
      if (opts.match(row)) {
        rows.push(row);
        if (rows.length >= opts.limit) {
          // Les lignes restantes du paquet n'ont pas été regardées : on reprend juste après la dernière gardée.
          return { rows, next: cursor };
        }
      }
    }
  }
  return { rows, next: cursor };
}
