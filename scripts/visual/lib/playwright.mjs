// Playwright n'est PAS une dépendance du cœur (rien ne s'installe de plus) : on le cherche dans PLAYWRIGHT_MODULE, puis le dossier courant, puis les emplacements usuels.
import { createRequire } from "node:module";
import fs from "node:fs";

const CANDIDATES = [process.env.PLAYWRIGHT_MODULE, process.cwd() + "/", "/opt/node-tools/", "/opt/node22/lib/node_modules/", "/usr/lib/node_modules/", "/usr/local/lib/node_modules/"].filter(Boolean);
export function loadPlaywright() {
  for (const base of CANDIDATES) {
    try { return createRequire(base.endsWith("/") ? base : base + "/")("playwright"); } catch {}
  }
  throw new Error("Playwright introuvable : installez-le (`npm i -g playwright`) ou indiquez son dossier dans PLAYWRIGHT_MODULE (le dossier qui contient node_modules/playwright ou le dossier node_modules).");
}
export function chromiumPath() {
  const p = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
  if (!fs.existsSync(p)) throw new Error(`Chromium introuvable : ${p} (variable CHROMIUM_PATH ; Playwright : PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers)`);
  return p;
}
export const CHROMIUM_ARGS = ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars", "--num-raster-threads=1", "--disable-partial-raster", "--disable-gpu-rasterization", "--disable-gpu-compositing", "--disable-lcd-text", "--force-device-scale-factor=1", "--disable-features=Translate,BackForwardCache", "--autoplay-policy=user-gesture-required", "--mute-audio"];
