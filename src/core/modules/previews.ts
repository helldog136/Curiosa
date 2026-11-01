import { z } from "zod";

/**
 * VISUELS D'UN MODULE (`previews` du manifeste, cœur 0.6.1) : jusqu'à 6 captures qui montrent CE QUE LE MODULE AJOUTE (une page de commandes, un écran d'administration,
 * un élément d'overlay). Elles s'affichent dans la fiche de l'extension, avant l'installation comme après.
 *
 * Ce fichier ne dépend de rien d'autre du cœur : le schéma (utilisé par manifest.ts), la lecture de la taille d'une image et ses limites. Les octets ne sont JAMAIS chargés
 * par le navigateur depuis un site tiers : le cœur les lit côté serveur (dépôt du catalogue ou dossier du module installé), les vérifie ici, puis les sert depuis sa propre route
 * (previewServe.ts).
 */
export const PREVIEW_LIMITS = {
  /** Visuels au plus par module. */
  max: 6,
  /** Poids d'une image, en octets (150 Ko). */
  bytes: 150 * 1024,
  /** Largeur et hauteur minimales / maximales, en pixels. */
  minSide: 240,
  maxSide: 2400,
  /** Surface maximale (pixels) : une image « bombe » de poids faible mais de taille énorme est refusée. */
  maxPixels: 4_000_000,
  caption: 140,
  alt: 250,
} as const;

export const PREVIEW_TYPES = ["public", "admin", "overlay"] as const;
export type PreviewType = (typeof PREVIEW_TYPES)[number];
export const PREVIEW_FILE_RE = /^previews\/[a-z0-9][a-z0-9._-]{0,63}\.(webp|png)$/;
const LOCALE_RE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

/** Un texte dans plusieurs langues : le français ET l'anglais sont obligatoires (parité), d'autres langues sont permises. */
const text = (max: number) =>
  z.record(z.string().regex(LOCALE_RE), z.string().trim().min(1).max(max)).refine((r) => !!r.fr && !!r.en, "needs both fr and en texts");

export const previewSchema = z.object({
  /** Chemin dans le module : `previews/<nom>.webp` ou `.png` (minuscules, chiffres, `.`, `_`, `-`). */
  file: z.string().regex(PREVIEW_FILE_RE, "file must be previews/<name>.webp or .png (lowercase letters, digits, dots, dashes)"),
  /** Légende affichée sous l'image (vouvoiement, une phrase). */
  caption: text(PREVIEW_LIMITS.caption),
  /** Description de l'image pour les lecteurs d'écran : obligatoire. */
  alt: text(PREVIEW_LIMITS.alt),
  /** Ce que la capture montre : la page du site (`public`), un écran d'administration (`admin`) ou un élément d'une page d'overlay (`overlay`). */
  type: z.enum(PREVIEW_TYPES),
});

export const previewsSchema = z.array(previewSchema).max(PREVIEW_LIMITS.max);
export type PreviewDecl = z.infer<typeof previewSchema>;

/** Problèmes d'un ensemble de visuels déclarés (doublons) : chemin relatif + message, pour `superRefine` du manifeste. */
export function previewIssues(previews: PreviewDecl[] | undefined): { path: (string | number)[]; message: string }[] {
  const seen = new Set<string>();
  const out: { path: (string | number)[]; message: string }[] = [];
  for (const [i, p] of (previews ?? []).entries()) {
    if (seen.has(p.file)) out.push({ path: [i, "file"], message: `duplicate preview file "${p.file}"` });
    seen.add(p.file);
  }
  return out;
}

/** Entrée d'index du catalogue → visuels valides (les mal formés sont écartés un à un, jamais bloquants). */
export function sanitizePreviews(v: unknown): PreviewDecl[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PreviewDecl[] = [];
  const seen = new Set<string>();
  for (const raw of v.slice(0, 20)) {
    const r = previewSchema.safeParse(raw);
    if (r.success && !seen.has(r.data.file)) { seen.add(r.data.file); out.push(r.data); }
    if (out.length >= PREVIEW_LIMITS.max) break;
  }
  return out.length ? out : undefined;
}

