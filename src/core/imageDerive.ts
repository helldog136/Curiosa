import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, UPLOADS_DIR } from "@/core/config";
import { TIMED_OUT, withDeadline } from "@/core/deadline";
import { cropGeometry, type Crop } from "@/core/imageCrop";
import { MAX_UPLOAD_BYTES, sniffImage } from "@/core/services/uploads";

/**
 * Fabrication (côté serveur) de la version cadrée d'une image envoyée. L'original n'est jamais touché ; le résultat est gardé dans
 * `data/cache/crops/` (hors des envois : il n'est ni sauvegardé ni restauré, il se refabrique tout seul).
 *
 * Sécurité : entrée limitée (taille du fichier ET nombre de pixels : pas de « bombe de décompression »), format vérifié par signature
 * (jamais de SVG ni de GIF animé), orientation EXIF appliquée puis TOUTES les métadonnées (GPS compris) retirées de la version fabriquée,
 * sortie bornée (MAX_SIDE), nom de fichier du cache calculé (jamais construit à partir d'un texte reçu), peu de fabrications en parallèle.
 */

export const CROP_CACHE_DIR = path.join(DATA_DIR, "cache", "crops");
/** Au plus 40 millions de pixels en entrée (≈ 6 300 × 6 300) : au-delà, la décompression coûterait trop de mémoire. */
export const MAX_INPUT_PIXELS = 40_000_000;
const MAX_PARALLEL = 2;
const MAX_WAITING = 24;
/** Une fabrication qui dépasse ce temps est abandonnée : sa place est rendue, sinon quelques images bloquées suffiraient à en bloquer tout le site (« occupé »). */
let jobMs = 45_000;
/** Pour les tests. */
export function setDeriveTimeout(ms?: number): void { jobMs = ms ?? 45_000; }
const bounded = async (work: () => Promise<DeriveResult>): Promise<DeriveResult> => {
  const done = await withDeadline(work, jobMs);
  return done === TIMED_OUT ? { ok: false, reason: "failed" } : done;
};
const CACHE_MAX_FILES = 3000;
const CACHE_MAX_BYTES = 300 * 1024 * 1024;

export type DeriveResult = { ok: true; file: string; mime: string } | { ok: false; reason: "missing" | "format" | "toolarge" | "busy" | "engine" | "failed" };

type Sharp = (typeof import("sharp"))["default"];
type Pipeline = import("sharp").Sharp;
let engine: Promise<Sharp | null> | null = null;
/** `sharp` est chargé à la première demande seulement : s'il manque ou ne démarre pas, le site continue avec l'image d'origine. */
function loadEngine(): Promise<Sharp | null> {
  engine ??= import("sharp").then((m) => {
    const sharp: Sharp = m.default ?? (m as unknown as Sharp);
    sharp.cache({ memory: 64, files: 0, items: 16 });
    sharp.concurrency(1);
    return sharp;
  }).catch(() => null);
  return engine;
}

