import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, siteUrl, UPLOADS_DIR } from "@/core/config";
import { prisma } from "@/core/db";
import { audit } from "@/core/permissions";
import { takeSlot } from "@/core/maintenance/slots";
import { filesUsage, FILES_QUOTA_BYTES, FILES_QUOTA_COUNT, type FileOwner } from "@/core/services/files";
import { storeUpload } from "@/core/services/uploads";
import { dailyWindowStart, filesLimitsNow, notLiftedNote, OWNER_WHERE, utcTime } from "@/core/services/mcp/uploadLift";
import { ASSISTANT_KINDS, ASSISTANT_MAX_BYTES, CHUNK_BYTES, checkAssistantFile, HTTP_PART_BYTES, STAGING_TTL_MS, type AssistantKind } from "./assistantUploadCheck";
export { CHUNK_BYTES, HTTP_PART_BYTES, STAGING_TTL_MS };

/**
 * ASSISTANT UPLOADS (core 0.18.0) — `ctx.api.files.upload` in the MCP tools of a module that declare `"uploads": true`.
 *
 * Why: `files.claim` keeps a file only for the PERSON who just uploaded it in the admin (`no-person` otherwise). An AI assistant has no person, but the owner
 * may want it to add a video it made (an alert for a follow, a raid...). This is the smallest door for that, and nothing else changes for people:
 *
 *   begin   the tool says how big the file is and its sha256; the core opens a STAGING slot (outside /uploads, never served) for 30 minutes, bound to the access
 *           (MCP token) AND to the module instance, and gives two ways to send the bytes: a one-time https address (PUT, 8 MB per request, for an assistant that
 *           can run curl) or base64 pieces of 700 KB through the tool itself (for an assistant that can only call tools);
 *   finish  the core checks the size, the sha256, the kind from the bytes, the container (assistantUploadCheck.ts: no trailing data, a codec every browser plays,
 *           30 s and 1920x1080 at most), the daily quota of the site and the module's quota, then stores the file under a random name, ALREADY OWNED by the
 *           calling instance (so `files.remove` works as for any claimed file), and writes `file.upload` in the journal with the access name.
 *
 * Who can: only an MCP call (never a page, route, task or service), of a tool that declares `"uploads": true` (manifest refuses it on a read-only or
 * default-on tool, and without the `files` permission), granted by the owner to this access (write tools are off by default). Replaying `finish` returns the
 * same file (`already: true`), never a second one. Unfinished slots are swept (no timer: at each begin, piece and finish).
 *
 * The owner's "Start over from zero" and "Lift the limits" (services/mcp/uploadLift.ts, 0.28.2) cover the daily quota of files and the "content" counter
 * of begin, read on every begin AND finish (a lift that ended between the two no longer counts). Never lifted: the byte caps per kind, the checks, the
 * open-upload caps, the 30-minute staging, the module's storage quota. A refusal that a running lift does not cover says so.
 */
export const STAGING_DIR = path.join(DATA_DIR, "assistant-uploads");
export const OPEN_PER_ACCESS = 3;
export const OPEN_PER_SITE = 10;
/** For the whole site, all assistants together, over 24 hours or since the owner started over (counted from the journal, nothing else to keep). */
export const DAILY_FILES = 30;
export const DAILY_BYTES = 250 * 1024 * 1024;

export type UploadWho = { tokenId: string; tokenName: string };
export type UploadProblem = { ok: false; reason: "not-allowed" | "invalid" | "busy" | "unknown" | "expired" | "incomplete" | "hash" | "type" | "size" | "probe" | "quota" | "failed"; message: string };
export type UploadBegin = { ok: true; upload: string; putUrl: string; partBytes: number; chunkBytes: number; chunks: number; expiresAt: string; maxBytes: number };
export type UploadChunk = { ok: true; received: number; total: number; complete: boolean };
export type UploadDone = { ok: true; url: string; kind: AssistantKind; type: string; bytes: number; label: string; width: number | null; height: number | null; durationSeconds: number | null; codec: string | null; alpha: boolean | null; already: boolean };

type Session = {
  id: string; secretHash: string; tokenId: string; tokenName: string; moduleId: string; instanceId: string; instanceKey: string;
  bytes: number; sha256: string; accept: AssistantKind[]; label: string; createdAt: number; received: number; result?: Omit<UploadDone, "already">;
};

