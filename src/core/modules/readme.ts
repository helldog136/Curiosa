import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../config";
import { git, isCommitRef, parseRepoUrl } from "./installer";
import { parseManifest, type ParsedManifest } from "./manifest";

/**
 * APERÇU AVANT INSTALLATION : le README.md et le module.json d'un module, lus SANS l'installer, pour que l'administrateur sache ce qu'il
 * s'apprête à faire tourner sur son serveur (à quoi il sert, quelles permissions, comment soutenir son auteur s'il le souhaite).
 * Un module livré avec le framework se lit dans son dossier ; un dépôt git (reconnu ou personnel) se lit par un clonage superficiel dans
 * un dossier temporaire, avec les mêmes garde-fous que l'installation (hôtes autorisés, https, aucun crochet git). Le texte est NON FIABLE :
 * il n'est affiché que par le rendu Markdown sans HTML brut.
 */
export type ModulePreview = { manifest: ParsedManifest | null; readme: string | null; truncated: boolean };
export type PreviewTarget = { kind: "bundled"; dir: string } | { kind: "repo"; url: string; ref?: string; subdir?: string };

const MAX_README = 100_000;
const MAX_MANIFEST = 100_000;
const TTL = 10 * 60_000;
const README_RE = /^readme(\.md|\.markdown|\.txt)?$/i;
const cache = new Map<string, { at: number; value: ModulePreview }>();
export const clearPreviewCache = () => cache.clear();

function finish(manifestText: string | null, readmeText: string | null): ModulePreview {
  let manifest: ParsedManifest | null = null;
  try { const p = manifestText ? parseManifest(JSON.parse(manifestText)) : null; manifest = p?.ok ? p.manifest : null; } catch { /* manifeste illisible : pas d'aperçu des permissions */ }
  const truncated = (readmeText?.length ?? 0) > MAX_README;
  return { manifest, readme: readmeText === null ? null : readmeText.slice(0, MAX_README), truncated };
}

function readBundled(dir: string): ModulePreview {
  const read = (name: string) => { try { return fs.readFileSync(path.join(dir, name), "utf8"); } catch { return null; } };
  const name = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => README_RE.test(f)) : undefined;
  return finish(read("module.json"), name ? read(name) : null);
}

async function readRepo(url: string, ref?: string, subdir?: string): Promise<ModulePreview> {
  const parsed = parseRepoUrl(ref || subdir ? `${url}#${ref ?? ""}${subdir ? `:${subdir}` : ""}` : url);
  if (!parsed.ok) throw new Error(parsed.error);
  fs.mkdirSync(path.join(DATA_DIR, "tmp"), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(DATA_DIR, "tmp", "preview-"));
  try {
    const dir = path.join(tmp, "repo");
    if (ref && isCommitRef(ref)) {
      await git(["init", "-q", dir]);
      await git(["remote", "add", "origin", parsed.repo.url], dir);
      await git(["fetch", "-q", "--depth", "1", "origin", ref], dir).catch(() => git(["fetch", "-q", "origin"], dir));
      await git(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", "--no-guess", ref], dir).catch(() => git(["reset", "-q", ref], dir));
    } else {
      const branch = ref ? ["--branch", ref] : [];
      // Sans contenu des fichiers (seuls les deux qui nous intéressent seront demandés) ; repli sur un clonage superficiel si le serveur refuse le filtre.
      await git(["clone", "-q", "--depth", "1", "--single-branch", "--filter=blob:none", "--no-checkout", ...branch, "--", parsed.repo.url, dir])
        .catch(async () => { fs.rmSync(dir, { recursive: true, force: true }); await git(["clone", "-q", "--depth", "1", "--single-branch", "--no-checkout", ...branch, "--", parsed.repo.url, dir]); });
    }
    // Module dans un dossier du dépôt : on ne lit que les fichiers de CE dossier.
    const prefix = subdir ? `${subdir}/` : "";
    const names = (await git(["ls-tree", "--name-only", subdir ? `HEAD:${subdir}` : "HEAD"], dir)).split("\n");
    const show = async (name: string | undefined) => (name ? git(["show", `HEAD:${prefix}${name}`], dir).then((t) => t.slice(0, MAX_README + 1)) : null);
    const readme = names.find((n) => README_RE.test(n));
    return finish(await show(names.includes("module.json") ? "module.json" : undefined).then((t) => (t ?? "").slice(0, MAX_MANIFEST) || null), await show(readme));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Lit l'aperçu d'un module (10 minutes de cache). Lève une `Error` si le dépôt est refusé ou injoignable. */
export async function getModulePreview(target: PreviewTarget): Promise<ModulePreview> {
  const key = target.kind === "bundled" ? `b:${target.dir}` : `r:${target.url}#${target.ref ?? ""}:${target.subdir ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = target.kind === "bundled" ? readBundled(target.dir) : await readRepo(target.url, target.ref, target.subdir);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return value;
}
