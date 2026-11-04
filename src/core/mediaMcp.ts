import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/core/config";
import { LOGO_KEYS } from "@/core/logos";
import { looksLikeSvg, saveSvgUpload } from "@/core/logoUpload";
import { prisma } from "@/core/db";
import { MAX_INPUT_PIXELS, readImageSize } from "@/core/imageDerive";
import { audit } from "@/core/permissions";
import { uploadNameOf } from "@/core/services/files";
import { saveUpload, sniffImage } from "@/core/services/uploads";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import type { JsonSchemaLite } from "@/core/modules/types";
import { takeSlot } from "@/core/maintenance/slots";

/**
 * MEDIA FOR AN AI: `media_upload`, `media_list` (read) and `media_set_alt`. No deletion tool.
 *
 * The bytes come ONLY in the call (base64): the server never fetches an address, so there is nothing to point at an internal server or a third party.
 * The checks are the ones of the admin's own upload route, reused, never a second validator:
 *   - the type is read from the BYTES (`sniffImage`: png, jpeg, webp, gif); the declared name or type is ignored. A video is refused here even though the admin accepts it;
 *   - a svg goes through the logo pipeline (`saveSvgUpload`): it is re-written from the elements it recognises, scripts, styles, images and outside links are refused, and what is
 *     saved is the cleaned copy, never the received file. 300 KB at most (the logo limit);
 *   - the file name is a random identifier chosen by the core (`/uploads/<uuid>.<ext>`); the name sent by the AI is only a label in the journal, cleaned of any path;
 *   - 3 MB at most, 40 million pixels at most (no decompression bomb), the alternative text is required (125 characters at most).
 * The admin's upload route does not strip EXIF data from the stored original (only the resized copies lose it): the same holds here. Said in docs/MAINTENANCE-IA.md.
 * Limits: the "content" counter of the access (slots.ts), and a daily quota for the whole site counted from the journal. The journal gets who / when / the file name and
 * its size, never the bytes.
 */
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export const MAX_ALT = 125;
export const PAGE_SIZE = 50;
/** For the whole site, all accesses together, over the last 24 hours. */
export const DAILY_FILES = 100;
export const DAILY_BYTES = 60 * 1024 * 1024;

const IMAGE_NAME = /^[0-9a-f-]{36}\.(png|jpg|webp|gif|svg)$/;
const ALT_KEY = (name: string) => `media.alt.${name}`;
const TYPE_OF: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

export const MEDIA_UPLOAD_INPUT: JsonSchemaLite = {
  type: "object",
  properties: {
    dataBase64: { type: "string", maxLength: 4_300_000, description: "The image bytes as plain base64 (no \"data:\" prefix). png, jpeg, webp or gif, 3 MB at most; svg only for logos (300 KB at most, it is cleaned). The site never downloads from an address: the bytes must be here." },
    alt: { type: "string", maxLength: MAX_ALT + 40, description: `Alternative text that describes the image for people who cannot see it, ${MAX_ALT} characters at most, for example "Blue logo of Etoile Nord". Required.` },
    name: { type: "string", maxLength: 120, description: "Optional: the original file name, only written in the journal as a label. The stored name is chosen by the site." },
  },
  required: ["dataBase64", "alt"],
};
export const MEDIA_LIST_INPUT: JsonSchemaLite = { type: "object", properties: { page: { type: "integer", minimum: 1, maximum: 100000, description: `Page number, ${PAGE_SIZE} images per page, newest first. Default 1.` } } };
export const MEDIA_ALT_INPUT: JsonSchemaLite = {
  type: "object",
  properties: {
    address: { type: "string", maxLength: 200, description: "Address of an image already on the site, like /uploads/0a1b2c3d-….png (from media_list or media_upload)." },
    alt: { type: "string", maxLength: MAX_ALT + 40, description: `New alternative text, ${MAX_ALT} characters at most.` },
  },
  required: ["address", "alt"],
};

/** The alternative text: one line, no control characters, 1 to 125 characters. */
function cleanAlt(v: unknown): string {
  const alt = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (!alt) throw new McpToolError('Give the "alt" text: a short sentence that describes the image, for example "Blue logo of Etoile Nord".');
  if (/[\u0000-\u001f\u007f]/.test(alt)) throw new McpToolError('"alt" must be plain text without control characters.');
  if (alt.length > MAX_ALT) throw new McpToolError(`"alt" is ${alt.length} characters; shorten it to ${MAX_ALT} at most.`);
  return alt;
}

/** The label of the journal: the last part of what was sent, letters, digits, dot, dash, underscore and space only. */
const label = (v: unknown): string => (typeof v === "string" ? v.split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N} ._-]+/gu, "").replace(/^\.+/, "").trim().slice(0, 60) : "");