const no = (reason: UploadProblem["reason"], message: string): UploadProblem => ({ ok: false, reason, message });
const ID_RE = /^[0-9a-f]{32}$/;
const sha = (x: string | Buffer) => crypto.createHash("sha256").update(x).digest("hex");
const jsonPath = (id: string) => path.join(STAGING_DIR, `${id}.json`);
const partPath = (id: string) => path.join(STAGING_DIR, `${id}.part`);
/** One writer at a time per slot (pieces, PUT, finish). The site is one process. */
const busy = new Set<string>();
export const deps = { now: () => Date.now() };

async function load(id: string): Promise<Session | null> {
  if (!ID_RE.test(id)) return null;
  try { return JSON.parse(await fs.readFile(jsonPath(id), "utf8")) as Session; } catch { return null; }
}
async function save(s: Session): Promise<void> {
  const tmp = `${jsonPath(s.id)}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
  await fs.rename(tmp, jsonPath(s.id));
}
async function drop(id: string): Promise<void> {
  await fs.rm(partPath(id), { force: true }).catch(() => {});
  await fs.rm(jsonPath(id), { force: true }).catch(() => {});
}
const expired = (s: Session) => deps.now() - s.createdAt > STAGING_TTL_MS;

/** Removes expired slots and stray files of the staging folder. Returns the slots still open (not finished). */
export async function sweep(): Promise<Session[]> {
  const names = await fs.readdir(STAGING_DIR).catch(() => [] as string[]);
  const open: Session[] = [];
  for (const n of names) {
    const id = n.split(".")[0]!;
    if (!n.endsWith(".json")) {
      // a piece without its description, or a temporary file left by a crash
      if (!ID_RE.test(id) || !names.includes(`${id}.json`)) await fs.rm(path.join(STAGING_DIR, n), { force: true }).catch(() => {});
      continue;
    }
    const s = await load(id);
    if (!s || expired(s)) { await drop(id); continue; }
    if (!s.result) open.push(s);
  }
  return open;
}

/** What assistants stored in the last 24 hours, or since the owner started the count over if that is more recent (from the journal, same start as the images). */
export async function usedToday(): Promise<{ files: number; bytes: number }> {
  const from = await dailyWindowStart();
  const rows = await prisma.auditLog.findMany({ where: { action: "file.upload", actorKind: "assistant", createdAt: { gt: new Date(from) } }, select: { target: true }, take: DAILY_FILES * 4 });
  return { files: rows.length, bytes: rows.reduce((n, r) => n + Number(/ (\d+) bytes/.exec(r.target)?.[1] ?? 0), 0) };
}

const MB = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
/** The refusal of the daily quota of files: what is counted, what the owner can do and where (the button names of the card), and what the assistant can do. */
export const filesQuotaMessage = (day: { files: number; bytes: number }) =>
  `The daily upload quota of the site for files sent by assistants is used up (${DAILY_FILES} files or ${DAILY_BYTES / 1024 / 1024} MB per 24 hours, all assistants together; ${day.files} files and ${MB(day.bytes)} MB counted now). The owner can press "Lift the limits" (10, 30 or 60 minutes) or "Start over from zero" ${OWNER_WHERE}, then you can try again. Otherwise try again later.`;
const roomMessage = (until: number | null) => `This module has no room left for files. The owner can delete unused files in its library.${notLiftedNote(until, "the room of a module")}`;

/** A label for the journal and the module (the name the assistant gives): letters, digits, space, dot, dash, underscore, apostrophe; 60 characters. */
export const cleanLabel = (v: unknown): string => (typeof v === "string" ? v.normalize("NFKC").split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N} ._'-]+/gu, " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "").trim().slice(0, 60) : "");

export async function beginUpload(who: UploadWho, owner: FileOwner, input: { bytes?: unknown; sha256?: unknown; accept?: unknown; label?: unknown }): Promise<UploadBegin | UploadProblem> {
  const accept = (Array.isArray(input.accept) && input.accept.length ? input.accept : ASSISTANT_KINDS).filter((k): k is AssistantKind => ASSISTANT_KINDS.includes(k as AssistantKind));
  if (!accept.length) return no("invalid", "accept must list image, video and/or audio.");
  const max = Math.max(...accept.map((k) => ASSISTANT_MAX_BYTES[k]));
  const bytes = input.bytes;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1) return no("invalid", "Give the exact size of the file in bytes, for example 2104331 (stat -c %s file.webm).");
  // The limits are read on every call: a lift that ended a second ago no longer counts.
  const limits = await filesLimitsNow();
  if (bytes > max) return no("size", `The file is ${(bytes / 1024 / 1024).toFixed(1)} MB; ${Math.round(max / 1024 / 1024)} MB at most here (pictures 5 MB, sounds 10 MB, videos 25 MB). Compress it first.${notLiftedNote(limits.until, "the size of one file")}`);
  const hash = typeof input.sha256 === "string" ? input.sha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(hash)) return no("invalid", "Give the sha256 of the file as 64 hexadecimal characters, for example the first word of: sha256sum file.webm.");
  const open = await sweep();
  const openNote = notLiftedNote(limits.until, "the number of uploads in progress");
  if (open.filter((s) => s.tokenId === who.tokenId).length >= OPEN_PER_ACCESS) return no("busy", `This access already has ${OPEN_PER_ACCESS} uploads in progress. Finish them (or wait 30 minutes for them to expire) before starting another one.${openNote}`);
  if (open.length >= OPEN_PER_SITE) return no("busy", `Too many uploads are in progress on this site. Try again in a few minutes.${openNote}`);
  if (limits.daily) {
    const day = await usedToday();
    if (day.files >= DAILY_FILES || day.bytes + bytes > DAILY_BYTES) return no("quota", filesQuotaMessage(day));
  }
  const used = await filesUsage(owner.moduleId);
  if (used.files + 1 > FILES_QUOTA_COUNT || used.bytes + bytes > FILES_QUOTA_BYTES) return no("quota", roomMessage(limits.until));
  if (limits.contentCounter) { try { await takeSlot(who.tokenId, "content"); } catch (error) { return no("busy", (error as Error).message); } }
  const id = crypto.randomBytes(16).toString("hex");
  const secret = crypto.randomBytes(32).toString("base64url");
  await fs.mkdir(STAGING_DIR, { recursive: true, mode: 0o700 });
  const s: Session = { id, secretHash: sha(secret), tokenId: who.tokenId, tokenName: who.tokenName, moduleId: owner.moduleId, instanceId: owner.instanceId, instanceKey: owner.instanceKey, bytes, sha256: hash, accept, label: cleanLabel(input.label), createdAt: deps.now(), received: 0 };
  await fs.writeFile(partPath(id), Buffer.alloc(0), { mode: 0o600 });
  await save(s);
  return { ok: true, upload: id, putUrl: `${siteUrl}/api/assistant-upload/${id}.${secret}`, partBytes: HTTP_PART_BYTES, chunkBytes: CHUNK_BYTES, chunks: Math.ceil(bytes / CHUNK_BYTES), expiresAt: new Date(s.createdAt + STAGING_TTL_MS).toISOString(), maxBytes: max };
}

/** The slot of THIS access and THIS instance, or a refusal that reveals nothing (the same answer whether it exists for someone else or not). */
async function mine(who: UploadWho, owner: FileOwner, upload: unknown): Promise<Session | UploadProblem> {
  const id = typeof upload === "string" ? upload.trim() : "";
  const s = await load(id);
  if (!s || s.tokenId !== who.tokenId || s.instanceId !== owner.instanceId) return no("unknown", "Unknown upload. Use the upload value returned by the begin step of this same tool, within 30 minutes.");
  if (expired(s)) { await drop(s.id); return no("expired", `This upload expired (30 minutes). Start a new one.${notLiftedNote((await filesLimitsNow()).until, "the 30 minutes of an upload")}`); }
  return s;
}

/** Writes `data` at `offset` (0 or any offset already reached: pieces can be sent again). */
async function writeAt(s: Session, offset: number, data: Buffer): Promise<UploadChunk | UploadProblem> {
  if (s.result) return no("invalid", "This upload is already finished. Start a new one for another file.");
  if (!Number.isInteger(offset) || offset < 0 || offset > s.received) return no("invalid", `Send the file in order: ${s.received} bytes were received so far, so the next piece starts at byte ${s.received} (piece number ${Math.floor(s.received / CHUNK_BYTES)}).`);
  if (offset + data.length > s.bytes) return no("size", `This piece goes past the size announced at the start (${s.bytes} bytes). Start a new upload with the right size.`);
  const fh = await fs.open(partPath(s.id), "r+");
  try { await fh.write(data, 0, data.length, offset); } finally { await fh.close(); }
  s.received = Math.max(s.received, offset + data.length);
  await save(s);
  return { ok: true, received: s.received, total: s.bytes, complete: s.received === s.bytes };
}

export async function uploadChunk(who: UploadWho, owner: FileOwner, input: { upload?: unknown; index?: unknown; data?: unknown }): Promise<UploadChunk | UploadProblem> {
  const s = await mine(who, owner, input.upload);
  if ("reason" in s) return s;
  const index = input.index;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return no("invalid", "index must be the number of the piece, starting at 0.");
  const raw = typeof input.data === "string" ? input.data.replace(/\s+/g, "") : "";
  if (/^data:/i.test(raw)) return no("invalid", 'Send only the base64 text, without a "data:…;base64," prefix.');
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 === 1) return no("invalid", "data must be plain base64 (letters, digits, + and /), for example the output of: base64 -w0.");
  if (raw.length > Math.ceil(CHUNK_BYTES / 3) * 4) return no("size", `A piece is ${CHUNK_BYTES} bytes at most before base64 (split -b ${CHUNK_BYTES}).`);
  const data = Buffer.from(raw, "base64");
  const last = index === Math.ceil(s.bytes / CHUNK_BYTES) - 1;
  if (data.length !== CHUNK_BYTES && !last) return no("invalid", `Every piece except the last one must be exactly ${CHUNK_BYTES} bytes (split -b ${CHUNK_BYTES}).`);
  if (busy.has(s.id)) return no("busy", "Another piece of this upload is being written. Send the pieces one after the other.");
  busy.add(s.id);
  try { return await writeAt(s, index * CHUNK_BYTES, data); } finally { busy.delete(s.id); }
}

/**
 * The one-time address: `PUT /api/assistant-upload/<upload>.<secret>[?offset=n]`, raw bytes in the body, 8 MB per request. The secret (256 bits) is compared by
 * its sha256 in constant time; any problem answers the same 404, so the address reveals nothing. It only fills the staging slot: the file is checked and stored
 * by the tool's finish step (an MCP call with the access's rights), never here.
 */
export async function receivePart(ticket: string, offsetRaw: string | null, body: ReadableStream<Uint8Array> | null, declaredLength: number | null): Promise<{ status: number; body: Record<string, unknown> }> {
  const m = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
  const notFound = { status: 404, body: { error: "Unknown or expired upload address. Start a new upload with the tool." } };
  if (!m) return notFound;
  await sweep();
  const s = await load(m[1]!);
  if (!s || expired(s) || !crypto.timingSafeEqual(Buffer.from(sha(m[2]!), "hex"), Buffer.from(s.secretHash, "hex"))) return notFound;
  if (s.result) return { status: 409, body: { error: "This upload is already finished." } };
  const offset = offsetRaw === null || offsetRaw === "" ? 0 : /^\d{1,9}$/.test(offsetRaw) ? Number(offsetRaw) : -1;
  if (offset < 0 || offset > s.received) return { status: 409, body: { error: `Send the file in order: next offset is ${s.received}.`, received: s.received, total: s.bytes } };
  const room = Math.min(HTTP_PART_BYTES, s.bytes - offset);
  if (declaredLength !== null && declaredLength > room) return { status: 413, body: { error: `At most ${room} bytes here (8 MB per request, and not past the announced size of ${s.bytes}). Send the rest with ?offset=.`, received: s.received, total: s.bytes } };
  if (!body) return { status: 400, body: { error: "Send the file bytes in the body." } };
  if (busy.has(s.id)) return { status: 409, body: { error: "Another request is writing this upload. Send the parts one after the other." } };
  busy.add(s.id);
  try {
    const parts: Buffer[] = [];
    let got = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (got > room) { await reader.cancel().catch(() => {}); return { status: 413, body: { error: `Too many bytes: at most ${room} here (8 MB per request, and not past the announced size of ${s.bytes}).`, received: s.received, total: s.bytes } }; }
      parts.push(Buffer.from(value));
    }
    const r = await writeAt(s, offset, Buffer.concat(parts));
    if (!r.ok) return { status: 409, body: { error: r.message } };
    return { status: 200, body: { received: r.received, total: r.total, complete: r.complete, next: r.complete ? "Call the finish step of the same tool with this upload." : `Send the next part with ?offset=${r.received}.` } };
  } finally { busy.delete(s.id); }
}

export async function finishUpload(who: UploadWho, owner: FileOwner, input: { upload?: unknown }): Promise<UploadDone | UploadProblem> {
  await sweep();
  const s = await mine(who, owner, input.upload);
  if ("reason" in s) return s;
  if (s.result) return { ...s.result, already: true };
  if (s.received !== s.bytes) return no("incomplete", `Only ${s.received} of ${s.bytes} bytes were received. Send the rest (next piece number ${Math.floor(s.received / CHUNK_BYTES)}, or PUT with ?offset=${s.received}), then finish again.`);
  if (busy.has(s.id)) return no("busy", "This upload is being written or checked. Try again in a few seconds.");
  busy.add(s.id);
  try {
    const buf = await fs.readFile(partPath(s.id));
    if (buf.length !== s.bytes) return no("incomplete", "The received file has a different size. Start a new upload.");
    if (sha(buf) !== s.sha256) {
      // the bytes do not match what was announced: start the pieces again in the same slot
      s.received = 0; await fs.writeFile(partPath(s.id), Buffer.alloc(0)); await save(s);
      return no("hash", "The sha256 of the received bytes does not match the one given at the start. The received bytes were discarded: send the file again from piece 0 (or offset 0), then finish.");
    }
    const checked = await checkAssistantFile(buf, s.accept);
    if (!checked.ok) { await drop(s.id); return no(checked.reason, checked.message); }
    const limits = await filesLimitsNow();
    if (limits.daily) {
      // The slot is kept (30 minutes): once the owner lifts the limits or starts over, finish again with the same upload, nothing to send again.
      const day = await usedToday();
      if (day.files >= DAILY_FILES || day.bytes + buf.length > DAILY_BYTES) return no("quota", `${filesQuotaMessage(day)} The bytes already sent stay until ${utcTime(s.createdAt + STAGING_TTL_MS)}: after the owner's action, call the finish step again with the same upload, nothing to send again.`);
    }
    const used = await filesUsage(owner.moduleId);
    if (used.files + 1 > FILES_QUOTA_COUNT || used.bytes + buf.length > FILES_QUOTA_BYTES) return no("quota", roomMessage(limits.until));
    const url = await storeUpload(buf, checked.ext);
    const name = url.slice("/uploads/".length);
    const now = new Date(deps.now());
    try {
      await prisma.uploadFile.create({ data: { name, uploaderId: `assistant:${who.tokenId}`, bytes: buf.length, ownerModule: owner.moduleId, ownerInstance: owner.instanceId, claimedAt: now } });
    } catch {
      await fs.rm(path.join(UPLOADS_DIR, name), { force: true }).catch(() => {});
      return no("failed", "The file could not be recorded. Try the finish step again.");
    }
    const detail = [checked.width ? `${checked.width}x${checked.height}` : "", checked.durationSeconds ? `${checked.durationSeconds}s` : ""].filter(Boolean).join(" ");
    await audit(`mcp:${who.tokenName}`, "file.upload", `${owner.instanceKey}: ${name} ${buf.length} bytes ${checked.kind}${detail ? ` ${detail}` : ""}${s.label ? ` "${s.label}"` : ""}`, { module: owner.moduleId, instance: owner.instanceKey });
    const result: Omit<UploadDone, "already"> = { ok: true, url, kind: checked.kind, type: checked.ext, bytes: buf.length, label: s.label, width: checked.width, height: checked.height, durationSeconds: checked.durationSeconds, codec: checked.codec, alpha: checked.alpha };
    s.result = result;
    await fs.rm(partPath(s.id), { force: true }).catch(() => {});
    await save(s);
    return { ...result, already: false };
  } finally { busy.delete(s.id); }
}

/** Gives up an upload in progress (its bytes are deleted). Finished uploads are not touched (the file belongs to the module: `files.remove`). */
export async function cancelUpload(who: UploadWho, owner: FileOwner, input: { upload?: unknown }): Promise<{ ok: true } | UploadProblem> {
  const s = await mine(who, owner, input.upload);
  if ("reason" in s) return s;
  if (!s.result) await drop(s.id);
  return { ok: true };
}
