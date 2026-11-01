// Familles de la liste « Installées » d'Extensions : Contenu, Communauté, Réseaux et connexions, Overlays. Logique pure (ni base ni React), testée telle quelle.
import { declaredFamily, isOverlayManifest, type PlacementManifest } from "./menuPlacement";
import { platformOf } from "./platform";

export const EXTENSION_FAMILIES = ["content", "community", "connections", "overlays"] as const;
export type ExtensionFamily = (typeof EXTENSION_FAMILIES)[number];

export const parseFamily = (v: unknown): ExtensionFamily | null => ((EXTENSION_FAMILIES as readonly string[]).includes(String(v)) ? (v as ExtensionFamily) : null);

/**
 * Famille d'un module, déduite de son manifeste seul :
 * 0. (0.2.14) `family` déclarée dans le manifeste : elle l'emporte ;
 * 1. overlay (type ou permission) → Overlays ;
 * 2. catégorie « social » ou « integration », plateforme déclarée, ou simple liste de liens vers l'extérieur → Réseaux et connexions (ce qui se règle une fois) ;
 * 3. module à contenu → Contenu ;
 * 4. le reste (outils de relation, pages animées…) → Communauté.
 */
export function extensionFamily(m: PlacementManifest & { platform?: unknown }): ExtensionFamily {
  const declared = declaredFamily(m);
  if (declared) return declared;   // (0.2.14) `family` du manifeste : le module range lui-même sa carte ; sans clé, la déduction ci-dessous
  if (isOverlayManifest(m)) return "overlays";
  if (m.type === "social" || m.type === "integration" || platformOf(m)) return "connections";
  if (m.content) return m.content.display === "links" && m.content.clickAction === "external" ? "connections" : "content";
  return m.type === "content" ? "content" : "community";
}

/** Ordre d'attention d'une carte : une erreur d'abord, puis ce qui reste à configurer, puis ce qui tourne. */
export const ATTENTION_ORDER = { error: 0, setup: 1, on: 2 } as const;
export type AttentionState = keyof typeof ATTENTION_ORDER;

/** L'état « le plus urgent » d'un ensemble d'instances (« on », rien à signaler, s'il n'y en a aucune). */
export function worstState(states: readonly AttentionState[]): AttentionState {
  return states.reduce<AttentionState>((worst, s) => (ATTENTION_ORDER[s] < ATTENTION_ORDER[worst] ? s : worst), "on");
}
