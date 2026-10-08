import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const TYPES: Record<string, { ext: string; mime: string }> = {
  png: { ext: "png", mime: "image/png" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  webp: { ext: "webp", mime: "image/webp" },
  gif: { ext: "gif", mime: "image/gif" },
};

/** Détecte le vrai format par signature (on ne fait pas confiance au nom ni au Content-Type). SVG exclu : il peut contenir du script. */
export function sniffImage(buf: Buffer): keyof typeof TYPES | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "gif";
  return null;
}

export async function saveUpload(buf: Buffer): Promise<string | null> {
  const kind = sniffImage(buf);
  if (!kind || buf.length > MAX_UPLOAD_BYTES) return null;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}.${TYPES[kind]!.ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, name), buf);
  return `/uploads/${name}`;
}

export const UPLOAD_NAME_RE = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;

export function mimeFor(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return Object.values(TYPES).find((t) => t.ext === ext)?.mime ?? "application/octet-stream";
}
