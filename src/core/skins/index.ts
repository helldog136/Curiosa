/**
 * Bibliothèque pure des skins : assainissement des feuilles de style et contrôle de lisibilité (docs/SKINS.md §6-§7).
 * Aucune dépendance à Next, à la base de données, au réseau ni à un minuteur : utilisable à l'installation, au rendu et
 * par le kit `skin:check`.
 */
export * from "./allowlist";
export { parseColor, toHex, NAMED_COLORS, type Rgba } from "./colorParse";
export { sanitizeSkinCss, sanitizeTokenValue, type SanitizeOptions, type SanitizeResult, type SanitizeStats } from "./sanitize";
export { ISSUE_CODES, issueText, makeIssue, type Locale, type SkinIssue, type Text } from "./messages";
export {
  checkReadability, correctReadability, probableIllegibility, hasReadabilityErrors, relativeLuminance, contrastRatio, contrastOver, composite, suggestColor,
  READABILITY_PAIRS, AA_TEXT, AA_LARGE, AAA_TEXT, AAA_LARGE,
  type Correction, type CorrectionChange, type CorrectionStep, type Mode, type ModulePair, type ProbableIssue, type ReadabilityIssue, type ReadabilityOptions, type RetouchColors,
} from "./readability";
