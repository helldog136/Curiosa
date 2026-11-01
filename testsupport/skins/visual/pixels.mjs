// Calculs sur les pixels d'une capture (sharp, dépendance du cœur) : contraste RENDU sous un texte, comparaison de deux images, changement visible du focus.
const lib = async (n) => import(`../../../src/core/skins/${n}.ts`);

export async function rawOf(png) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Nombre de pixels qui diffèrent (un canal de plus de `tol` d'écart). Tailles différentes : tout diffère. */
export function diffCount(a, b, tol = 0) {
  if (a.width !== b.width || a.height !== b.height) return Math.max(a.width * a.height, b.width * b.height);
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) n++;
  }
  return n;
}

/** Le pire contraste d'un texte (couleur `color`, éventuellement translucide) sur les pixels de ses boîtes (échantillon en grille). */
export async function worstContrast(raw, run) {
  const { contrastRatio, composite } = await lib("readability");
  let worst = Infinity, at = null;
  for (const r of run.rects) {
    const cols = Math.min(9, Math.max(2, Math.round(r.w / 12))), rows = Math.min(4, Math.max(1, Math.round(r.h / 10)));
    for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < cols; ix++) {
      const x = Math.min(raw.width - 1, Math.max(0, Math.round(r.x + 1 + ((r.w - 2) * (ix + 0.5)) / cols)));
      const y = Math.min(raw.height - 1, Math.max(0, Math.round(r.y + 1 + ((r.h - 2) * (iy + 0.5)) / rows)));
      const i = (y * raw.width + x) * 4;
      const bg = { r: raw.data[i], g: raw.data[i + 1], b: raw.data[i + 2], a: 1 };
      const fg = composite({ r: run.color.r, g: run.color.g, b: run.color.b, a: run.color.a }, bg);
      const ratio = contrastRatio(fg, bg);
      if (ratio < worst) { worst = ratio; at = { x, y }; }
    }
  }
  return { ratio: worst === Infinity ? null : Math.round(worst * 100) / 100, at };
}

/** Le focus se voit-il ? Compare deux captures du même cadre (sans / avec focus). Rend { changed, strong }. */
export async function focusChange(before, after) {
  const { contrastRatio } = await lib("readability");
  if (before.width !== after.width || before.height !== after.height) return { changed: 0, strong: 0 };
  let changed = 0, strong = 0;
  for (let i = 0; i < before.data.length; i += 4) {
    const d = Math.max(Math.abs(before.data[i] - after.data[i]), Math.abs(before.data[i + 1] - after.data[i + 1]), Math.abs(before.data[i + 2] - after.data[i + 2]));
    if (d <= 16) continue;
    changed++;
    const a = { r: before.data[i], g: before.data[i + 1], b: before.data[i + 2], a: 1 }, b = { r: after.data[i], g: after.data[i + 1], b: after.data[i + 2], a: 1 };
    if (contrastRatio(a, b) >= 3) strong++;
  }
  return { changed, strong };
}
