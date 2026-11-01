/** Adresse publique complète d'un overlay, celle que l'on colle dans OBS : `<adresse du site>/overlays/<clé de l'instance>`. */
export const overlayUrl = (siteUrl: string, key: string): string => `${siteUrl.replace(/\/+$/, "")}/overlays/${key}`;
