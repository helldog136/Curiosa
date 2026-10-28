// Ordre VISUEL des éléments focalisables comparé à l'ordre de TABULATION (= ordre du DOM) : docs/SKINS.md §6.5.
// Fonction PURE (testée sans navigateur). Entrée : les éléments dans l'ordre du DOM, avec leur région et leur boîte. Sortie : la part de paires inversées.
//
// Écart avec l'énoncé du §6.5 (« haut → bas puis gauche → droite ») : trois mises en page légitimes seraient condamnées à tort par un tri brut, la colonne latérale
// (le menu est à gauche mais le contenu commence aussi en haut), les colonnes CSS (`columns: 2` descend la colonne 1 avant la 2 : c'est l'ordre du DOM) et, plus
// généralement, tout groupe. Le tri se fait donc en trois niveaux : (1) les RÉGIONS (en-tête, contenu, pied…) entre elles, d'après leur position (haut puis gauche) ;
// (2) à l'intérieur d'une région, les colonnes CSS (colonne puis haut) ; (3) sinon les rangées (haut → bas, puis gauche → droite ; deux éléments sont dans la
// même rangée si leurs hauteurs se recouvrent d'au moins la moitié de la plus petite). Une paire est inversée quand l'ordre visuel contredit l'ordre du DOM.

/** items : [{ region, top, left, bottom, right, col?: { id, left, width } }] dans l'ordre du DOM. Rend { pairs, inverted, percent, regions: {nom: {n, pairs, inverted, percent}} }. */
export function tabOrderMetrics(items) {
  const n = items.length;
  const regionRect = new Map();
  for (const it of items) {
    const r = regionRect.get(it.region) ?? { top: Infinity, left: Infinity, first: Infinity };
    r.top = Math.min(r.top, it.regionTop ?? it.top); r.left = Math.min(r.left, it.regionLeft ?? it.left);
    regionRect.set(it.region, r);
  }
  const regionOrder = [...regionRect.entries()].sort((a, b) => (Math.abs(a[1].top - b[1].top) > 8 ? a[1].top - b[1].top : a[1].left - b[1].left)).map(([k]) => k);
  // première apparition dans le DOM : égalité de position → l'ordre du DOM tranche
  const domFirst = new Map(); items.forEach((it, i) => { if (!domFirst.has(it.region)) domFirst.set(it.region, i); });
  regionOrder.sort((a, b) => {
    const ra = regionRect.get(a), rb = regionRect.get(b);
    if (Math.abs(ra.top - rb.top) <= 8 && Math.abs(ra.left - rb.left) <= 8) return domFirst.get(a) - domFirst.get(b);
    return 0;
  });
  const rank = new Map(regionOrder.map((k, i) => [k, i]));

  // rangées et colonnes à l'intérieur de chaque région
  const pos = new Array(n);
  for (const region of regionOrder) {
    const idx = items.map((it, i) => (it.region === region ? i : -1)).filter((i) => i >= 0);
    const free = idx.filter((i) => !items[i].col);
    // rangées : tri par haut, regroupement par recouvrement vertical
    const rows = [];
    for (const i of [...free].sort((a, b) => items[a].top - items[b].top || items[a].left - items[b].left)) {
      const it = items[i];
      const row = rows.find((r) => { const overlap = Math.min(r.bottom, it.bottom) - Math.max(r.top, it.top); return overlap >= 0.5 * Math.min(r.bottom - r.top, it.bottom - it.top); });
      if (row) { row.items.push(i); row.top = Math.min(row.top, it.top); row.bottom = Math.max(row.bottom, it.bottom); }
      else rows.push({ top: it.top, bottom: it.bottom, items: [i] });
    }
    rows.sort((a, b) => a.top - b.top);
    rows.forEach((row, ri) => row.items.sort((a, b) => items[a].left - items[b].left).forEach((i, xi) => { pos[i] = [rank.get(region), 0, ri, xi, 0]; }));
    // colonnes CSS : colonne (d'après la position), puis haut
    const byCol = new Map();
    for (const i of idx.filter((i) => items[i].col)) { const k = items[i].col.id; (byCol.get(k) ?? byCol.set(k, []).get(k)).push(i); }
    let base = rows.length;
    for (const list of byCol.values()) {
      const c = items[list[0]].col;
      const colOf = (i) => Math.max(0, Math.floor((items[i].left - c.left + 1) / Math.max(1, c.width)));
      list.sort((a, b) => colOf(a) - colOf(b) || items[a].top - items[b].top).forEach((i, k) => { pos[i] = [rank.get(region), 0, base, 0, k]; });
      base += 1;
    }
  }
  const cmp = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; };
  const stats = (list) => { let pairs = 0, inv = 0; for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) { pairs++; if (cmp(pos[list[x]], pos[list[y]]) > 0) inv++; } return { pairs, inverted: inv, percent: pairs ? Math.round((1000 * inv) / pairs) / 10 : 0 }; };
  const all = stats(items.map((_, i) => i));
  const regions = {};
  for (const region of regionOrder) {
    const list = items.map((it, i) => (it.region === region ? i : -1)).filter((i) => i >= 0);
    regions[region] = { n: list.length, ...stats(list) };
  }
  return { n, ...all, regions };
}

/** Seuils (voir docs/CREER-UN-SKIN.md : mesurés sur des skins de référence, section « ordre de tabulation »). */
export const ORDER_THRESHOLDS = { warn: 3, error: 10, regionWarn: 15, regionError: 30, regionMin: 3 };

export function judgeOrder(m, t = ORDER_THRESHOLDS) {
  if (m.percent > t.error) return { level: "error", percent: m.percent };
  const worst = Object.entries(m.regions).filter(([, r]) => r.n >= t.regionMin).sort((a, b) => b[1].percent - a[1].percent)[0];
  if (worst && worst[1].percent > t.regionError) return { level: "error", region: worst[0], percent: worst[1].percent };
  if (m.percent > t.warn) return { level: "warning", percent: m.percent };
  if (worst && worst[1].percent > t.regionWarn) return { level: "warning", region: worst[0], percent: worst[1].percent };
  return { level: "ok", percent: m.percent };
}
