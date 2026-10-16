/**
 * CADRAGE D'UNE IMAGE — la seule définition (éditeur d'admin, pages publiques, serveur) de ce qu'est « une image recadrée ».
 *
 * Principe : l'image envoyée n'est JAMAIS modifiée. Une valeur de champ image reste une simple chaîne :
 *   - `/uploads/<id>.png`                       l'original, tel quel (toutes les valeurs d'avant ce système, sans migration) ;
 *   - `/uploads/<id>.png?c=1.7778_1.25_0.5_0.5_ffffff`   l'original + son cadrage `ratio_zoom_x_y_remplissage`.
 * Le navigateur (ou un module) peut donc mettre la valeur telle quelle dans un `src` : le serveur (`/uploads/[name]`) fabrique la version cadrée,
 * la garde en cache et la refabrique dès que le cadrage change (le cadrage fait partie de l'adresse).
 *
 * Le cadrage :
 *   - ratio  : largeur/hauteur du cadre (nombre), ou `o` = ratio de l'image d'origine ;
 *   - zoom   : 1 = l'image remplit exactement le cadre ; > 1 rapproche, < 1 éloigne (la zone vide est remplie) ;
 *   - x, y   : le point de l'image (0 à 1) placé au centre du cadre ;
 *   - remplissage : 6 chiffres hexadécimaux (couleur) ou `t` (transparent), pour la zone vide quand on dézoome.
 *
 * Fichier pur (aucun accès disque, aucune bibliothèque) : le même calcul sert l'aperçu du navigateur et le traitement du serveur.
 */

export const RATIOS = [
  { id: "16:9", value: 16 / 9 },
  { id: "4:3", value: 4 / 3 },
  { id: "3:2", value: 3 / 2 },
  { id: "1:1", value: 1 },
  { id: "3:4", value: 3 / 4 },
  { id: "9:16", value: 9 / 16 },
] as const;

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;
export const RATIO_MIN = 0.25;
export const RATIO_MAX = 4;
/** Plus grand côté d'une image cadrée (en pixels) : assez pour un écran large, jamais une image énorme. */
export const MAX_SIDE = 1600;
/** Image de partage (Open Graph) : 1,91:1, le format que les réseaux sociaux affichent entier. */
export const SHARE_SIZE = { width: 1200, height: 630 } as const;
/** Partage : on garde le cadrage de la personne s'il est dans cette plage de ratios, sinon on en fabrique un de 1,91:1. */
export const SHARE_KEEP = { min: 1.2, max: 2.2 } as const;
/** Sous cette largeur (en pixels de l'image d'origine) la zone visible devient floue à l'écran : on prévient. */
export const SMALL_SOURCE_PX = 360;

export type Crop = { ratio: number | null; zoom: number; x: number; y: number; fill: string };

export const DEFAULT_CROP: Crop = { ratio: null, zoom: 1, x: 0.5, y: 0.5, fill: "ffffff" };

/** Le morceau d'adresse qui porte le cadrage ; toutes les listes d'images acceptées du cœur le partagent. */
export const CROP_QUERY_SOURCE = String.raw`(?:\?c=[0-9a-z._-]{1,60}(?:&s=1)?)?`;

/** Une image envoyée sur le site (raster uniquement), avec ou sans cadrage. */
export const UPLOADED_RASTER_SOURCE = String.raw`/uploads/[0-9a-f-]{36}\.(?:png|jpe?g|webp|gif)${CROP_QUERY_SOURCE}`;
export const UPLOADED_RASTER = new RegExp(`^${UPLOADED_RASTER_SOURCE}$`);

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
/** Arrondi au nombre de décimales voulu, sans zéros inutiles (`1.25`, jamais `1.2500000001`). */
const num = (n: number, decimals: number) => String(Number(n.toFixed(decimals)));

/** Valeurs rangées dans les bornes et arrondies : deux cadrages quasi identiques donnent la même adresse (donc le même fichier en cache). */
export function normalizeCrop(c: Crop): Crop {
  const ratio = c.ratio === null ? null : Number(clamp(Number.isFinite(c.ratio) ? c.ratio : 1, RATIO_MIN, RATIO_MAX).toFixed(4));
  const fill = c.fill === "t" || /^[0-9a-f]{6}$/.test(c.fill) ? c.fill : "ffffff";
  return {
    ratio,
    zoom: Number(clamp(Number.isFinite(c.zoom) ? c.zoom : 1, ZOOM_MIN, ZOOM_MAX).toFixed(2)),
    x: Number(clamp(Number.isFinite(c.x) ? c.x : 0.5, 0, 1).toFixed(3)),
    y: Number(clamp(Number.isFinite(c.y) ? c.y : 0.5, 0, 1).toFixed(3)),
    fill,
  };
}

