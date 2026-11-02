import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import { git, gitBlob, isCommitRef, parseRepoUrl } from "./installer";
import { checkPreviewImage, loadPreviewImages, PREVIEW_CACHE_BYTES, PREVIEW_LIMITS, type PreviewImage } from "./previews";
import { parseManifest, type ParsedManifest } from "./manifest";
import { clearFicheDiskCache, ficheKey, MUTABLE_TTL, readEntry, touch, writeEntry, type FicheKey } from "./ficheCache";
import { MAX_REQUESTS_PER_FICHE, rawBase, rawFileUrl, RawError, rawGet, setRawFetch } from "./rawRead";

/**
 * APERÇU AVANT INSTALLATION : le README.md et le module.json d'un module, lus SANS l'installer, pour que l'administrateur sache ce qu'il
 * s'apprête à faire tourner sur son serveur (à quoi il sert, quelles permissions, comment soutenir son auteur s'il le souhaite).
 *
 * ORDRE DE LECTURE (le clonage n'est jamais le premier réflexe) :
 *   1. la copie sur disque (ficheCache.ts), même ancienne : affichée tout de suite, relue en coulisse si elle peut avoir changé ;
 *   2. la lecture directe, un fichier par requête, sur raw.githubusercontent.com pour un dépôt GitHub (rawRead.ts) ;
 *   3. en DERNIER recours seulement (GitHub injoignable ou refusant, dépôt qui n'est pas sur GitHub) : un clonage temporaire, superficiel, filtré, limité au dossier du module,
 *      un seul à la fois, effacé dès que les fichiers sont lus.
 * Les mêmes garde-fous que l'installation s'appliquent (hôtes autorisés, https, aucun crochet git). Le texte est NON FIABLE : il n'est affiché que par le rendu Markdown sans HTML brut.
 */
export type ModulePreview = { manifest: ParsedManifest | null; readme: string | null; truncated: boolean };
/** `version` : celle que le catalogue annonce ; avec une étiquette épinglée (`ref`) elle rend la copie sur disque immuable (voir ficheCache.ts). */
export type PreviewTarget = { kind: "repo"; url: string; ref?: string; subdir?: string; version?: string };

/** La cible d'une entrée du catalogue (adresse, étiquette, dossier, version), ou null si l'entrée n'a pas de dépôt. */
export const targetOf = (e: { repo?: string; ref?: string; subdir?: string; version?: string }): PreviewTarget | null =>
  e.repo ? { kind: "repo", url: e.repo, ref: e.ref, subdir: e.subdir, version: e.version } : null;

const MAX_README = 100_000;
const MAX_MANIFEST = 100_000;
const TTL = 10 * 60_000;
const README_RE = /^readme(\.md|\.markdown|\.txt)?$/i;
/** Clonages de secours en même temps : un seul, le dernier recours ne doit pas saturer un petit serveur. */
export const MAX_PARALLEL_READS = 1;
export { PREVIEW_SLOW_MS, PREVIEW_WAIT_MS } from "./previewTimings";
const GIT_CLONE_MS = 45_000;
export class PreviewTimeout extends Error { constructor() { super("preview-timeout"); } }
/** La fiche n'a pu être lue ni directement ni par clonage : `reason` dit pourquoi (limite de débit de GitHub, réseau). Jamais gardé en copie. */
export class PreviewFailure extends Error {
  reason: "rate-limit" | "network";
  retryAfterSec?: number;
  constructor(reason: "rate-limit" | "network", retryAfterSec?: number) { super(`preview-${reason}`); this.reason = reason; this.retryAfterSec = retryAfterSec; }
}