function decode(raw: string): Buffer {
  const b64 = raw.replace(/\s+/g, "");
  if (/^data:/i.test(b64)) throw new McpToolError('Send only the base64 text, without the "data:image/…;base64," prefix.');
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 === 1) throw new McpToolError('"dataBase64" must be the image encoded as plain base64 (letters, digits, + and /).');
  const approx = Math.floor((b64.length * 3) / 4);
  if (approx > MAX_MEDIA_BYTES + 3) throw new McpToolError(`The image is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB. Resize or compress it (for example a 1600 pixel wide jpeg or webp) and send it again.`);
  const buf = Buffer.from(b64, "base64");
  if (buf.length > MAX_MEDIA_BYTES) throw new McpToolError(`The image is larger than ${MAX_MEDIA_BYTES / 1024 / 1024} MB. Resize or compress it and send it again.`);
  return buf;
}

/** The size in pixels, read from the header (no decoding). Refuses what is too big; a file the engine cannot read is refused too. */
async function checkPixels(buf: Buffer): Promise<{ width: number; height: number } | null> {
  const size = await readImageSize(buf);
  if (size === "unreadable") throw new McpToolError("This file looks like an image but cannot be read. Export it again as png, jpeg or webp and send it again.");
  if (size === "toolarge") throw new McpToolError(`The image has too many pixels (more than ${MAX_INPUT_PIXELS / 1_000_000} million). Reduce it to ${Math.floor(Math.sqrt(MAX_INPUT_PIXELS))} pixels on a side at most.`);
  return size;
}

/** What the assistants uploaded in the last 24 hours, counted from the journal (nothing else to keep, nothing to clean). */
async function usedToday(): Promise<{ files: number; bytes: number }> {
  const rows = await prisma.auditLog.findMany({ where: { action: "media.upload", actorKind: "assistant", createdAt: { gt: new Date(Date.now() - 86_400_000) } }, select: { target: true }, take: DAILY_FILES * 4 });
  return { files: rows.length, bytes: rows.reduce((n, r) => n + Number(/ (\d+) bytes/.exec(r.target)?.[1] ?? 0), 0) };
}

export async function mediaUpload(rawArgs: Record<string, unknown>, actor: { name: string; tokenId?: string }): Promise<unknown> {
  const args = validateArgs(MEDIA_UPLOAD_INPUT, rawArgs);
  const alt = cleanAlt(args.alt);
  const buf = decode(String(args.dataBase64));
  await takeSlot(actor.tokenId, "content");
  const day = await usedToday();
  if (day.files >= DAILY_FILES || day.bytes + buf.length > DAILY_BYTES) throw new McpToolError(`The daily upload quota of the site is used up (${DAILY_FILES} images or ${DAILY_BYTES / 1024 / 1024} MB per 24 hours, all assistants together). Try again later, or the owner can upload in the admin.`);

  let address: string;
  let kind: string;
  let size = { width: 0, height: 0 };
  if (looksLikeSvg(buf)) {
    // The logo pipeline: re-written, never stored as received.
    const r = await saveSvgUpload(buf);
    if ("error" in r) throw new McpToolError(r.error === "svg" ? `This svg was refused: only simple shapes, gradients and filters are accepted; scripts, styles, texts, embedded images and outside links are not. Send a simpler svg or a png. Detail from the site (in French): ${r.detail}` : "This is not a usable image. Send png, jpeg, webp or gif.");
    address = r.url; kind = "svg";
  } else {
    const type = sniffImage(buf);
    if (!type) throw new McpToolError("This is not a png, jpeg, webp or gif image (the file content was checked, not its name). Convert it to one of these formats and send it again.");
    size = (await checkPixels(buf)) ?? size;
    const saved = await saveUpload(buf);
    if (!saved) throw new McpToolError("The image was refused. Check that it is a png, jpeg, webp or gif of 3 MB at most.");
    address = saved; kind = type;
  }
  const name = uploadNameOf(address)!;
  await prisma.setting.upsert({ where: { key_locale: { key: ALT_KEY(name), locale: "" } }, create: { key: ALT_KEY(name), locale: "", value: JSON.stringify(alt) }, update: { value: JSON.stringify(alt) } });
  const stored = kind === "svg" ? (await fs.stat(path.join(UPLOADS_DIR, name))).size : buf.length;
  // Who, what, when, the file name and its size. Never the bytes.
  await audit(`mcp:${actor.name}`, "media.upload", `${name} ${stored} bytes${label(args.name) ? ` (sent as "${label(args.name)}")` : ""}`);
  return { address, id: name, type: TYPE_OF[kind], bytes: stored, ...(size.width ? { width: size.width, height: size.height } : {}), alt, usage: "Use this address in a Markdown image ![alt](address), in site_settings_set (logos), or in an image setting of a module (maintenance_module_configure)." };
}

