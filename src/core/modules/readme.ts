import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import { git, gitBlob, isCommitRef, parseRepoUrl } from "./installer";
import { loadPreviewImages, PREVIEW_CACHE_BYTES, type PreviewImage } from "./previews";
import { parseManifest, type ParsedManifest } from "./manifest";

/**
 * APERÇU AVANT INSTALLATION : le README.md et le module.json d'un module, lus SANS l'installer, pour que l'administrateur sache ce qu'il
 * s'apprête à faire tourner sur son serveur (à quoi il sert, quelles permissions, comment soutenir son auteur s'il le souhaite).
 * Un dépôt git (du catalogue ou personnel) se lit par un clonage superficiel dans un dossier temporaire, avec les mêmes garde-fous que l'installation (hôtes autorisés, https, aucun crochet git). Le texte est NON FIABLE :
 * il n'est affiché que par le rendu Markdown sans HTML brut.
 */
export type ModulePreview = { manifest: ParsedManifest | null; readme: string | null; truncated: boolean };
export type PreviewTarget = { kind: "repo"; url: string; ref?: string; subdir?: string };

const MAX_README = 100_000;
const MAX_MANIFEST = 100_000;
const TTL = 10 * 60_000;
const README_RE = /^readme(\.md|\.markdown|\.txt)?$/i;
/** Lectures de dépôts en même temps, au plus : plusieurs fiches ouvertes d'affilée (ou survolées) ne saturent ni le réseau ni le disque du serveur. */
export const MAX_PARALLEL_READS = 3;
/** Attente maximale de la fiche à l'écran : au-delà, un message clair et « Réessayer » (la lecture continue en coulisse et sert la tentative suivante). */
export const PREVIEW_WAIT_MS = 20_000;
export class PreviewTimeout extends Error { constructor() { super("preview-timeout"); } }

const cache = new Map<string, { at: number; value: ModulePreview }>();
/** Visuels déjà lus (octets vérifiés), à part du texte : la fiche s'affiche sans les attendre, les images arrivent ensuite. Mémoire bornée (trimPreviewCache). */
const imageCache = new Map<string, { at: number; value: { images: PreviewImage[] } }>();
/** Lectures en cours : plusieurs demandes en même temps pour le même module (la fiche, ses images, le survol) ne clonent le dépôt qu'une fois. */
const pending = new Map<string, Promise<ModulePreview>>();
const imageReads = new Map<string, Promise<PreviewImage[]>>();
export const clearPreviewCache = () => { cache.clear(); imageCache.clear(); pending.clear(); imageReads.clear(); };
const imageBytes = (p: { images: PreviewImage[] }) => p.images.reduce((n, i) => n + i.bytes.length, 0);
const keyOf = (t: PreviewTarget) => `r:${t.url}#${t.ref ?? ""}:${t.subdir ?? ""}`;

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