const cache = new Map<string, { at: number; value: ModulePreview }>();
/** Visuels déjà lus (octets vérifiés), à part du texte : la fiche s'affiche sans les attendre, les images arrivent ensuite. Mémoire bornée (trimPreviewCache). */
const imageCache = new Map<string, { at: number; value: { images: PreviewImage[] } }>();
/** Lectures en cours : plusieurs demandes en même temps pour le même module (la fiche, ses images, le survol, « Réessayer ») ne lisent qu'une fois. */
const pending = new Map<string, Promise<ModulePreview>>();
const imageReads = new Map<string, Promise<PreviewImage[]>>();
const refreshing = new Set<string>();
/** Oublie la mémoire seulement (la copie sur disque reste : c'est ce qui survit à un redémarrage). */
export const resetPreviewMemory = () => { cache.clear(); imageCache.clear(); pending.clear(); imageReads.clear(); refreshing.clear(); };
/** « Actualiser » : la mémoire ET la copie sur disque. */
export const clearPreviewCache = () => { resetPreviewMemory(); clearFicheDiskCache(); setRawFetch(null); };
const imageBytes = (p: { images: PreviewImage[] }) => p.images.reduce((n, i) => n + i.bytes.length, 0);
const keyOf = (t: PreviewTarget) => `r:${t.url}#${t.ref ?? ""}:${t.subdir ?? ""}@${t.version ?? ""}`;

/** Mémoire bornée : `maxEntries` éléments au plus et `maxBytes` d'images au total (le dernier lu est toujours gardé) ; les plus anciens partent d'abord. */
export function trimPreviewCache(map: Map<string, { value: { images: PreviewImage[] } }>, maxEntries: number, maxBytes: number): void {
  let total = 0;
  for (const e of map.values()) total += imageBytes(e.value);
  while (map.size > maxEntries || (total > maxBytes && map.size > 1)) {
    const oldest = map.keys().next().value!;
    total -= imageBytes(map.get(oldest)!.value);
    map.delete(oldest);
  }
}

/** Passage à un seul clonage de secours à la fois. */
let gitBusy = false;
const gitQueue: (() => void)[] = [];
async function gitGate<T>(fn: () => Promise<T>): Promise<T> {
  if (gitBusy) await new Promise<void>((r) => gitQueue.push(r)); else gitBusy = true;
  try { return await fn(); } finally { const next = gitQueue.shift(); if (next) next(); else gitBusy = false; }
}

function parse(manifestText: string | null, readmeText: string | null): ModulePreview {
  let manifest: ParsedManifest | null = null;
  try { const p = manifestText ? parseManifest(JSON.parse(manifestText)) : null; manifest = p?.ok ? p.manifest : null; } catch { /* manifeste illisible : pas d'aperçu des permissions */ }
  const truncated = (readmeText?.length ?? 0) > MAX_README;
  return { manifest, readme: readmeText === null ? null : readmeText.slice(0, MAX_README), truncated };
}
const text = (b: Buffer | null, max: number) => (b ? b.toString("utf8").slice(0, max + 1) : null);
type Reader = (file: string, maxBytes: number) => Promise<Buffer | null>;
type Loaded = { preview: ModulePreview; images: Promise<PreviewImage[]> };

/** Une ouverture de fiche ne fait jamais plus de MAX_REQUESTS_PER_FICHE requêtes. */
type Budget = { n: number };
const net = (b: Budget, url: string, max: number, truncate = false): Promise<Buffer | null> => {
  if (++b.n > MAX_REQUESTS_PER_FICHE) return Promise.reject(new RawError("http", 0));
  return rawGet(url, max, truncate);
};

