import QRCode from "qrcode";

/**
 * QR CODE D'UNE REDIRECTION (SVG propre et PNG), prêt à imprimer.
 *
 * L'encodage est fait par la bibliothèque `qrcode` du cœur (la même que `ctx.api.qr`) ; ce fichier ne fait que le dessin et les choix qui rendent le code lisible partout :
 *  - noir sur blanc PLEIN, jamais transparent : le contraste est maximal et ne dépend ni du thème du site ni du papier ;
 *  - une zone de silence de 4 modules (la norme) DANS l'image : posé sur un fond sombre ou une affiche colorée, le code garde son cadre blanc ;
 *  - des modules entiers (pas de coins arrondis, pas de dégradé) ; le SVG est un seul tracé net, avec un titre et un texte alternatif.
 * Le QR encode l'adresse COMPLÈTE de la redirection (`https://monsite.be/twitch`), jamais sa destination : changer la destination ne change donc jamais le QR imprimé.
 */
export const QUIET_ZONE = 4;
/** Niveau de correction d'erreurs : M par défaut (bon compromis), Q en option avancée (plus robuste si le code est abîmé ou petit). */
export type QrLevel = "M" | "Q";
export const DEFAULT_LEVEL: QrLevel = "M";
/** Largeur visée du « grand » PNG (au moins : chaque module a un nombre entier de pixels, jamais de flou). */
export const LARGE_PNG = 1500;
export const MAX_QR_TEXT = 1000;

export const parseLevel = (v: unknown): QrLevel => (String(v ?? "").toUpperCase() === "Q" ? "Q" : DEFAULT_LEVEL);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function matrix(text: string, level: QrLevel): { size: number; at: (r: number, c: number) => boolean } {
  if (!text || text.length > MAX_QR_TEXT) throw new Error("qr: text out of bounds");
  const qr = QRCode.create(text, { errorCorrectionLevel: level });
  return { size: qr.modules.size, at: (r, c) => qr.modules.get(r, c) === 1 };
}

/** QR code en SVG. `label` : texte alternatif (lu par les lecteurs d'écran, repris dans <title>). `pixels` : taille fixe, sinon l'image s'adapte à son conteneur. */
export function qrSvg(text: string, opts: { level?: QrLevel; label?: string; pixels?: number } = {}): string {
  const { size, at } = matrix(text, opts.level ?? DEFAULT_LEVEL);
  const full = size + QUIET_ZONE * 2;
  let path = "";
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!at(r, c)) { c++; continue; }
      let end = c;
      while (end < size && at(r, end)) end++;
      path += `M${c + QUIET_ZONE} ${r + QUIET_ZONE}h${end - c}v1h-${end - c}z`;
      c = end;
    }
  }
  const label = esc(opts.label || "QR code");
  const dim = opts.pixels ? ` width="${Math.round(opts.pixels)}" height="${Math.round(opts.pixels)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}"${dim} role="img" aria-label="${label}" shape-rendering="crispEdges"><title>${label}</title><rect width="${full}" height="${full}" fill="#ffffff"/><path fill="#000000" d="${path}"/></svg>`;
}

/** Largeur en pixels d'un PNG pour ce texte : modules + zone de silence, chacun d'un nombre ENTIER de pixels, au moins `target`. */
export function pngWidth(text: string, level: QrLevel = DEFAULT_LEVEL, target = LARGE_PNG): number {
  const { size } = matrix(text, level);
  const full = size + QUIET_ZONE * 2;
  return full * Math.max(1, Math.ceil(target / full));
}

/** QR code en PNG (noir sur blanc plein, zone de silence de 4 modules). Par défaut le « grand » format, prêt pour l'imprimeur. */
export async function qrPng(text: string, opts: { level?: QrLevel; target?: number } = {}): Promise<Buffer> {
  const level = opts.level ?? DEFAULT_LEVEL;
  const { size } = matrix(text, level);
  const full = size + QUIET_ZONE * 2;
  const scale = Math.max(1, Math.ceil(Math.min(opts.target ?? LARGE_PNG, 4000) / full));
  return QRCode.toBuffer(text, { type: "png", errorCorrectionLevel: level, margin: QUIET_ZONE, scale, color: { dark: "#000000ff", light: "#ffffffff" } });
}
