/**
 * COUCHE 2 : les pièces des modules (docs/SKINS.md §8). Le lot « pièces de modules » remplira `getModuleSkinLayer()` à partir de la clé `skin` des
 * `module.json` des modules actifs ; tant qu'aucun module ne déclare de pièce, la couche est vide et la composition ne change rien.
 * Interface seulement : ne lit ni la base ni les modules.
 */
import type { ModulePairDecl, ModuleTokenDecl } from "./types";

export type ModuleSkinLayer = {
  /** Jetons déclarés par les pièces (nom, type, valeur par défaut) : émis AVANT les valeurs du skin. */
  tokens: readonly ModuleTokenDecl[];
  /** Paires texte / fond à contrôler (paire 11 de la lisibilité). */
  pairs: readonly ModulePairDecl[];
  /** Change quand la liste des pièces change (clé de cache). */
  version: string;
};

export const EMPTY_MODULE_LAYER: ModuleSkinLayer = { tokens: [], pairs: [], version: "0" };

export async function getModuleSkinLayer(): Promise<ModuleSkinLayer> {
  return EMPTY_MODULE_LAYER;
}
