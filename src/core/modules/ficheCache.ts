import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";

/**
 * COPIE SUR DISQUE DES FICHES D'EXTENSIONS (DATA_DIR/cache/catalogue/) : elle survit aux redémarrages et aux mises à jour du site.
 *
 * Elle ne contient QUE les fichiers lus pour les fiches ouvertes (le manifeste, le README et les images de visuels de CE module) : jamais le code d'un module,
 * jamais un dépôt entier, jamais un dossier `.git`. Une entrée = un fichier ; un fiche = un dossier ; les fiches d'un même module sont groupées.
 *   <module>/<version>/module.json | README.md | previews__capture.webp | <nom>.absent (fichier absent du module : on ne le redemande pas)
 *
 * Fraîcheur : l'étiquette de version d'un module du catalogue est IMMUABLE (le contenu à `v1.35.0` ne change pas). Une fiche lue pour (dépôt, module, étiquette, version)
 * est donc valable tant que le catalogue annonce la même version ; une nouvelle version = un autre dossier (lecture du réseau), et l'ancienne est supprimée
 * (2 versions gardées au plus par module). Sans étiquette de version (branche, dépôt personnel) : fraîcheur courte (MUTABLE_TTL), la copie plus ancienne est
 * servie tout de suite puis relue en coulisse. Rien ici n'est jamais exécuté : à la relecture, chaque valeur est validée comme à l'origine (voir readme.ts).
 *
 * Bornes, appliquées à chaque écriture (aucun minuteur de fond) : 50 Mo au total, 200 fiches, 2 versions par module ; les plus anciennes partent d'abord.
 */
export const FICHE_CACHE_LIMITS = { bytes: 50 * 1024 * 1024, fiches: 200, versionsPerModule: 2 } as const;
/** Fraîcheur d'une fiche SANS version immuable (branche, dépôt personnel). */
export const MUTABLE_TTL = 10 * 60_000;

export type FicheTarget = { url: string; ref?: string; subdir?: string; version?: string };
export type FicheKey = { moduleDir: string; versionDir: string; immutable: boolean };

const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_").slice(0, 60) || "_";
const h8 = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
const TAGLIKE = /^v?\d[\w.+-]*$/;

export const root = () => path.join(DATA_DIR, "cache", "catalogue");

/** Immuable = le catalogue donne une version ET l'étiquette (ou le commit) épinglée : leur contenu ne change pas. */
export function isImmutable(t: FicheTarget): boolean {
  return !!t.version && !!t.ref && (TAGLIKE.test(t.ref) || /^[0-9a-f]{7,40}$/i.test(t.ref));
}

export function ficheKey(t: FicheTarget): FicheKey {
  const mod = `${t.url.replace(/^https?:\/\//, "").replace(/\.git$/, "")}|${t.subdir ?? ""}`;
  const immutable = isImmutable(t);
  const ver = `${t.ref ?? "HEAD"}|${immutable ? t.version : ""}`;
  return {
    moduleDir: `${slug(mod)}-${h8(mod)}`,
    versionDir: `${slug(`${t.ref ?? "HEAD"}${immutable ? `+${t.version}` : ""}`)}-${h8(ver)}`,
    immutable,
  };
}

