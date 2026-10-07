export type CatalogueItem = { id: string; name: string; description: string; repo: string };

let cache: { at: number; items: CatalogueItem[] } | null = null;

/**
 * Catalogue de modules, à la HACS : un simple fichier JSON public
 * [{ id, name, description, repo }] dont l'URL est donnée par
 * MODULES_INDEX_URL. Rien d'installé automatiquement : c'est une liste de
 * suggestions, l'installation passe toujours par l'admin.
 */
export async function getCatalogue(): Promise<CatalogueItem[]> {
  const url = process.env.MODULES_INDEX_URL;
  if (!url || !url.startsWith("https://")) return [];
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.items;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const items = (Array.isArray(json) ? json : [])
      .filter((i): i is CatalogueItem => !!i && typeof i.id === "string" && typeof i.repo === "string")
      .map((i) => ({ id: i.id, name: String(i.name ?? i.id), description: String(i.description ?? ""), repo: i.repo }))
      .slice(0, 200);
    cache = { at: Date.now(), items };
    return items;
  } catch {
    return [];
  }
}