// ── Lecture directe (HTTPS) ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Le manifeste et le README, EN MÊME TEMPS (deux requêtes). README.md, sinon readme.md (une requête de plus, seulement s'il reste de la place pour les visuels). Écrit la copie sur disque. */
async function fetchText(base: string, target: PreviewTarget, key: FicheKey, budget: Budget): Promise<{ manifestText: string | null; readmeText: string | null }> {
  const url = (f: string) => rawFileUrl(base, target.subdir, f);
  const mUrl = url("module.json"), rUrl = url("README.md");
  if (!mUrl || !rUrl) throw new RawError("http", 0);
  const [m, r0] = await Promise.all([net(budget, mUrl, MAX_MANIFEST + 1, true), net(budget, rUrl, MAX_README * 4 + 4, true)]);
  let r = r0;
  if (r === null) {
    let declared = 6;
    try { const p = m ? parseManifest(JSON.parse(m.toString("utf8"))) : null; declared = p?.ok ? p.manifest.previews?.length ?? 0 : 0; } catch { declared = 0; }
    const alt = url("readme.md");
    if (alt && declared <= MAX_REQUESTS_PER_FICHE - 3) r = await net(budget, alt, MAX_README * 4 + 4, true);
  }
  // Ni manifeste ni README : ce n'est pas le bon endroit (ou pas un dépôt public) ; le clonage de secours regardera.
  if (m === null && r === null) throw new RawError("http", 404);
  writeEntry(key, "module.json", m);
  writeEntry(key, "README.md", r);
  return { manifestText: text(m, MAX_MANIFEST)?.slice(0, MAX_MANIFEST) ?? null, readmeText: text(r, MAX_README) };
}

/** Un visuel lu sur le réseau puis vérifié (type RÉEL, poids, dimensions) : seul un visuel valable est gardé sur disque, un visuel refusé laisse une marque « absent ». */
async function fetchImage(base: string, target: PreviewTarget, key: FicheKey, budget: Budget, file: string, max: number): Promise<Buffer | null> {
  const u = rawFileUrl(base, target.subdir, file);
  if (!u) return null;
  let bytes: Buffer | null;
  try { bytes = await net(budget, u, max); } catch (e) { if (e instanceof RawError && e.kind === "too-large") writeEntry(key, file, null); return null; }
  if (bytes && !checkPreviewImage(bytes, file).ok) bytes = null;
  writeEntry(key, file, bytes);
  return bytes;
}

// ── Copie sur disque ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function fromDisk(key: FicheKey): { preview: ModulePreview; ageMs: number } | null {
  const m = readEntry(key, "module.json", MAX_MANIFEST * 4);
  const r = readEntry(key, "README.md", MAX_README * 4 + 8);
  if (!m || !r) return null;
  const t = (e: NonNullable<typeof m>, max: number) => ("bytes" in e ? text(e.bytes, max) : null);
  return { preview: parse(t(m, MAX_MANIFEST)?.slice(0, MAX_MANIFEST) ?? null, t(r, MAX_README)), ageMs: Math.max(m.ageMs, r.ageMs) };
}

/** Les visuels, d'abord depuis la copie sur disque (jamais le réseau si elle y est), sinon `fetchOne`. Chaque image est revérifiée par `loadPreviewImages`. */
function readImages(preview: ModulePreview, key: FicheKey, fetchOne: Reader): Promise<PreviewImage[]> {
  const decls = preview.manifest?.previews;
  if (!decls?.length) return Promise.resolve([]);
  return loadPreviewImages(decls, async (file, max) => {
    const e = readEntry(key, file, max);
    if (e) return "bytes" in e ? e.bytes : null;
    return fetchOne(file, max);
  }).catch((): PreviewImage[] => []);
}

/** Relit en coulisse une fiche dont la copie est ancienne ET peut avoir changé (sans version immuable). Directement, jamais par clonage ; une panne est ignorée (la copie reste). */
function refreshInBackground(target: PreviewTarget, key: FicheKey, memKey: string): void {
  const base = rawBase(target.url, target.ref);
  if (!base || refreshing.has(memKey)) return;
  refreshing.add(memKey);
  void (async () => {
    const budget: Budget = { n: 0 };
    const { manifestText, readmeText } = await fetchText(base, target, key, budget);
    const preview = parse(manifestText, readmeText);
    await Promise.all((preview.manifest?.previews ?? []).slice(0, PREVIEW_LIMITS.max).map((d) => fetchImage(base, target, key, budget, d.file, PREVIEW_LIMITS.bytes)));
    cache.delete(memKey); imageCache.delete(memKey); imageReads.delete(memKey);
  })().catch(() => {}).finally(() => refreshing.delete(memKey));
}

