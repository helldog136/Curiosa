import { missingSettings, type FillField } from "./missingSettings";

// Rangement des instances dans le menu de l'admin : « épinglée au menu » (placement « menu ») ou « seulement dans Extensions » (les autres valeurs). Logique pure (ni base ni React), testée telle quelle.

/**
 * Où une instance apparaît. « menu » = épinglée : elle a sa place dans le menu (on y travaille souvent), dans sa rubrique (voir `defaultSection`).
 * « integrations » et « overlays » = seulement dans Extensions > Installées (réglée une fois ; « overlays » pour une source navigateur OBS). Les valeurs gardent leur nom d'avant la refonte du menu : les choix déjà enregistrés restent valables.
 */
export const PLACEMENTS = ["menu", "integrations", "overlays"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Choix de l'utilisateur, stocké avec l'instance (réglage du cœur, jamais dans le module). Absent = la règle par défaut. */
export const placementSettingKey = (instanceId: string): string => `instance.${instanceId}.__placement`;

/** Épinglée au menu ? Toute autre valeur : l'instance ne vit que dans Extensions. */
export const isPinned = (p: Placement): boolean => p === "menu";

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

/** Les rangements possibles d'une instance de ce module : épinglée, ou seulement dans Extensions (« overlays » pour un overlay, « integrations » pour le reste). */
export const placementsFor = (m: PlacementManifest): Placement[] => (isOverlayManifest(m) ? ["menu", "overlays"] : ["menu", "integrations"]);

/** Le rangement « seulement dans Extensions » qui correspond à ce module (celui que choisit « Retirer du menu »). */
export const unpinnedPlacementFor = (m: PlacementManifest): Placement => (isOverlayManifest(m) ? "overlays" : "integrations");

// ─── Rubriques et groupes du menu ───────────────────────────────────────────

/** Rubriques du menu où se rangent les instances épinglées : « Mon contenu » (on y écrit) et « Ma communauté » (relations, pages interactives). */
export const MENU_SECTIONS = ["content", "community"] as const;
export type MenuSectionId = (typeof MENU_SECTIONS)[number];

/**
 * Rubrique par défaut d'un module, déduite de son manifeste (aucun champ en plus à renseigner) : un module à contenu (blog, pages, sponsoring…)
 * ou de catégorie « content » → « Mon contenu » ; tout le reste (outils de relation, pages animées, widgets) → « Ma communauté ».
 */
export function defaultSection(m: Pick<PlacementManifest, "type" | "content">): MenuSectionId {
  return m.content || m.type === "content" ? "content" : "community";
}

/** Groupes pliables de « Ma communauté », dans l'ordre d'affichage. « other » reçoit les catégories inconnues ou absentes (modules tiers). */
export const MENU_GROUPS = ["utility", "widget", "other"] as const;
export type MenuGroupId = (typeof MENU_GROUPS)[number];

/** Groupe d'une catégorie de module : outils (contacts, partenariats) → « utility » ; pages animées (planning, formulaire) → « widget » ; le reste → « other ». */
export function menuGroupOf(type: string): MenuGroupId {
  return type === "utility" ? "utility" : type === "widget" ? "widget" : "other";
}

export type MenuEntry = { id: string; type: string; section: MenuSectionId; placement: Placement; error: boolean; badge: number; content: boolean };
export type MenuLayout<T extends MenuEntry> = {
  /** Instances épinglées de la rubrique « Mon contenu ». */
  content: T[];
  /** Instances épinglées de « Ma communauté » : en liste simple, ou en groupes pliables quand elles sont nombreuses (`collapsible`). Les groupes vides n'existent pas. */
  community: { items: T[]; groups: { id: MenuGroupId; items: T[] }[]; collapsible: boolean };
  /** Pastilles des instances qui ne sont PAS épinglées : elles remontent sur l'entrée Extensions. */
  unpinnedBadge: number;
};

/**
 * Répartit les instances : seules les épinglées qui tournent (sans erreur de données) figurent dans le menu, chacune dans sa rubrique.
 * Les autres ne vivent que dans Extensions, et leurs pastilles s'additionnent dans `unpinnedBadge` pour ne rien cacher.
 * Dès qu'il y a plus de OPEN_BY_DEFAULT_MAX entrées dans « Ma communauté », elles passent en groupes pliables.
 */
export function buildMenuLayout<T extends MenuEntry>(items: readonly T[]): MenuLayout<T> {
  const pinned = items.filter((i) => !i.error && isPinned(i.placement));
  const content = pinned.filter((i) => i.section === "content");
  const rest = pinned.filter((i) => i.section === "community");
  const groups = MENU_GROUPS.map((id) => ({ id, items: rest.filter((i) => menuGroupOf(i.type) === id) })).filter((g) => g.items.length > 0);
  const unpinnedBadge = items.reduce((n, i) => n + (!isPinned(i.placement) && !i.error ? i.badge : 0), 0);
  return { content, community: { items: groups.flatMap((g) => g.items), groups, collapsible: rest.length > OPEN_BY_DEFAULT_MAX }, unpinnedBadge };
}

/** Pastille de l'entrée Extensions : mises à jour de modules + modules à régler (à configurer ou en erreur) + pastilles des modules non épinglés. */
export function extensionsBadge(i: { modulesBehind: number; toSetUp: number; unpinnedBadge: number }): { count: number; onlyUpdates: boolean } {
  const other = i.toSetUp + i.unpinnedBadge;
  return { count: i.modulesBehind + other, onlyUpdates: i.modulesBehind > 0 && other === 0 };
}

// ─── Plié / déplié ──────────────────────────────────────────────────────────

/** Cookie du navigateur : lu côté serveur pour que le menu s'affiche tout de suite dans le bon état (aucun clignotement). */
export const NAV_STATE_COOKIE = "curiosa_nav_groups";

/** Jusqu'à ce nombre d'entrées dans « Ma communauté », elles restent en liste simple ; au-delà, elles passent en groupes pliables, repliés par défaut (sauf celui de la page ouverte). */
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

export type IntegrationState = "on" | "setup" | "error";

/** État d'une carte : une erreur signalée passe avant tout, puis « à configurer ». Il n'y a pas d'état « éteint » : une instance qui existe tourne. */
export function integrationState(i: { error: boolean; toFill: boolean }): IntegrationState {
  if (i.error) return "error";
  return i.toFill ? "setup" : "on";
}

/**
 * Un réglage à remplir (clé, adresse, identifiant… encore vide, sans valeur par défaut, hors groupes et réglages facultatifs) manque-t-il ?
 * Sert à l'état « à configurer » de l'instance ; la liste de ce qui manque est dans `missingSettings`.
 */
export function settingsToFill(fields: readonly FillField[], groupedKeys: ReadonlySet<string>, stored: Record<string, Record<string, unknown> | undefined>): boolean {
  return missingSettings(fields, groupedKeys, stored).length > 0;
}
