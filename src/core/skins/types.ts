/**
 * Types communs du mécanisme de skins (docs/SKINS.md §3-§5). Aucune dépendance à Next ni à la base de données.
 */
import type { GlowLevel } from "../glow";
import type { HeaderLayout } from "../header";
import type { Text } from "./messages";
import type { Mode } from "./readability";
import type { TokenType } from "./tokens";

export type { Mode } from "./readability";

/** `tokens.json` d'un skin (§5.4) : chaînes seulement, aucune exécution. */
export type SkinTokensFile = {
  light?: Record<string, string>;
  dark?: Record<string, string>;
  common?: Record<string, string>;
  /** Jetons des pièces de modules : `modules.<idDuModule>` (ignorés si le module n'est pas installé). */
  modules?: Record<string, Record<string, string>>;
};

export type SkinOptionValue = { id: string; label: Text; tokens: Record<string, string> };
export type SkinOption = { id: string; label: Text; default: string; values: SkinOptionValue[] };

/** Valeurs de départ de ce que la personne peut retoucher (§5.2 `defaults`). */
export type SkinDefaults = {
  headerLayout?: HeaderLayout;
  /** `skin` : la police du skin (`--v-font` du skin). */
  font?: "sans" | "serif" | "mono" | "skin";
  glow?: GlowLevel;
  /** `"none"`, `"dusk"`, `"grid"` ou un tableau de couches (format de `core/background.ts`). */
  background?: string | unknown[];
};

/** Un skin prêt à être composé : manifeste et jetons lus, feuille DÉJÀ assainie par `sanitizeSkinCss` (ou vide). */
export type SkinDefinition = {
  id: string;
  version: string;
  name: Text;
  modes: Mode[];
  tokens: SkinTokensFile;
  /** Feuille de style assainie (préfixée par `:root[data-skin="<id>"]`) ; vide pour basic. */
  css: string;
  defaults: SkinDefaults;
  options: SkinOption[];
  /**
   * Vrai pour basic : la personne qui retouche fond, accent, texte ou cartes obtient EXACTEMENT ce qu'elle obtenait avant les skins
   * (palette recalculée à partir de ses choix, jamais de valeur « fixée » par le skin). Les autres skins fixent leurs valeurs (§4.3).
   */
  deriveFromBackground: boolean;
  /** Faux pour basic : pas de `color-scheme` (l'apparence actuelle ne le pose pas). */
  colorScheme: boolean;
};

/** Un jeton déclaré par la pièce d'un module (§8.2) : couche 2, émis AVANT les valeurs du skin. */
export type ModuleTokenDecl = { name: string; type: TokenType; default: string; moduleId?: string };

/** Une paire de couleurs à contrôler pour les pièces de module (§7.1 paire 11). */
export type ModulePairDecl = { fg: string; bg: string };

/** Couleurs retouchées par la personne (valeurs « #rrggbb » valides seulement ; absent = pas de retouche). */
export type ColorRetouch = { background?: string; accent?: string; accent2?: string; surface?: string; text?: string };

export type Retouches = {
  /** `single` : un seul jeu (`theme.*`) ; `both` : un jeu par mode (`theme.light.*`, `theme.dark.*`). */
  palette: "single" | "both";
  single: ColorRetouch;
  light: ColorRetouch;
  dark: ColorRetouch;
  /** Police retouchée (`theme.font`) ; absent = celle du skin. */
  font?: "sans" | "serif" | "mono";
};

export const NO_RETOUCHES: Retouches = { palette: "single", single: {}, light: {}, dark: {} };
