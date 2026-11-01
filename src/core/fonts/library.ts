/**
 * LA BIBLIOTHÈQUE EMBARQUÉE (docs/POLICES.md) : vingt familles libres (licence OFL-1.1), livrées avec le cœur dans `fonts/` (dossier à côté de `package.json`,
 * listé dans l'archive de release). `fonts/library.json` en est l'inventaire : famille, groupe, graisses, auteur, source, licence, et pour chaque fichier sa
 * taille et son empreinte SHA-256. Les adresses publiques portent les dix premiers caractères de l'empreinte : le fichier est servi `immutable`.
 *
 * Lecture paresseuse et mémorisée. Une bibliothèque absente ou abîmée ne casse rien : elle est simplement vide (restent le système et les polices envoyées).
 */
import fs from "node:fs";
import path from "node:path";
import { isFontGroup, type FontFile, type LibraryFamily } from "./types";

export const HASH_LEN = 10;

/** Le dossier `fonts/` du cœur. `CURIOSA_FONTS_DIR` : pour les tests. */
export function libraryDir(): string {
  return process.env.CURIOSA_FONTS_DIR ? path.resolve(process.env.CURIOSA_FONTS_DIR) : path.join(/* turbopackIgnore: true */ process.cwd(), "fonts");
}

export type LibraryEntry = { family: LibraryFamily; file: FontFile; urlName: string; abs: string };
export type Library = { families: LibraryFamily[]; byId: Map<string, LibraryFamily>; byUrlName: Map<string, LibraryEntry> };

const EMPTY: Library = { families: [], byId: new Map(), byUrlName: new Map() };
const cache = new Map<string, Library>();

/** Adresse publique d'un fichier de la bibliothèque, avec son empreinte. */
export const urlNameOf = (f: Pick<FontFile, "file" | "sha256">): string => `${f.file.replace(/\.woff2$/, "")}.${f.sha256.slice(0, HASH_LEN)}.woff2`;
export const fontUrl = (urlName: string): string => `/fonts/${urlName}`;

const FILE_RE = /^[a-z0-9][a-z0-9-]*-(?:400|700)-(?:latin|latin-ext)\.woff2$/;

function readLibrary(dir: string): Library {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "library.json"), "utf8")) as { fonts?: unknown };
    if (!Array.isArray(raw.fonts)) return EMPTY;
    const families: LibraryFamily[] = [];
    for (const f of raw.fonts as Partial<LibraryFamily>[]) {
      if (!f || typeof f.id !== "string" || typeof f.name !== "string" || !isFontGroup(f.group) || !Array.isArray(f.files)) continue;
      const files = f.files.filter((x): x is FontFile => !!x && typeof x.file === "string" && FILE_RE.test(x.file) && typeof x.sha256 === "string" && /^[0-9a-f]{64}$/.test(x.sha256) && (x.weight === 400 || x.weight === 700) && (x.subset === "latin" || x.subset === "latin-ext"));
      if (!files.length) continue;
      families.push({ ...(f as LibraryFamily), files });
    }
    const byId = new Map(families.map((f) => [f.id, f]));
    const byUrlName = new Map<string, LibraryEntry>();
    for (const family of families) for (const file of family.files) byUrlName.set(urlNameOf(file), { family, file, urlName: urlNameOf(file), abs: path.join(dir, "files", file.file) });
    return { families, byId, byUrlName };
  } catch {
    return EMPTY;
  }
}

export function loadLibrary(dir: string = libraryDir()): Library {
  let lib = cache.get(dir);
  if (!lib) { lib = readLibrary(dir); cache.set(dir, lib); }
  return lib;
}

/** Pour les tests : relire le disque. */
export function resetLibraryCache(): void { cache.clear(); }
