/**
 * THE PATTERN NORMALISER (core 0.48.0): turns the pieces of a skin's pattern (a list of polygons in a domain of the skin's own units) into the PLANAR GRAPH the
 * mosaic engine draws. Pure TypeScript, run on the server (when a skin is read) and in Node tests, NEVER inside the engine text: the engine only receives the result,
 * as numbers, and re-bounds it itself (second lock).
 *
 * What it does, in this order:
 *  1. SNAP the vertices (a grid hash, eps = 0.2 % of the domain): two pieces that were drawn with a hair of difference share one vertex.
 *  2. Make every piece counter-clockwise (positive area in x right / y up maths; on screen this reads clockwise, the order is only a convention).
 *  3. SPLIT every edge at the vertices that touch it (T-junctions): the edge graph becomes planar, a lead shared by two pieces of different sizes is made of
 *     sub-edges that each have TWO owners. Without this, the long side of a big piece would be drawn as a border (1.5 x thick) all along its neighbours.
 *  4. List the unique sub-edges: one owner = BORDER (the outside of the window), two owners = an interior lead, more or the same direction twice = refused.
 *  5. JOIN collinear continuations into CHAINS (a straight run split at T-junctions is one chain, bent runs are cut where they leave the straight line), so
 *     a long straight lead is ONE stroke: the engine bows a chain once, not each sub-edge on its own.
 *  6. Per piece: area, centroid (for the lighting order), LABEL POINT (the pole of inaccessibility: always inside, even in an L or a T) and INRADIUS.
 *  7. The OUTLINE: the biggest closed loop of border sub-edges (the silhouette; `shape` is ignored for a pattern).
 *
 * Only numbers come out. The engine never reads anything else from a skin's pattern.
 */
export type Pt = [number, number];
export type RawCell = { p: Pt[]; tone: number; rank?: number | null };
/** A sub-edge between two vertices (`a` < `b`), the chain it belongs to, and whether it is on the outside of the window. */
export type GraphEdge = { a: number; b: number; border: boolean; chain: number };
/** A piece: its loop of vertex ids (after the T-junction split), the edge id of each side (`e[i]` joins `loop[i]` and `loop[i+1]`), and its measures. */
export type GraphCell = { loop: number[]; e: number[]; tone: number; rank: number | null; area: number; cen: Pt; lp: Pt; ri: number };
/** A straight run of sub-edges drawn as ONE lead stroke: `ids` are its vertices in order, `e[i]` joins `ids[i]` and `ids[i+1]`. */
export type GraphChain = { ids: number[]; e: number[]; border: boolean };
export type PatternGraph = { domain: [number, number]; v: Pt[]; edges: GraphEdge[]; chains: GraphChain[]; cells: GraphCell[]; outline: number[] };
export type NormaliseFail = "degenerate" | "blowup" | "overlap" | "nonmanifold" | "empty";
export type NormaliseResult = { ok: true; graph: PatternGraph; verticesBefore: number; verticesAfter: number } | { ok: false; reason: NormaliseFail };

/** Tuning of the normaliser (the same numbers in the tests). */
export const GRAPH = {
  /** Snap distance, as a fraction of the larger side of the domain. */
  snap: 0.002,
  /** The vertex count after the T-junction split may not exceed this multiple of the count before. */
  blowup: 4,
  /** Two sub-edges continue each other when the turn between them is under about 8 degrees (cosine of the angle between them, reversed). */
  collinearCos: Math.cos((8 * Math.PI) / 180),
  /** A chain may leave the straight line between its ends by this fraction of its length (a closed curve is cut into straight pieces). */
  chainDeviation: 0.015,
  /** Label point precision, as a fraction of the smaller side of the piece. */
  labelPrecision: 0.01,
} as const;

