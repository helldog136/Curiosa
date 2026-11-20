// Minimal zip WRITER for the tests of the skin zip reader (src/core/skins/zip.ts). It can also write archives that are wrong on purpose: a lying size,
// a wrong CRC, a link, a password flag, zip64 markers, overlapping entries... Nothing here is used by the product.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/**
 * entries: { name, data (Buffer|string), method (8 deflate | 0 stored), host (3 = Unix), mode (Unix mode, e.g. 0o120000 = link), flags, crc, usize, csize, utf8 }
 * options: { comment, extraTail (bytes appended before the end record, for overlap tests) }
 */
export function makeZip(entries, options = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, e.utf8 === false ? "latin1" : "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "");
    const method = e.method ?? (e.name.endsWith("/") ? 0 : 8);
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = e.crc ?? crc32(data);
    const usize = e.usize ?? data.length;
    const csize = e.csize ?? body.length;
    const flags = (e.flags ?? 0) | (e.utf8 === false ? 0 : 0x800);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(csize, 18); local.writeUInt32LE(usize, 22); local.writeUInt16LE(name.length, 26);
    const at = e.localOffset ?? offset;
    parts.push(local, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(((e.host ?? 0) << 8) | 20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(flags, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(csize, 20); cen.writeUInt32LE(usize, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(e.mode ? (e.mode << 16) >>> 0 : 0, 38); cen.writeUInt32LE(at, 42);
    central.push(cen, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const comment = Buffer.from(options.comment ?? "");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, cd, end, comment]);
}

/** Zips a folder like a person would: `top` puts everything in one folder of that name; `junk` adds what macOS and Windows add. */
export function zipFolder(dir, { top = "", junk = false, backslashes = false } = {}) {
  const entries = [];
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(path.join(dir, r)).isDirectory()) { walk(r); continue; }
      const full = top ? `${top}/${r}` : r;
      entries.push({ name: backslashes ? full.replace(/\//g, "\\") : full, data: fs.readFileSync(path.join(dir, r)), host: 3, mode: 0o100644 });
    }
  };
  walk("");
  if (junk) {
    const p = top ? `${top}/` : "";
    entries.push({ name: "__MACOSX/", data: "" }, { name: `__MACOSX/${p}._skin.json`, data: "junk" }, { name: `${p}.DS_Store`, data: "junk" }, { name: `${p}Thumbs.db`, data: "junk" }, { name: `${p}._skin.css`, data: "junk" });
    if (top) entries.unshift({ name: `${top}/`, data: "" });
  }
  return makeZip(entries);
}
