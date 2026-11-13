import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { AUDIO_URL_RE } from "@/core/audioTypes";
import { MAX_AUDIO_BYTES, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES } from "@/core/uploadLimits";

export { AUDIO_URL_RE };

// Plafonds (images 5 Mo, sons 10 Mo, vidéos 50 Mo : le serveur web devant le site doit accepter 60 Mo, `client_max_body_size 60m` sous nginx) : voir uploadLimits.ts, sans code serveur.
export { MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES, MAX_AUDIO_BYTES };

const TYPES: Record<string, { ext: string; mime: string }> = {
  png: { ext: "png", mime: "image/png" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  webp: { ext: "webp", mime: "image/webp" },
  gif: { ext: "gif", mime: "image/gif" },
  mp4: { ext: "mp4", mime: "video/mp4" },
  webm: { ext: "webm", mime: "video/webm" },
  ogg: { ext: "ogg", mime: "audio/ogg" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  wav: { ext: "wav", mime: "audio/wav" },
  m4a: { ext: "m4a", mime: "audio/mp4" },
  aac: { ext: "aac", mime: "audio/aac" },
  svg: { ext: "svg", mime: "image/svg+xml" },
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

/** Vidéo reconnue à sa signature : MP4/MOV (boîte « ftyp ») ou WebM (en-tête EBML). Rien d'autre. Une boîte « ftyp » de marque audio (M4A, M4B) n'est jamais une vidéo : voir `sniffAudio`. */
export function sniffVideo(buf: Buffer): "mp4" | "webm" | null {
  if (buf.length < 12) return null;
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") return AUDIO_BRANDS.has(buf.subarray(8, 12).toString("latin1")) ? null : "mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  return null;
}

export const isVideoName = (name: string) => /\.(mp4|webm)$/.test(name);
export type AudioKind = "ogg" | "mp3" | "wav" | "m4a" | "aac";
export const isAudioName = (name: string) => /\.(mp3|ogg|wav|m4a|aac)$/.test(name);
/** Lecture par morceaux (en-tête Range) : vidéos et sons. */
export const isStreamName = (name: string) => isVideoName(name) || isAudioName(name);

const AUDIO_BRANDS = new Set(["M4A ", "M4B "]);
const u32 = (b: Buffer, at: number) => b.readUInt32BE(at);

/** Ogg : première page complète (balise de début de flux), dont le premier paquet est Vorbis ou Opus. Theora (vidéo) et FLAC ne passent pas. */
function isOggAudio(b: Buffer): boolean {
  if (b.length < 28 || b.subarray(0, 4).toString("latin1") !== "OggS" || b[4] !== 0 || (b[5]! & 0x07) !== 0x02) return false;
  const segs = b[26]!;
  if (segs === 0 || b.length < 27 + segs) return false;
  let body = 0;
  for (let i = 0; i < segs; i++) body += b[27 + i]!;
  const start = 27 + segs;
  if (body < 8 || b.length < start + body) return false; // page de tête tronquée
  const head = b.subarray(start, start + 8);
  return head.equals(Buffer.from("OpusHead", "latin1")) || head.subarray(0, 7).equals(Buffer.from("\x01vorbis", "latin1"));
}

/** Longueur d'une trame MPEG audio (couche III) si les 4 octets à `at` en sont l'en-tête, sinon 0. */
function mp3FrameLength(b: Buffer, at: number): number {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1]! & 0xe0) !== 0xe0) return 0;
  const version = (b[at + 1]! >> 3) & 3; // 0 = 2.5, 1 = réservé, 2 = 2, 3 = 1
  const layer = (b[at + 1]! >> 1) & 3; // 1 = couche III (0 = ADTS/réservé)
  const bitrateIdx = b[at + 2]! >> 4;
  const rateIdx = (b[at + 2]! >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) return 0;
  const bitrates = version === 3 ? [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rates = [44100, 48000, 32000].map((r) => (version === 3 ? r : version === 2 ? r / 2 : r / 4));
  const pad = (b[at + 2]! >> 1) & 1;
  return Math.floor(((version === 3 ? 144 : 72) * bitrates[bitrateIdx - 1]! * 1000) / rates[rateIdx]!) + pad;
}

/** MP3 : étiquette ID3v2 facultative, puis une trame complète suivie d'une autre trame (ou de la fin du fichier, ou d'une étiquette ID3v1 « TAG »). */
function isMp3(b: Buffer): boolean {
  let at = 0;
  if (b.subarray(0, 3).toString("latin1") === "ID3") {
    if (b.length < 10 || b[3]! < 2 || b[3]! > 4 || b[4] === 0xff || (b[6]! | b[7]! | b[8]! | b[9]!) & 0x80) return false;
    at = 10 + ((b[6]! << 21) | (b[7]! << 14) | (b[8]! << 7) | b[9]!) + (b[5]! & 0x10 ? 10 : 0);
    for (let pad = 0; pad < 256 && b[at] === 0; pad++) at++; // un peu de remplissage laissé après l'étiquette
  }
  const len = mp3FrameLength(b, at);
  if (!len || at + len > b.length) return false; // pas de trame, ou trame tronquée
  const next = at + len;
  if (next === b.length) return true;
  if (b.subarray(next, next + 3).toString("latin1") === "TAG") return true;
  return mp3FrameLength(b, next) > 0 || next + 4 > b.length;
}

/** WAV : RIFF/WAVE, bloc « fmt » cohérent (PCM, flottant ou étendu), bloc « data » présent, taille annoncée non dépassée par le fichier (pas tronqué). */
function isWav(b: Buffer): boolean {
  if (b.length < 44 || b.subarray(0, 4).toString("latin1") !== "RIFF" || b.subarray(8, 12).toString("latin1") !== "WAVE") return false;
  const declared = b.readUInt32LE(4);
  if (declared !== 0xffffffff && declared + 8 > b.length) return false; // tronqué
  let fmt = false;
  for (let at = 12; at + 8 <= b.length; ) {
    const id = b.subarray(at, at + 4).toString("latin1");
    const size = b.readUInt32LE(at + 4);
    if (id === "fmt ") {
      if (size < 16 || at + 8 + 16 > b.length) return false;
      const tag = b.readUInt16LE(at + 8), channels = b.readUInt16LE(at + 10), rate = b.readUInt32LE(at + 12), bits = b.readUInt16LE(at + 22);
      if (![1, 3, 0xfffe].includes(tag) || channels < 1 || channels > 8 || rate < 1000 || rate > 768000 || ![8, 16, 24, 32, 64].includes(bits)) return false;
      fmt = true;
    } else if (id === "data") return fmt;
    at += 8 + size + (size & 1);
  }
  return false;
}

/** M4A : boîte « ftyp » de marque M4A/M4B en tête, boîtes suivantes bien formées, boîte « moov » entière présente (sans elle le fichier n'est pas lisible : fichier tronqué). */
function isM4a(b: Buffer): boolean {
  if (b.length < 16 || b.subarray(4, 8).toString("latin1") !== "ftyp" || !AUDIO_BRANDS.has(b.subarray(8, 12).toString("latin1"))) return false;
  let moov = false;
  for (let at = 0; at + 8 <= b.length; ) {
    let size = u32(b, at);
    const type = b.subarray(at + 4, at + 8).toString("latin1");
    if (!/^[\x20-\x7e\xa9]{4}$/.test(type)) return false;
    if (size === 1) { if (at + 16 > b.length) return false; const big = b.readBigUInt64BE(at + 8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) return false; size = Number(big); }
    else if (size === 0) size = b.length - at;
    if (size < 8) return false;
    if (type === "moov") { if (at + size > b.length) return false; moov = true; }
    at += size;
  }
  return moov;
}

/** AAC brut (ADTS) : trames chaînées de même fréquence ; la première est entière. */
function isAdts(b: Buffer): boolean {
  const frame = (at: number): { len: number; rate: number } | null => {
    if (at + 7 > b.length || b[at] !== 0xff || (b[at + 1]! & 0xf6) !== 0xf0) return null;
    const rate = (b[at + 2]! >> 2) & 15;
    const len = ((b[at + 3]! & 3) << 11) | (b[at + 4]! << 3) | (b[at + 5]! >> 5);
    return rate > 12 || len < 7 ? null : { len, rate };
  };
  const first = frame(0);
  if (!first || first.len > b.length) return false;
  if (first.len === b.length) return true;
  const second = frame(first.len);
  return second !== null && second.rate === first.rate && first.len + second.len <= b.length;
}

/** Son reconnu à sa signature ET à la forme de ses premiers blocs (Ogg Vorbis/Opus, MP3, WAV, M4A, AAC brut). Ni le nom ni le Content-Type n'entrent en compte. */
export function sniffAudio(buf: Buffer): AudioKind | null {
  if (buf.length < 12) return null;
  if (isOggAudio(buf)) return "ogg";
  if (isWav(buf)) return "wav";
  if (isM4a(buf)) return "m4a";
  if (isAdts(buf)) return "aac";
  if (isMp3(buf)) return "mp3";
  return null;
}

/** Écrit un fichier déjà validé sous un nom aléatoire et renvoie son adresse. Réservé au cœur : l'appelant a vérifié le contenu. */
export async function storeUpload(content: Buffer | string, ext: keyof typeof TYPES): Promise<string> {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}.${TYPES[ext]!.ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, name), content);
  return `/uploads/${name}`;
}