type Usage = { logos: Map<string, string[]>; settings: Map<string, string[]>; entries: { entryId: string; locale: string; text: string }[] };
async function usageIndex(): Promise<Usage> {
  const logoKeys = new Map<string, string>(Object.entries(LOGO_KEYS).map(([slot, key]) => [key, slot]));
  const rows = await prisma.setting.findMany({ where: { value: { contains: "/uploads/" }, NOT: [{ key: { startsWith: "media.alt." } }, { key: { startsWith: "maintenance." } }] }, select: { key: true, value: true } });
  const logos = new Map<string, string[]>(); const settings = new Map<string, string[]>();
  for (const r of rows) for (const n of new Set(r.value.match(/[0-9a-f-]{36}\.(?:png|jpg|webp|gif|svg)/g) ?? [])) {
    const slot = logoKeys.get(r.key);
    const into = slot ? logos : settings;
    into.set(n, [...(into.get(n) ?? []), slot ? `logo ${slot}` : r.key.startsWith("instance.") ? "a module setting" : `setting ${r.key}`]);
  }
  const t = await prisma.entryTranslation.findMany({ where: { OR: [{ body: { contains: "/uploads/" } }, { summary: { contains: "/uploads/" } }] }, select: { entryId: true, locale: true, body: true, summary: true }, take: 2000 });
  return { logos, settings, entries: t.map((x) => ({ entryId: x.entryId, locale: x.locale, text: `${x.summary}\n${x.body}` })) };
}

export async function mediaList(rawArgs: Record<string, unknown>): Promise<unknown> {
  const args = validateArgs(MEDIA_LIST_INPUT, rawArgs);
  const page = (args.page as number | undefined) ?? 1;
  const names = (await fs.readdir(UPLOADS_DIR).catch(() => [] as string[])).filter((n) => IMAGE_NAME.test(n));
  const stats: { name: string; size: number; at: number }[] = [];
  for (let i = 0; i < names.length; i += 100) {
    await Promise.all(names.slice(i, i + 100).map(async (name) => { try { const s = await fs.stat(path.join(UPLOADS_DIR, name)); if (s.isFile()) stats.push({ name, size: s.size, at: s.mtimeMs }); } catch { /* removed meanwhile */ } }));
  }
  stats.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(stats.length / PAGE_SIZE));
  const slice = stats.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const alts = new Map((await prisma.setting.findMany({ where: { key: { in: slice.map((s) => ALT_KEY(s.name)) } } })).map((r) => [r.key, r.value]));
  const use = slice.length ? await usageIndex() : null;
  const items = slice.map((s) => {
    let alt: string | null = null;
    try { const v = alts.get(ALT_KEY(s.name)); alt = v ? (JSON.parse(v) as string) : null; } catch { /* unreadable: no alt */ }
    const usedBy = [...(use!.logos.get(s.name) ?? []), ...(use!.settings.get(s.name) ?? []), ...use!.entries.filter((e) => e.text.includes(s.name)).map((e) => `content ${e.entryId} (${e.locale})`)];
    return { id: s.name, address: `/uploads/${s.name}`, type: TYPE_OF[s.name.split(".").pop()!], alt, bytes: s.size, uploadedAt: new Date(s.at).toISOString(), usedBy: usedBy.slice(0, 5), usedByCount: usedBy.length };
  });
  return { items, total: stats.length, page, pages, perPage: PAGE_SIZE, note: "usedBy is best effort: it looks at the logos, the settings and the text of the content, not at every module." };
}

export async function mediaSetAlt(rawArgs: Record<string, unknown>, actor: { name: string; tokenId?: string }): Promise<unknown> {
  const args = validateArgs(MEDIA_ALT_INPUT, rawArgs);
  const alt = cleanAlt(args.alt);
  const address = String(args.address);
  const name = uploadNameOf(address);
  if (!name || address !== `/uploads/${name}` || !IMAGE_NAME.test(name)) throw new McpToolError("The address must be an image of this site, written like /uploads/0a1b2c3d-….png (see media_list).");
  try { if (!(await fs.stat(path.join(UPLOADS_DIR, name))).isFile()) throw new Error("x"); } catch { throw new McpToolError("No image has this address on this site. Check media_list."); }
  await takeSlot(actor.tokenId, "content");
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: ALT_KEY(name), locale: "" } } });
  let before: string | null = null;
  try { before = row ? (JSON.parse(row.value) as string) : null; } catch { /* none */ }
  await prisma.setting.upsert({ where: { key_locale: { key: ALT_KEY(name), locale: "" } }, create: { key: ALT_KEY(name), locale: "", value: JSON.stringify(alt) }, update: { value: JSON.stringify(alt) } });
  await audit(`mcp:${actor.name}`, "media.alt", `${name}: ${JSON.stringify(before ?? "")} → ${JSON.stringify(alt)}`);
  return { address, alt, previousAlt: before };
}
