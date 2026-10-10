// Rangement des instances dans le menu de l'admin : « épinglée au menu », « rangée dans Intégrations » ou « rangée dans Overlays ». Logique pure (ni base ni React), testée telle quelle.

/** Où une instance apparaît : directement dans le menu (on y travaille souvent), dans la page Intégrations (réglée une fois), ou dans la page Overlays (sources navigateur pour OBS : une famille à part). */
export const PLACEMENTS = ["menu", "integrations", "overlays"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Choix de l'utilisateur, stocké avec l'instance (réglage du cœur, jamais dans le module). Absent = la règle par défaut. */
export const placementSettingKey = (instanceId: string): string => `instance.${instanceId}.__placement`;

export const parsePlacement = (v: unknown): Placement | null => ((PLACEMENTS as readonly string[]).includes(String(v)) ? (v as Placement) : null);

/** Ce que la règle lit dans le manifeste d'un module (les autres champs sont ignorés). */
export type PlacementManifest = {
  type?: string;
  content?: { display?: string; clickAction?: string } | null;
  mcp?: readonly unknown[];
  offers?: readonly unknown[];
  requires?: readonly unknown[];
  permissions?: readonly string[];
};

/** Un module de type « overlay », ou qui déclare la permission « overlay » : une source navigateur pour OBS. */
export function isOverlayManifest(m: Pick<PlacementManifest, "type" | "permissions">): boolean {
  return m.type === "overlay" || (m.permissions ?? []).includes("overlay");
}

/**
 * RÈGLE PAR DÉFAUT, déterministe, lue dans le manifeste seul :
 * 0. type « overlay » ou permission « overlay » : famille à part → Overlays (ni menu de travail ni Intégrations) ;
 * 1. catégorie « social » ou « integration » : se règle une fois → Intégrations ;
 * 2. module à contenu : on y écrit → menu, SAUF une simple liste de liens qui s'ouvrent ailleurs (affichage « links » + clic externe : vos réseaux, vos chaînes), qui se règle une fois → Intégrations ;
 * 3. les autres (widget, outil…) : des données à gérer (actions MCP, service offert ou service de stockage requis) → menu ; sinon rien à entretenir → Intégrations.
 */
export function defaultPlacement(m: PlacementManifest): Placement {
  if (isOverlayManifest(m)) return "overlays";
  const type = m.type ?? (m.content ? "content" : "widget");
  if (type === "social" || type === "integration") return "integrations";
  if (m.content) return m.content.display === "links" && m.content.clickAction === "external" ? "integrations" : "menu";
  if (type === "content") return "menu";
  const manages = (m.mcp?.length ?? 0) > 0 || (m.offers?.length ?? 0) > 0 || (m.requires?.length ?? 0) > 0;
  return manages ? "menu" : "integrations";
}

/**
 * Le choix de l'utilisateur l'emporte sur la règle par défaut. Seul un overlay peut être rangé dans Overlays (la page y affiche l'adresse OBS) :
 * ce choix, posé sur autre chose, est ignoré.
 */
export function resolvePlacement(m: PlacementManifest, pinned: unknown): Placement {
  const chosen = parsePlacement(pinned);
  return chosen && (chosen !== "overlays" || isOverlayManifest(m)) ? chosen : defaultPlacement(m);
}

/** Les rangements possibles d'une instance de ce module (« Overlays » seulement pour un overlay). */
export const placementsFor = (m: PlacementManifest): Placement[] => (isOverlayManifest(m) ? [...PLACEMENTS] : ["menu", "integrations"]);

// ─── Groupes du menu ─────────────────────────────────────────────────────────

/** Groupes pliables de la rubrique « Fonctionnalités », dans l'ordre d'affichage. « other » reçoit les catégories inconnues ou absentes (modules tiers). */
export const MENU_GROUPS = ["utility", "widget", "other"] as const;
export type MenuGroupId = (typeof MENU_GROUPS)[number];

/** Groupe d'une catégorie de module : outils (contacts, partenariats) → « utility » ; pages animées (planning, formulaire) → « widget » ; le reste → « other ». */
export function menuGroupOf(type: string): MenuGroupId {
  return type === "utility" ? "utility" : type === "widget" ? "widget" : "other";
}

export type MenuEntry = { id: string; type: string; placement: Placement; enabled: boolean; error: boolean; badge: number; content: boolean };
export type MenuLayout<T extends MenuEntry> = {
  /** Instances à contenu épinglées : la rubrique « Mon contenu ». */
  content: T[];
  /** Les autres instances épinglées, en groupes (les groupes vides n'existent pas). */
  groups: { id: MenuGroupId; items: T[] }[];
  /** Entrée unique « Intégrations » : nombre d'instances rangées (désactivées comprises) et pastilles remontées. */
  integrations: { items: T[]; count: number; badge: number };
  /** Entrée unique « Overlays » : même principe. */
  overlays: { items: T[]; count: number; badge: number };
};

/**
 * Répartit les instances : seules celles qui tournent (actives, sans erreur de données) figurent dans le menu ;
 * toutes celles rangées dans Intégrations (ou dans Overlays) y sont comptées, et leurs pastilles s'additionnent sur l'entrée.
 */
export function buildMenuLayout<T extends MenuEntry>(items: readonly T[]): MenuLayout<T> {
  const shown = items.filter((i) => i.enabled && !i.error);
  const pinned = shown.filter((i) => i.placement === "menu");
  const parked = items.filter((i) => i.placement === "integrations");
  const overlays = items.filter((i) => i.placement === "overlays");
  const badgeOf = (list: readonly T[]) => list.reduce((n, i) => n + (i.enabled && !i.error ? i.badge : 0), 0);
  const content = pinned.filter((i) => i.type === "content");
  const rest = pinned.filter((i) => i.type !== "content");
  const groups = MENU_GROUPS.map((id) => ({ id, items: rest.filter((i) => menuGroupOf(i.type) === id) })).filter((g) => g.items.length > 0);
  return { content, groups, integrations: { items: parked, count: parked.length, badge: badgeOf(parked) }, overlays: { items: overlays, count: overlays.length, badge: badgeOf(overlays) } };
}

// ─── Plié / déplié ──────────────────────────────────────────────────────────

/** Cookie du navigateur : lu côté serveur pour que le menu s'affiche tout de suite dans le bon état (aucun clignotement). */
export const NAV_STATE_COOKIE = "curiosa_nav_groups";

/** Jusqu'à ce nombre d'instances épinglées, tous les groupes sont dépliés par défaut ; au-delà, ils sont repliés. */
export const OPEN_BY_DEFAULT_MAX = 6;

export type NavState = Record<string, boolean>;

/** « utility:1,widget:0 » → { utility: true, widget: false } ; toute valeur illisible est ignorée. */
export function parseNavState(raw: string | null | undefined): NavState {
  const out: NavState = {};
  for (const part of String(raw ?? "").split(",")) {
    const m = /^([a-z][a-z0-9_-]{0,30}):([01])$/.exec(part.trim());
    if (m) out[m[1]!] = m[2] === "1";
  }
  return out;
}

export function serializeNavState(state: NavState): string {
  return Object.entries(state).filter(([id]) => /^[a-z][a-z0-9_-]{0,30}$/.test(id)).map(([id, open]) => `${id}:${open ? 1 : 0}`).join(",");
}

export const groupOpenByDefault = (pinnedCount: number): boolean => pinnedCount <= OPEN_BY_DEFAULT_MAX;

/** Un groupe est ouvert si la page courante s'y trouve ; sinon selon le dernier choix mémorisé, sinon selon le défaut. */
export function isGroupOpen(id: string, state: NavState, openByDefault: boolean, hasCurrent: boolean): boolean {
  return hasCurrent || (state[id] ?? openByDefault);
}

// ─── Cartes « Intégrations » ────────────────────────────────────────────────

export type IntegrationState = "on" | "off" | "setup" | "error";

/** État d'une carte : une erreur signalée passe avant tout, puis « désactivée », puis « à configurer ». */
export function integrationState(i: { enabled: boolean; moduleEnabled: boolean; error: boolean; toFill: boolean }): IntegrationState {
  if (i.error) return "error";
  if (!i.enabled || !i.moduleEnabled) return "off";
  return i.toFill ? "setup" : "on";
}

type FillField = { key: string; type: string; default?: unknown; translatable?: boolean; advanced?: boolean };

/**
 * Un réglage à remplir (clé, adresse, identifiant… encore vide, sans valeur par défaut, hors groupes facultatifs) manque-t-il ?
 * `stored[clé]` = valeurs enregistrées par langue. Sert à la mention « à compléter » de l'instance et à l'état « à configurer ».
 */
export function settingsToFill(fields: readonly FillField[], groupedKeys: ReadonlySet<string>, stored: Record<string, Record<string, unknown> | undefined>): boolean {
  return fields.some((f) => !groupedKeys.has(f.key) && ["secret", "text", "url", "link"].includes(f.type) && f.default === undefined && !f.translatable && !Object.values(stored[f.key] ?? {}).some((v) => v !== undefined && v !== ""));
}
