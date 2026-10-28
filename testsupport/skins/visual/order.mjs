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
  const total = { n: items.length, pairs: 0, inverted: 0, percent: 0 };
  /** conteneur (plus proche ancêtre commun) → { branches: Map(id de branche → rang de première apparition), region } */
  const containers = new Map();
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
      if (bad && samples.length < 3) samples.push([items[i].label ?? i, items[j].label ?? j]);
      const c = k > 0 ? pa[k - 1] : -1;
      const entry = containers.get(c) ?? containers.set(c, { branches: new Map(), region: items[i].region }).get(c);
      if (!entry.branches.has(pa[k])) entry.branches.set(pa[k], i);
      if (!entry.branches.has(pb[k])) entry.branches.set(pb[k], j);
    }
  }
  // par conteneur : parmi les paires de BRANCHES (éléments frères qui contiennent des éléments cliquables), combien sont à l'envers ?
  const list = [];
  for (const [id, entry] of containers) {
    const ids = [...entry.branches.entries()].sort((a, b) => a[1] - b[1]).map(([b]) => b);
    if (ids.length < 3 && !(ids.length === 2)) continue;
    let pairs = 0, inv = 0;
    for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) { pairs++; if (boxes[ids[x]] && boxes[ids[y]] && inverted(boxes[ids[x]], boxes[ids[y]])) inv++; }
    list.push({ id, branches: ids.length, pairs, inverted: inv, percent: pairs ? Math.round((1000 * inv) / pairs) / 10 : 0, region: entry.region });
  }
  total.percent = total.pairs ? Math.round((1000 * total.inverted) / total.pairs) / 10 : 0;
  list.sort((a, b) => b.percent - a.percent);
  return { ...total, containers: list, samples };
}

/**
 * Seuils du §6.5 (avertissement au-delà de 3 %, erreur au-delà de 10 %), appliqués à la page entière ET au pire conteneur (au moins 3 branches ; deux branches
 * seulement sont jugées si elles sont à l'envers l'une de l'autre). Mesuré (docs/CREER-UN-SKIN.md) : la page entière dilue une inversion locale (un menu à l'envers = 14 % de la page, 100 % de
 * son conteneur), le conteneur la montre.
 */
export const ORDER_THRESHOLDS = { warn: 3, error: 10, containerWarn: 3, containerError: 10, containerMin: 3 };

export function judgeOrder(m, t = ORDER_THRESHOLDS) {
  const worst = m.containers.find((c) => c.branches >= t.containerMin);
  const two = m.containers.find((c) => c.branches === 2 && c.percent === 100);
  if (m.percent > t.error) return { level: "error", percent: m.percent };
  if (worst && worst.percent > t.containerError) return { level: "error", region: worst.region, percent: worst.percent };
  if (two) return { level: "error", region: two.region, percent: two.percent };
  if (m.percent > t.warn) return { level: "warning", percent: m.percent };
  if (worst && worst.percent > t.containerWarn) return { level: "warning", region: worst.region, percent: worst.percent };
  return { level: "ok", percent: m.percent };
}
