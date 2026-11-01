import * as simpleIcons from "simple-icons";

type Icon = { slug: string; path: string; title: string };

let bySlug: Map<string, Icon> | null = null;

/**
 * `icon` d'une entrée : soit un identifiant simple-icons ("twitch",
 * "youtube"…), soit n'importe quel texte court (un emoji). Renvoie le chemin
 * SVG si c'est une icône connue.
 */
export function resolveIcon(icon: string | null | undefined): { svg: string; title: string } | { text: string } | null {
  if (!icon) return null;
  if (!/^[a-z0-9]+$/i.test(icon)) return { text: icon.slice(0, 8) };
  if (!bySlug) {
    bySlug = new Map();
    for (const value of Object.values(simpleIcons) as Icon[]) {
      if (value && typeof value === "object" && "slug" in value && "path" in value) bySlug.set(value.slug, value);
    }
  }
  const hit = bySlug.get(icon.toLowerCase());
  return hit ? { svg: hit.path, title: hit.title } : { text: icon.slice(0, 8) };
}
