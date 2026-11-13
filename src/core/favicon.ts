/**
 * FAVICON. Un site peut envoyer sa propre image (Réglages → Identité) ; sans image, le framework en fabrique une à partir des couleurs du site :
 * une pastille de la couleur d'accent sur un carré de la couleur de fond. Aucune lettre ni texte : rien à choisir, rien qui dépende d'une police.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

export function defaultFaviconSvg(accent: string, background: string): string {
  const a = HEX.test(accent) ? accent : "#e8a23b";
  const b = HEX.test(background) ? background : "#121214";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${b}"/><circle cx="32" cy="32" r="19" fill="${a}"/><circle cx="32" cy="32" r="8" fill="${b}"/></svg>`;
}

/** Adresse de l'icône d'un site : l'image envoyée, sinon l'icône générée. */
export const faviconUrl = (uploaded: string | null): string => uploaded || "/icon";

const iconType = (url: string): string | undefined => {
  const ext = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase();
  return ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : undefined;
};

/**
 * The `<link rel="icon">` and `<link rel="apple-touch-icon">` of a page, with `type` (and `sizes="any"` for a svg) so that a browser picks without downloading.
 * The home-screen icon must be a raster (iOS ignores svg): the favicon if it is one, else the square logo if it is one, else none.
 */
export function siteIconLinks(favicon: string | null, square: string | null) {
  const href = faviconUrl(favicon);
  const type = iconType(href);
  const touch = [favicon, square].find((v): v is string => !!v && !!iconType(v) && iconType(v) !== "image/svg+xml");
  return {
    icon: [{ url: href, ...(type ? { type } : {}), ...(type === "image/svg+xml" ? { sizes: "any" } : {}) }],
    ...(touch ? { apple: [{ url: touch, type: iconType(touch) }] } : {}),
  };
}
