import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Vidéos : plus lourdes (le serveur web devant le site doit accepter autant : `client_max_body_size 60m` sous nginx). */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const TYPES: Record<string, { ext: string; mime: string }> = {
  png: { ext: "png", mime: "image/png" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  webp: { ext: "webp", mime: "image/webp" },
  gif: { ext: "gif", mime: "image/gif" },
  mp4: { ext: "mp4", mime: "video/mp4" },
  webm: { ext: "webm", mime: "video/webm" },
};

/** Détecte le vrai format par signature (on ne fait pas confiance au nom ni au Content-Type). SVG exclu : il peut contenir du script. */
export function sniffImage(buf: Buffer): "png" | "jpg" | "webp" | "gif" | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "gif";
  return null;
}

/** Vidéo reconnue à sa signature : MP4/MOV (boîte « ftyp ») ou WebM (en-tête EBML). Rien d'autre. */
export function sniffVideo(buf: Buffer): "mp4" | "webm" | null {
  if (buf.length < 12) return null;
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") return "mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  return null;
}

export const isVideoName = (name: string) => /\.(mp4|webm)$/.test(name);

export async function saveUpload(buf: Buffer): Promise<string | null> {
  const image = sniffImage(buf);
  const kind = image ?? sniffVideo(buf);
  if (!kind || buf.length > (image ? MAX_UPLOAD_BYTES : MAX_VIDEO_BYTES)) return null;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}.${TYPES[kind]!.ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, name), buf);
  return `/uploads/${name}`;
}

export const UPLOAD_NAME_RE = /^[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm)$/;

export function mimeFor(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return Object.values(TYPES).find((t) => t.ext === ext)?.mime ?? "application/octet-stream";
}
