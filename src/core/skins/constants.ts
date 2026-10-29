/**
 * Constantes de l'installation des skins (docs/SKINS.md §5) : bibliothèque PURE (aucun accès réseau, base ou Next).
 * L'adresse du dépôt officiel de skins n'est PAS ici : elle est écrite une seule fois, dans `core/config.ts` (`DEFAULT_SKINS_REPO`).
 */

/** Version du contrat de skin que CE cœur comprend (`skinContract` du manifeste, §5.2). */
export const SKIN_CONTRACT = 1;

/** Licences SPDX permises pour le contenu d'un skin et pour chacune de ses ressources (§5.2). */
export const SPDX_ALLOWED: readonly string[] = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "OFL-1.1"];

/** Vocabulaire contrôlé des étiquettes d'un skin (§5.2). */
export const TAG_VOCABULARY: readonly string[] = ["light", "dark", "serif", "sans", "mono", "pixel", "playful", "minimal", "bold", "editorial", "retro", "glass", "high-contrast"];

export const HEADER_LAYOUTS: readonly string[] = ["classic", "twoRows", "centered", "minimal"];

/** Plafonds du dossier d'un skin (§5.3). */
export const FILE_LIMITS = {
  manifestBytes: 100 * 1024,
  tokensBytes: 40 * 1024,
  /** La feuille a son propre plafond (60 Ko) dans l'assainisseur. */
  stylesheetBytes: 60 * 1024,
  fonts: 4,
  fontBytes: 150 * 1024,
  fontsTotalBytes: 400 * 1024,
  images: 12,
  imageBytes: 200 * 1024,
  svgBytes: 30 * 1024,
  imagesTotalBytes: 1.2 * 1024 * 1024,
  previews: 4,
  previewBytes: 150 * 1024,
  /** Notice de licence ou README : lus pour l'aperçu, jamais exécutés. */
  textBytes: 100 * 1024,
  totalBytes: 2 * 1024 * 1024,
  files: 60,
} as const;

/** Réglages enregistrés (docs/SKINS.md §3.2). */
export const SETTING_INSTALLED = "skin.installed";
export const SETTING_ACTIVE = "skin.active";
export const SETTING_OPTIONS = "skin.options";
export const BASIC_ID = "basic";
