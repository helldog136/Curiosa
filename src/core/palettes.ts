/**
 * Palettes prêtes à l'emploi et reconnaissance d'une combinaison de couleurs.
 * Une palette fixe cinq couleurs : fond, surface (cartes), texte, accent et accent 2 (le contrepoint de l'accent).
 * Les sept premières (« d'origine ») gardent le fond et l'accent qu'elles avaient avant l'arrivée des cinq couleurs.
 */
export const THEME_PRESETS = [
  { id: "night", mode: "dark", background: "#121214", surface: "#1d1d21", text: "#f4f4f5", accent: "#e8a23b", accent2: "#7aa2ff" },
  { id: "ocean", mode: "dark", background: "#0b1220", surface: "#142035", text: "#e6edf7", accent: "#38bdf8", accent2: "#fb7185" },
  { id: "forest", mode: "dark", background: "#0f1a14", surface: "#17271e", text: "#ecf3ee", accent: "#4ade80", accent2: "#facc15" },
  { id: "rose", mode: "dark", background: "#1a0f14", surface: "#26161e", text: "#fbeef4", accent: "#f472b6", accent2: "#22d3ee" },
  { id: "violet", mode: "dark", background: "#14111f", surface: "#1e1a2e", text: "#f1eefb", accent: "#a78bfa", accent2: "#f0abfc" },
  { id: "daylight", mode: "light", background: "#fafafa", surface: "#ffffff", text: "#18181b", accent: "#2563eb", accent2: "#7c3aed" },
  { id: "paper", mode: "light", background: "#f5f0e6", surface: "#fffaf0", text: "#2b2118", accent: "#c2410c", accent2: "#0f766e" },
  { id: "arcade", mode: "dark", background: "#0d0221", surface: "#1a0b38", text: "#f5ecff", accent: "#ff2a6d", accent2: "#05d9e8" },
  { id: "vinyl", mode: "dark", background: "#181414", surface: "#241d1d", text: "#f5efe9", accent: "#f43f5e", accent2: "#fbbf24" },
  { id: "workshop", mode: "dark", background: "#1c1917", surface: "#29241f", text: "#f5f0e8", accent: "#e07a5f", accent2: "#81b29a" },
  { id: "stadium", mode: "light", background: "#f3f6fb", surface: "#ffffff", text: "#0b1b33", accent: "#c2410c", accent2: "#1d4ed8" },
  { id: "solidarity", mode: "light", background: "#fbf8f3", surface: "#ffffff", text: "#1f2a24", accent: "#15803d", accent2: "#0369a1" },
  { id: "boutique", mode: "light", background: "#fff7f5", surface: "#ffffff", text: "#2d1b1e", accent: "#be185d", accent2: "#6d28d9" },
  { id: "lagoon", mode: "light", background: "#effcf8", surface: "#ffffff", text: "#12302a", accent: "#0f766e", accent2: "#be185d" },
] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

/** Les sept palettes qui existaient avant les cinq couleurs : un site qui n'a que leur fond et leur accent (sans rien d'autre) les reconnaît toujours. */
const ORIGINAL_PRESETS: readonly string[] = ["night", "ocean", "forest", "rose", "violet", "daylight", "paper"];

export const CUSTOM_PALETTE = "custom";
export type PaletteId = ThemePreset["id"] | typeof CUSTOM_PALETTE;

/** Une couleur facultative : « » pour absente (vide, null, undefined), sa forme normalisée (minuscules, sans espaces) sinon, null si ce n'est pas du texte. */
function optional(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v.trim().toLowerCase() : null;
}

/**
 * Id de la palette reconnue, sinon « custom » (insensible à la casse).
 * Une palette est reconnue quand fond, accent, accent 2, surface et texte correspondent tous.
 * Exception : une palette d'origine l'est aussi quand seuls son fond et son accent correspondent ET qu'aucun accent 2, surface ou texte n'est défini (sites existants).
 */
export function matchPalette(background: unknown, accent: unknown, accent2?: unknown, surface?: unknown, text?: unknown): PaletteId {
  if (typeof background !== "string" || typeof accent !== "string") return CUSTOM_PALETTE;
  const bg = background.trim().toLowerCase();
  const ac = accent.trim().toLowerCase();
  const [a2, sf, tx] = [optional(accent2), optional(surface), optional(text)];
  if (a2 === null || sf === null || tx === null) return CUSTOM_PALETTE;
  const bare = a2 === "" && sf === "" && tx === "";
  const found = THEME_PRESETS.find((p) => p.background === bg && p.accent === ac
    && ((p.accent2 === a2 && p.surface === sf && p.text === tx) || (bare && ORIGINAL_PRESETS.includes(p.id))));
  return found?.id ?? CUSTOM_PALETTE;
}