let active = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active < MAX_PARALLEL_READS) active++; else await new Promise<void>((r) => waiting.push(r));
  try { return await fn(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
}

function parse(manifestText: string | null, readmeText: string | null): ModulePreview {
  let manifest: ParsedManifest | null = null;
  try { const p = manifestText ? parseManifest(JSON.parse(manifestText)) : null; manifest = p?.ok ? p.manifest : null; } catch { /* manifeste illisible : pas d'aperçu des permissions */ }
  const truncated = (readmeText?.length ?? 0) > MAX_README;
  return { manifest, readme: readmeText === null ? null : readmeText.slice(0, MAX_README), truncated };
}

/** Le texte (manifeste, README) est prêt dès que `preview` l'est ; les visuels, eux, continuent d'être lus dans le même dossier temporaire (effacé quand ils sont lus). */
async function readRepo(url: string, ref?: string, subdir?: string): Promise<{ preview: ModulePreview; images: Promise<PreviewImage[]> }> {
  const parsed = parseRepoUrl(ref || subdir ? `${url}#${ref ?? ""}${subdir ? `:${subdir}` : ""}` : url);
  if (!parsed.ok) throw new Error(parsed.error);
  fs.mkdirSync(path.join(DATA_DIR, "tmp"), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(DATA_DIR, "tmp", "preview-"));
  const clean = () => fs.rmSync(tmp, { recursive: true, force: true });
  let handedOver = false;
  try {
    const dir = path.join(tmp, "repo");
    if (ref && isCommitRef(ref)) {
      await git(["init", "-q", dir]);
      await git(["remote", "add", "origin", parsed.repo.url], dir);
      await git(["fetch", "-q", "--depth", "1", "origin", ref], dir).catch(() => git(["fetch", "-q", "origin"], dir));
      await git(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "--no-guess", ref], dir).catch(() => git(["reset", "-q", ref], dir));
    } else {
      const branch = ref ? ["--branch", ref] : [];
      // Sans contenu des fichiers (seuls ceux qui nous intéressent seront demandés) ; repli sur un clonage superficiel si le serveur refuse le filtre.
      await git(["clone", "-q", "--depth", "1", "--single-branch", "--filter=blob:none", "--no-checkout", ...branch, "--", parsed.repo.url, dir])
        .catch(async () => { fs.rmSync(dir, { recursive: true, force: true }); await git(["clone", "-q", "--depth", "1", "--single-branch", "--no-checkout", ...branch, "--", parsed.repo.url, dir]); });
    }
    // Module dans un dossier du dépôt : on ne lit que les fichiers de CE dossier.
    const prefix = subdir ? `${subdir}/` : "";
    const names = (await git(["ls-tree", "--name-only", subdir ? `HEAD:${subdir}` : "HEAD"], dir)).split("\n");
    const show = (name: string | undefined) => (name ? git(["show", `HEAD:${prefix}${name}`], dir).then((t) => t.slice(0, MAX_README + 1)) : Promise.resolve(null));
    // Le manifeste et le README se lisent EN MÊME TEMPS (dans un clone filtré, chaque fichier est un aller-retour réseau).
    const [manifestText, readmeText] = await Promise.all([show(names.includes("module.json") ? "module.json" : undefined), show(names.find((n) => README_RE.test(n)))]);
    const preview = parse((manifestText ?? "").slice(0, MAX_MANIFEST) || null, readmeText);
    const decls = preview.manifest?.previews;
    if (!decls?.length) return { preview, images: Promise.resolve([]) };
    // Les visuels : seulement ceux que le manifeste déclare, dans `previews/` du module, taille contrôlée avant lecture, tous en parallèle, sans retenir la fiche.
    const images = loadPreviewImages(decls, (file, maxBytes) => gitBlob(`HEAD:${prefix}${file}`, dir, maxBytes)).catch((): PreviewImage[] => []).finally(clean);
    handedOver = true;
    return { preview, images };
  } finally {
    if (!handedOver) clean();
  }
}

const withDeadline = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new PreviewTimeout()), ms);
  p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

/**
 * Lit l'aperçu d'un module (10 minutes de cache). Lève une `Error` si le dépôt est refusé ou injoignable.
 * `waitMs` : n'attend pas plus longtemps (lève `PreviewTimeout`) ; la lecture continue et remplit le cache, la tentative suivante en profite.
 * Les visuels ne sont PAS attendus ici : voir `getPreviewImages`.
 */
export async function getModulePreview(target: PreviewTarget, opts: { waitMs?: number } = {}): Promise<ModulePreview> {
  const key = keyOf(target);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let reading = pending.get(key);
  if (!reading) {
    reading = withSlot(() => readRepo(target.url, target.ref, target.subdir)).then(({ preview, images }) => {
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
    // Images écartées de la mémoire (bornée) : on relit le dépôt.
    cache.delete(key);
    await getModulePreview(target);
    return (await imageReads.get(key)) ?? imageCache.get(key)?.value.images ?? [];
  } catch { return []; }
}

/** Réchauffe la lecture d'une fiche (survol du bouton) : rend la main tout de suite, n'échoue jamais. */
export function warmModulePreview(target: PreviewTarget): void {
  void getModulePreview(target).catch(() => {});
}