// ── Dernier recours : clonage temporaire ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Clonage TEMPORAIRE (jamais gardé) : superficiel, sans contenu des fichiers (seuls ceux demandés sont téléchargés), sans extraction, limité au dossier du module.
 * Le dossier est effacé dès que les fichiers voulus sont lus (`close`).
 */
async function readViaGit(target: PreviewTarget, repoUrl: string): Promise<{ manifestText: string | null; readmeText: string | null; blob: Reader; close: () => void }> {
  fs.mkdirSync(path.join(DATA_DIR, "tmp"), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(DATA_DIR, "tmp", "preview-"));
  const close = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const { ref, subdir } = target;
    const dir = path.join(tmp, "repo");
    const g = (args: string[], cwd?: string) => git(args, cwd, undefined, GIT_CLONE_MS);
    const out = await gitGate(async () => {
      if (ref && isCommitRef(ref)) {
        await g(["init", "-q", dir]);
        await g(["remote", "add", "origin", repoUrl], dir);
        await g(["fetch", "-q", "--depth", "1", "origin", ref], dir).catch(() => g(["fetch", "-q", "origin"], dir));
        await g(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "--no-guess", ref], dir).catch(() => g(["reset", "-q", ref], dir));
      } else {
        const branch = ref ? ["--branch", ref] : [];
        await g(["clone", "-q", "--depth", "1", "--single-branch", "--filter=blob:none", "--no-checkout", ...branch, "--", repoUrl, dir])
          .catch(async (e) => { if (!/filter/i.test(String((e as Error)?.message))) throw e; fs.rmSync(dir, { recursive: true, force: true }); await g(["clone", "-q", "--depth", "1", "--single-branch", "--no-checkout", ...branch, "--", repoUrl, dir]); });
      }
      // Seul le dossier du module est concerné (les autres modules du dépôt ne sont ni extraits ni lus).
      if (subdir) await g(["sparse-checkout", "set", "--no-cone", `/${subdir}/`], dir).catch(() => {});
      const prefix = subdir ? `${subdir}/` : "";
      const names = (await g(["ls-tree", "--name-only", subdir ? `HEAD:${subdir}` : "HEAD"], dir)).split("\n");
      const show = (name: string | undefined) => (name ? g(["show", `HEAD:${prefix}${name}`], dir).then((t) => t.slice(0, MAX_README + 1)) : Promise.resolve(null));
      const [manifestText, readmeText] = await Promise.all([show(names.includes("module.json") ? "module.json" : undefined), show(names.find((n) => README_RE.test(n)))]);
      return { manifestText: (manifestText ?? "").slice(0, MAX_MANIFEST) || null, readmeText, prefix, dir };
    });
    return { manifestText: out.manifestText, readmeText: out.readmeText, blob: (file, max) => gitBlob(`HEAD:${out.prefix}${file}`, out.dir, max), close };
  } catch (e) { close(); throw e; }
}

