/**
 * PAGE FACULTATIVE D'UN MODULE (cœur 0.2.12). Un module peut déclarer `pageSetting: "<clé d'un réglage booléen>"` : tant que ce réglage est faux, la page de
 * l'instance n'existe pour personne (404) ET n'apparaît nulle part : plan du site, llms.txt, menu, éditeur de menu, script de page. Une SEULE règle, ici,
 * lue par tous ces endroits (jamais une copie par endroit) : `hasPublicPage`. Sans le champ, rien ne change.
 * Réglage jamais enregistré : sa valeur par défaut ; sans défaut : éteint (fermé au moindre doute).
 */
type PageManifest = { pageSetting?: string; settings: readonly { key: string; default?: unknown }[] };

/** Clé de stockage d'un réglage d'instance (la même que ctx.setting). */
export const pageSettingStorageKey = (instanceId: string, key: string): string => `instance.${instanceId}.${key}`;

/** La page est-elle allumée, d'après la valeur enregistrée (ou son absence) ? Vrai sans `pageSetting`. */
export function pageIsOn(manifest: PageManifest, stored: unknown): boolean {
  if (!manifest.pageSetting) return true;
  const field = manifest.settings.find((f) => f.key === manifest.pageSetting);
  if (!field) return false;
  return (stored === undefined ? field.default : stored) === true;
}

/** LA règle commune : l'instance est montée sur un chemin (`basePath` non nul) ET sa page n'est pas éteinte par son réglage. */
export function hasPublicPage(a: { instance: { basePath: string | null }; pageOn?: boolean }): boolean {
  return a.instance.basePath !== null && a.pageOn !== false;
}
