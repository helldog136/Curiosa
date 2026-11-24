/**
 * THE PATTERN CHECKER (core 0.48.0): reads a skin's pattern file (`patterns/<name>.json`, docs/OVERLAY-ANIMATIONS.md "Patterns") with the closed grammar below. Run
 * when a skin is validated, at installation, at every reading of an installed skin and by `skin:check`. PURE: no file, no network; the bytes (their count) are passed in.
 *
 * A pattern is DATA and nothing but numbers: `{ "patternContract": 1, "domain": [W, H], "cells": [ { "p": [[x, y], …3 to 12 pairs], "tone": 0..1, "rank": optional } ] }`.
 * The principle: a skin gets more power over HOW an element is drawn, never over DATA. A pattern is never served raw, holds no code and no address, and cannot read or
 * change anything of the site. Keys are WHITELISTED (never an untrusted object spread): an unknown key is a warning and is dropped, `$comment` is allowed.
 *
 * What is refused (errors): a file that is not JSON of this shape, a domain out of bounds, a coordinate that is not a finite number inside the domain (0.5 % tolerance,
 * then clamped), a piece with fewer than 3 or more than 12 vertices, repeated vertices, a tiny piece (under 0.05 % of the domain), a spike (interior angle under 3
 * degrees), a polygon that crosses itself, two pieces on top of each other, more than 160 pieces or 1500 vertices, a normaliser blow-up (T-junction splits above 4 times
 * the vertices). What is only warned: a sharp corner (under 12 degrees), a window that covers less than 97 % of its domain, more pieces than the engine draws (120),
 * a rank given to some pieces only (then no rank is used).
 */
import { PATTERN } from "./spec";
import { labelPoint, normalisePattern, pointInsideDistance, signedArea, type PatternGraph, type Pt } from "./patternGraph";

export type PatternCode = "pattern-invalid" | "pattern-too-large" | "pattern-cells" | "pattern-cells-cap" | "pattern-polygon" | "pattern-angle" | "pattern-overlap" | "pattern-coverage" | "pattern-contract-newer" | "pattern-ignored" | "pattern-loop";
export type PatternIssue = { code: PatternCode; path: string; severity: "error" | "warning" };
/** A checked pattern: pieces counter-clockwise, numbers rounded to 2 decimals and clamped to the domain, only whitelisted keys. */
export type CleanPattern = { patternContract: number; domain: [number, number]; cells: { p: Pt[]; tone: number; rank: number | null }[] };
export type PatternCheck = { ok: boolean; pattern: CleanPattern | null; graph: PatternGraph | null; issues: PatternIssue[]; newer?: boolean };

