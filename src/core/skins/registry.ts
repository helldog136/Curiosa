/**
 * REGISTRE DES SKINS INSTALLÉS (docs/SKINS.md §3.2, §10.7) : la liste vit dans le réglage `skin.installed` (table Setting), pas dans une table à part.
 * Raisons : (1) la conception le prévoit ainsi ; (2) la sauvegarde contient déjà TOUS les réglages et la restauration les remet d'un bloc, sans
 * migration de base ni nouveau format ; (3) un seul propriétaire par donnée : les FICHIERS d'un skin sont sous `data/skins/<id>/<version>/`, le réglage ne
 * dit que « quoi, d'où, quelle version, quelle empreinte ». Un réglage absent ou abîmé se lit comme « aucun skin installé » : basic s'applique.
 *
 * Les lectures passent directement par la base (pas par le cache de requête de `getSetting`) : juste après une restauration, la liste lue doit être la nouvelle.
 * Les écritures sont SÉRIALISÉES (`serial`) : deux installations en même temps ne se piétinent pas.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db";
import { SKINS_DIR } from "../config";
import { deleteSetting, setSetting } from "../settings";
import { SKIN_ID_RE } from "./allowlist";
import { BASIC_ID, SETTING_ACTIVE, SETTING_INSTALLED, SETTING_OPTIONS } from "./constants";
import { invalidateSkinCache } from "./invalidate";
import { SEMVER_RE } from "./semver";

export type SkinSource = "catalogue" | "personal";
export type PreviousVersion = { version: string; ref: string | null; commit: string; tree: string | null; fingerprint: string };
export type SkinRow = {
  id: string;
  version: string;
  repo: string;
  ref: string | null;
  subdir: string | null;
  source: SkinSource;
  commit: string;
  /** Empreinte git du dossier du skin dans le dépôt (sert à voir si une mise à jour existe). */
  tree: string | null;
  /** Empreinte du contenu installé (voir validate.ts) : relue pour détecter une altération. */
  fingerprint: string;
  installedAt: string;
  /** Version d'avant la dernière mise à jour, gardée sur le disque pour « Revenir à la version d'avant ». */
  previous?: PreviousVersion;
};

const strOrNull = (v: unknown, max = 300): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

function cleanRow(raw: unknown): SkinRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !SKIN_ID_RE.test(r.id) || r.id === BASIC_ID) return null;
  if (typeof r.version !== "string" || !SEMVER_RE.test(r.version) || typeof r.repo !== "string" || r.repo.length > 300) return null;
  const prev = r.previous && typeof r.previous === "object" ? (r.previous as Record<string, unknown>) : null;
  return {
    id: r.id, version: r.version, repo: r.repo, ref: strOrNull(r.ref, 100), subdir: strOrNull(r.subdir, 200),
    source: r.source === "personal" ? "personal" : "catalogue",
    commit: typeof r.commit === "string" ? r.commit.slice(0, 64) : "", tree: strOrNull(r.tree, 64),
    fingerprint: typeof r.fingerprint === "string" ? r.fingerprint.slice(0, 64) : "",
    installedAt: typeof r.installedAt === "string" ? r.installedAt.slice(0, 40) : "",
    ...(prev && typeof prev.version === "string" && SEMVER_RE.test(prev.version)
      ? { previous: { version: prev.version, ref: strOrNull(prev.ref, 100), commit: typeof prev.commit === "string" ? prev.commit.slice(0, 64) : "", tree: strOrNull(prev.tree, 64), fingerprint: typeof prev.fingerprint === "string" ? prev.fingerprint.slice(0, 64) : "" } }
      : {}),
  };
}

/** Les skins enregistrés (sans vérifier les fichiers). Doublons et lignes illisibles écartés ; jamais d'exception. */
export async function readRows(): Promise<SkinRow[]> {
  try {
    const row = await prisma.setting.findUnique({ where: { key_locale: { key: SETTING_INSTALLED, locale: "" } } });
    const list = row ? JSON.parse(row.value) : [];
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: SkinRow[] = [];
    for (const raw of list.slice(0, 200)) {
      const c = cleanRow(raw);
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  } catch { return []; }
}

export async function writeRows(rows: readonly SkinRow[]): Promise<void> {
  await setSetting(SETTING_INSTALLED, rows);
  invalidateSkinCache(); // installation, mise à jour, retour arrière, retrait, restauration : le rendu du site public recompose
}

/** Le skin actif tel que réglé (même si ses fichiers manquent) ; « basic » si rien. */
export async function readActiveSetting(): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key_locale: { key: SETTING_ACTIVE, locale: "" } } });
    const v = row ? JSON.parse(row.value) : null;
    return typeof v === "string" && (v === BASIC_ID || SKIN_ID_RE.test(v)) ? v : BASIC_ID;
  } catch { return BASIC_ID; }
}

/** Le skin actif retombe sur basic : les retouches de la personne ne sont pas touchées (§10.7), seules les options du skin disparu sont nettoyées. */
export async function fallBackToBasic(): Promise<void> {
  await setSetting(SETTING_ACTIVE, BASIC_ID);
  await deleteSetting(SETTING_OPTIONS);
  invalidateSkinCache();
}

/** Dossier d'une version installée : `data/skins/<id>/<version>/`. Les arguments sont validés : jamais de chemin hors de `data/skins`. */
export function skinDir(id: string, version: string): string {
  if (!SKIN_ID_RE.test(id) || !SEMVER_RE.test(version)) throw new Error("bad skin path");
  return path.join(SKINS_DIR, id, version);
}

/** Les fichiers essentiels du skin sont-ils là ? (contrôle léger, sans relire le contenu) */
export function filesPresent(id: string, version: string): boolean {
  try {
    const dir = skinDir(id, version);
    return fs.lstatSync(path.join(dir, "skin.json")).isFile();
  } catch { return false; }
}

let tail: Promise<unknown> = Promise.resolve();
/** Exécute `fn` à son tour : une installation, mise à jour ou suppression à la fois (dans ce processus). */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

/** Supprime les dossiers de `data/skins` que plus aucune ligne du registre ne réclame (reste d'une restauration, d'un échec). Ne touche à rien d'autre. */
export function pruneUnclaimed(rows: readonly SkinRow[]): string[] {
  const removed: string[] = [];
  let ids: string[] = [];
  try { ids = fs.readdirSync(SKINS_DIR); } catch { return removed; }
  const claimed = new Map(rows.map((r) => [r.id, new Set([r.version, ...(r.previous ? [r.previous.version] : [])])]));
  for (const name of ids) {
    const base = path.join(SKINS_DIR, name);
    if (name.startsWith(".incoming-")) { fs.rmSync(base, { recursive: true, force: true }); continue; }   // reste d'une installation interrompue
    if (!SKIN_ID_RE.test(name)) continue;
    const keep = claimed.get(name);
    if (!keep) { fs.rmSync(base, { recursive: true, force: true }); removed.push(name); continue; }
    for (const v of fs.readdirSync(base)) {
      if (!keep.has(v)) { fs.rmSync(path.join(base, v), { recursive: true, force: true }); removed.push(`${name}/${v}`); }
    }
  }
  return removed;
}
