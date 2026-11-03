import type { SearchDoc } from "./index";

/**
 * RECHERCHE DANS LE SITE — le classement (pur). Simple et prévisible, dit tel quel aux personnes qui gèrent le site :
 *   1. une fiche répond si CHAQUE mot saisi se trouve quelque part (titre, résumé, étiquettes ou début du texte) ;
 *   2. rang 0 : tous les mots sont dans le titre ; rang 1 : chaque mot est dans le titre ou le résumé ; rang 2 : il faut aussi le texte ;
 *   3. à rang égal, le plus récent d'abord (sans date : à la fin), puis l'ordre alphabétique du titre, puis l'identifiant (ordre toujours le même).
 * Avant tout cela : le CONTENU DU SITE passe avant ce qui mène AILLEURS. Un résultat est « du site » s'il vient des entrées de contenu du cœur OU si son
 * adresse reste sur le site (adresse relative ou même domaine) ; il est « externe » si son adresse est absolue vers un autre domaine (YouTube, réseaux…).
 * Tous les résultats du site d'abord, puis les externes, chaque groupe gardant le classement ci-dessus.
 * Aucun score caché, aucune pondération qui change d'un jour à l'autre.
 */
export const MAX_RESULTS = 200;

/** Nom de domaine sans « www. » ni majuscules : `www.monsite.be` et `monsite.be` sont le même site. */
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/**
 * Cette adresse reste-t-elle sur le site ? Oui : adresse relative (`/fr/blog/x`) ou même nom de domaine que le site (à « www. » près, port ignoré).
 * Non : toute autre adresse absolue. Un SOUS-domaine (`boutique.monsite.be`) est un AUTRE domaine : il peut être un service à part (boutique, forum,
 * outil d'un tiers), la règle reste donc lisible : seul le nom de domaine exact du site compte.
 */
export function isOwnAddress(url: string, siteUrl: string): boolean {
  if (url.startsWith("/")) return !url.startsWith("//");
  try {
    const u = new URL(url), site = new URL(siteUrl);
    return (u.protocol === "http:" || u.protocol === "https:") && bareHost(u.hostname) === bareHost(site.hostname);
  } catch { return false; }
}

export type Hit = { doc: SearchDoc; rank: 0 | 1 | 2 };
export type Ranked = { hits: Hit[]; /** Nombre de fiches qui répondent, avant le plafond de `MAX_RESULTS`. */ total: number };

export function rankDocs(docs: readonly SearchDoc[], words: readonly string[], limit = MAX_RESULTS): Ranked {
  if (words.length === 0) return { hits: [], total: 0 };
  const hits: Hit[] = [];
  for (const doc of docs) {
    let inTitle = true, inTop = true, anywhere = true;
    for (const w of words) {
      const t = doc.fTitle.includes(w);
      const top = t || doc.fSummary.includes(w);
      if (!t) inTitle = false;
      if (!top) inTop = false;
      if (!top && !doc.fBody.includes(w)) { anywhere = false; break; }
    }
    if (!anywhere) continue;
    hits.push({ doc, rank: inTitle ? 0 : inTop ? 1 : 2 });
  }
  hits.sort((a, b) => Number(b.doc.own) - Number(a.doc.own) || a.rank - b.rank || (b.doc.publishedAt ?? -Infinity) - (a.doc.publishedAt ?? -Infinity) || a.doc.title.localeCompare(b.doc.title) || (a.doc.id < b.doc.id ? -1 : a.doc.id > b.doc.id ? 1 : 0));
  return { hits: hits.slice(0, Math.max(1, limit)), total: hits.length };
}