/** `1.7778_1.25_0.5_0.5_ffffff` — la partie après `?c=`. */
export function formatCrop(c: Crop): string {
  const n = normalizeCrop(c);
  return [n.ratio === null ? "o" : num(n.ratio, 4), num(n.zoom, 2), num(n.x, 3), num(n.y, 3), n.fill].join("_");
}

/** Lit un cadrage ; `null` si le texte n'est pas EXACTEMENT de la forme attendue (jamais de valeur devinée). */
export function parseCrop(text: string): Crop | null {
  const parts = text.split("_");
  if (parts.length !== 5) return null;
  const [r, z, x, y, f] = parts as [string, string, string, string, string];
  const dec = /^\d{1,2}(?:\.\d{1,4})?$/;
  if (!(r === "o" || dec.test(r)) || !dec.test(z) || !/^[01](?:\.\d{1,3})?$/.test(x) || !/^[01](?:\.\d{1,3})?$/.test(y)) return null;
  if (!(f === "t" || /^[0-9a-f]{6}$/.test(f))) return null;
  const ratio = r === "o" ? null : Number(r);
  if ((ratio !== null && (ratio < RATIO_MIN || ratio > RATIO_MAX)) || Number(z) < ZOOM_MIN || Number(z) > ZOOM_MAX || Number(x) > 1 || Number(y) > 1) return null;
  return normalizeCrop({ ratio, zoom: Number(z), x: Number(x), y: Number(y), fill: f });
}

export type ImageRef = { path: string; crop: Crop | null; share: boolean; hasQuery: boolean };

/** Sépare « l'original » et « le cadrage » d'une valeur de champ. Une valeur sans `?c=` (ou illisible) n'a pas de cadrage. */
export function splitImageRef(value: string): ImageRef {
  const i = value.indexOf("?");
  if (i < 0) return { path: value, crop: null, share: false, hasQuery: false };
  const path = value.slice(0, i);
  const m = /^\?c=([0-9a-z._-]{1,60})(&s=1)?$/.exec(value.slice(i));
  // Seuls les envois PNG/JPEG/WebP du site se cadrent (pas d'image distante, pas de GIF animé, pas de SVG).
  const ours = /(?:^|\/)uploads\/[0-9a-f-]{36}\.(?:png|jpe?g|webp)$/.test(path);
  return { path, crop: m && ours ? parseCrop(m[1]!) : null, share: !!m?.[2], hasQuery: true };
}

/** Valeur de champ = original + cadrage. */
export const joinImageRef = (path: string, crop: Crop | null): string => (crop ? `${path}?c=${formatCrop(crop)}` : path);

/** Le ratio d'affichage connu d'avance (pour réserver la place avant le chargement), ou `null` : ratio d'origine ou image non cadrée. */
export function refRatio(value: string | null | undefined): number | null {
  if (!value) return null;
  return splitImageRef(value).crop?.ratio ?? null;
}

/**
 * Image à donner aux réseaux sociaux (Open Graph / carte Twitter) à partir d'une valeur de champ.
 *  - non cadrée : telle quelle (comme avant) ;
 *  - cadrée avec un ratio raisonnable (1,2 à 2,2) : le cadrage de la personne, tel quel ;
 *  - cadrée avec un ratio extrême (9:16, 1:1, ratio d'origine inconnu…) : une version 1,91:1 fabriquée automatiquement, centrée sur le même point.
 */
export function shareImage(value: string): string {
  const ref = splitImageRef(value);
  if (!ref.crop || ref.share) return value;
  const r = ref.crop.ratio;
  if (r !== null && r >= SHARE_KEEP.min && r <= SHARE_KEEP.max) return value;
  return `${value}&s=1`;
}

/** Format du fichier que le serveur renverra pour cette adresse (flux RSS : `type` de l'enclosure). `null` = on ne sait pas, voir l'extension. */
export function derivedMime(value: string): string | null {
  const ref = splitImageRef(value);
  if (!ref.crop) return null;
  return ref.share ? "image/jpeg" : "image/webp";
}

