/**
 * HALO DE COULEUR derrière la page : de grandes taches douces (dégradés radiaux), teintées à partir de la couleur d'accent.
 * Réglages : nombre de taches, taille et variation de taille, décalage de teinte maximal de chaque tache, intensité, disposition (graine).
 * La disposition est déterministe : la même graine donne toujours les mêmes taches (pas de saut visuel d'une page à l'autre).
 */
export type GlowLevel = "none" | "soft" | "strong" | "custom";
export const GLOW_LEVELS: readonly GlowLevel[] = ["none", "soft", "strong", "custom"];

export type GlowTuning = {
  /** Nombre de taches (1 à 8). */
  count: number;
  /** Taille moyenne d'une tache, en rem (30 à 120). */
  size: number;
  /** Variation de taille : ± ce pourcentage autour de la taille moyenne (0 à 100). */
  variance: number;
  /** Décalage de teinte maximal de chaque tache par rapport à l'accent, en degrés (0 à 180). */
  hue: number;
  /** Opacité maximale du cœur d'une tache, en % (5 à 50). */
  intensity: number;
  /** Graine de la disposition (1 à 9999) : change les positions, tailles et teintes tirées au sort. */
  seed: number;
};

export const GLOW_BOUNDS: Record<keyof GlowTuning, [number, number]> = {
  count: [1, 8], size: [30, 120], variance: [0, 100], hue: [0, 180], intensity: [5, 50], seed: [1, 9999],
};

export const GLOW_PRESETS: Record<"soft" | "strong", GlowTuning> = {
  soft: { count: 2, size: 60, variance: 20, hue: 0, intensity: 14, seed: 7 },
  strong: { count: 3, size: 60, variance: 30, hue: 0, intensity: 28, seed: 7 },
};

const clamp = (n: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, n));

/** Réglages saisis ou relus → valeurs sûres (entiers bornés), les manquants viennent du préréglage « doux ». */
export function normalizeTuning(raw: unknown): GlowTuning {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...GLOW_PRESETS.soft };
  for (const key of Object.keys(GLOW_BOUNDS) as (keyof GlowTuning)[]) {
    const n = Number(src[key]);
    if (src[key] !== undefined && src[key] !== "" && Number.isFinite(n)) out[key] = Math.round(clamp(n, GLOW_BOUNDS[key]));
  }
  return out;
}

export function isGlowLevel(value: unknown): value is GlowLevel {
  return typeof value === "string" && (GLOW_LEVELS as readonly string[]).includes(value);
}

/** Générateur pseudo-aléatoire à graine (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1]!, 16) : 0xe8a23b;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

/** Réglages effectifs pour un niveau (« none » : aucun). */
export function tuningFor(level: GlowLevel, custom: GlowTuning): GlowTuning | null {
  if (level === "none") return null;
  return level === "custom" ? custom : GLOW_PRESETS[level];
}

/** Les dégradés radiaux d'un halo : déterministes pour un même (réglages, accent). */
export function spotGradients(t: GlowTuning, accent: string): string[] {
  const rand = rng(t.seed);
  const [h, s, l] = hexToHsl(accent);
  // Une couleur trop claire ou trop sombre ne se verrait pas sur un fond uni : on borne la luminosité.
  const light = Math.min(68, Math.max(38, l));
  const spots: string[] = [];
  for (let i = 0; i < t.count; i++) {
    const x = Math.round(rand() * 100), y = Math.round(rand() * 100);
    const size = t.size * (1 + (rand() * 2 - 1) * (t.variance / 100));
    const hue = Math.round((h + (rand() * 2 - 1) * t.hue + 360) % 360);
    const alpha = ((t.intensity / 100) * (0.65 + 0.35 * rand())).toFixed(3);
    const w = Math.round(size), hgt = Math.round(size * 0.7);
    spots.push(`radial-gradient(${w}rem ${hgt}rem at ${x}% ${y}%,hsla(${hue},${Math.round(s)}%,${Math.round(light)}%,${alpha}),transparent 70%)`);
  }
  return spots;
}

/** CSS du halo (sur le corps de la page) ; chaîne vide si désactivé. */
export function glowCss(level: GlowLevel, custom: GlowTuning, accent: string): string {
  const t = tuningFor(level, custom);
  if (!t) return "";
  return `body{background-image:${spotGradients(t, accent).join(",")};background-repeat:no-repeat;background-attachment:fixed}`;
}
