/** Contrôle d'un tracé renvoyé par l'action de génération d'un bloc `gridEditor` (aucun accès au stockage : pur, testable). */
export type GridData = { width: number; height: number; cells: string };

/** Plafonds de sécurité côté serveur (la taille exacte autorisée est connue de l'éditeur, qui la revérifie). */
export const GRID_HARD_MAX = 100;

/**
 * Vérifie une grille proposée : largeur et hauteur entières dans [min, max], une chaîne de `width × height` caractères, chacun dans `allowed`
 * (si fourni). Renvoie la grille nettoyée, ou `null` si quoi que ce soit cloche.
 */
export function parseGeneratedGrid(raw: unknown, opts: { min?: number; max?: number; allowed?: string[] } = {}): GridData | null {
  if (!raw || typeof raw !== "object") return null;
  const { width, height, cells } = raw as Record<string, unknown>;
  const min = Math.max(1, opts.min ?? 1), max = Math.min(GRID_HARD_MAX, opts.max ?? GRID_HARD_MAX);
  if (typeof width !== "number" || typeof height !== "number" || typeof cells !== "string") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < min || width > max || height < min || height > max) return null;
  if (cells.length !== width * height) return null;
  if (opts.allowed && [...cells].some((c) => !opts.allowed!.includes(c))) return null;
  return { width, height, cells };
}