const fileName = (rel: string) => slug(rel.replace(/\//g, "__"));
const dirOf = (k: FicheKey) => path.join(root(), k.moduleDir, k.versionDir);

let writes = 0;
export type Entry = { bytes: Buffer; ageMs: number } | { absent: true; ageMs: number };

/** La copie d'un fichier, ou null s'il n'y en a pas. `maxBytes` : une copie plus grosse (abîmée) est ignorée. */
export function readEntry(k: FicheKey, rel: string, maxBytes: number, now = Date.now()): Entry | null {
  try {
    const f = path.join(dirOf(k), fileName(rel));
    const abs = fs.statSync(`${f}.absent`, { throwIfNoEntry: false });
    if (abs) return { absent: true, ageMs: now - abs.mtimeMs };
    const st = fs.statSync(f);
    if (!st.isFile() || st.size > maxBytes) return null;
    return { bytes: fs.readFileSync(f), ageMs: now - st.mtimeMs };
  } catch { return null; }
}

/** Marque la fiche comme récemment utilisée (pour savoir quoi effacer d'abord). */
export function touch(k: FicheKey): void {
  try { const d = new Date(); fs.utimesSync(dirOf(k), d, d); } catch { /* sans importance */ }
}

/** Écriture atomique d'un fichier (ou de son absence), puis nettoyage. N'échoue jamais : la copie est un plus. */
export function writeEntry(k: FicheKey, rel: string, bytes: Buffer | null): void {
  try {
    const dir = dirOf(k);
    const fresh = !fs.existsSync(dir);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, fileName(rel));
    const tmp = `${f}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    // Un fichier présent et son marqueur d'absence ne coexistent jamais.
    if (bytes) { fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, f); fs.rmSync(`${f}.absent`, { force: true }); }
    else { fs.writeFileSync(tmp, ""); fs.renameSync(tmp, `${f}.absent`); fs.rmSync(f, { force: true }); }
    // Le nettoyage parcourt tout le dossier : fait à la création d'une fiche (et tous les 8 fichiers), pas à chacun de ses fichiers.
    if (fresh || ++writes % 8 === 0) trim(k);
  } catch { /* disque plein ou en lecture seule : la fiche se lit sans copie */ }
}

type Dir = { module: string; version: string; full: string; mtime: number; size: number };
function listDirs(): Dir[] {
  const out: Dir[] = [];
  let mods: string[] = [];
  try { mods = fs.readdirSync(root()); } catch { return out; }
  for (const m of mods) {
    let vers: string[] = [];
    try { vers = fs.readdirSync(path.join(root(), m)); } catch { continue; }
    for (const v of vers) {
      const full = path.join(root(), m, v);
      try {
        const st = fs.statSync(full);
        if (!st.isDirectory()) continue;
        let size = 0;
        for (const f of fs.readdirSync(full)) { try { size += fs.statSync(path.join(full, f)).size; } catch { /* disparu */ } }
        out.push({ module: m, version: v, full, mtime: st.mtimeMs, size });
      } catch { /* disparu */ }
    }
  }
  return out;
}

const rm = (d: Dir) => { fs.rmSync(d.full, { recursive: true, force: true }); try { fs.rmdirSync(path.dirname(d.full)); } catch { /* module non vide */ } };

/** Nettoyage à l'écriture : ancienne version d'un module, puis nombre de fiches, puis poids total. La fiche qu'on vient d'écrire est gardée. */
export function trim(current: FicheKey): void {
  let dirs = listDirs().sort((a, b) => a.mtime - b.mtime);
  const isCurrent = (d: Dir) => d.module === current.moduleDir && d.version === current.versionDir;
  const drop = (d: Dir) => { rm(d); dirs = dirs.filter((x) => x !== d); };
  // 1. au plus N versions par module (la plus récemment utilisée d'abord gardée, la courante toujours).
  const mine = dirs.filter((d) => d.module === current.moduleDir);
  for (const d of mine.slice(0, Math.max(0, mine.length - FICHE_CACHE_LIMITS.versionsPerModule))) if (!isCurrent(d)) drop(d);
  // 2. nombre de fiches, 3. poids total : les plus anciennes d'abord.
  const total = () => dirs.reduce((n, d) => n + d.size, 0);
  while (dirs.length > FICHE_CACHE_LIMITS.fiches || total() > FICHE_CACHE_LIMITS.bytes) {
    const victim = dirs.find((d) => !isCurrent(d));
    if (!victim) break;
    drop(victim);
  }
  // Fichiers temporaires oubliés (arrêt en pleine écriture) : effacés au passage.
  try {
    const dir = dirOf(current);
    for (const f of fs.readdirSync(dir)) if (f.includes(".tmp-") && Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 60_000) fs.rmSync(path.join(dir, f), { force: true });
  } catch { /* sans importance */ }
}

/** « Actualiser » : tout effacer. */
export function clearFicheDiskCache(): void {
  try { fs.rmSync(root(), { recursive: true, force: true }); } catch { /* sans importance */ }
}
