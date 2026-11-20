/**
 * SAFE READER FOR THE ZIP FILE OF A SKIN (docs/SKINS.md "From your folder to your site").
 *
 * The archive is UNTRUSTED. This file only reads: it never writes, never executes, never touches the disk, and has no dependency (the repository has no zip
 * library; `node:zlib` inflates). It reads the CENTRAL DIRECTORY (the list at the end of the file), refuses everything unusual, then inflates only the entries
 * that will be kept, each under a hard output cap, and checks the size and the CRC of what came out.
 *
 * Refused, with a code (`ZipErrorCode`, turned into a plain sentence by the admin action):
 *   - not a zip, several end records (ambiguous), a truncated or inconsistent file, overlapping entries (the "quine" bomb)       not-zip, ambiguous, truncated, corrupt, overlap
 *   - zip64 (more than 4 GB or 65535 entries: no skin needs it), encrypted entries, methods other than "stored" and "deflate"     zip64, encrypted, method
 *   - links (symbolic or hard) and any entry that is not a plain file or folder (device, socket, pipe)                           special
 *   - a name with `..`, an absolute path, a drive letter, a control character, an empty part, or that is too long or too deep     bad-name
 *   - two entries with the same name, or names that differ only by case or Unicode form (they would overwrite each other)        duplicate
 *   - more than `maxFiles` files kept, a file or a total over its cap (declared AND actual), a compression ratio over `maxRatio`  too-many, too-large, ratio
 *   - a size or CRC that does not match what was declared                                                                         corrupt
 * Ignored (not inflated, not counted): the junk that Windows and macOS add (`__MACOSX/`, `.DS_Store`, `._*`, `Thumbs.db`, `desktop.ini`) and folders.
 * Backslashes are read as separators (old Windows tools write them) BEFORE every check, so `..\x` is still refused.
 */
import zlib from "node:zlib";
import { FILE_LIMITS } from "./constants";

export const ZIP_LIMITS = {
  /** The archive itself: the skin's own cap (2 MB uncompressed) plus room for folders, junk and headers. */
  archiveBytes: 4 * 1024 * 1024,
  /** Entries in the central directory, junk included (a macOS zip doubles every file with `._` and `__MACOSX/` copies). */
  entries: 400,
  /** Files kept: the skin's own cap. */
  maxFiles: FILE_LIMITS.files,
  /** One kept file: above any file a skin may carry (a picture is at most 200 KB), so the skin check, not this one, says which file is too heavy. */
  entryBytes: 512 * 1024,
  /** All kept files, uncompressed: the skin's cap plus a little room (the skin check refuses above its own cap with a precise message). */
  totalBytes: FILE_LIMITS.totalBytes + 512 * 1024,
  /** Uncompressed / compressed, for an entry of at least `ratioFrom` bytes. */
  maxRatio: 100,
  ratioFrom: 8 * 1024,
  pathChars: 200,
  depth: 6,
} as const;

export type ZipErrorCode = "not-zip" | "ambiguous" | "truncated" | "corrupt" | "overlap" | "zip64" | "encrypted" | "method" | "special" | "bad-name" | "duplicate" | "too-many" | "too-large" | "ratio" | "empty" | "too-big";
export type ZipResult = { ok: true; files: { path: string; content: Buffer }[]; ignored: number } | { ok: false; code: ZipErrorCode; file?: string };

const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50, ZIP64_LOCATOR = 0x07064b50;
const S_IFMT = 0o170000, S_IFREG = 0o100000, S_IFDIR = 0o040000;

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Junk that file managers add: never part of a skin, never inflated. */
export function isJunk(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1] ?? "";
  return parts[0] === "__MACOSX" || name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini" || name.startsWith("._");
}

const err = (code: ZipErrorCode, file?: string): { ok: false; code: ZipErrorCode; file?: string } => ({ ok: false, code, ...(file ? { file } : {}) });

type Entry = { name: string; raw: string; method: number; crc: number; csize: number; usize: number; local: number; dir: boolean };

/** Reads the archive. Never throws. */
export function readSkinZip(buf: Buffer, limits: { maxFiles?: number; entryBytes?: number; totalBytes?: number; maxRatio?: number } = {}): ZipResult {
  try { return read(buf, { ...ZIP_LIMITS, ...limits }); } catch { return err("corrupt"); }
}

