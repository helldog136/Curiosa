// Ordre visuel / ordre de tabulation (docs/SKINS.md §6.5, docs/CREER-UN-SKIN.md) : la mesure est une fonction pure, essayée ici sur des mises en page construites à la main.
import test from "node:test";
import assert from "node:assert/strict";

const { tabOrderMetrics, judgeOrder, ORDER_THRESHOLDS } = await import("../../testsupport/skins/visual/order.mjs");

/** Une rangée ou une colonne de `n` éléments frères sous un conteneur ; `place(i)` rend la boîte du i-ème (dans l'ordre du DOM). */
function group(n, place, region = "main", base = 100) {
  const boxes = {}, items = [];
  for (let i = 0; i < n; i++) { boxes[base + i] = place(i); items.push({ region, path: [1, base, base + 1 + i].slice(0, 2).concat(base + 10 + i), label: `${region}${i}` }); boxes[base + 10 + i] = boxes[base + i] = place(i); }
  return { boxes, items };
}
const row = (n, reverse = false) => group(n, (i) => { const x = reverse ? (n - 1 - i) * 100 : i * 100; return { top: 0, bottom: 40, left: x, right: x + 90 }; });
const col = (n) => group(n, (i) => ({ top: i * 50, bottom: i * 50 + 40, left: 0, right: 90 }));
const m = (g, extra = {}) => tabOrderMetrics({ items: g.items, boxes: g.boxes, ...extra });

test("une rangée et une colonne dans l'ordre du DOM : 0 % d'inversions", () => {
  assert.equal(m(row(6)).percent, 0);
  assert.equal(m(col(6)).percent, 0);
  assert.equal(judgeOrder(m(row(6))).level, "ok");
});

test("une rangée à l'envers (row-reverse) : 100 % dans son conteneur, donc une erreur, même quand elle ne pèse que peu dans la page", () => {
  const g = row(5, true);
  const r = m(g);
  assert.equal(r.percent, 100);
  assert.equal(r.containers[0].percent, 100);
  assert.equal(judgeOrder(r).level, "error");
  // la même rangée noyée dans une grande page bien ordonnée : le pourcentage de la page est faible, le conteneur le voit
  const calm = col(40);
  const items = [...g.items.map((it) => ({ ...it, path: [...it.path] })), ...calm.items.map((it) => ({ ...it, region: "footer", path: [2, ...it.path.slice(1)] }))];
  const boxes = { ...g.boxes, ...Object.fromEntries(Object.entries(calm.boxes).map(([k, v]) => [Number(k) + 1000, { ...v, top: v.top + 1000, bottom: v.bottom + 1000 }])) };
  const calmItems = calm.items.map((it) => ({ ...it, region: "footer", path: it.path.map((p) => p + 1000) }));
  const mixed = tabOrderMetrics({ items: [...g.items, ...calmItems], boxes });
  assert.ok(mixed.percent < ORDER_THRESHOLDS.error, `page entière : ${mixed.percent} %`);
  assert.equal(judgeOrder(mixed).level, "error", "le conteneur, lui, est à 100 %");
  void items;
});

test("une seule paire échangée parmi six : avertissement (6,7 %) ; deux : erreur", () => {
  const swap = (order) => group(6, (i) => { const at = order[i]; return { top: 0, bottom: 40, left: at * 100, right: at * 100 + 90 }; });
  assert.equal(judgeOrder(m(swap([0, 1, 2, 3, 4, 5]))).level, "ok");
  const one = m(swap([1, 0, 2, 3, 4, 5]));
  assert.equal(one.containers[0].percent, 6.7);
  assert.equal(judgeOrder(one).level, "warning");
  assert.equal(judgeOrder(m(swap([1, 0, 3, 2, 4, 5]))).level, "error");
});

