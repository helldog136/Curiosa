// Petites images de démonstration servies par le banc (`/uploads/<uuid>.png`, `/bench/logo-*.svg`) : des dégradés reproductibles, jamais une vraie photo.
import crypto from "node:crypto";

export function placeholderSvg(name, w = 1600, h = 900) {
  const hue = parseInt(crypto.createHash("sha1").update(name).digest("hex").slice(0, 4), 16) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 60% 35%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${h * 0.18}" fill="hsl(${hue} 80% 85% / .55)"/></svg>`;
}