/** Les genres de contenu qu'un envoi peut être : le champ « galerie » en choisit un sous-ensemble (`only`). */
export type UploadKind = "image" | "video" | "audio";

/** Pourquoi un envoi est refusé : `format` (contenu non reconnu ou d'un genre non voulu) ou `size` (reconnu, mais trop lourd pour son genre). */
export function uploadProblem(buf: Buffer, opts: { only?: "audio" | readonly UploadKind[] } = {}): "format" | "size" | null {
  const allow = allowed(opts.only);
  const image = allow.has("image") ? sniffImage(buf) : null;
  const audio = image || !allow.has("audio") ? null : sniffAudio(buf);
  const video = image || audio || !allow.has("video") ? null : sniffVideo(buf);
  if (!image && !audio && !video) return "format";
  return buf.length > (image ? MAX_UPLOAD_BYTES : audio ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES) ? "size" : null;
}
const allowed = (only: "audio" | readonly UploadKind[] | undefined): Set<UploadKind> => new Set(only === undefined ? ["image", "audio", "video"] : only === "audio" ? ["audio"] : only);

/**
 * Enregistre un envoi dont le contenu est reconnu (image, son ou vidéo). `only: "audio"` : seuls les sons passent (champs et réglages « audio » : un champ son ne
 * reçoit jamais une image ni une vidéo, même si le navigateur a été contourné). `only: ["image", "video"]` (champ « galerie », cœur 0.14.0) : seulement ces genres.
 */
export async function saveUpload(buf: Buffer, opts: { only?: "audio" | readonly UploadKind[] } = {}): Promise<string | null> {
  if (uploadProblem(buf, opts) !== null) return null;
  const allow = allowed(opts.only);
  const image = allow.has("image") ? sniffImage(buf) : null;
  const audio = image || !allow.has("audio") ? null : sniffAudio(buf);
  const kind = image ?? audio ?? sniffVideo(buf);
  if (!kind) return null;
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${crypto.randomUUID()}.${TYPES[kind]!.ext}`;
  await fs.writeFile(path.join(UPLOADS_DIR, name), buf);
  return `/uploads/${name}`;
}

export const UPLOAD_NAME_RE = /^[0-9a-f-]{36}\.(png|jpg|webp|gif|mp4|webm|ogg|mp3|wav|m4a|aac|svg)$/;

export function mimeFor(name: string): string {
  const ext = name.split(".").pop() ?? "";
  return Object.values(TYPES).find((t) => t.ext === ext)?.mime ?? "application/octet-stream";
}