export type PreviewMime = "image/png" | "image/webp";
export type PreviewProblem = "too-large" | "type" | "corrupt" | "dimensions";
export type PreviewCheck = { ok: true; mime: PreviewMime; width: number; height: number } | { ok: false; problem: PreviewProblem };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Type RÉEL et dimensions d'après les octets (jamais l'extension), ou null si ce n'est ni un PNG ni un WebP lisible. */
export function sniffImage(b: Buffer): { mime: PreviewMime; width: number; height: number } | null {
  if (b.length > 33 && b.subarray(0, 8).equals(PNG_SIGNATURE) && b.subarray(12, 16).toString("latin1") === "IHDR" && b.readUInt32BE(8) === 13) {
    // Fichier tronqué : un PNG complet se termine par le bloc IEND.
    if (b.subarray(b.length - 8, b.length - 4).toString("latin1") !== "IEND") return null;
    return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length > 30 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    if (b.readUInt32LE(4) + 8 > b.length) return null; // tronqué
    const kind = b.subarray(12, 16).toString("latin1");
    if (kind === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { mime: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L" && b[20] === 0x2f) { const bits = b.readUInt32LE(21); return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
    if (kind === "VP8X") return { mime: "image/webp", width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/** Une image de visuel : poids, type réel, dimensions. L'extension du nom doit aussi correspondre au type réel. */
export function checkPreviewImage(bytes: Buffer, file?: string): PreviewCheck {
  if (bytes.length > PREVIEW_LIMITS.bytes) return { ok: false, problem: "too-large" };
  const s = sniffImage(bytes);
  if (!s) return { ok: false, problem: "type" };
  if (file && !file.endsWith(s.mime === "image/png" ? ".png" : ".webp")) return { ok: false, problem: "type" };
  const { width: w, height: h } = s;
  if (w < PREVIEW_LIMITS.minSide || h < PREVIEW_LIMITS.minSide || w > PREVIEW_LIMITS.maxSide || h > PREVIEW_LIMITS.maxSide || w * h > PREVIEW_LIMITS.maxPixels) return { ok: false, problem: "dimensions" };
  return { ok: true, ...s };
}

/** Un visuel prêt à servir : sa déclaration, son rang dans la liste du manifeste et ses octets vérifiés. */
export type PreviewImage = { index: number; decl: PreviewDecl; mime: PreviewMime; width: number; height: number; bytes: Buffer };

/**
 * Lit les visuels déclarés avec `read` (qui sait où sont les fichiers : dépôt git ou dossier) : au plus 6, un fichier illisible ou non conforme est simplement
 * écarté (jamais d'erreur pour la fiche). `read` reçoit la taille permise et rend les octets, ou null.
 */
export async function loadPreviewImages(decls: PreviewDecl[] | undefined, read: (file: string, maxBytes: number) => Promise<Buffer | null>): Promise<PreviewImage[]> {
  // En parallèle (au plus 6 lectures) : chaque lecture d'un dépôt distant coûte un aller-retour réseau, les faire l'une après l'autre les additionnerait.
  const got = await Promise.all((decls ?? []).slice(0, PREVIEW_LIMITS.max).map(async (decl, index): Promise<PreviewImage | null> => {
    let bytes: Buffer | null = null;
    try { bytes = await read(decl.file, PREVIEW_LIMITS.bytes); } catch { bytes = null; }
    if (!bytes) return null;
    const c = checkPreviewImage(bytes, decl.file);
    return c.ok ? { index, decl, mime: c.mime, width: c.width, height: c.height, bytes } : null;
  }));
  return got.filter((i): i is PreviewImage => i !== null);
}

/** Octets conservés au plus en mémoire pour tous les visuels lus (le reste est relu à la demande). */
export const PREVIEW_CACHE_BYTES = 12 * 1024 * 1024;
