/**
 * VÉRIFICATION DES OCTETS d'une police envoyée (docs/POLICES.md) : on ne croit ni l'extension ni le type annoncé par le navigateur.
 *
 * Un fichier WOFF2 (https://www.w3.org/TR/WOFF2/) est lu pour de bon : signature `wOF2`, longueur annoncée = longueur réelle, en-tête cohérent, répertoire des
 * tables lu jusqu'au bout, flux Brotli DÉCOMPRESSÉ avec un plafond de taille (une « bombe » de décompression est refusée), taille décompressée = somme exacte des
 * tailles de tables annoncées, tables indispensables présentes (`cmap`, `head` avec son nombre magique, `hhea`, `hmtx`, `maxp`, `name` et `glyf`+`loca` ou `CFF `).
 * Refusés : collection de polices, bloc de données privées, dessins SVG embarqués (table `SVG `). Rien n'est exécuté ni interprété : on lit des nombres.
 * De là viennent aussi le nom de la famille, la graisse (normale, grasse, ou plage d'une police variable) et le style (droit, italique).
 */
import zlib from "node:zlib";
import { UPLOAD_LIMITS } from "./types";

export type FontCheckCode =
  | "empty" | "too-large" | "not-woff2" | "header" | "collection" | "truncated" | "tables" | "private" | "svg" | "cff2" | "trailing" | "compressed" | "sizes" | "missing" | "head" | "name";

export type FontCheck =
  | { ok: true; family: string; weight: string; style: "normal" | "italic"; variable: boolean; glyphs: number }
  | { ok: false; code: FontCheckCode };

const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"] as const;
/** Pour les tests : la table des 63 étiquettes connues du format. */
export const KNOWN_TAGS: readonly string[] = KNOWN;

const FLAVORS = new Set([0x00010000, 0x4f54544f, 0x74727565]); // TrueType, « OTTO » (CFF), « true »
const MAX_TABLES = 64;
/** Plafond de la police décompressée : 150 Ko de Brotli donnent rarement plus de 1 Mo ; au-delà, c'est une bombe ou un fichier qui n'a rien à faire ici. */
const MAX_SFNT = 4 * 1024 * 1024;
const MAX_META = 20_000;

type Table = { tag: string; offset: number; length: number };

function base128(buf: Buffer, at: number): { value: number; next: number } | null {
  let acc = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[at + i];
    if (b === undefined) return null;
    if (i === 0 && b === 0x80) return null; // zéros de tête interdits
    if (acc & 0xfe000000) return null; // dépassement
    acc = (acc << 7) | (b & 0x7f);
    if (!(b & 0x80)) return { value: acc >>> 0, next: at + i + 1 };
  }
  return null;
}