const fin = (n: unknown): n is number => typeof n === "number" && isFinite(n);
const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Signed area (shoelace): positive when the loop turns counter-clockwise in x right / y up maths. */
export function signedArea(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}
/** Area centroid of a simple polygon (falls back to the mean of the vertices for a degenerate one). */
export function areaCentroid(p: readonly Pt[]): Pt {
  const a2 = signedArea(p) * 6;
  if (Math.abs(a2) < 1e-12) { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; }
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!, f = a[0] * b[1] - b[0] * a[1]; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; }
  return [cx / a2, cy / a2];
}
const segDist2 = (px: number, py: number, a: Pt, b: Pt): number => {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) { const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } }
  dx = px - x; dy = py - y;
  return dx * dx + dy * dy;
};
/** Distance from a point to a polygon outline, positive inside and negative outside. */
export function pointInsideDistance(px: number, py: number, p: readonly Pt[]): number {
  let inside = false, min = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i]!, b = p[j]!;
    if ((a[1] > py) !== (b[1] > py) && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    min = Math.min(min, segDist2(px, py, a, b));
  }
  const d = Math.sqrt(min);
  return inside ? d : -d;
}
/** The pole of inaccessibility (the point of a polygon farthest from its sides), by quadtree refinement, deterministic. Its distance is the INRADIUS. */
export function labelPoint(p: readonly Pt[], precision: number): { p: Pt; d: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of p) { minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]); }
  const w = maxX - minX, h = maxY - minY, size = Math.min(w, h);
  if (!(size > 0)) return { p: [minX, minY], d: 0 };
  type Q = { x: number; y: number; h: number; d: number; max: number };
  const mk = (x: number, y: number, hh: number): Q => { const d = pointInsideDistance(x, y, p); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
  let half = size / 2;
  const queue: Q[] = [];
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) queue.push(mk(x + half, y + half, half));
  const c = areaCentroid(p);
  let best = mk(c[0], c[1], 0);
  const bb = mk(minX + w / 2, minY + h / 2, 0);
  if (bb.d > best.d) best = bb;
  let guard = 0;
  while (queue.length && guard++ < 4000) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.max > queue[bi]!.max) bi = i;
    const cell = queue.splice(bi, 1)[0]!;
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    half = cell.h / 2;
    queue.push(mk(cell.x - half, cell.y - half, half), mk(cell.x + half, cell.y - half, half), mk(cell.x - half, cell.y + half, half), mk(cell.x + half, cell.y + half, half));
  }
  return { p: [best.x, best.y], d: Math.max(0, best.d) };
}

