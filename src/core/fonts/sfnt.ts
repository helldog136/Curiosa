/**
 * CONVERSION D'UN FICHIER .ttf / .otf EN WOFF2 (docs/POLICES.md). Tout ce qui est stocké, sauvegardé et servi reste du WOFF2 : le fichier envoyé n'est jamais gardé tel quel.
 *
 * On lit le fichier sfnt pour de bon (signature, répertoire de tables dans le fichier, sans chevauchement, tables indispensables, `head` avec son nombre magique), on refuse
 * les collections, l'ancien format WOFF, les dessins SVG et les polices en images (bitmap), puis on écrit un WOFF2 : en-tête, répertoire (étiquettes connues indexées ;
 * `glyf` et `loca` en « transformation nulle », version 3, permise par la norme), flux de tables compressé en Brotli (mode police) par le pool de fils de Node (`zlib`, sans bloquer le serveur ; un envoi à la fois grâce au verrou d'envoi), bourrage à 4 octets.
 * Le résultat repasse ensuite par `checkWoff2`, comme un envoi WOFF2 : aucune confiance dans ce que ce fichier-ci vient de produire. Rien n'est exécuté.
 */
import zlib from "node:zlib";
import { promisify } from "node:util";
import { KNOWN_TAGS } from "./woff2";

const brotli = promisify(zlib.brotliCompress);

export type SfntCode = "cff2" | "corrupt" | "not-font" | "collection" | "truncated" | "tables" | "bitmap" | "missing" | "head" | "too-large";
export type Converted = { ok: true; woff2: Buffer } | { ok: false; code: SfntCode };

const FLAVORS = new Set([0x00010000, 0x4f54544f, 0x74727565]);
/** Tables de dessins en images ou en SVG : refusées (aucun intérêt pour du texte, et plus de surface à vérifier). */
const REFUSED = new Set(["SVG ", "EBDT", "EBLC", "EBSC", "CBDT", "CBLC", "sbix", "bdat", "bloc"]);
const MAX_TABLES = 64;

/** Ce fichier a-t-il l'allure d'un fichier sfnt (.ttf, .otf) ? */
export function looksLikeSfnt(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const s = buf.readUInt32BE(0);
  return FLAVORS.has(s) || s === 0x74746366 /* ttcf */ || s === 0x774f4646 /* wOFF */;
}

const pad4 = (n: number) => (n + 3) & ~3;

function base128(n: number): number[] {
  const out = [n & 0x7f];
  for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

export async function sfntToWoff2(buf: Buffer, opts: { maxInput?: number } = {}): Promise<Converted> {
  const bad = (code: SfntCode): Converted => ({ ok: false, code });
  if (buf.length > (opts.maxInput ?? 500 * 1024)) return bad("too-large");
  if (buf.length < 12) return bad("not-font");
  const flavor = buf.readUInt32BE(0);
  if (flavor === 0x74746366) return bad("collection");
  if (!FLAVORS.has(flavor)) return bad("not-font"); // y compris l'ancien WOFF (« wOFF »)
  const n = buf.readUInt16BE(4);
  if (n < 5 || n > MAX_TABLES) return bad("tables");
  const dirEnd = 12 + 16 * n;
  if (dirEnd > buf.length) return bad("truncated");

  const tables: { tag: string; offset: number; length: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const at = 12 + 16 * i;
    const tag = buf.toString("latin1", at, at + 4);
    const offset = buf.readUInt32BE(at + 8), length = buf.readUInt32BE(at + 12);
    if (!/^[\x20-\x7e]{4}$/.test(tag) || seen.has(tag)) return bad("tables");
    seen.add(tag);
    if (REFUSED.has(tag)) return bad("bitmap");
    if (offset < dirEnd || offset + length > buf.length || length === 0 && tag !== "loca") return bad(offset + length > buf.length ? "truncated" : "tables");
    tables.push({ tag, offset, length });
  }
  // pas de chevauchement
  const byOffset = [...tables].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < byOffset.length; i++) if (byOffset[i]!.offset < byOffset[i - 1]!.offset + byOffset[i - 1]!.length) return bad("tables");
  for (const need of ["cmap", "head", "hhea", "hmtx", "maxp", "name"]) if (!seen.has(need)) return bad("missing");
  if (seen.has("CFF2")) return bad("cff2");
  if (!(seen.has("glyf") && seen.has("loca")) && !seen.has("CFF ")) return bad("missing");

  const data = (t: { offset: number; length: number }) => Buffer.from(buf.subarray(t.offset, t.offset + t.length));
  const headT = tables.find((t) => t.tag === "head")!;
  if (headT.length < 54) return bad("head");
  const head = data(headT);
  if (head.readUInt32BE(12) !== 0x5f0f3cf5) return bad("head");
  // contours TrueType : `loca` croissant, de la bonne longueur pour `maxp.numGlyphs`, et sans dépasser `glyf`
  if (seen.has("glyf")) {
    const maxp = data(tables.find((t) => t.tag === "maxp")!), loca = data(tables.find((t) => t.tag === "loca")!), glyfLen = tables.find((t) => t.tag === "glyf")!.length;
    const long = head.readInt16BE(50);
    if (maxp.length < 6 || (long !== 0 && long !== 1)) return bad("corrupt");
    const count = maxp.readUInt16BE(4) + 1, size = long ? 4 : 2;
    if (loca.length < count * size) return bad("corrupt");
    let prev = 0;
    for (let i = 0; i < count; i++) {
      const o = (long ? loca.readUInt32BE(i * 4) : loca.readUInt16BE(i * 2) * 2);
      if (o < prev || o > glyfLen) return bad("corrupt");
      prev = o;
    }
  }
  head.writeUInt16BE(head.readUInt16BE(16) | (1 << 11), 16); // « police convertie sans perte » (norme WOFF2)

  // répertoire WOFF2 + flux concaténé
  const ordered = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const dir: number[] = [];
  const parts: Buffer[] = [];
  let sfntSize = 12 + 16 * n;
  for (const t of ordered) {
    const idx = KNOWN_TAGS.indexOf(t.tag);
    const nullTransform = t.tag === "glyf" || t.tag === "loca" ? 3 << 6 : 0;
    dir.push((idx >= 0 ? idx : 63) | nullTransform);
    if (idx < 0) dir.push(...Buffer.from(t.tag, "latin1"));
    dir.push(...base128(t.length));
    parts.push(t.tag === "head" ? head : data(t));
    sfntSize += pad4(t.length);
  }
  const stream = Buffer.concat(parts);
  let compressed: Buffer;
  try {
    compressed = await brotli(stream, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_FONT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: stream.length } });
  } catch { return bad("tables"); }

  const header = Buffer.alloc(48);
  header.write("wOF2", 0, "latin1");
  header.writeUInt32BE(flavor, 4);
  header.writeUInt16BE(n, 12);
  header.writeUInt32BE(sfntSize, 16);
  header.writeUInt32BE(compressed.length, 20);
  const body = Buffer.concat([Buffer.from(dir), compressed]);
  const out = Buffer.concat([header, body, Buffer.alloc(pad4(48 + body.length) - (48 + body.length))]);
  out.writeUInt32BE(out.length, 8);
  return { ok: true, woff2: out };
}
