/**
 * Constantes de l'installation des skins (docs/SKINS.md §5) : bibliothèque PURE (aucun accès réseau, base ou Next).
 * L'adresse du dépôt officiel de skins n'est PAS ici : elle est écrite une seule fois, dans `core/config.ts` (`DEFAULT_SKINS_REPO`).
 */

/**
 * Version du contrat de skin que CE cœur comprend (`skinContract` du manifeste, §5.2).
 * (core 0.44.0) 4: a site skin may declare `customize` (docs/SKINS.md "Customization"). A skin of contract 1 to 3 is read as before; an older core refuses a skin
 * of contract 4 cleanly ("contract newer") instead of ignoring its customization.
 */
export const SKIN_CONTRACT = 4;
/** Contract an overlay skin must declare (core 0.8.0): older cores refuse it cleanly ("contract newer") instead of misreading it. */
export const OVERLAY_SKIN_CONTRACT = 2;
/** (core 0.9.0) Contract of overlay skins that use the closed presets and layout properties (docs/OVERLAY-SKINS.md section 3): older cores refuse it as "contract newer". */
export const OVERLAY_SKIN_CONTRACT_V3 = 3;
/**
 * (core 0.30.0) Contract of overlay skins that ship an animation recipe (`animation` in skin.json, docs/OVERLAY-ANIMATIONS.md). Only overlay skins may declare
 * it: a site skin above SKIN_CONTRACT is still "contract newer". Older cores refuse such a skin cleanly instead of ignoring its animation file.
 */
export const OVERLAY_SKIN_CONTRACT_V4 = 4;
/**
 * (core 0.40.0) Contract of overlay skins that ship a SCENE (`scene` in skin.json, docs/OVERLAY-ANIMATIONS.md "Scenes"): their own pictures (`images/`, PNG, WebP, sanitised SVG)
 * placed on the abstract bar. Only a skin that declares it may carry images; older cores refuse it cleanly ("contract newer").
 */
export const OVERLAY_SKIN_CONTRACT_V5 = 5;
/** The highest contract this core understands for a skin of this kind. */
export const maxSkinContract = (kind: unknown): number => (kind === "overlay" ? OVERLAY_SKIN_CONTRACT_V5 : SKIN_CONTRACT);

/** Licences SPDX permises pour le contenu d'un skin et pour chacune de ses ressources (§5.2). */
export const SPDX_ALLOWED: readonly string[] = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "OFL-1.1"];

/** Vocabulaire contrôlé des étiquettes d'un skin (§5.2). */
export const TAG_VOCABULARY: readonly string[] = ["light", "dark", "serif", "sans", "mono", "pixel", "playful", "minimal", "bold", "editorial", "retro", "glass", "high-contrast", "epic", "spooky", "fantasy", "scifi", "cozy", "neon", "nature"];

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
  /** (0.44.0) A site skin that declares `customize` offers pictures to choose from: more files, the same weight limits. */
  imagesCustomizable: 24,
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
/** (core 0.44.0) The owner's customization of ONE skin: `skin.custom.<skinId>` (kept when the owner switches skins). */
export const SETTING_CUSTOM_PREFIX = "skin.custom.";
export const BASIC_ID = "basic";