export function normalisePattern(domain: readonly [number, number], raw: readonly RawCell[]): NormaliseResult {
  if (!raw.length || !fin(domain[0]) || !fin(domain[1]) || domain[0] <= 0 || domain[1] <= 0) return { ok: false, reason: "empty" };
  const eps = GRAPH.snap * Math.max(domain[0], domain[1]);
  // 1. snap the vertices (grid hash: a vertex joins the first vertex within eps found in its 3 x 3 neighbourhood of buckets)
  const V: Pt[] = [], buckets = new Map<string, number[]>();
  const bkey = (i: number, j: number) => i + "," + j;
  const snap = (p: Pt): number => {
    const bi = Math.floor(p[0] / eps), bj = Math.floor(p[1] / eps);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const id of buckets.get(bkey(bi + di, bj + dj)) ?? []) if (dist(V[id]!, p) <= eps) return id;
    const id = V.length; V.push([p[0], p[1]]);
    const k = bkey(bi, bj), l = buckets.get(k); if (l) l.push(id); else buckets.set(k, [id]);
    return id;
  };
  let before = 0;
  const loops: number[][] = [];
  for (const c of raw) {
    if (!Array.isArray(c.p) || c.p.length < 3 || !c.p.every((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]))) return { ok: false, reason: "degenerate" };
    before += c.p.length;
    const ids: number[] = [];
    for (const q of c.p) { const id = snap(q as Pt); if (ids[ids.length - 1] !== id) ids.push(id); }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length < 3) return { ok: false, reason: "degenerate" };
    // 2. counter-clockwise
    const sa = signedArea(ids.map((i) => V[i]!));
    if (Math.abs(sa) < eps * eps) return { ok: false, reason: "degenerate" };
    if (sa < 0) ids.reverse();
    loops.push(ids);
  }
  // 3. T-junctions: split an edge at every vertex that lies on it (a coarse grid of the vertices, only the buckets under the edge are visited)
  const G = 32, gx = (x: number) => Math.max(0, Math.min(G - 1, Math.floor((x / domain[0]) * G))), gy = (y: number) => Math.max(0, Math.min(G - 1, Math.floor((y / domain[1]) * G)));
  const grid: number[][] = Array.from({ length: G * G }, () => []);
  V.forEach((q, id) => grid[gy(q[1]) * G + gx(q[0])]!.push(id));
  const split: number[][] = [];
  let after = 0;
  for (const ids of loops) {
    const out: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const ia = ids[i]!, ib = ids[(i + 1) % ids.length]!, a = V[ia]!, b = V[ib]!, dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
      out.push(ia);
      const hits: { id: number; t: number }[] = [];
      const x0 = gx(Math.min(a[0], b[0]) - eps), x1 = gx(Math.max(a[0], b[0]) + eps), y0 = gy(Math.min(a[1], b[1]) - eps), y1 = gy(Math.max(a[1], b[1]) + eps);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) for (const id of grid[yy * G + xx]!) {
        if (id === ia || id === ib) continue;
        const q = V[id]!, t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2;
        if (t <= 0 || t >= 1) continue;
        if (segDist2(q[0], q[1], a, b) <= eps * eps) hits.push({ id, t });
      }
      hits.sort((m, n) => m.t - n.t || m.id - n.id);
      for (const h of hits) if (out[out.length - 1] !== h.id) out.push(h.id);
    }
    after += out.length;
    split.push(out);
  }
  if (after > before * GRAPH.blowup) return { ok: false, reason: "blowup" };
  // 4. the unique sub-edges and their owners
  const edges: GraphEdge[] = [], eIndex = new Map<string, number>(), owners: number[] = [], seenDir = new Set<string>();
  const cellEdges: number[][] = [];
  for (const ids of split) {
    const es: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const u = ids[i]!, w = ids[(i + 1) % ids.length]!;
      if (u === w) return { ok: false, reason: "degenerate" };
      const dk = u + ">" + w;
      if (seenDir.has(dk)) return { ok: false, reason: "overlap" };   // two pieces walk the same side the same way: they lie on top of each other
      seenDir.add(dk);
      const k = Math.min(u, w) + ":" + Math.max(u, w);
      let ei = eIndex.get(k);
      if (ei === undefined) { ei = edges.length; eIndex.set(k, ei); edges.push({ a: Math.min(u, w), b: Math.max(u, w), border: true, chain: -1 }); owners.push(0); }
      if (++owners[ei]! > 2) return { ok: false, reason: "nonmanifold" };
      es.push(ei);
    }
    cellEdges.push(es);
  }
  edges.forEach((e, i) => { e.border = owners[i]! < 2; });
  // 5. chains: at each vertex, pair the sub-edges that continue each other in a straight line (same side of the window), then cut the runs that bend
  const inc: number[][] = V.map(() => []);
  edges.forEach((e, i) => { inc[e.a]!.push(i); inc[e.b]!.push(i); });
  const other = (ei: number, v: number) => (edges[ei]!.a === v ? edges[ei]!.b : edges[ei]!.a);
  const link = V.map(() => new Map<number, number>());
  for (let v = 0; v < V.length; v++) {
    const list = inc[v]!;
    if (list.length < 2) continue;
    const cand: { i: number; j: number; align: number }[] = [];
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const ei = list[x]!, ej = list[y]!;
      if (edges[ei]!.border !== edges[ej]!.border) continue;
      const a = V[other(ei, v)]!, b = V[other(ej, v)]!, p = V[v]!, la = dist(a, p), lb = dist(b, p);
      if (!(la > 0) || !(lb > 0)) continue;
      const align = -(((a[0] - p[0]) * (b[0] - p[0]) + (a[1] - p[1]) * (b[1] - p[1])) / (la * lb));
      if (align >= GRAPH.collinearCos) cand.push({ i: ei, j: ej, align });
    }
    cand.sort((m, n) => n.align - m.align || m.i - n.i || m.j - n.j);
    for (const c of cand) if (!link[v]!.has(c.i) && !link[v]!.has(c.j)) { link[v]!.set(c.i, c.j); link[v]!.set(c.j, c.i); }
  }
  const visited = new Array<boolean>(edges.length).fill(false), chains: GraphChain[] = [];
  const cut = (ids: number[], es: number[], border: boolean): void => {
    // a run is one chain when no vertex leaves the line between its ends by more than a small part of its length; otherwise cut at the farthest vertex
    const rec = (i: number, j: number): void => {
      if (j - i < 2) { chains.push({ ids: ids.slice(i, j + 1), e: es.slice(i, j), border }); return; }
      const A = V[ids[i]!]!, B = V[ids[j]!]!, len = dist(A, B);
      let k = -1, dev = -1;
      for (let m = i + 1; m < j; m++) {
        const P = V[ids[m]!]!, d = len > 1e-9 ? Math.abs((B[0] - A[0]) * (A[1] - P[1]) - (A[0] - P[0]) * (B[1] - A[1])) / len : dist(A, P);
        if (d > dev) { dev = d; k = m; }
      }
      if (len > 1e-9 && dev <= GRAPH.chainDeviation * len + eps) chains.push({ ids: ids.slice(i, j + 1), e: es.slice(i, j), border });
      else { rec(i, k); rec(k, j); }
    };
    rec(0, es.length);
  };
  for (let s = 0; s < edges.length; s++) {
    if (visited[s]) continue;
    // walk to one end of the run, then along it to the other
    let first = s, startV = edges[s]!.a, guard = 0, closed = false;
    for (;;) {
      const nxt = link[startV]!.get(first);
      if (nxt === undefined) break;
      startV = other(nxt, startV); first = nxt;
      if (first === s) { closed = true; break; }
      if (++guard > edges.length) break;
    }
    const ids: number[] = [], es: number[] = [];
    // an open run starts at the end of `first` that has no partner; a closed one starts anywhere
    let cur = closed ? s : first, v0 = closed ? edges[s]!.a : startV;
    ids.push(v0);
    guard = 0;
    for (;;) {
      visited[cur] = true; es.push(cur);
      const v1 = other(cur, v0); ids.push(v1);
      const nxt = link[v1]!.get(cur);
      if (nxt === undefined || visited[nxt] || ++guard > edges.length) break;
      cur = nxt; v0 = v1;
    }
    cut(ids, es, edges[s]!.border);
  }
  chains.forEach((c, ci) => { for (const ei of c.e) edges[ei]!.chain = ci; });
  // 6. the measures of each piece
  const cells: GraphCell[] = split.map((ids, i) => {
    const pts = ids.map((v) => V[v]!), box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const q of pts) { box.minX = Math.min(box.minX, q[0]); box.minY = Math.min(box.minY, q[1]); box.maxX = Math.max(box.maxX, q[0]); box.maxY = Math.max(box.maxY, q[1]); }
    const lab = labelPoint(pts, GRAPH.labelPrecision * Math.min(box.maxX - box.minX, box.maxY - box.minY)), c = raw[i]!;
    return { loop: ids, e: cellEdges[i]!, tone: Math.min(1, Math.max(0, c.tone)), rank: fin(c.rank) ? (c.rank as number) : null, area: signedArea(pts), cen: areaCentroid(pts), lp: lab.p, ri: lab.d };
  });
  // 7. the outline: border sub-edges walked in the direction their only owner walks them, the biggest closed loop wins
  const out = new Map<number, number[]>();
  split.forEach((ids, ci) => cellEdges[ci]!.forEach((ei, k) => { if (edges[ei]!.border) { const u = ids[k]!, w = ids[(k + 1) % ids.length]!; (out.get(u) ?? out.set(u, []).get(u)!).push(w); } }));
  let outline: number[] = [], bestArea = -1;
  const used = new Set<string>();
  for (const [start, nexts] of [...out.entries()].sort((m, n) => m[0] - n[0])) {
    for (const first of nexts) {
      if (used.has(start + ">" + first)) continue;
      const loop = [start]; let u = start, w = first, guard = 0;
      while (guard++ < V.length + 2) {
        used.add(u + ">" + w);
        if (w === start) break;
        loop.push(w);
        const cands = (out.get(w) ?? []).filter((x) => !used.has(w + ">" + x));
        if (!cands.length) { loop.length = 0; break; }
        u = w; w = cands[0]!;
      }
      if (loop.length >= 3) { const a = signedArea(loop.map((v) => V[v]!)); if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); outline = a < 0 ? loop.slice().reverse() : loop; } }
    }
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000, rp = (p: Pt): Pt => [r3(p[0]), r3(p[1])];
  return {
    ok: true, verticesBefore: before, verticesAfter: after,
    graph: { domain: [domain[0], domain[1]], v: V.map(rp), edges, chains, cells: cells.map((c) => ({ ...c, area: r3(c.area), cen: rp(c.cen), lp: rp(c.lp), ri: r3(c.ri) })), outline },
  };
}

/** Which variant of a pattern fits a body: the one whose aspect ratio (w / h of the domain) is the nearest in log scale to the body's. Ties go to the first. */
export function pickVariant<T extends { domain: readonly [number, number] }>(variants: readonly T[], w: number, h: number): number {
  const target = Math.log(w / h);
  let best = 0, bestD = Infinity;
  variants.forEach((v, i) => { const d = Math.abs(Math.log(v.domain[0] / v.domain[1]) - target); if (d < bestD - 1e-12) { bestD = d; best = i; } });
  return best;
}
