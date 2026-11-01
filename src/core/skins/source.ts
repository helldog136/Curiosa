/**
 * RÉCUPÉRATION D'UN SKIN DEPUIS UN DÉPÔT GIT (docs/SKINS.md §5.6, §10) : mêmes garde-fous que les modules (`modules/installer.ts`), réutilisés tels quels.
 *   - adresse `https://hôte/propriétaire/dépôt[.git][#étiquette-ou-commit[:dossier]]`, hôtes de MODULES_ALLOWED_HOSTS (le même réglage : c'est la liste des
 *     hébergeurs git de confiance de l'installation, pas un réglage propre aux modules), jamais d'identifiant ni de requête dans l'adresse ;
 *   - dépôts locaux (file://) seulement si CURIOSA_ALLOW_LOCAL_MODULES=1 (développement et tests) ;
 *   - récupération superficielle (`--depth 1`), aucun crochet git, protocole `ext` fermé, délai de 90 s ;
 *   - un dossier d'un dépôt qui en regroupe plusieurs : jamais en dehors du dépôt (liens symboliques résolus).
 * Rien n'est exécuté : on ne lit que des fichiers.
 */
import fs from "node:fs";
import path from "node:path";
import { SKINS_DIR } from "../config";
import { git, isCommitRef, isInside, parseRepoUrl, type ParsedRepo } from "../modules/installer";
import { pickLatestTag } from "../updates/versions";

export type SkinRepo = ParsedRepo;

const ERROR_MAP: Record<string, string> = {
  "modules.error.url": "skins.error.url",
  "modules.error.ref": "skins.error.ref",
  "modules.error.subdir": "skins.error.subdir",
  "modules.error.local": "skins.error.local",
  "modules.error.host": "skins.error.host",
};

/** Comme `parseRepoUrl` des modules (même contrôle d'hôte), avec des messages de skins. */
export function parseSkinRepoUrl(input: string): { ok: true; repo: SkinRepo } | { ok: false; error: string } {
  const r = parseRepoUrl(input);
  return r.ok ? r : { ok: false, error: ERROR_MAP[r.error] ?? "skins.error.url" };
}

/** Adresse complète (`dépôt#ref:dossier`) d'un dépôt de skin. */
export const repoAddress = (r: { url: string; ref?: string | null; subdir?: string | null }): string =>
  `${r.url}${r.ref || r.subdir ? `#${r.ref ?? ""}${r.subdir ? `:${r.subdir}` : ""}` : ""}`;

export const sameRepoUrl = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const norm = (u: string | null | undefined) => (u ?? "").replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
  return norm(a) === norm(b);
};

export type Fetched = {
  /** Dossier du skin, dans un dossier temporaire (supprimé par `cleanup`). */
  root: string;
  commit: string;
  /** Empreinte git du CONTENU du dossier du skin (change seulement si ce skin change). */
  tree: string;
  cleanup: () => void;
};

/**
 * Récupère (superficiellement) le dépôt à une étiquette, une branche ou un commit, et pose le dossier du skin dans un dossier temporaire de `data/skins`
 * (même disque que l'installation : l'échange final est un simple renommage). Lève si le dépôt est injoignable ou si le dossier n'y est pas.
 */
export async function fetchSkinSource(url: string, ref: string | null | undefined, subdir: string | null | undefined): Promise<Fetched> {
  fs.mkdirSync(SKINS_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(SKINS_DIR, ".incoming-"));
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    const checkout = path.join(tmp, "repo");
    await git(["init", "-q", checkout]);
    await git(["remote", "add", "origin", url], checkout);
    await git(["fetch", "-q", "--depth", "1", "origin", ref || "HEAD"], checkout).catch((e) => {
      if (ref && isCommitRef(ref)) return git(["fetch", "-q", "origin"], checkout);   // certains serveurs refusent de livrer un commit seul
      throw e;
    });
    await git(["-c", "advice.detachedHead=false", "checkout", "-q", "--detach", isCommitRef(ref) ? ref! : "FETCH_HEAD"], checkout);
    const root = subdir ? path.join(checkout, subdir) : checkout;
    if (subdir && !isInside(checkout, root)) throw Object.assign(new Error("subdir"), { code: "skins.error.nosubdir" });
    const commit = await git(["rev-parse", "HEAD"], checkout);
    const tree = await git(["rev-parse", subdir ? `HEAD:${subdir}` : "HEAD^{tree}"], checkout);
    return { root, commit, tree, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Plus haute étiquette stable (`vX.Y.Z`) du dépôt, ou null. */
export async function latestStableTag(url: string): Promise<string | null> {
  return pickLatestTag(await git(["ls-remote", "--tags", "--refs", "--", url]));
}

/** Tête (commit) d'une branche, ou de la branche par défaut. */
export async function remoteHead(url: string, branch?: string | null): Promise<string | null> {
  const out = await git(["ls-remote", "--", url, branch ? `refs/heads/${branch}` : "HEAD"]);
  return out.split(/\s+/)[0] || null;
}

export { isCommitRef };
