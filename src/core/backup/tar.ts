import zlib from "node:zlib";

/**
 * Archive tar.gz (format ustar) écrite et lue sans dépendance : n'importe quel outil standard (`tar xzf`) la lit.
 * Les chemins sont relatifs, en UTF-8, sans « .. » : une archive ne peut ni écrire hors de son dossier ni usurper un chemin.
 */
export type TarFile = { path: string; content: Buffer };

const BLOCK = 512;
const MAX_PATH = 255;

const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";

/** Chemin sûr : relatif, sans « .. », sans octet nul ni antislash. */
export function isSafeArchivePath(p: string): boolean {
  if (!p || p.length > MAX_PATH || p.startsWith("/") || p.includes("\0") || p.includes("\\")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

function header(path: string, size: number, mtime: number): Buffer {
  const buf = Buffer.alloc(BLOCK);
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    // ustar : préfixe (≤ 155) + nom (≤ 100), coupés sur un « / ».
    const cut = path.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100) throw new Error(`chemin trop long : ${path}`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  buf.write(name, 0, 100, "utf8");
  buf.write(octal(0o644, 8), 100);
  buf.write(octal(0, 8), 108);
  buf.write(octal(0, 8), 116);
  buf.write(octal(size, 12), 124);
  buf.write(octal(mtime, 12), 136);
  buf.write("        ", 148); // somme de contrôle : des espaces pendant le calcul
  buf.write("0", 156); // fichier ordinaire
  buf.write("ustar\0", 257);
  buf.write("00", 263);
  if (prefix) buf.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return buf;
}

/** Écrit les fichiers dans une archive tar.gz. `mtime` (secondes) fixé : mêmes fichiers → mêmes octets. */
export function createTarGz(files: TarFile[], mtime = 0): Buffer {
  const parts: Buffer[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!isSafeArchivePath(f.path)) throw new Error(`chemin refusé : ${f.path}`);
    if (seen.has(f.path)) throw new Error(`chemin en double : ${f.path}`);
    seen.add(f.path);
    parts.push(header(f.path, f.content.length, mtime), f.content);
    const pad = (BLOCK - (f.content.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  // gzip : en-tête sans horodatage (mtime=0 par défaut dans zlib) → sortie reproductible.
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

export type ReadLimits = { maxBytes?: number; maxFiles?: number };

/** Lit une archive tar.gz. Refuse les chemins dangereux, les liens, et les archives démesurées (bombe de décompression). */
export function readTarGz(archive: Buffer, limits: ReadLimits = {}): TarFile[] {
  const { maxBytes = 1024 * 1024 * 1024, maxFiles = 200_000 } = limits;
  const tar = zlib.gunzipSync(archive, { maxOutputLength: maxBytes });
  const out: TarFile[] = [];
  let offset = 0;
  let total = 0;
  while (offset + BLOCK <= tar.length) {
    const head = tar.subarray(offset, offset + BLOCK);
    if (head.every((b) => b === 0)) break;
    const field = (start: number, len: number) => {
      const end = head.indexOf(0, start);
      return head.toString("utf8", start, end === -1 || end > start + len ? start + len : end);
    };
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : head[i]!;
    if (sum !== parseInt(field(148, 8).trim(), 8)) throw new Error("archive corrompue (somme de contrôle)");
    const type = String.fromCharCode(head[156] || 48);
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const prefix = field(345, 155);
    const name = (prefix ? `${prefix}/` : "") + field(0, 100);
    offset += BLOCK;
    if (type === "0") {
      if (!isSafeArchivePath(name)) throw new Error(`chemin refusé dans l'archive : ${name}`);
      if (offset + size > tar.length) throw new Error("archive tronquée");
      total += size;
      if (out.length >= maxFiles || total > maxBytes) throw new Error("archive trop volumineuse");
      out.push({ path: name, content: Buffer.from(tar.subarray(offset, offset + size)) });
    } else if (type !== "5") {
      throw new Error(`type d'entrée non pris en charge dans l'archive : ${type}`); // liens, périphériques…
    }
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
