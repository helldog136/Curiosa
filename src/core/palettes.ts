/** Palettes prêtes à l'emploi (fond + accent) et reconnaissance d'une combinaison de couleurs. */
export const THEME_PRESETS = [
  { id: "night", background: "#121214", accent: "#e8a23b" },
  { id: "ocean", background: "#0b1220", accent: "#38bdf8" },
  { id: "forest", background: "#0f1a14", accent: "#4ade80" },
  { id: "rose", background: "#1a0f14", accent: "#f472b6" },
  { id: "violet", background: "#14111f", accent: "#a78bfa" },
  { id: "daylight", background: "#fafafa", accent: "#2563eb" },
  { id: "paper", background: "#f5f0e6", accent: "#c2410c" },
] as const;

export const CUSTOM_PALETTE = "custom";
export type PaletteId = (typeof THEME_PRESETS)[number]["id"] | typeof CUSTOM_PALETTE;

/** Id de la palette dont le fond ET l'accent correspondent exactement (insensible à la casse), sinon « custom ». */
export function matchPalette(background: unknown, accent: unknown): PaletteId {
  if (typeof background !== "string" || typeof accent !== "string") return CUSTOM_PALETTE;
  const bg = background.trim().toLowerCase();
  const ac = accent.trim().toLowerCase();
  return THEME_PRESETS.find((p) => p.background === bg && p.accent === ac)?.id ?? CUSTOM_PALETTE;
}