const TOP = new Set(["patternContract", "domain", "cells", "$comment"]);
const CELL = new Set(["p", "tone", "rank", "$comment"]);
const fin = (n: unknown): n is number => typeof n === "number" && isFinite(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

const orient = (a: Pt, b: Pt, c: Pt): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSeg = (a: Pt, b: Pt, p: Pt): boolean => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
/** Do two segments meet at all (crossing, touching, overlapping)? */
function meets(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
}
/** Do two segments cross strictly inside both (not at an end, not along each other)? */
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

export function checkPattern(raw: unknown, opts: { bytes?: number } = {}): PatternCheck {
  const issues: PatternIssue[] = [];
  // at most 40 findings, but a warning never takes the place of an error: a full list gives its last warning's room to an error, and errors are listed first
  const add = (code: PatternCode, path: string, severity: "error" | "warning" = "error") => {
    const item: PatternIssue = { code, path: path.slice(0, 80), severity };
    if (issues.length < 40) { issues.push(item); return; }
    if (severity === "error") { const w = issues.map((i) => i.severity).lastIndexOf("warning"); if (w >= 0) issues.splice(w, 1, item); }
  };
  const errorsFirst = () => { issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)); };
  const fail = (): PatternCheck => { errorsFirst(); return { ok: false, pattern: null, graph: null, issues }; };
  if (typeof opts.bytes === "number" && opts.bytes > PATTERN.fileBytes) { add("pattern-too-large", "file"); return fail(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { add("pattern-invalid", "shape"); return fail(); }
  const r = raw as Record<string, unknown>;
  const c = r.patternContract;
  if (!Number.isInteger(c) || (c as number) < 1) { add("pattern-invalid", "patternContract"); return fail(); }
  if ((c as number) > PATTERN.contract) { add("pattern-contract-newer", "patternContract", "warning"); return { ok: true, pattern: null, graph: null, issues, newer: true }; }
  for (const k of Object.keys(r)) if (!TOP.has(k)) add("pattern-ignored", k.slice(0, 40), "warning");
  const d = r.domain;
  if (!Array.isArray(d) || d.length !== 2 || !fin(d[0]) || !fin(d[1]) || d[0] < PATTERN.domainMin || d[0] > PATTERN.domainMax || d[1] < PATTERN.domainMin || d[1] > PATTERN.domainMax) { add("pattern-invalid", "domain"); return fail(); }
  const W = d[0] as number, H = d[1] as number, aspect = W / H;
  if (aspect < PATTERN.aspectMin || aspect > PATTERN.aspectMax) { add("pattern-invalid", "domain.aspect"); return fail(); }
  if (!Array.isArray(r.cells) || r.cells.length < 1 || r.cells.length > PATTERN.maxCellsFile) { add("pattern-cells", "cells"); return fail(); }
  if (r.cells.length > PATTERN.maxPieces) add("pattern-cells-cap", "cells", "warning");

  const mx = W * PATTERN.margin, my = H * PATTERN.margin, domainArea = W * H;
  const cells: CleanPattern["cells"] = [];
  let vertices = 0, ranked = 0, bad = false;
  (r.cells as unknown[]).forEach((rawCell, ci) => {
    const path = `cells.${ci}`;
    if (!rawCell || typeof rawCell !== "object" || Array.isArray(rawCell)) { add("pattern-invalid", path); bad = true; return; }
    const o = rawCell as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!CELL.has(k)) add("pattern-ignored", `${path}.${k}`.slice(0, 60), "warning");
    if (!Array.isArray(o.p) || o.p.length < PATTERN.minPieceVertices || o.p.length > PATTERN.maxPieceVertices) { add("pattern-polygon", `${path}.p`); bad = true; return; }
    vertices += o.p.length;
    const pts: Pt[] = [];
    for (const q of o.p as unknown[]) {
      if (!Array.isArray(q) || q.length !== 2 || !fin(q[0]) || !fin(q[1]) || q[0] < -mx || q[0] > W + mx || q[1] < -my || q[1] > H + my) { add("pattern-invalid", `${path}.p`); bad = true; return; }
      pts.push([Math.min(W, Math.max(0, r2(q[0]))), Math.min(H, Math.max(0, r2(q[1])))]);
    }
    if (!fin(o.tone) || o.tone < 0 || o.tone > 1) { add("pattern-invalid", `${path}.tone`); bad = true; return; }
    let rank: number | null = null;
    if (o.rank !== undefined) { if (!fin(o.rank) || Math.abs(o.rank) > 1e6) { add("pattern-invalid", `${path}.rank`); bad = true; return; } rank = o.rank; ranked++; }
    // repeated vertices (also last = first), tiny pieces
    for (let i = 0; i < pts.length; i++) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; if (a[0] === b[0] && a[1] === b[1]) { add("pattern-polygon", `${path}.p`); bad = true; return; } }
    // a polygon that crosses or touches itself: no two non-adjacent sides may meet (at most 66 pairs for 12 sides)
    const n = pts.length;
    for (let i = 0; i < n && !bad; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (meets(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) { add("pattern-polygon", `${path}.self`); bad = true; break; }
    }
    if (bad) return;
    const sa = signedArea(pts);
    if (Math.abs(sa) <= domainArea * PATTERN.minArea) { add("pattern-polygon", `${path}.area`); bad = true; return; }
    if (sa < 0) pts.reverse();   // normalise the winding: counter-clockwise
    // the sharpest interior angle (counter-clockwise: the inside is on the left of each side)
    let minAngle = Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const v = pts[i]!, u = pts[(i + n - 1) % n]!, w = pts[(i + 1) % n]!, ax = u[0] - v[0], ay = u[1] - v[1], bx = w[0] - v[0], by = w[1] - v[1];
      let th = Math.atan2(bx * ay - by * ax, bx * ax + by * ay); if (th < 0) th += Math.PI * 2;
      minAngle = Math.min(minAngle, th);
    }
    const deg = (minAngle * 180) / Math.PI;
    if (deg < PATTERN.angleError) { add("pattern-polygon", `${path}.angle`); bad = true; return; }
    if (deg < PATTERN.angleWarn) add("pattern-angle", `${path}.angle`, "warning");
    cells.push({ p: pts, tone: o.tone, rank });
  });
  if (vertices > PATTERN.maxVerticesFile) { add("pattern-cells", "vertices"); bad = true; }
  if (bad) return fail();
  if (ranked > 0 && ranked < cells.length) add("pattern-ignored", "cells.rank", "warning");   // a rank on some pieces only: no rank is used

  // pieces on top of each other: a bounding-box prefilter, then a proper crossing, or a vertex, a side middle or an inner point of one strictly inside the other
  const tol = Math.max(W, H) * 0.0002, box = cells.map((q) => { let a = Infinity, b = Infinity, c2 = -Infinity, e = -Infinity; for (const p of q.p) { a = Math.min(a, p[0]); b = Math.min(b, p[1]); c2 = Math.max(c2, p[0]); e = Math.max(e, p[1]); } return [a, b, c2, e] as const; });
  const probes = cells.map((q) => { const out: Pt[] = [labelPoint(q.p, 0.02 * Math.sqrt(Math.abs(signedArea(q.p)))).p];   // (the area centroid of a concave piece may lie outside it: never a probe)
     for (let i = 0; i < q.p.length; i++) { const a = q.p[i]!, b = q.p[(i + 1) % q.p.length]!; out.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); } return out; });
  const overlap = (i: number, j: number): boolean => {
    const A = cells[i]!.p, B = cells[j]!.p;
    for (let a = 0; a < A.length; a++) for (let b = 0; b < B.length; b++) if (crosses(A[a]!, A[(a + 1) % A.length]!, B[b]!, B[(b + 1) % B.length]!)) return true;
    for (const p of probes[i]!) if (pointInsideDistance(p[0], p[1], B) > tol) return true;
    for (const p of probes[j]!) if (pointInsideDistance(p[0], p[1], A) > tol) return true;
    return false;
  };
  for (let i = 0; i < cells.length && !bad; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = box[i]!, b = box[j]!;
    if (a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) continue;
    if (overlap(i, j)) { add("pattern-overlap", `cells.${i}+${j}`); bad = true; break; }
  }
  if (bad) return fail();
  const covered = cells.reduce((s, q) => s + Math.abs(signedArea(q.p)), 0) / domainArea;
  if (covered < PATTERN.coverage) add("pattern-coverage", `${Math.round(covered * 100)}`, "warning");

  // the normaliser: it refuses what only shows up once the pieces are welded (a split that blows up the vertices, a side shared three times)
  const pattern: CleanPattern = { patternContract: c as number, domain: [W, H], cells };
  const norm = normalisePattern([W, H], cells);
  if (!norm.ok) { add(norm.reason === "overlap" ? "pattern-overlap" : "pattern-polygon", `normalise.${norm.reason}`); return fail(); }
  // the engine draws a graph only within its own bounds (spec.ts PATTERN, graphOk): refuse here what it would silently replace by the simple mosaic
  const g = norm.graph;
  if (g.v.length > PATTERN.maxVertices || g.edges.length > PATTERN.maxEdges) { add("pattern-loop", "graph.size"); return fail(); }
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i]!.loop.length > PATTERN.maxLoop) { add("pattern-loop", `cells.${i}`); return fail(); }
  errorsFirst();
  return { ok: true, pattern, graph: g, issues };
}

/** What a recipe needs to know about each pattern file it names (the caller read and checked the files): its domain and its pieces, or that it is written for a newer contract. */
export type PatternFileInfo = { w: number; h: number; cells: number } | { newer: true };
export const patternInfoOf = (c: PatternCheck): PatternFileInfo | null => (c.newer ? { newer: true } : c.ok && c.pattern ? { w: c.pattern.domain[0], h: c.pattern.domain[1], cells: c.pattern.cells.length } : null);
