// Captures du banc d'essai : les planches (clair et sombre, toutes les largeurs), les quatre mises en page d'en-tête, et les aperçus 1280 × 800 pour `previews/` d'un skin.
import fs from "node:fs";
import path from "node:path";
import { BOARD_PATH, DEMO_PAGES } from "./site.mjs";

async function launch() {
  const pw = await import("../../../scripts/visual/lib/playwright.mjs");
  const playwright = pw.loadPlaywright();
  return playwright.chromium.launch({ executablePath: pw.chromiumPath(), args: pw.CHROMIUM_ARGS });
}

/** PNG des planches : `board-<mode>-<largeur>.png`, `header-<mise en page>-<mode>-<largeur>.png`, `<page>-<mode>-<largeur>.png`. Rend la liste des fichiers écrits. */
export async function makeShots(site, server, { dir, widths = [390, 768, 1280, 1920], pages = false, log = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launch();
  const out = [];
  try {
    const modes = site.look.composed.modes.map((m) => m.mode);
    for (const mode of modes) {
      for (const width of widths) {
        const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 }, colorScheme: mode, reducedMotion: "reduce", locale: "fr-FR" });
        const shot = async (urlPath, name, opts = {}) => {
          const page = await ctx.newPage();
          await page.goto(`${server.url}${urlPath}`, { waitUntil: "load" });
          await page.evaluate(async () => { await document.fonts.ready; });
          const file = path.join(dir, `${name}-${mode}-${width}.png`);
          await page.screenshot({ path: file, ...opts });
          await page.close();
          out.push(file); log(file);
        };
        await shot(BOARD_PATH, "board", { fullPage: true });
        for (const layout of ["classic", "twoRows", "centered", "minimal"]) await shot(`/?layout=${layout}`, `header-${layout}`, { clip: { x: 0, y: 0, width, height: Math.min(width < 700 ? 420 : 320, 844) } });
        if (pages) for (const p of DEMO_PAGES) await shot(p.path, p.id, { fullPage: true });
        await ctx.close();
      }
    }
  } finally { await browser.close(); }
  return out;
}

/** Aperçus pour `previews/` : la page d'accueil en 1280 × 800, un WebP de 150 Ko au plus par mode. Rend [{ file, mode, bytes }]. */
export async function makePreviews(site, server, { dir, log = () => {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const sharp = (await import("sharp")).default;
  const browser = await launch();
  const out = [];
  try {
    for (const mode of site.look.composed.modes.map((m) => m.mode)) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: mode, reducedMotion: "reduce", locale: "fr-FR" });
      const page = await ctx.newPage();
      await page.goto(`${server.url}/`, { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; });
      const png = await page.screenshot();
      await ctx.close();
      let buf;
      for (const q of [85, 75, 65, 55, 45, 35]) { buf = await sharp(png).webp({ quality: q }).toBuffer(); if (buf.length <= 150 * 1024) break; }
      const file = path.join(dir, `home-${mode}.webp`);
      fs.writeFileSync(file, buf);
      out.push({ file, mode, bytes: buf.length }); log(file);
    }
  } finally { await browser.close(); }
  return out;
}
