/**
 * Décisions des onglets de page (PageTabs.tsx), sans DOM ni React : testées telles quelles (tests/core/module-tabs.test.mjs).
 */

/** Touche du clavier sur la rangée d'onglets (motif WAI-ARIA) : index de l'onglet à activer, ou null (touche ignorée). Les flèches bouclent. */
export function keyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  const i = index < 0 ? 0 : index;
  if (key === "ArrowRight") return (i + 1) % count;
  if (key === "ArrowLeft") return (i - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Onglet où aller quand des erreurs apparaissent : le premier onglet NOUVELLEMENT en erreur, seulement si l'onglet affiché n'en a pas
 * (on ne retire jamais la personne d'un onglet où elle a elle-même quelque chose à corriger). `errored` est dans l'ordre des onglets.
 */
export function errorTabToShow(previous: ReadonlySet<string>, errored: readonly string[], active: string): string | null {
  if (errored.includes(active)) return null;
  return errored.find((id) => !previous.has(id)) ?? null;
}

/** Adresse avec `?tab=<id>` (les autres paramètres gardés), ou null si elle y est déjà. */
export function withTab(href: string, id: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get("tab") === id) return null;
  url.searchParams.set("tab", id);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Un clic sur ce lien quitte-t-il la page avec des modifications non enregistrées (donc : demander confirmation) ?
 * Non pour : nouvel onglet ou fenêtre (touche, `target=_blank`), téléchargement, ancre de la même page, autre site, même adresse, rien de modifié.
 */
export function leaveNeedsConfirm(link: { href: string; rawHref: string; target?: string | null; download?: boolean }, click: { button: number; modifier: boolean }, current: string, dirty: boolean): boolean {
  if (!dirty || click.button !== 0 || click.modifier) return false;
  if (link.target === "_blank" || link.download || link.rawHref.startsWith("#")) return false;
  let next: URL, here: URL;
  try { next = new URL(link.href, current); here = new URL(current); } catch { return false; }
  if (next.origin !== here.origin) return false;
  return !(next.pathname === here.pathname && next.search === here.search);
}
