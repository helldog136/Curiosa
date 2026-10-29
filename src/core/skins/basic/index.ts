/**
 * Le skin « basic » EMBARQUÉ dans le cœur (docs/SKINS.md §4.2) : LA BASE de tout. Ses valeurs sont l'apparence ACTUELLE du site, relevées dans le CSS compilé
 * (tests/core/skins-tokens.test.mjs le vérifie). Il n'a qu'un mode (le sombre) : aucune bascule clair/sombre, aucun `color-scheme`, aucun changement pour
 * un site existant. Jamais absent : si un skin disparaît, c'est lui qui s'applique.
 */
import manifest from "./skin.json";
import tokens from "./tokens.json";
import type { SkinDefinition, SkinTokensFile } from "../types";
import type { HeaderLayout } from "../../header";

export const BASIC_ID = "basic";

export const BASIC: SkinDefinition = {
  id: BASIC_ID,
  version: manifest.version,
  name: manifest.name,
  modes: ["dark"],
  tokens: tokens as SkinTokensFile,
  css: "",
  defaults: { headerLayout: manifest.defaults.headerLayout as HeaderLayout, font: "sans", glow: "none", background: "none" },
  options: [],
  deriveFromBackground: true,
  colorScheme: false,
};
