import { hasPage, type ParsedManifest } from "./manifest";
import type { LocalizedString } from "./types";

/**
 * Ce que la FICHE d'une extension dit, dans l'ordre voulu : d'abord ce que fait le module (description, visuels, ce qu'il ajoute), ensuite les détails techniques
 * (données, autorisations, dépendances, version, source). Ce fichier ne garde que la logique pure (testée sans rendu) ; les textes viennent de `fiche.*` dans les dictionnaires.
 */
export type AddKind = "page" | "content" | "settings" | "sections" | "overlay" | "tools";
export type AddItem = { kind: AddKind; icon: string; /** Nombre d'éléments (overlay, outils). */ n?: number; /** Noms lisibles (éléments d'overlay), 3 au plus. */ names?: string };

/** Ce que le module AJOUTE à la personne : une page publique, un espace de contenus, un écran de réglages, des blocs d'accueil, des éléments d'overlay, des outils pour l'assistant IA. */
export function whatItAdds(m: ParsedManifest, label: (v: LocalizedString) => string): AddItem[] {
  const out: AddItem[] = [];
  if (hasPage(m)) out.push({ kind: "page", icon: "🌐" });
  if (m.content) out.push({ kind: "content", icon: "✍️" });
  if (m.settings.length > 0 || m.permissions.includes("admin")) out.push({ kind: "settings", icon: "⚙️" });
  if (m.sections.length > 0) out.push({ kind: "sections", icon: "🧩" });
  const overlay = m.overlayElements ?? [];
  if (overlay.length > 0) {
    const shown = overlay.slice(0, 3).map((e) => label(e.label));
    out.push({ kind: "overlay", icon: "🎬", n: overlay.length, names: shown.join(", ") + (overlay.length > shown.length ? "…" : "") });
  }
  const tools = (m.mcp ?? []).length;
  if (tools > 0) out.push({ kind: "tools", icon: "🤖", n: tools });
  return out;
}

export type KeepsKind = "privacy" | "storage" | "none";

/** Résumé d'une ligne des détails techniques : ce que le module garde, combien d'autorisations il demande. `perms` : celles que la fiche sait expliquer en clair. */
export function techSummary(m: Pick<ParsedManifest, "privacy" | "permissions">, perms: readonly string[]): { keeps: KeepsKind; asks: number } {
  return { keeps: m.privacy ? "privacy" : m.permissions.includes("storage") ? "storage" : "none", asks: perms.length };
}

export type BarReason = "read" | "incompatible" | "core" | "deps";
export type BarState =
  | { kind: "hidden" }
  /** Le module est déjà là : la barre renvoie vers sa page, sans bouton d'installation. */
  | { kind: "installed" }
  /** Installation impossible : le bouton est inactif et la raison est écrite à côté. */
  | { kind: "blocked"; reason: BarReason }
  /** Installation possible ; `confirm` : module non vérifié, une case à cocher accompagne le bouton. */
  | { kind: "ready"; confirm: boolean };

/**
 * État de la barre d'installation toujours visible en bas de la fiche. Rien pour qui ne peut pas installer, ni pour une fiche sans module lisible.
 * Les raisons, par ordre : lecture impossible, incompatible avec cette version du framework, cœur trop ancien, prérequis manquant.
 */
export function installBarState(i: {
  canInstall: boolean; hasModule: boolean; failed: boolean; installed: boolean;
  entry?: { compatible: boolean; needsNewerCore?: string; origin: "official" | "extra" };
  problems: number;
}): BarState {
  if (!i.canInstall || !i.hasModule) return { kind: "hidden" };
  if (i.installed) return { kind: "installed" };
  if (i.failed) return { kind: "blocked", reason: "read" };
  if (i.entry && !i.entry.compatible) return { kind: "blocked", reason: "incompatible" };
  if (i.entry?.needsNewerCore) return { kind: "blocked", reason: "core" };
  if (i.problems > 0) return { kind: "blocked", reason: "deps" };
  return { kind: "ready", confirm: !i.entry || i.entry.origin === "extra" };
}
