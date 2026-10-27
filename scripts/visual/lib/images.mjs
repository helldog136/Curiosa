// Images de démonstration fabriquées à la volée (formes et dégradés, aucun texte : le rendu ne dépend d'aucune police système). Aucune image n'est versionnée.
import sharp from "sharp";

const PALETTE = [["#355c7d", "#c06c84"], ["#2a9d8f", "#e9c46a"], ["#6a4c93", "#ff9f1c"], ["#264653", "#e76f51"], ["#0b525b", "#f4a261"], ["#5f0f40", "#fb8b24"], ["#1d3557", "#a8dadc"], ["#386641", "#bc4749"]];

/** Une image `w`×`h` de la variante `n` (couleurs et formes différentes selon n). */
// PNG par défaut : sans perte, et surtout sans le décodage JPEG « à échelle réduite » de Chromium, dont le grain varie d'une capture à l'autre quand la photo est affichée plus petite que sa taille.
export async function demoImage(w, h, n = 0, format = "png") {
  const [a, b] = PALETTE[n % PALETTE.length];
  const k = (n * 37) % 100;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${w * (0.2 + (k % 5) * 0.15)}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.22}" fill="#ffffff" fill-opacity="0.22"/>
<rect x="${w * 0.45}" y="${h * (0.45 + (k % 3) * 0.08)}" width="${w * 0.4}" height="${h * 0.3}" rx="${Math.min(w, h) * 0.04}" fill="#000000" fill-opacity="0.25"/>
<path d="M0 ${h} L${w * 0.35} ${h * 0.62} L${w * 0.6} ${h * 0.85} L${w * 0.8} ${h * 0.7} L${w} ${h} Z" fill="#000000" fill-opacity="0.32"/>
</svg>`;
  const img = sharp(Buffer.from(svg));
  return format === "png" ? img.png({ compressionLevel: 9 }).toBuffer() : img.jpeg({ quality: 82, mozjpeg: false }).toBuffer();
}

/** Logo carré / horizontal (SVG nettoyé accepté par le site : formes simples). */
export function demoLogoSvg(kind = "square", dark = false) {
  const fg = dark ? "#f3f1ea" : "#1d2733", ac = "#e8a23b";
  if (kind === "square") return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><rect x="4" y="4" width="56" height="56" rx="14" fill="${ac}"/><circle cx="32" cy="32" r="14" fill="${fg}"/></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 56" width="220" height="56"><rect x="2" y="8" width="40" height="40" rx="10" fill="${ac}"/><circle cx="22" cy="28" r="9" fill="${fg}"/><rect x="56" y="18" width="150" height="8" rx="4" fill="${fg}"/><rect x="56" y="34" width="96" height="6" rx="3" fill="${fg}" fill-opacity="0.6"/></svg>`;
}
