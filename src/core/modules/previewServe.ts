import fs from "node:fs";
import path from "node:path";
import { findCatalogueEntry } from "./catalogue";
import { parseRepoUrl } from "./installer";
import { parseManifest } from "./manifest";
import { loadPreviewImages, PREVIEW_LIMITS, type PreviewImage } from "./previews";
import { getModulePreview, type PreviewTarget } from "./readme";
import { moduleDir } from "./registry";

/**
 * D'où viennent les visuels d'une fiche d'extension, et comment le cœur les SERT.
 *
 * Le navigateur ne charge jamais une image depuis un site tiers : il demande `/api/admin/extension-previews?…&n=<rang>` au cœur, qui lit l'image côté serveur
 * (dépôt du catalogue ou dossier du module installé), la vérifie (type RÉEL, poids, dimensions, voir previews.ts) et la renvoie. Trois sources, une seule à la fois :
 *   id         module du catalogue (l'adresse du dépôt vient du catalogue, jamais de la demande)
 *   repo       dépôt personnel (adresse contrôlée par `parseRepoUrl` : hôtes autorisés, https)
 *   installed  module installé (dossier local)
 */
export type PreviewSource = { id: string } | { repo: string } | { installed: string };
export const PREVIEW_ROUTE = "/api/admin/extension-previews";
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** Adresse (sur le site) du visuel de rang `n`. `v` change quand le module change : le navigateur ne garde pas une ancienne image. */
export function previewUrl(src: PreviewSource, n: number, v?: string): string {
  const q = new URLSearchParams();
  if ("id" in src) q.set("id", src.id); else if ("repo" in src) q.set("repo", src.repo); else q.set("installed", src.installed);
  q.set("n", String(n));
  if (v) q.set("v", v.slice(0, 40));
  return `${PREVIEW_ROUTE}?${q.toString()}`;
}

export type PreviewDeps = {
  catalogueTarget(id: string): Promise<PreviewTarget | null>;
  repoPreview(target: PreviewTarget): Promise<PreviewImage[]>;
  installedImages(id: string): Promise<PreviewImage[]>;
};

/** Les visuels d'un module INSTALLÉ : fichiers de son dossier (pas de lien symbolique, taille contrôlée avant lecture), mêmes vérifications que pour le catalogue. */
export async function readInstalledPreviews(id: string, root: string = moduleDir(id)): Promise<PreviewImage[]> {
  if (!ID_RE.test(id)) return [];
  let manifest;
  try { const p = parseManifest(JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"))); manifest = p.ok ? p.manifest : null; } catch { manifest = null; }
  if (!manifest?.previews?.length) return [];
  return loadPreviewImages(manifest.previews, async (file, maxBytes) => {
    const full = path.join(root, file);
    if (path.relative(root, full).startsWith("..")) return null;
    const st = fs.lstatSync(full);
    if (!st.isFile() || st.size === 0 || st.size > maxBytes) return null;
    return fs.readFileSync(full);
  });
}

export const realPreviewDeps: PreviewDeps = {
  async catalogueTarget(id) {
    const entry = await findCatalogueEntry(id);
    return entry?.repo ? { kind: "repo", url: entry.repo, ref: entry.ref, subdir: entry.subdir } : null;
  },
  async repoPreview(target) { return (await getModulePreview(target)).images; },
  installedImages: (id) => readInstalledPreviews(id),
};

/** Les visuels vérifiés d'une source (liste vide si rien à montrer ou si la source est refusée). */
export async function previewImages(src: PreviewSource, deps: PreviewDeps = realPreviewDeps): Promise<PreviewImage[]> {
  try {
    if ("installed" in src) return ID_RE.test(src.installed) ? await deps.installedImages(src.installed) : [];
    if ("id" in src) {
      if (!ID_RE.test(src.id)) return [];
      const target = await deps.catalogueTarget(src.id);
      return target ? await deps.repoPreview(target) : [];
    }
    const parsed = parseRepoUrl(src.repo);
    return parsed.ok ? await deps.repoPreview({ kind: "repo", url: parsed.repo.url, ref: parsed.repo.ref, subdir: parsed.repo.subdir }) : [];
  } catch { return []; }
}

export type PreviewReply = { status: 200; mime: string; bytes: Buffer } | { status: 400 | 404 };

/** Réponse à `GET ?id|repo|installed=…&n=…` : une seule source, un rang entier de 0 à 5, sinon 400 ; image absente ou refusée : 404. */
export async function servePreview(params: URLSearchParams, deps: PreviewDeps = realPreviewDeps): Promise<PreviewReply> {
  const sources = (["id", "repo", "installed"] as const).filter((k) => params.has(k));
  const n = params.get("n") ?? "";
  if (sources.length !== 1 || !/^[0-5]$/.test(n) || Number(n) >= PREVIEW_LIMITS.max) return { status: 400 };
  const value = params.get(sources[0]!) ?? "";
  if (!value || value.length > 300) return { status: 400 };
  const src: PreviewSource = sources[0] === "id" ? { id: value } : sources[0] === "repo" ? { repo: value } : { installed: value };
  const image = (await previewImages(src, deps)).find((i) => i.index === Number(n));
  return image ? { status: 200, mime: image.mime, bytes: image.bytes } : { status: 404 };
}