function read(buf: Buffer, L: { maxFiles: number; entryBytes: number; totalBytes: number; maxRatio: number }): ZipResult {
  if (buf.length > ZIP_LIMITS.archiveBytes) return err("too-big");
  if (buf.length < 22) return err("not-zip");
  // ---- the end record: the ONE candidate whose comment reaches exactly the end of the file
  const found: number[] = [];
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) found.push(i);
  }
  if (found.length === 0) return err(buf.subarray(0, 4).toString("latin1") === "PK\x03\x04" ? "truncated" : "not-zip");
  if (found.length > 1) return err("ambiguous");
  const e = found[0]!;
  if (e >= 20 && buf.readUInt32LE(e - 20) === ZIP64_LOCATOR) return err("zip64");
  const disk = buf.readUInt16LE(e + 4), cdDisk = buf.readUInt16LE(e + 6), onDisk = buf.readUInt16LE(e + 8), total = buf.readUInt16LE(e + 10);
  const cdSize = buf.readUInt32LE(e + 12), cdOffset = buf.readUInt32LE(e + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return err("zip64");
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) return err("corrupt");
  if (total === 0) return err("empty");
  if (total > ZIP_LIMITS.entries) return err("too-many");
  if (cdOffset + cdSize > e) return err("truncated");

  // ---- the central directory
  const entries: Entry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdOffset + cdSize || buf.readUInt32LE(p) !== CEN) return err("corrupt");
    const madeBy = buf.readUInt16LE(p + 4), flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const diskStart = buf.readUInt16LE(p + 34), external = buf.readUInt32LE(p + 38), local = buf.readUInt32LE(p + 42);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > cdOffset + cdSize) return err("corrupt");
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    const rawName = nameBytes.toString(flags & 0x800 ? "utf8" : "latin1");
    if (csize === 0xffffffff || usize === 0xffffffff || local === 0xffffffff || diskStart === 0xffff) return err("zip64");
    // links and special entries: the Unix mode sits in the high half of the external attributes when the archive was made on Unix (host 3)
    const host = madeBy >> 8;
    const mode = (external >>> 16) & 0xffff;
    if (host === 3 && (mode & S_IFMT) !== 0 && (mode & S_IFMT) !== S_IFREG && (mode & S_IFMT) !== S_IFDIR) return err("special", rawName.slice(0, 80));
    if ((external & 0x400) !== 0 && host === 0) return err("special", rawName.slice(0, 80));   // MS-DOS reparse-point attribute
    if (flags & 0x1 || flags & 0x40) return err("encrypted", rawName.slice(0, 80));
    if (method !== 0 && method !== 8) return err("method", rawName.slice(0, 80));
    if (diskStart !== 0) return err("corrupt");
    // the name: separators first, then every check on the result
    if (/[\u0000-\u001f\u007f]/.test(rawName)) return err("bad-name", rawName.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 80));
    const unified = rawName.replace(/\\/g, "/");
    const dir = unified.endsWith("/");
    const name = dir ? unified.slice(0, -1) : unified;
    if (!dir && name === "") return err("bad-name", rawName.slice(0, 80));
    if (name !== "") {
      const parts = name.split("/");
      if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || parts.some((s) => s === "" || s === "." || s === "..") || name.length > ZIP_LIMITS.pathChars || parts.length > ZIP_LIMITS.depth) return err("bad-name", name.slice(0, 80));
      if (/^[A-Za-z]:/.test(parts[0]!)) return err("bad-name", name.slice(0, 80));
    }
    if (dir && usize !== 0) return err("corrupt", name.slice(0, 80));
    entries.push({ name, raw: rawName, method, crc, csize, usize, local, dir });
    p = end;
  }
  if (p !== cdOffset + cdSize) return err("corrupt");

  // ---- names: no duplicate, no two that differ only by case or Unicode form
  const seen = new Set<string>();
  for (const en of entries) {
    if (en.dir || en.name === "") continue;
    const key = en.name.normalize("NFC").toLowerCase();
    if (seen.has(key)) return err("duplicate", en.name.slice(0, 80));
    seen.add(key);
  }

  // ---- what is kept: caps on the DECLARED sizes first (nothing is inflated yet)
  const kept = entries.filter((x) => !x.dir && !isJunk(x.name));
  const ignored = entries.length - kept.length;
  if (kept.length === 0) return err("empty");
  if (kept.length > L.maxFiles) return err("too-many");
  let declared = 0;
  for (const k of kept) {
    if (k.usize > L.entryBytes) return err("too-large", k.name);
    if (k.usize >= ZIP_LIMITS.ratioFrom && k.usize > k.csize * L.maxRatio) return err("ratio", k.name);
    declared += k.usize;
    if (declared > L.totalBytes) return err("too-large");
  }

  // ---- the data of every entry: inside the file, before the central directory, never overlapping another
  const spans: [number, number][] = [];
  const located = new Map<Entry, number>();
  for (const en of entries) {
    if (en.local + 30 > cdOffset || buf.readUInt32LE(en.local) !== LOC) return err("corrupt", en.name.slice(0, 80));
    const lflags = buf.readUInt16LE(en.local + 6), lnameLen = buf.readUInt16LE(en.local + 26), lextra = buf.readUInt16LE(en.local + 28);
    if (lflags & 0x1) return err("encrypted", en.name.slice(0, 80));
    const start = en.local + 30 + lnameLen + lextra;
    const stop = start + en.csize;
    if (stop > cdOffset) return err("truncated", en.name.slice(0, 80));
    if (buf.subarray(en.local + 30, en.local + 30 + lnameLen).toString("latin1") !== Buffer.from(en.raw, lflags & 0x800 ? "utf8" : "latin1").toString("latin1")) return err("corrupt", en.name.slice(0, 80));
    spans.push([en.local, stop]);
    located.set(en, start);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i]![0] < spans[i - 1]![1]) return err("overlap");

  // ---- inflate the kept entries, each under its own cap; the running total is checked on the ACTUAL bytes
  const files: { path: string; content: Buffer }[] = [];
  let actual = 0;
  for (const k of kept) {
    const start = located.get(k)!;
    const data = buf.subarray(start, start + k.csize);
    let out: Buffer;
    if (k.method === 0) {
      if (k.csize !== k.usize) return err("corrupt", k.name);
      out = Buffer.from(data);
    } else {
      try { out = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, k.usize) }); }
      catch (error) { return err((error as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE" ? "corrupt" : "truncated", k.name); }
    }
    actual += out.length;
    if (out.length !== k.usize || out.length > L.entryBytes) return err("corrupt", k.name);
    if (actual > L.totalBytes) return err("too-large");
    if (crc32(out) !== k.crc) return err("corrupt", k.name);
    files.push({ path: k.name, content: out });
  }
  return { ok: true, files, ignored };
}