/** Vérifie les octets. `maxBytes` : la taille permise du fichier (150 Ko par défaut). */
export function checkWoff2(buf: Buffer, maxBytes: number = UPLOAD_LIMITS.maxBytes): FontCheck {
  const bad = (code: FontCheckCode): FontCheck => ({ ok: false, code });
  if (buf.length === 0) return bad("empty");
  if (buf.length > maxBytes) return bad("too-large");
  if (buf.length < 48 || buf.readUInt32BE(0) !== 0x774f4632) return bad("not-woff2"); // « wOF2 »
  const flavor = buf.readUInt32BE(4);
  if (flavor === 0x74746366) return bad("collection");
  const length = buf.readUInt32BE(8);
  const numTables = buf.readUInt16BE(12);
  const reserved = buf.readUInt16BE(14);
  const totalSfnt = buf.readUInt32BE(16);
  const totalCompressed = buf.readUInt32BE(20);
  const metaOffset = buf.readUInt32BE(28), metaLength = buf.readUInt32BE(32);
  const privOffset = buf.readUInt32BE(40), privLength = buf.readUInt32BE(44);
  if (length !== buf.length || !FLAVORS.has(flavor) || reserved !== 0 || numTables < 5 || numTables > MAX_TABLES || totalSfnt < 100 || totalSfnt > MAX_SFNT || totalCompressed === 0) return bad("header");
  if (privLength !== 0 || privOffset !== 0) return bad("private");

  // ── répertoire des tables
  let pos = 48;
  const tables: Table[] = [];
  let streamLength = 0;
  const seen = new Set<string>();
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++];
    if (flags === undefined) return bad("truncated");
    const idx = flags & 0x3f, version = flags >> 6;
    let tag: string;
    if (idx === 63) {
      if (pos + 4 > buf.length) return bad("truncated");
      tag = buf.toString("latin1", pos, pos + 4);
      pos += 4;
      if (!/^[\x20-\x7e]{4}$/.test(tag)) return bad("tables");
    } else tag = KNOWN[idx]!;
    if (seen.has(tag)) return bad("tables");
    seen.add(tag);
    const orig = base128(buf, pos);
    if (!orig) return bad("truncated");
    pos = orig.next;
    // glyf et loca : transformés par défaut (version 0), « nuls » en version 3 ; les autres : transformés si la version n'est pas 0
    if (version !== 0 && tag !== "glyf" && tag !== "loca" && tag !== "hmtx") return bad("tables"); // seules ces trois tables ont une version transformée
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    let length = orig.value;
    if (transformed) {
      const tl = base128(buf, pos);
      if (!tl) return bad("truncated");
      pos = tl.next;
      if (tag === "loca" && tl.value !== 0) return bad("tables");
      length = tl.value;
    }
    if (length > MAX_SFNT) return bad("sizes");
    tables.push({ tag, offset: streamLength, length });
    streamLength += length;
    if (streamLength > MAX_SFNT) return bad("sizes");
  }
  if (seen.has("SVG ")) return bad("svg");
  if (seen.has("CFF2")) return bad("cff2");
  const dirEnd = pos;
  if (dirEnd + totalCompressed > buf.length) return bad("truncated");
  if (metaLength !== 0 || metaOffset !== 0) {
    if (metaLength > MAX_META || metaOffset < dirEnd + totalCompressed || metaOffset + metaLength > buf.length) return bad("truncated");
  }
  // Rien après la police : le flux (arrondi à 4 octets) finit où commencent les métadonnées, sinon à la fin du fichier ; au plus 3 octets de bourrage.
  const streamEnd = dirEnd + totalCompressed;
  const hasMeta = metaLength !== 0 || metaOffset !== 0;
  const aligned = (streamEnd + 3) & ~3;
  if (hasMeta ? (metaOffset !== aligned && metaOffset !== streamEnd) || buf.length - (metaOffset + metaLength) > 3 : buf.length < streamEnd || buf.length > aligned) return bad("trailing");

  // ── flux Brotli : décompressé avec un plafond, taille exacte
  let data: Buffer;
  try {
    data = zlib.brotliDecompressSync(buf.subarray(dirEnd, dirEnd + totalCompressed), { maxOutputLength: streamLength + 1 });
  } catch { return bad("compressed"); }
  if (data.length !== streamLength) return bad("sizes");

  // ── tables indispensables
  for (const need of ["cmap", "head", "hhea", "hmtx", "maxp", "name"]) if (!seen.has(need)) return bad("missing");
  if (!(seen.has("glyf") && seen.has("loca")) && !seen.has("CFF ")) return bad("missing");
  const get = (tag: string): Buffer | null => {
    const t = tables.find((x) => x.tag === tag);
    return t ? data.subarray(t.offset, t.offset + t.length) : null;
  };
  const head = get("head"), maxp = get("maxp");
  if (!head || head.length < 54 || head.readUInt32BE(12) !== 0x5f0f3cf5) return bad("head");
  const upm = head.readUInt16BE(18);
  if (upm < 16 || upm > 16384) return bad("head");
  if (!maxp || maxp.length < 6) return bad("head");
  const glyphs = maxp.readUInt16BE(4);
  if (glyphs < 1) return bad("head");

  const family = familyName(get("name"));
  if (family === null) return bad("name");

  // ── graisse et style
  const os2 = get("OS/2");
  const macStyle = head.readUInt16BE(44);
  let italic = (macStyle & 2) !== 0;
  let weightClass = (macStyle & 1) !== 0 ? 700 : 400;
  if (os2 && os2.length >= 6) {
    weightClass = os2.readUInt16BE(4);
    if (os2.length >= 64) italic = (os2.readUInt16BE(62) & 1) !== 0 || italic;
  }
  let weight = weightClass >= 600 ? "700" : "400";
  let variable = false;
  const fvar = get("fvar");
  if (fvar && fvar.length >= 16) {
    const axesOffset = fvar.readUInt16BE(4), count = fvar.readUInt16BE(8), size = fvar.readUInt16BE(10);
    for (let i = 0; i < Math.min(count, 16); i++) {
      const at = axesOffset + i * size;
      if (size < 20 || at + 20 > fvar.length) break;
      if (fvar.toString("latin1", at, at + 4) === "wght") {
        const min = Math.round(fvar.readInt32BE(at + 4) / 65536), max = Math.round(fvar.readInt32BE(at + 12) / 65536);
        if (min >= 1 && max <= 1000 && min < max) { weight = `${min} ${max}`; variable = true; }
        break;
      }
    }
  }
  return { ok: true, family, weight, style: italic ? "italic" : "normal", variable, glyphs };
}

/** Le nom de la famille (nom typographique, sinon nom de famille), nettoyé ; `""` si le fichier n'en donne pas ; `null` si la table est illisible. */
function familyName(name: Buffer | null): string | null {
  if (!name || name.length < 6) return null;
  const count = name.readUInt16BE(2), strings = name.readUInt16BE(4);
  if (6 + count * 12 > name.length || strings > name.length) return null;
  const found = new Map<number, string>();
  const rank = new Map<number, number>();
  for (let i = 0; i < Math.min(count, 400); i++) {
    const r = 6 + i * 12;
    const platform = name.readUInt16BE(r), id = name.readUInt16BE(r + 6), len = name.readUInt16BE(r + 8), off = name.readUInt16BE(r + 10);
    if (id !== 16 && id !== 1) continue;
    const start = strings + off;
    if (start + len > name.length || len === 0 || len > 400) continue;
    const raw = name.subarray(start, start + len);
    const wide = platform === 3 || platform === 0;
    if (wide && len % 2 !== 0) continue; // texte UTF-16 de longueur impaire : enregistrement abîmé, ignoré
    const text = wide ? Buffer.from(raw).swap16().toString("utf16le") : raw.toString("latin1");
    const score = platform === 3 ? 3 : platform === 0 ? 2 : 1;
    if ((rank.get(id) ?? 0) < score) { found.set(id, text); rank.set(id, score); }
  }
  return cleanFontName(found.get(16) ?? found.get(1) ?? "");
}

/** Un nom affichable : lettres, chiffres, espaces et quelques signes ; 60 caractères au plus. */
export function cleanFontName(text: string): string {
  return text.normalize("NFC").replace(/[^\p{L}\p{N} ._'’&()+-]/gu, "").replace(/\s+/g, " ").trim().slice(0, UPLOAD_LIMITS.maxName);
}

/** Identifiant de famille tiré du nom : minuscules, lettres et chiffres séparés par des tirets (`Ma Police Gras` → `ma-police-gras`). */
export function familySlug(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/g, "");
}
