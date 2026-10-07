import { parseRepoUrl } from "./installer";

export type CatalogueItem = {
  id: string;
  name: string;
  description: string;
  repo: string;
  /** Étiquette git à installer (sinon la branche par défaut). */
  ref?: string;
  version?: string;
  author?: string;
  icon?: string;
  /** Version de l'API des modules que le module vise ; différente de celle du framework → affiché comme incompatible. */
  apiVersion?: number;
};

let cache: { at: number; url: string; items: CatalogueItem[] } | null = null;
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/**
 * Index des modules RECONNUS : un fichier JSON public `[{ id, name, description, repo, ref?, version?, apiVersion? }]` dont l'adresse est
 * donnée par MODULES_INDEX_URL. Celui qui publie l'index se porte garant des dépôts qu'il liste. Rien n'est installé automatiquement :
 * c'est une liste, l'installation passe toujours par l'admin. Chaque entrée est revalidée ici (identifiant, dépôt https sur un hôte autorisé).
 */
export async function getCatalogue(fetchImpl: typeof fetch = fetch): Promise<CatalogueItem[]> {
  const url = process.env.MODULES_INDEX_URL;
  if (!url || !url.startsWith("https://")) return [];
  if (cache && cache.url === url && Date.now() - cache.at < 5 * 60_000) return cache.items;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const seen = new Set<string>();
    const items: CatalogueItem[] = [];
    for (const i of Array.isArray(json) ? json : []) {
      if (!i || typeof i !== "object" || typeof i.id !== "string" || typeof i.repo !== "string" || !ID_RE.test(i.id) || seen.has(i.id)) continue;
      const repo = parseRepoUrl(i.repo);
      if (!repo.ok || repo.repo.url.startsWith("file:")) continue;
      seen.add(i.id);
      items.push({
        id: i.id, name: str(i.name, 120) || i.id, description: str(i.description, 500) ?? "", repo: repo.repo.url,
        ref: typeof i.ref === "string" && /^[\w./-]{1,100}$/.test(i.ref) ? i.ref : undefined,
        version: str(i.version, 40), author: str(i.author, 120), icon: str(i.icon, 8),
        apiVersion: Number.isInteger(i.apiVersion) ? i.apiVersion : undefined,
      });
      if (items.length >= 300) break;
    }
    cache = { at: Date.now(), url, items };
    return items;
  } catch {
    return [];
  }
}

export function clearCatalogueCache(): void { cache = null; }