let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T | "busy"> {
  if (running >= MAX_PARALLEL) {
    if (waiting.length >= MAX_WAITING) return "busy";
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else running++;
  try { return await job(); } finally {
    const next = waiting.shift();
    if (next) next(); else running--;
  }
}

export const cacheName = (name: string, crop: Crop, share: boolean) => {
  const key = crypto.createHash("sha256").update(JSON.stringify([1, name, crop.ratio, crop.zoom, crop.x, crop.y, crop.fill, share])).digest("hex").slice(0, 40);
  return `${key}.${share ? "jpg" : "webp"}`;
};

let lastPrune = 0;
/** Garde le cache raisonnable : au plus CACHE_MAX_FILES fichiers / CACHE_MAX_BYTES octets, les plus anciens partent d'abord. */
async function prune(now = Date.now()): Promise<void> {
  if (now - lastPrune < 10 * 60_000) return;
  lastPrune = now;
  try {
    const rows = await Promise.all((await fs.readdir(CROP_CACHE_DIR)).map(async (n) => ({ n, s: await fs.stat(path.join(CROP_CACHE_DIR, n)).catch(() => null) })));
    const files = rows.flatMap((r) => (r.s?.isFile() ? [{ n: r.n, size: r.s.size, at: r.s.mtimeMs }] : [])).sort((a, b) => a.at - b.at);
    let count = files.length, bytes = files.reduce((t, f) => t + f.size, 0);
    for (const f of files) {
      if (count <= CACHE_MAX_FILES * 0.8 && bytes <= CACHE_MAX_BYTES * 0.8) break;
      if (count <= CACHE_MAX_FILES && bytes <= CACHE_MAX_BYTES) break;
      await fs.rm(path.join(CROP_CACHE_DIR, f.n), { force: true });
      count--; bytes -= f.size;
    }
  } catch { /* le cache est facultatif */ }
}

/** Fabrique (ou retrouve en cache) la version cadrée de l'envoi `name` (nom déjà validé par UPLOAD_NAME_RE). */
export async function deriveImage(name: string, crop: Crop, share = false): Promise<DeriveResult> {
  const target = path.join(CROP_CACHE_DIR, cacheName(name, crop, share));
  const mime = share ? "image/jpeg" : "image/webp";
  try { if ((await fs.stat(target)).isFile()) return { ok: true, file: target, mime }; } catch { /* à fabriquer */ }

  const source = path.join(UPLOADS_DIR, name);
  let buf: Buffer;
  try {
    const st = await fs.stat(source);
    if (!st.isFile()) return { ok: false, reason: "missing" };
    if (st.size > MAX_UPLOAD_BYTES) return { ok: false, reason: "toolarge" };
    buf = await fs.readFile(source);
  } catch { return { ok: false, reason: "missing" }; }
  const kind = sniffImage(buf);
  if (kind !== "png" && kind !== "jpg" && kind !== "webp") return { ok: false, reason: "format" };

  const sharp = await loadEngine();
  if (!sharp) return { ok: false, reason: "engine" };

  const made = await slot(() => bounded(async (): Promise<DeriveResult> => {
    try {
      const input = () => sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", animated: false });
      // Lecture de l'en-tête seulement (aucun décodage) : la limite de pixels est vérifiée juste après, pour répondre « trop grande » plutôt qu'« échec ».
      const meta = await sharp(buf, { limitInputPixels: false, animated: false }).metadata();
      if (!meta.width || !meta.height) return { ok: false, reason: "format" };
      // L'orientation EXIF échange largeur et hauteur : tous les calculs se font sur l'image redressée.
      const turned = (meta.orientation ?? 1) >= 5;
      const W = turned ? meta.height : meta.width, H = turned ? meta.width : meta.height;
      if (W * H > MAX_INPUT_PIXELS) return { ok: false, reason: "toolarge" };
      const g = cropGeometry(crop, W, H, share);
      const piece = input().rotate().extract(g.extract).resize(g.resize.width, g.resize.height, { fit: "fill", kernel: "lanczos3" });
      // Remplissage : la couleur choisie, ou « transparent » (sauf pour le partage, qui n'accepte pas la transparence : blanc).
      const transparent = crop.fill === "t" && !share;
      const hex = crop.fill === "t" ? "ffffff" : crop.fill;
      const background = { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), alpha: transparent ? 0 : 1 };
      let out: Pipeline;
      if (g.inside) out = piece;
      else {
        const inner = await piece.png().toBuffer();
        out = sharp({ create: { width: g.outW, height: g.outH, channels: 4, background } }).composite([{ input: inner, left: g.place.left, top: g.place.top }]);
      }
      // Une image transparente est posée sur la couleur de remplissage (comme dans l'aperçu), sauf si le remplissage est « transparent ».
      if (!transparent) out = out.flatten({ background: `#${hex}` });
      const result = share ? await out.jpeg({ quality: 84 }).toBuffer() : await out.webp({ quality: 82 }).toBuffer();
      await fs.mkdir(CROP_CACHE_DIR, { recursive: true });
      const tmp = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
      await fs.writeFile(tmp, result);
      await fs.rename(tmp, target);
      void prune();
      return { ok: true, file: target, mime };
    } catch {
      return { ok: false, reason: "failed" };
    }
  }));
  return made === "busy" ? { ok: false, reason: "busy" } : made;
}