// ── Une fiche ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function loadFiche(target: PreviewTarget, memKey: string): Promise<Loaded> {
  const parsed = parseRepoUrl(target.ref || target.subdir ? `${target.url}#${target.ref ?? ""}${target.subdir ? `:${target.subdir}` : ""}` : target.url);
  if (!parsed.ok) throw new Error(parsed.error);
  const key = ficheKey(target);
  const base = rawBase(parsed.repo.url, target.ref);

  // 1. La copie sur disque, même ancienne : affichée tout de suite.
  const kept = fromDisk(key);
  if (kept) {
    touch(key);
    if (!key.immutable && kept.ageMs >= MUTABLE_TTL) refreshInBackground(target, key, memKey);
    const budget: Budget = { n: 0 };
    const viaNet: Reader = async (file, max) => {
      if (base) return fetchImage(base, target, key, budget, file, max);
      const s = await readViaGit(target, parsed.repo.url); // dépôt hors GitHub dont les visuels n'ont pas encore été copiés
      try { const b = await s.blob(file, max); const ok = b && checkPreviewImage(b, file).ok ? b : null; writeEntry(key, file, ok); return ok; } finally { s.close(); }
    };
    return { preview: kept.preview, images: readImages(kept.preview, key, viaNet) };
  }

  // 2. Lecture directe.
  let httpError: RawError | null = null;
  if (base) {
    const budget: Budget = { n: 0 };
    try {
      const { manifestText, readmeText } = await fetchText(base, target, key, budget);
      const preview = parse(manifestText, readmeText);
      return { preview, images: readImages(preview, key, (file, max) => fetchImage(base, target, key, budget, file, max)) };
    } catch (e) { if (!(e instanceof RawError)) throw e; httpError = e; }
  }

  // 3. Dernier recours : clonage temporaire.
  let s: Awaited<ReturnType<typeof readViaGit>>;
  try { s = await readViaGit(target, parsed.repo.url); } catch (e) {
    if (httpError?.kind === "rate-limit") throw new PreviewFailure("rate-limit", httpError.retryAfterSec);
    if (httpError && httpError.kind !== "http") throw new PreviewFailure("network");
    throw e;
  }
  writeEntry(key, "module.json", s.manifestText === null ? null : Buffer.from(s.manifestText));
  writeEntry(key, "README.md", s.readmeText === null ? null : Buffer.from(s.readmeText));
  const preview = parse(s.manifestText, s.readmeText);
  if (!preview.manifest?.previews?.length) { s.close(); return { preview, images: Promise.resolve([]) }; }
  const images = readImages(preview, key, async (file, max) => { const b = await s.blob(file, max); const ok = b && checkPreviewImage(b, file).ok ? b : null; writeEntry(key, file, ok); return ok; }).finally(s.close);
  return { preview, images };
}

const withDeadline = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new PreviewTimeout()), ms);
  p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

/**
 * Lit l'aperçu d'un module (copie sur disque, puis lecture directe, puis clonage de secours ; 10 minutes de copie en mémoire). Lève une `Error` si le dépôt est refusé,
 * `PreviewFailure` s'il est injoignable. `waitMs` : n'attend pas plus longtemps (lève `PreviewTimeout`) ; la lecture continue et remplit la copie, « Réessayer » la reprend.
 * Les visuels ne sont PAS attendus ici : voir `getPreviewImages`.
 */
export async function getModulePreview(target: PreviewTarget, opts: { waitMs?: number } = {}): Promise<ModulePreview> {
  const key = keyOf(target);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let reading = pending.get(key);
  if (!reading) {
    reading = loadFiche(target, key).then(({ preview, images }) => {
      cache.set(key, { at: Date.now(), value: preview });
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      const loading = images.then((list) => { imageCache.set(key, { at: Date.now(), value: { images: list } }); trimPreviewCache(imageCache, 100, PREVIEW_CACHE_BYTES); return list; }).finally(() => { if (imageReads.get(key) === loading) imageReads.delete(key); });
      imageReads.set(key, loading);
      return preview;
    }).finally(() => pending.delete(key));
    pending.set(key, reading);
  }
  return opts.waitMs ? withDeadline(reading, opts.waitMs) : reading;
}

/** Les visuels vérifiés d'un module (liste vide s'il n'y en a pas ou s'ils ne conviennent pas). Jamais d'erreur : une image absente n'empêche pas la fiche. */
export async function getPreviewImages(target: PreviewTarget): Promise<PreviewImage[]> {
  const key = keyOf(target);
  try {
    await getModulePreview(target);
    const kept = imageCache.get(key);
    if (kept && Date.now() - kept.at < TTL) return kept.value.images;
    const reading = imageReads.get(key);
    if (reading) return await reading;
    // Images écartées de la mémoire (bornée) : on relit (la copie sur disque d'abord).
    cache.delete(key);
    await getModulePreview(target);
    return (await imageReads.get(key)) ?? imageCache.get(key)?.value.images ?? [];
  } catch { return []; }
}

/** Réchauffe la lecture d'une fiche (survol du bouton, ouverture de la liste) : texte ET visuels, rend la main tout de suite, n'échoue jamais. */
export function warmModulePreview(target: PreviewTarget): void {
  void getPreviewImages(target);
}