test("deux blocs côte à côte de hauteurs inégales (colonne latérale, cartes de l'accueil) : 0 % — le tri brut haut/bas donnerait des inversions", () => {
  // DOM : bloc A (3 liens, haut de la colonne gauche) puis bloc B (3 liens à droite, commence plus bas et finit plus haut que la fin de A)
  const boxes = { 1: { top: 0, bottom: 600, left: 0, right: 200 }, 2: { top: 0, bottom: 600, left: 220, right: 900 } };
  const items = [];
  for (let i = 0; i < 3; i++) { boxes[10 + i] = { top: 20 + i * 150, bottom: 60 + i * 150, left: 10, right: 190 }; items.push({ region: "header", path: [0, 1, 10 + i], label: `a${i}` }); }
  for (let i = 0; i < 3; i++) { boxes[20 + i] = { top: 100 + i * 60, bottom: 140 + i * 60, left: 230, right: 890 }; items.push({ region: "main", path: [0, 2, 20 + i], label: `b${i}` }); }
  const r = tabOrderMetrics({ items, boxes });
  assert.equal(r.percent, 0);
  // à plat (mélange des rangées), ces mêmes éléments paraîtraient inversés : c'est le défaut du tri brut que la mesure évite
  const flat = [...items].sort((a, b) => boxes[a.path[2]].top - boxes[b.path[2]].top).map((it) => it.label);
  assert.notDeepEqual(flat, items.map((i) => i.label));
});

test("l'en-tête placé après le contenu : paires de branches inversées (erreur)", () => {
  const boxes = { 1: { top: 600, bottom: 700, left: 0, right: 900 }, 2: { top: 0, bottom: 580, left: 0, right: 900 }, 3: { top: 720, bottom: 760, left: 0, right: 900 } };
  const items = [];
  for (let i = 0; i < 3; i++) { boxes[10 + i] = { top: 620, bottom: 660, left: i * 100, right: i * 100 + 90 }; items.push({ region: "header", path: [0, 1, 10 + i] }); }
  for (let i = 0; i < 3; i++) { boxes[20 + i] = { top: 20 + i * 100, bottom: 60 + i * 100, left: 0, right: 90 }; items.push({ region: "main", path: [0, 2, 20 + i] }); }
  items.push({ region: "footer", path: [0, 3, 30] }); boxes[30] = { top: 730, bottom: 750, left: 0, right: 90 };
  const r = tabOrderMetrics({ items, boxes });
  assert.ok(r.percent > ORDER_THRESHOLDS.error, `${r.percent} %`);
  assert.equal(judgeOrder(r).level, "error");
});

test("colonnes CSS (maçonnerie) : le DOM descend la colonne avant de passer à la suivante, ce n'est pas une inversion", () => {
  // 6 cartes en 2 colonnes : 0,1,2 dans la colonne de gauche, 3,4,5 dans celle de droite
  const boxes = { 100: { top: 0, bottom: 500, left: 0, right: 600 } };
  const items = [];
  for (let i = 0; i < 6; i++) { const c = i < 3 ? 0 : 1; boxes[200 + i] = { top: (i % 3) * 120, bottom: (i % 3) * 120 + 100, left: c * 300, right: c * 300 + 280 }; boxes[300 + i] = boxes[200 + i]; items.push({ region: "main", path: [0, 100, 200 + i, 300 + i] }); }
  assert.ok(tabOrderMetrics({ items, boxes }).percent > 0, "sans l'exception, la mesure verrait des inversions");
  assert.equal(tabOrderMetrics({ items, boxes, columns: [100] }).percent, 0);
});

test("un élément qui contient l'autre, ou sans boîte connue, n'est pas compté ; moins de deux éléments : rien à mesurer", () => {
  const r = tabOrderMetrics({ items: [{ region: "main", path: [1, 2] }, { region: "main", path: [1, 2, 3] }], boxes: { 1: { top: 0, bottom: 1, left: 0, right: 1 }, 2: { top: 0, bottom: 1, left: 0, right: 1 }, 3: { top: 0, bottom: 1, left: 0, right: 1 } } });
  assert.equal(r.pairs, 0);
  assert.equal(tabOrderMetrics({ items: [], boxes: {} }).percent, 0);
  assert.deepEqual(ORDER_THRESHOLDS, { warn: 3, error: 10, containerWarn: 3, containerError: 10, containerMin: 3 }, "les seuils de 3 % et 10 % du §6.5 sont gardés");
});