export type Geometry = {
  /** Taille de l'image fabriquée. */
  outW: number; outH: number;
  /** Zone de l'original à lire (entiers, dans l'original redressé), puis taille à laquelle la redimensionner. */
  extract: { left: number; top: number; width: number; height: number };
  resize: { width: number; height: number };
  /** Où poser cette zone dans l'image fabriquée (hors zone = remplissage). */
  place: { left: number; top: number };
  /** Vrai si le cadre est entièrement dans l'image : un seul redimensionnement, aucun remplissage. */
  inside: boolean;
  /** Largeur, en pixels de l'original, de la zone visible : sert à prévenir quand l'image est trop petite pour ce cadre. */
  visibleSourceWidth: number;
};

/** Largeur/hauteur du cadre pour un cadrage donné sur une image W×H. */
export const frameRatio = (c: Crop, W: number, H: number): number => clamp(c.ratio ?? W / H, RATIO_MIN, RATIO_MAX);

/** Zone de l'original visible dans le cadre (en pixels de l'original ; elle peut dépasser l'image quand on dézoome). */
export function visibleRegion(c: Crop, W: number, H: number): { left: number; top: number; width: number; height: number } {
  const A = frameRatio(c, W, H);
  const baseW = A >= W / H ? W : H * A;
  const baseH = A >= W / H ? W / A : H;
  const width = baseW / c.zoom;
  const height = baseH / c.zoom;
  return { left: c.x * W - width / 2, top: c.y * H - height / 2, width, height };
}

/**
 * Tout le calcul d'une image cadrée. `share` : image de partage 1,91:1 (1200×630), centrée sur le même point, sans zoom.
 * Le résultat ne dépasse jamais MAX_SIDE pixels sur un côté.
 */
export function cropGeometry(input: Crop, W: number, H: number, share = false): Geometry {
  const c = normalizeCrop(share ? { ...input, ratio: SHARE_SIZE.width / SHARE_SIZE.height, zoom: 1 } : input);
  const A = frameRatio(c, W, H);
  const r = visibleRegion(c, W, H);
  let outW: number, outH: number;
  if (share) {
    outW = SHARE_SIZE.width; outH = SHARE_SIZE.height;
  } else {
    // Même densité de pixels que l'original quand on rapproche (jamais plus fin que lui, mais jamais minuscule) ; quand on éloigne, la taille du cadre plein.
    const baseW = A >= W / H ? W : H * A;
    let w = c.zoom >= 1 ? Math.max(r.width, Math.min(480, baseW)) : baseW;
    const f = Math.min(1, MAX_SIDE / Math.max(w, w / A));
    w *= f;
    outW = Math.max(1, Math.round(w));
    outH = Math.max(1, Math.round(w / A));
  }
  const k = outW / r.width;
  const ix0 = Math.max(0, r.left), iy0 = Math.max(0, r.top);
  const ix1 = Math.min(W, r.left + r.width), iy1 = Math.min(H, r.top + r.height);
  const eps = 1e-6;
  const inside = r.left >= -eps && r.top >= -eps && r.left + r.width <= W + eps && r.top + r.height <= H + eps;
  const left = clamp(Math.round(ix0), 0, W - 1), top = clamp(Math.round(iy0), 0, H - 1);
  const extract = { left, top, width: clamp(Math.round(ix1) - left, 1, W - left), height: clamp(Math.round(iy1) - top, 1, H - top) };
  if (inside) {
    return { outW, outH, extract: { left: clamp(Math.round(r.left), 0, W - 1), top: clamp(Math.round(r.top), 0, H - 1), width: clamp(Math.round(r.width), 1, W), height: clamp(Math.round(r.height), 1, H) }, resize: { width: outW, height: outH }, place: { left: 0, top: 0 }, inside, visibleSourceWidth: r.width };
  }
  const resize = { width: clamp(Math.round(extract.width * k), 1, outW), height: clamp(Math.round(extract.height * k), 1, outH) };
  const place = { left: clamp(Math.round((left - r.left) * k), 0, outW - resize.width), top: clamp(Math.round((top - r.top) * k), 0, outH - resize.height) };
  return { outW, outH, extract, resize, place, inside, visibleSourceWidth: r.width };
}

/**
 * Mise en page de l'aperçu (navigateur) : le cadre fait `frameW` de large ; renvoie la hauteur du cadre et la position/taille de l'image dedans.
 * Même géométrie que ci-dessus : ce qu'on voit dans le cadre est ce que le serveur fabrique.
 */
export function previewLayout(c: Crop, W: number, H: number, frameW: number): { frameH: number; imgW: number; imgH: number; imgLeft: number; imgTop: number } {
  const A = frameRatio(c, W, H);
  const r = visibleRegion(c, W, H);
  const s = frameW / r.width;
  return { frameH: frameW / A, imgW: W * s, imgH: H * s, imgLeft: -r.left * s, imgTop: -r.top * s };
}
