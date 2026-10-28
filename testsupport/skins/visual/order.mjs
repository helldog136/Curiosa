// Ordre VISUEL des éléments focalisables comparé à l'ordre de TABULATION (= ordre du DOM) : docs/SKINS.md §6.5.
// Fonction PURE (testée sans navigateur).
//
// Écart avec l'énoncé du §6.5 (« haut → bas puis gauche → droite » sur tous les éléments à la fois) : ce tri brut condamne à tort des mises en page normales. Mesuré sur le
// skin de base et sur une colonne latérale : deux blocs côte à côte d'inégales hauteurs (cartes de l'accueil, colonne de menu et contenu) mélangent leurs lignes alors que
// chacun se lit bien dans l'ordre du DOM. La mesure compare donc, pour chaque paire d'éléments (a avant b dans le DOM), leurs deux BRANCHES FRÈRES juste sous leur plus proche
// ancêtre commun : la paire est inversée si la branche de b est visuellement avant celle de a (entièrement au-dessus, ou dans la même rangée et entièrement à gauche).
// C'est exactement ce que `order`, `row-reverse`, `grid-area` ou un positionnement changent. Sont ignorés : les ancêtres `display: contents` (sans boîte) et les conteneurs en colonnes CSS
// (`columns`), où l'ordre du DOM descend la colonne avant de passer à la suivante.
//
// items : [{ region, path: [id, …] }] dans l'ordre du DOM (path = ancêtres depuis la racine, puis l'élément) · boxes : { id: { top, left, bottom, right } } · columns : [id, …]
const TOL = 1;

function inverted(a, b) {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const sameRow = overlap > Math.max(2, 0.5 * Math.min(a.bottom - a.top, b.bottom - b.top));
  if (sameRow) return b.right <= a.left + TOL && b.left < a.left;
  return b.bottom <= a.top + TOL && b.top < a.top;
}

export function tabOrderMetrics({ items, boxes, columns = [] }) {
  const cols = new Set(columns);
  const stat = () => ({ n: 0, pairs: 0, inverted: 0, percent: 0 });
  const total = stat(); total.n = items.length;
  const regions = {};
  for (const it of items) (regions[it.region] ??= stat()).n++;
  const samples = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const pa = items[i].path, pb = items[j].path;
      let k = 0;
      while (k < pa.length && k < pb.length && pa[k] === pb[k]) k++;
      if (k >= pa.length || k >= pb.length) continue;       // l'un contient l'autre
      if (k > 0 && cols.has(pa[k - 1])) continue;
      const A = boxes[pa[k]], B = boxes[pb[k]];
      if (!A || !B) continue;
      const bad = inverted(A, B);
      total.pairs++; if (bad) total.inverted++;
      if (items[i].region === items[j].region) { const r = regions[items[i].region]; r.pairs++; if (bad) r.inverted++; }
      if (bad && samples.length < 3) samples.push([items[i].label ?? i, items[j].label ?? j]);
    }
  }
  const pct = (s) => { s.percent = s.pairs ? Math.round((1000 * s.inverted) / s.pairs) / 10 : 0; };
  pct(total); Object.values(regions).forEach(pct);
  return { ...total, regions, samples };
}

/** Seuils du §6.5 (avertissement au-delà de 3 %, erreur au-delà de 10 %), appliqués à la page ET à chaque région d'au moins 3 éléments : une inversion locale (un menu à l'envers) serait sinon diluée par le reste de la page. */
export const ORDER_THRESHOLDS = { warn: 3, error: 10, regionWarn: 3, regionError: 10, regionMin: 3 };

export function judgeOrder(m, t = ORDER_THRESHOLDS) {
  const worst = Object.entries(m.regions).filter(([, r]) => r.n >= t.regionMin).sort((a, b) => b[1].percent - a[1].percent)[0];
  if (m.percent > t.error) return { level: "error", percent: m.percent };
  if (worst && worst[1].percent > t.regionError) return { level: "error", region: worst[0], percent: worst[1].percent };
  if (m.percent > t.warn) return { level: "warning", percent: m.percent };
  if (worst && worst[1].percent > t.regionWarn) return { level: "warning", region: worst[0], percent: worst[1].percent };
  return { level: "ok", percent: m.percent };
}
