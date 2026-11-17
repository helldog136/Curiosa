/* eslint-disable no-var, @typescript-eslint/no-explicit-any */
/**
 * THE ANIMATION ENGINE (core 0.30.0): ONE implementation that turns a principle's STATE and a skin's RECIPE into pictures, used by overlay elements (through
 * `ctx.overlay.animateScript()`), by the kit page (kitPage.ts: screenshots, measurements) and by the tests (the same text run in Node).
 *
 * Two layers, both pure:
 *  1. `view(state, t)`: the principle's abstract output at instant `t` (ms, server clock): progress 0..1, the displayed value, the phase, the highlights in
 *     progress with their intensity (0..1) and advancement (0..1). Bursts are merged here (five follows in two seconds = one highlight), celebrations wait in a
 *     short line, every phase ends by itself (rest).
 *  2. `frame(state, recipe, t, size, options)`: a DRAW LIST (plain data: polygons, circles, texts, post effects) for that instant. No canvas, no clock, no
 *     randomness: every irregular shape comes from seeded generators (`mulberry32`), so the same state at the same instant always gives the same list
 *     (frame-by-frame tests, resuming after a reload).
 * Then `draw(ctx2d, list)` paints a list on a Canvas 2D (layers 0-2 are cached bitmaps keyed by the list, layer 3 is drawn each frame) and `mount()` runs the
 * loop at 30 fps at most, and not at all when nothing moves.
 *
 * SELF-CONTAINED on purpose (like compose/render.ts): it is sent to OBS as its own source text, in plain old JavaScript (no spread, no classes, no optional
 * chaining) so no compiler adds helpers. `SPEC` (spec.ts) is passed next to it as JSON: parameters are clamped and defaulted with the very table the installer
 * checked them with (second lock). Texts are drawn with `fillText`, never scaled on one axis, skewed or rotated: a skin can bend a lead line, never a digit.
 */
export function animateEngine(win: any, SPEC: any): void {
  var P = SPEC.primitives, TIMING = SPEC.timing, QUALITY = SPEC.quality, GENRES = SPEC.genres;
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var FONTS: any = {
    sans: 'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif',
    serif: 'Georgia,"Times New Roman","Noto Serif",serif',
    rounded: 'ui-rounded,"Arial Rounded MT Bold","Nunito","Varela Round",system-ui,sans-serif',
    mono: 'ui-monospace,"Cascadia Mono","Consolas","DejaVu Sans Mono",monospace',
    condensed: '"Arial Narrow","Roboto Condensed","Liberation Sans Narrow",system-ui,sans-serif',
  };

  // ───────────────────────── numbers, randomness, colours ─────────────────────────
  function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
  function num(v: any, lo: number, hi: number, d: number): number { return typeof v === "number" && isFinite(v) ? clamp(v, lo, hi) : d; }
  function rng(seed: number): () => number { var a = (seed >>> 0) || 1; return function () { a = (a + 0x6d2b79f5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s: string): number { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
  /** Smooth 1D value noise in [-1,1], periodic over 64 units: shapes and slow life, never a new random value at each frame. */
  function noise1(seed: number): (x: number) => number { var R = rng(seed), v: number[] = []; for (var i = 0; i < 65; i++) v.push(R() * 2 - 1); v[64] = v[0]!; return function (x: number) { var u = ((x % 64) + 64) % 64, i = Math.floor(u), f = u - i, s = f * f * (3 - 2 * f); return v[i]! + (v[i + 1]! - v[i]!) * s; }; }
  function out3(u: number): number { u = clamp(u, 0, 1); return 1 - (1 - u) * (1 - u) * (1 - u); }
  function inOut(u: number): number { u = clamp(u, 0, 1); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  /** Envelope of a highlight: quick attack, slower decay (0 at both ends). */
  function env(u: number, attack: number): number { if (u <= 0 || u >= 1) return 0; return u < attack ? out3(u / attack) : 1 - inOut((u - attack) / (1 - attack)); }
  function rgb(h: string): number[] { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function hex(c: number[]): string { var s = "#"; for (var i = 0; i < 3; i++) { var v = clamp(Math.round(c[i]!), 0, 255).toString(16); s += v.length < 2 ? "0" + v : v; } return s; }
  function mix(a: string, b: string, k: number): string { var x = rgb(a), y = rgb(b); return hex([x[0]! + (y[0]! - x[0]!) * k, x[1]! + (y[1]! - x[1]!) * k, x[2]! + (y[2]! - x[2]!) * k]); }
  function rgba(h: string, a: number): string { var c = rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + Math.round(clamp(a, 0, 1) * 1000) / 1000 + ")"; }
  function lin(v: number): number { var c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(h: string): number { var c = rgb(h); return 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!); }
  function contrast(a: string, b: string): number { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function r2(x: number): number { return Math.round(x * 100) / 100; }

  // ───────────────────────── recipe reading (second lock) ─────────────────────────
  /** A colour parameter: `#rrggbb`, a name of the recipe's `colors`, or `@fg` / `@accent` / `@surface` (the page's tokens). Anything else: the default. */
  function colorOf(v: any, d: string, ctx: any): string {
    if (typeof v === "string") {
      if (HEX.test(v)) return v.toLowerCase();
      if (v.charAt(0) === "@") { var n = v.slice(1); if (ctx.tokens && HEX.test(ctx.tokens[n] || "")) return ctx.tokens[n].toLowerCase(); if (ctx.colors && HEX.test(ctx.colors[n] || "")) return ctx.colors[n].toLowerCase(); }
    }
    return d;
  }
  function paramsOf(name: string, raw: any, ctx: any): any {
    var spec = P[name], o: any = { draw: name };
    if (!spec) return null;
    raw = raw && typeof raw === "object" ? raw : {};
    for (var k in spec.params) {
      var s = spec.params[k], v = raw[k];
      if (s[0] === "num") o[k] = num(v, s[1], s[2], s[3]);
      else if (s[0] === "int") o[k] = Math.round(num(v, s[1], s[2], s[3]));
      else if (s[0] === "seed") o[k] = typeof v === "number" && isFinite(v) ? Math.abs(Math.round(v)) % 1000000 : s[1];
      else if (s[0] === "enum") o[k] = s[1].indexOf(v) >= 0 ? v : s[2];
      else if (s[0] === "bool") o[k] = typeof v === "boolean" ? v : s[1];
      else if (s[0] === "color") o[k] = colorOf(v, colorOf(s[1], s[1], ctx), ctx);
      else if (s[0] === "colors") {
        var list: string[] = [];
        if (Array.isArray(v)) for (var i = 0; i < v.length && list.length < s[2]; i++) { var c = colorOf(v[i], "", ctx); if (c) list.push(c); }
        o[k] = list.length >= s[1] ? list : s[3].slice();
      }
    }
    return o;
  }
  /** The layers of one role: the skin's (1 to 3), else the basic recipe's. `none` draws nothing on purpose. */
  function layersOf(recipe: any, basic: any, genre: string, role: string, ctx: any): any[] {
    var g = recipe && recipe.genres && recipe.genres[genre], raw = g ? g[role] : undefined, src = raw === undefined ? (basic.genres[genre] || {})[role] : raw;
    var arr = Array.isArray(src) ? src.slice(0, 3) : src ? [src] : [], out: any[] = [];
    for (var i = 0; i < arr.length; i++) {
      var d = arr[i] && arr[i].draw;
      if (!P[d] || P[d].roles.indexOf(role) < 0) continue;
      var p = paramsOf(d, arr[i], ctx);
      if (p && d !== "none") out.push(p);
    }
    return out;
  }
  /** Is a recipe usable by this engine? An unknown contract, or not an object: no (the basic recipe applies). */
  function usable(recipe: any): boolean { return !!recipe && typeof recipe === "object" && recipe.animateContract === SPEC.contract && !!recipe.genres && typeof recipe.genres === "object"; }

  /** The basic recipe: what every role looks like without a skin animation, from the page's tokens. Every existing overlay skin restyles it. */
  function basicRecipe(): any {
    var text = { draw: "text", font: "skin", weight: 800, color: "@fg" }, label = { draw: "text", font: "skin", weight: 600, color: "@fg", size: 0.7 };
    var step = [{ draw: "flash", color: "@accent", strength: 0.35, size: 0.8 }, { draw: "pulse", strength: 0.35 }];
    var burst = [{ draw: "flash", color: "@accent", strength: 0.55, size: 1.4 }, { draw: "ring", color: "@accent", irregularity: 0.6, width: 0.025 }, { draw: "particles", kind: "sparks", colors: ["@accent", "@fg"], count: 18 }];
    return {
      animateContract: SPEC.contract,
      genres: {
        gauge: { body: { draw: "bar", track: "@fg", trackAlpha: 0.2, fill: "@accent" }, ticks: { draw: "notch", color: "@fg", alpha: 0.6 }, value: text, label: label, timer: { draw: "gaugeline", color: "@accent", track: "@fg" }, step: step, burst: burst },
        levels: { body: { draw: "cells", count: 5, color: "@accent", dim: "@fg" }, value: text, label: label, timer: [{ draw: "gaugeline", color: "@accent", track: "@fg" }], step: step, burst: burst },
        counter: { value: text, label: label, step: step, burst: burst },
      },
    };
  }
  var BASIC = basicRecipe();

  // ───────────────────────── the principle's state and its view at an instant ─────────────────────────
  var KIND_RANK: any = {}; for (var hk = 0; hk < SPEC.highlights.length; hk++) KIND_RANK[SPEC.highlights[hk]] = hk;
  function normState(s: any): any {
    s = s && typeof s === "object" ? s : {};
    var genre = GENRES[s.genre] ? s.genre : "gauge", fmt = SPEC.formats.indexOf(s.format) >= 0 ? s.format : "count";
    var o: any = { genre: genre, format: fmt, value: num(s.value, -1e12, 1e12, 0), target: num(s.target, 0, 1e12, 0), min: num(s.min, -1e12, 1e12, 0), label: typeof s.label === "string" ? s.label.slice(0, 60) : "", currency: typeof s.currency === "string" ? s.currency.slice(0, 4) : "", level: Math.round(num(s.level, 0, 9999, 0)), highlights: [], milestones: [], ended: s.ended === true };
    if (Array.isArray(s.milestones)) for (var i = 0; i < s.milestones.length && o.milestones.length < 12; i++) if (typeof s.milestones[i] === "number" && isFinite(s.milestones[i])) o.milestones.push(s.milestones[i]);
    if (s.timer && typeof s.timer === "object" && typeof s.timer.endsAt === "number") o.timer = { endsAt: s.timer.endsAt, total: num(s.timer.total, 0, 1e10, 0), pausedAt: typeof s.timer.pausedAt === "number" ? s.timer.pausedAt : null };
    if (s.rebase && typeof s.rebase === "object" && typeof s.rebase.at === "number") o.rebase = { from: num(s.rebase.from, -1e12, 1e12, o.value), at: s.rebase.at };
    if (Array.isArray(s.highlights)) {
      var hs = s.highlights.slice(-TIMING.maxHighlights);
      for (var j = 0; j < hs.length; j++) { var h = hs[j]; if (!h || typeof h.at !== "number" || KIND_RANK[h.kind] === undefined) continue; o.highlights.push({ id: String(h.id || j).slice(0, 80), at: h.at, kind: h.kind, amount: num(h.amount, -1e9, 1e9, 0), intensity: num(h.intensity, 0, 1, 0.6) }); }
      o.highlights.sort(function (a: any, b: any) { return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    }
    return o;
  }
  /** Bursts: highlights closer than the window merge (amounts add, the strongest kind wins, intensity grows and is capped); celebrations wait in line. */
  function groups(hs: any[]): any[] {
    var out: any[] = [], cur: any = null;
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (cur && h.at - cur.at <= TIMING.burstWindow && (h.kind === "drop") === (cur.kind === "drop")) {
        cur.count++; cur.amount += h.amount; cur.last = h.at; if (KIND_RANK[h.kind] > KIND_RANK[cur.kind]) cur.kind = h.kind;
        cur.intensity = Math.min(1, Math.max(cur.intensity, h.intensity) + 0.12);
      } else { cur = { id: h.id, at: h.at, last: h.at, kind: h.kind, amount: h.amount, count: 1, intensity: h.intensity }; out.push(cur); }
    }
    return out;
  }
  function view(raw: any, t: number): any {
    var s = raw && raw.__norm ? raw : normState(raw);
    var gs = groups(s.highlights), active: any[] = [], line: any[] = [], end = -Infinity;
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i], celebrate = g.kind === "milestone" || g.kind === "complete";
      if (celebrate) {
        var start = Math.max(g.at, end);
        // more than `queue` celebrations already waiting: this one is dropped (the value is kept, only the show is skipped), so the line never grows
        if (start - g.at > TIMING.queue * TIMING.celebration) continue;
        line.push({ g: g, start: start });
        end = start + TIMING.celebration;
      }
      // a burst's reaction lasts while its events keep coming, then one step more
      var dur = celebrate ? TIMING.celebration : TIMING.step + (g.last - g.at);
      var st = celebrate ? line[line.length - 1].start : g.at, u = (t - st) / dur;
      if (u >= 0 && u < 1) active.push({ id: g.id, kind: g.kind, count: g.count, amount: g.amount, intensity: g.intensity, u: u, start: st, dur: dur, celebrate: celebrate });
    }
    // the displayed value: amounts arrive over TIMING.ease after their highlight; a recalibration glides from its old value, without a highlight
    var pending = 0;
    for (var j = 0; j < s.highlights.length; j++) { var h = s.highlights[j], k = (t - h.at) / TIMING.ease; if (h.amount && k < 1) pending += h.amount * (1 - out3(k < 0 ? 0 : k)); }
    var base = s.value;
    if (s.rebase) { var kr = (t - s.rebase.at) / (TIMING.ease * 2); if (kr < 1) base = s.value + (s.rebase.from - s.value) * (1 - inOut(kr < 0 ? 0 : kr)); }
    var display = base - pending, remaining = null as null | number, ended = s.ended;
    if (s.format === "time" && s.timer) {
      var now = s.timer.pausedAt !== null ? Math.min(t, s.timer.pausedAt) : t;
      remaining = Math.max(0, (s.timer.endsAt - now) / 1000 - pending);
      display = remaining;
      if (remaining <= 0) ended = true;
    }
    var timerLeft = s.timer && s.format !== "time" ? Math.max(0, (s.timer.endsAt - (s.timer.pausedAt !== null ? Math.min(t, s.timer.pausedAt) : t)) / 1000) : null;
    var span = s.target - s.min, progress = span > 0 ? clamp((display - s.min) / span, 0, 1) : 0, overflow = span > 0 ? Math.max(0, (display - s.target) / span) : 0;
    var moving = Math.abs(pending) > 1e-6 || (s.rebase && t - s.rebase.at < TIMING.ease * 2 && t >= s.rebase.at);
    var phase = "rest", top = null as any;
    for (var a = 0; a < active.length; a++) if (active[a].celebrate && (!top || KIND_RANK[active[a].kind] > KIND_RANK[top.kind])) top = active[a];
    if (ended) phase = "ended";
    else if (top) phase = top.kind;
    else if (moving) phase = pending > 0 || (s.rebase && s.rebase.from < s.value && pending === 0) ? "filling" : "draining";
    else if (overflow > 0) phase = "overflow";
    var reached = 0; for (var m = 0; m < s.milestones.length; m++) if (display >= s.milestones[m]) reached++;
    var timeLive = (s.format === "time" || !!s.timer) && !ended && !(s.timer && s.timer.pausedAt !== null);
    return { genre: s.genre, format: s.format, value: s.value, display: display, target: s.target, min: s.min, progress: progress, overflow: overflow, phase: phase, highlights: active, level: s.level, label: s.label, timerLeft: timerLeft, timerTotal: s.timer ? s.timer.total : 0, remaining: remaining, milestones: s.milestones, reached: reached, moving: !!moving, timeLive: timeLive, currency: s.currency };
  }

  // ───────────────────────── text formatting (language-free: digits, separators, symbols) ─────────────────────────
  function group(n: number, lang: string): string { var s = String(Math.abs(Math.round(n))), sep = lang === "fr" ? " " : ",", out = ""; while (s.length > 3) { out = sep + s.slice(-3) + out; s = s.slice(0, -3); } return (n < 0 ? "-" : "") + s + out; }
  function clock(sec: number): string { sec = Math.max(0, Math.ceil(sec - 1e-6)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s; }
  function fmt(v: number, f: string, lang: string, cur: string): string {
    if (f === "time") return clock(v);
    if (f === "percent") return Math.round(v) + (lang === "fr" ? " %" : "%");
    if (f === "money") { var whole = Math.floor(Math.abs(v)), c = Math.round((Math.abs(v) - whole) * 100), dec = lang === "fr" ? "," : "."; var s = (v < 0 ? "-" : "") + group(whole, lang) + dec + (c < 10 ? "0" : "") + c; return lang === "fr" ? s + (cur ? " " + cur : "") : (cur ? cur : "") + s; }
    return group(v, lang);
  }
  function amountText(v: any, f: string, lang: string, cur: string): string { var a = v.amount; if (!a) return ""; var sign = a > 0 ? "+" : "-"; return sign + (f === "time" ? clock(Math.abs(a)) : f === "money" ? fmt(Math.abs(a), f, lang, cur) : group(Math.abs(a), lang)); }

  // ───────────────────────── geometry ─────────────────────────
  type Pt = number[];
  function shapePoly(shape: string, b: any): Pt[] {
    var x = b.x, y = b.y, w = b.w, h = b.h, pts: Pt[] = [], i: number, n = 24;
    if (shape === "ellipse") { for (i = 0; i < 48; i++) { var a = (i / 48) * Math.PI * 2; pts.push([x + w / 2 + Math.cos(a) * w / 2, y + h / 2 + Math.sin(a) * h / 2]); } return pts; }
    if (shape === "capsule") { var r = Math.min(h / 2, w / 2); for (i = 0; i <= n; i++) { var a1 = -Math.PI / 2 + (i / n) * Math.PI; pts.push([x + w - r + Math.cos(a1) * r, y + h / 2 + Math.sin(a1) * r]); } for (i = 0; i <= n; i++) { var a2 = Math.PI / 2 + (i / n) * Math.PI; pts.push([x + r + Math.cos(a2) * r, y + h / 2 + Math.sin(a2) * r]); } return pts; }
    if (shape === "arch" || shape === "roundArch") {
      var ah = Math.min(h * 0.42, w * 0.32), top = y + ah;
      pts.push([x, y + h], [x + w, y + h], [x + w, top]);
      for (i = 1; i < n; i++) {
        var u = i / n, px: number, py: number;
        if (shape === "roundArch") { var ang = u * Math.PI; px = x + w / 2 + Math.cos(ang) * w / 2; py = top - Math.sin(ang) * ah; }
        else { var side = u < 0.5 ? 1 : -1, v = u < 0.5 ? u * 2 : (1 - u) * 2; px = side > 0 ? x + w - (w / 2) * v : x + (w / 2) * v; py = top - ah * Math.sin(v * Math.PI / 2) * (0.75 + 0.25 * v); }
        pts.push([px, py]);
      }
      pts.push([x, top]);
      return pts;
    }
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
  function inside(poly: Pt[], p: Pt): boolean { var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i]!, b = poly[j]!; if ((a[1]! > p[1]!) !== (b[1]! > p[1]!) && p[0]! < ((b[0]! - a[0]!) * (p[1]! - a[1]!)) / (b[1]! - a[1]!) + a[0]!) c = !c; } return c; }
  /** Keeps the part of a convex polygon where nx*x + ny*y <= d (one Sutherland-Hodgman pass). */
  function clipHalf(poly: Pt[], nx: number, ny: number, d: number): Pt[] {
    var out: Pt[] = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i]!, b = poly[(i + 1) % poly.length]!, da = nx * a[0]! + ny * a[1]! - d, db = nx * b[0]! + ny * b[1]! - d;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) { var k = da / (da - db); out.push([a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k]); }
    }
    return out;
  }
  function centroid(p: Pt[]): Pt { var x = 0, y = 0; for (var i = 0; i < p.length; i++) { x += p[i]![0]!; y += p[i]![1]!; } return [x / p.length, y / p.length]; }
  function area(p: Pt[]): number { var s = 0; for (var i = 0; i < p.length; i++) { var a = p[i]!, b = p[(i + 1) % p.length]!; s += a[0]! * b[1]! - b[0]! * a[1]!; } return Math.abs(s) / 2; }
  function flat(p: Pt[]): number[] { var o: number[] = []; for (var i = 0; i < p.length; i++) o.push(r2(p[i]![0]!), r2(p[i]![1]!)); return o; }
  function shrink(p: Pt[], c: Pt, k: number): Pt[] { var o: Pt[] = []; for (var i = 0; i < p.length; i++) o.push([c[0]! + (p[i]![0]! - c[0]!) * k, c[1]! + (p[i]![1]! - c[1]!) * k]); return o; }
  /** A line "drawn by hand": bowed perpendicular to its direction, sub-wiggles, less irregular when long (rough.js gain). Deterministic by seed. */
  function handLine(a: Pt, b: Pt, seed: number, irr: number, n: number): Pt[] {
    var dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, len = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / len, ny = dx / len, R = rng(seed);
    var gain = len < 200 ? 1 : len > 500 ? 0.4 : 1.333 - len / 600, bow = (R() * 2 - 1) * irr * 0.012 * len * gain, wig = noise1(seed + 3), pts: Pt[] = [];
    for (var i = 0; i <= n; i++) { var u = i / n, off = bow * Math.sin(u * Math.PI) + (i === 0 || i === n ? 0 : wig(u * 4) * irr * 0.6 * gain); pts.push([a[0]! + dx * u + nx * off, a[1]! + dy * u + ny * off]); }
    return pts;
  }
  /** A stroke of variable thickness as a polygon (perfect-freehand spirit): thickness breathes along the line with smooth noise. */
  function strokePoly(pts: Pt[], width: number, seed: number, wobble: number): Pt[] {
    var L: Pt[] = [], Rr: Pt[] = [], nz = noise1(seed);
    for (var i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, dx = b[0]! - a[0]!, dy = b[1]! - a[1]!, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var r = (width / 2) * (1 + wobble * nz(i * 0.9));
      L.push([pts[i]![0]! - (dy / d) * r, pts[i]![1]! + (dx / d) * r]); Rr.push([pts[i]![0]! + (dy / d) * r, pts[i]![1]! - (dx / d) * r]);
    }
    return L.concat(Rr.reverse());
  }
  function circlePts(cx: number, cy: number, r: number, seed: number, irr: number, n: number): Pt[] {
    var R = rng(seed), hs: number[][] = [], pts: Pt[] = [];
    for (var k = 1; k <= 4; k++) hs.push([k, (irr * 0.012 / k) * (0.6 + R() * 0.8), R() * Math.PI * 2]);
    for (var i = 0; i < n; i++) { var a = (i / n) * Math.PI * 2, m = 1; for (var j = 0; j < hs.length; j++) m += hs[j]![1]! * Math.sin(hs[j]![0]! * a + hs[j]![2]!); pts.push([cx + Math.cos(a) * r * m, cy + Math.sin(a) * r * m]); }
    return pts;
  }
  function roundRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); if (r < 0.5) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    var pts: Pt[] = [], c = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
    for (var i = 0; i < 4; i++) for (var j = 0; j <= 6; j++) { var a = c[i]![2]! + (j / 6) * (Math.PI / 2); pts.push([c[i]![0]! + Math.cos(a) * r, c[i]![1]! + Math.sin(a) * r]); }
    return pts;
  }

  /**
   * TESSELLATION of a convex shape into panes: seeded sites (jittered grid, rows of bricks, or voronoi), each cell = the shape clipped by the bisectors of
   * its neighbours. Shared vertices are welded so two panes share exactly the same lead; each lead edge is bowed once, by its own seed. Memoised by its inputs.
   */
  var TESS: any = {}, TESS_N = 0;
  function tessellate(b: any, p: any): any {
    var key = [p.shape, p.pattern, p.cells, p.jitter, p.seed, p.order, p.irregularity, Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)].join("|");
    if (TESS[key]) return TESS[key];
    if (++TESS_N > 24) { TESS = {}; TESS_N = 1; }
    var shape = shapePoly(p.shape, b), R = rng(p.seed * 7919 + 17), sites: Pt[] = [];
    var cols = Math.max(1, Math.round(Math.sqrt((p.cells * b.w) / b.h))), rows = Math.max(1, Math.ceil(p.cells / cols)), cw = b.w / cols, ch = b.h / rows;
    for (var j = 0; j < rows; j++) for (var i = 0; i < cols; i++) {
      var off = p.pattern === "bricks" && j % 2 ? 0.5 : 0, jit = p.pattern === "voronoi" ? p.jitter : p.jitter * 0.25;
      var s = [b.x + (i + 0.5 + off) * cw + (R() - 0.5) * jit * cw, b.y + (j + 0.5) * ch + (R() - 0.5) * jit * ch];
      if (inside(shape, s)) sites.push(s);
    }
    var cells: any[] = [];
    for (var a = 0; a < sites.length; a++) {
      var poly = shape.slice(), sa = sites[a]!;
      for (var c = 0; c < sites.length && poly.length; c++) {
        if (c === a) continue;
        var sb = sites[c]!, nx = sb[0]! - sa[0]!, ny = sb[1]! - sa[1]!;
        if (nx * nx + ny * ny > (cw * cw + ch * ch) * 9) continue;   // far sites cannot cut this cell
        poly = clipHalf(poly, nx, ny, (nx * (sa[0]! + sb[0]!) + ny * (sa[1]! + sb[1]!)) / 2);
      }
      if (poly.length >= 3 && area(poly) > 4) cells.push({ pts: poly });
    }
    // weld vertices, list the unique edges
    var V: Pt[] = [], weld = Math.max(0.75, Math.min(cw, ch) * 0.01);
    function vid(p0: Pt): number { for (var k = 0; k < V.length; k++) if (Math.abs(V[k]![0]! - p0[0]!) < weld && Math.abs(V[k]![1]! - p0[1]!) < weld) return k; V.push(p0); return V.length - 1; }
    var edges: any = {}, elist: any[] = [];
    for (var q = 0; q < cells.length; q++) {
      var ids: number[] = [], cp = cells[q].pts;
      for (var k2 = 0; k2 < cp.length; k2++) { var id = vid(cp[k2]); if (ids[ids.length - 1] !== id) ids.push(id); }
      if (ids.length > 2 && ids[0] === ids[ids.length - 1]) ids.pop();
      cells[q].ids = ids;
      for (var e = 0; e < ids.length; e++) {
        var u0 = ids[e]!, u1 = ids[(e + 1) % ids.length]!, lo = Math.min(u0, u1), hi = Math.max(u0, u1), ek = lo + ":" + hi;
        if (!edges[ek]) { edges[ek] = { a: lo, b: hi, n: 0 }; elist.push(edges[ek]); }
        edges[ek].n++;
      }
    }
    var irr = p.irregularity;
    for (var e2 = 0; e2 < elist.length; e2++) {
      var ed = elist[e2], A = V[ed.a]!, B = V[ed.b]!, len = Math.sqrt((B[0]! - A[0]!) * (B[0]! - A[0]!) + (B[1]! - A[1]!) * (B[1]! - A[1]!));
      ed.border = ed.n < 2;
      ed.pts = ed.border ? [A, B] : handLine(A, B, p.seed * 131 + ed.a * 977 + ed.b * 31, irr, Math.max(2, Math.min(8, Math.round(len / 18))));
    }
    // each pane's outline follows its bowed edges (so glass and lead match)
    for (var q2 = 0; q2 < cells.length; q2++) {
      var cell = cells[q2], path: Pt[] = [];
      for (var e3 = 0; e3 < cell.ids.length; e3++) {
        var v0 = cell.ids[e3], v1 = cell.ids[(e3 + 1) % cell.ids.length], ed2 = edges[Math.min(v0, v1) + ":" + Math.max(v0, v1)], seg = ed2.pts;
        if (v0 !== ed2.a) seg = seg.slice().reverse();
        for (var z = 0; z < seg.length - 1; z++) path.push(seg[z]);
      }
      cell.path = path; cell.c = centroid(cell.pts); cell.area = area(cell.pts);
      var rr = Infinity; for (var z2 = 0; z2 < cell.pts.length; z2++) { var P0 = cell.pts[z2], P1 = cell.pts[(z2 + 1) % cell.pts.length], ex = P1[0] - P0[0], ey = P1[1] - P0[1], el = Math.sqrt(ex * ex + ey * ey) || 1; rr = Math.min(rr, Math.abs((cell.c[0] - P0[0]) * ey - (cell.c[1] - P0[1]) * ex) / el); }
      cell.r = rr;
    }
    // fill order: along x (a bar), y, from the centre, or seeded random; slightly perturbed so the front is never a straight line
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, RO = rng(p.seed + 101);
    for (var q3 = 0; q3 < cells.length; q3++) {
      var cc = cells[q3].c, jitterO = (RO() - 0.5) * 0.35;
      cells[q3].key = p.order === "y" ? 1 - (cc[1] - b.y) / b.h + jitterO * 0.3 : p.order === "center" ? Math.sqrt((cc[0] - cx) * (cc[0] - cx) + (cc[1] - cy) * (cc[1] - cy)) / Math.max(b.w, b.h) + jitterO * 0.1 : p.order === "random" ? RO() : (cc[0] - b.x) / b.w + jitterO * (cw / b.w);
      var RT = rng(p.seed * 31 + q3 * 7 + 1); cells[q3].tone = RT(); cells[q3].tone2 = RT();
    }
    var order = cells.slice().sort(function (m: any, n2: any) { return m.key - n2.key; });
    for (var q4 = 0; q4 < order.length; q4++) order[q4].rank = q4;
    var res = { shape: shape, cells: cells, edges: elist, order: order };
    TESS[key] = res;
    return res;
  }
  /** A rose window: a centre medallion and 1-3 rings of segments of unequal widths, each boundary a slightly irregular circle. Ordered for lighting. */
  function roseGeom(cx: number, cy: number, R0: number, p: any): any {
    var key = ["rose", r2(cx), r2(cy), r2(R0), p.rings, p.segments, p.seed, p.irregularity].join("|");
    if (TESS[key]) return TESS[key];
    var R = rng(p.seed * 53 + 5), radii: number[] = [], rc = R0 * 0.3, cells: any[] = [];
    for (var i = 0; i <= p.rings; i++) radii.push(rc + ((R0 - rc) * i) / p.rings);
    var bound: any[] = [];
    for (var b2 = 0; b2 <= p.rings; b2++) { var hs: number[][] = []; for (var k = 1; k <= 3; k++) hs.push([k + 1, (p.irregularity * 0.01 / k) * (0.5 + R()), R() * 6.283]); bound.push(hs); }
    function rad(bi: number, a: number): number { var m = 1, hs2 = bound[bi]; for (var j = 0; j < hs2.length; j++) m += hs2[j][1] * Math.sin(hs2[j][0] * a + hs2[j][2]); return radii[bi]! * m; }
    for (var ring = 0; ring < p.rings; ring++) {
      var n = Math.max(4, Math.round(p.segments * (0.55 + 0.45 * (ring + 1) / p.rings))), ws: number[] = [], sum = 0;
      for (var s = 0; s < n; s++) { var wv = 1 + (R() - 0.5) * 0.5 * Math.min(1, p.irregularity); ws.push(wv); sum += wv; }
      var a0 = -Math.PI / 2 + (ring % 2 ? (Math.PI / n) * (0.6 + R() * 0.4) : 0), acc = a0;
      for (var s2 = 0; s2 < n; s2++) {
        var a1 = acc + (ws[s2]! / sum) * Math.PI * 2, pts: Pt[] = [], steps = Math.max(3, Math.round(((a1 - acc) / (Math.PI * 2)) * 48));
        for (var q = 0; q <= steps; q++) { var aa = acc + ((a1 - acc) * q) / steps; pts.push([cx + Math.cos(aa) * rad(ring + 1, aa), cy + Math.sin(aa) * rad(ring + 1, aa)]); }
        for (var q2 = steps; q2 >= 0; q2--) { var ab = acc + ((a1 - acc) * q2) / steps; pts.push([cx + Math.cos(ab) * rad(ring, ab), cy + Math.sin(ab) * rad(ring, ab)]); }
        var mid = (acc + a1) / 2, rm = (radii[ring]! + radii[ring + 1]!) / 2;
        cells.push({ path: pts, pts: pts, c: [cx + Math.cos(mid) * rm, cy + Math.sin(mid) * rm], r: Math.min((radii[ring + 1]! - radii[ring]!) / 2, rm * (a1 - acc) / 2), tone: R(), tone2: rng(p.seed * 17 + ring * 101 + s2)(), key: ring + (((mid + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) });
        acc = a1;
      }
    }
    var center: Pt[] = []; for (var c2 = 0; c2 < 36; c2++) { var ac = (c2 / 36) * Math.PI * 2; center.push([cx + Math.cos(ac) * rad(0, ac), cy + Math.sin(ac) * rad(0, ac)]); }
    var order = cells.slice().sort(function (m: any, n2: any) { return m.key - n2.key; });
    for (var o = 0; o < order.length; o++) order[o].rank = o;
    var outer: Pt[] = []; for (var c3 = 0; c3 < 72; c3++) { var ao = (c3 / 72) * Math.PI * 2; outer.push([cx + Math.cos(ao) * rad(p.rings, ao), cy + Math.sin(ao) * rad(p.rings, ao)]); }
    var res = { cells: cells, order: order, center: center, outer: outer, rc: rc };
    TESS[key] = res; TESS_N++;
    return res;
  }

  // ───────────────────────── layout: where the body and the texts go (the engine decides, so a skin can never hide a digit) ─────────────────────────
  function textStyle(layers: any[]): any { for (var i = 0; i < layers.length; i++) if (layers[i].draw === "text") return layers[i]; return paramsOf("text", {}, { tokens: {} }); }
  function layout(genre: string, w: number, h: number, bodyDraw: string, valueStyle: any, hasLabel: boolean, hasTimer: boolean, minText: number): any {
    var pad = Math.max(2, Math.min(w, h) * 0.05), L: any = { w: w, h: h, pad: pad };
    var vs = Math.max(minText, Math.min(h * 0.17, w * 0.09)) * valueStyle.size, ls = Math.max(minText * 0.75, vs * 0.62);
    L.valueSize = vs; L.labelSize = ls;
    if (genre === "counter") {
      L.frame = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
      L.valueSize = Math.max(minText, Math.min(h * 0.4, w * 0.2)) * valueStyle.size; L.labelSize = Math.max(minText * 0.75, L.valueSize * 0.38);
      L.value = { x: w / 2, y: hasLabel ? h * 0.6 : h / 2, align: "center", mw: w - 4 * pad };
      L.label = { x: w / 2, y: h * 0.26, align: "center", mw: w - 4 * pad };
      L.body = L.frame; L.center = [w / 2, h / 2];
      return L;
    }
    if (genre === "levels" && bodyDraw === "rose") {
      var side = Math.min(h - 2 * pad, w * 0.48);
      L.body = { x: pad, y: (h - side) / 2, w: side, h: side }; L.rose = [pad + side / 2, h / 2, side / 2];
      var tx = pad * 2 + side, tw = w - tx - pad;
      L.value = { x: L.rose[0], y: h / 2, align: "center", mw: side * 0.5, inRose: true };
      L.valueSize = Math.max(minText, side * 0.22) * valueStyle.size;
      L.label = { x: tx, y: h * 0.3, align: "left", mw: tw };
      L.timerText = { x: tx, y: h * 0.58, align: "left", mw: tw };
      L.timer = { x: tx, y: h * 0.72, w: tw, h: Math.max(4, h * 0.05) };
      L.center = [L.rose[0], L.rose[1]];
      return L;
    }
    var place = valueStyle.placement === "auto" ? (w / h > 4.5 ? "side" : "below") : valueStyle.placement;
    var band = vs * 1.45 + (hasTimer && genre === "levels" ? vs * 0.5 : 0);
    if (place === "below" || place === "above") {
      var bh = Math.max(h * 0.3, h - 2 * pad - band - pad);
      var by = place === "above" ? h - pad - bh : pad;
      L.body = { x: pad, y: by, w: w - 2 * pad, h: bh };
      var ty = place === "above" ? pad + vs * 0.7 : by + bh + pad + vs * 0.72;
      L.value = { x: w - pad, y: ty, align: "right", mw: (w - 2 * pad) * (hasLabel ? 0.5 : 1) };
      L.label = { x: pad, y: ty, align: "left", mw: (w - 2 * pad) * 0.5 };
    } else if (place === "side") {
      var tw2 = Math.min(w * 0.38, vs * 6);
      L.body = { x: pad, y: pad, w: w - 3 * pad - tw2, h: h - 2 * pad };
      L.value = { x: w - pad, y: h / 2 + (hasLabel ? vs * 0.35 : 0), align: "right", mw: tw2 };
      L.label = { x: w - pad, y: h / 2 - vs * 0.55, align: "right", mw: tw2 };
    } else {
      L.body = { x: pad, y: pad, w: w - 2 * pad, h: h - 2 * pad };
      L.value = { x: w / 2, y: h / 2 + (hasLabel ? vs * 0.3 : 0), align: "center", mw: w - 4 * pad, inside: true };
      L.label = { x: w / 2, y: h / 2 - vs * 0.6, align: "center", mw: w - 4 * pad };
    }
    if (genre === "levels") { L.timer = { x: L.body.x, y: L.body.y + L.body.h + pad * 0.4, w: L.body.w * 0.5, h: Math.max(3, h * 0.03) }; L.timerText = { x: L.label.x, y: L.label.y + vs * 0.9, align: "left", mw: L.body.w * 0.5 }; }
    if (genre === "gauge" && hasTimer) L.timer = { x: L.body.x, y: L.body.y + L.body.h + pad * 0.25, w: L.body.w, h: Math.max(3, h * 0.02) };
    L.center = [L.body.x + L.body.w / 2, L.body.y + L.body.h / 2];
    return L;
  }

  // ───────────────────────── the draw list ─────────────────────────
  function List(): any { return { ops: [] as any[] }; }
  function poly(out: any, L: number, pts: Pt[] | number[], o: any): void { var op: any = { k: "poly", L: L, p: (pts.length && Array.isArray(pts[0])) ? flat(pts as Pt[]) : pts }; for (var k in o) op[k] = o[k]; out.ops.push(op); }
  function circ(out: any, L: number, x: number, y: number, r: number, o: any): void { var op: any = { k: "circ", L: L, x: r2(x), y: r2(y), r: r2(Math.max(0.2, r)) }; for (var k in o) op[k] = o[k]; out.ops.push(op); }
  function radial(x: number, y: number, r: number, stops: any[]): any { return { g: "rad", x: r2(x), y: r2(y), r: r2(Math.max(1, r)), s: stops }; }
  function linear(x0: number, y0: number, x1: number, y1: number, stops: any[]): any { return { g: "lin", x0: r2(x0), y0: r2(y0), x1: r2(x1), y1: r2(y1), s: stops }; }

  /** A pane of glass, lit from behind: tinted base, light centre to shaded edge, mottling, bubbles, a reflection streak. Detail follows the quality. */
  function glassPane(out: any, L: number, cell: any, base: string, p: any, Q: any, alpha: number, glowBlur: number): void {
    var c = cell.c, r = Math.max(2, cell.r), R = rng(Math.floor(cell.tone * 1e6) + 3), path = cell.path, ext = Math.max(r * 2.2, Math.sqrt(cell.area || r * r * 4)), n0 = out.ops.length;
    if (!glowBlur && p.glow > 0 && Q.details > 0) circ(out, L, c[0], c[1], ext * 1.1, { f: radial(c[0], c[1], ext * 1.1, [[0, rgba(p.glowColor, 0.22 * p.glow * alpha)], [1, rgba(p.glowColor, 0)]]) });
    poly(out, L, path, { f: base, a: alpha, g: glowBlur, gc: p.glowColor });
    out.tagFrom = n0;
    if (Q.details <= 0) return;
    poly(out, L, path, { f: radial(c[0] - r * 0.4, c[1] - r * 0.5, ext, [[0, rgba(p.light, 0.5 * alpha)], [0.5, rgba(base, 0)], [1, rgba(p.shade, 0.45 * alpha)]]) });
    var nm = Math.round(p.mottle * 2 * Q.details);
    for (var m = 0; m < nm; m++) { var mx = c[0] + (R() - 0.5) * r, my = c[1] + (R() - 0.5) * r, mr = r * (0.5 + R() * 0.6); circ(out, L, mx, my, mr, { f: radial(mx, my, mr, [[0, rgba(R() < 0.5 ? p.shade : p.light, 0.16 * alpha)], [1, rgba(base, 0)]]) }); }
    var nb = Math.round(p.bubbles * 4 * Q.details * R());
    for (var bq = 0; bq < nb; bq++) circ(out, L, c[0] + (R() - 0.5) * r * 1.1, c[1] + (R() - 0.5) * r * 1.1, Math.max(0.6, r * (0.03 + R() * 0.05)), { f: rgba(p.light, 0.35 * alpha), s: rgba(p.shade, 0.25 * alpha), w: 0.6 });
    if (p.streaks > 0 && cell.tone > 1 - p.streaks * 0.8) poly(out, L, shrink(cell.pts, c, 0.5), { f: rgba("#ffffff", (0.07 + 0.1 * cell.tone) * alpha) });
  }
  /** Tags the ops of one lit pane with its rank, so a cached lit layer only paints the panes added since (one more follow = one pane drawn). */
  function tag(out: any, from: number, rank: number): void { for (var i = from; i < out.ops.length; i++) out.ops[i].pr = rank; }
  function paneColor(cell: any, p: any): string { var pal = p.palette, base = pal[Math.floor(cell.tone * pal.length) % pal.length]; var k = cell.tone2 === undefined ? 0.5 : cell.tone2; return p.tint > 0 ? mix(base, k < 0.5 ? p.shade : p.light, Math.abs(k - 0.5) * 0.35 * p.tint) : base; }
  function leadEdges(out: any, L: number, edges: any[], width: number, p: any, Q: any, seedBase: number): void {
    for (var e = 0; e < edges.length; e++) {
      var ed = edges[e], w = ed.border ? width * 1.5 : width, sp = strokePoly(ed.pts, w, seedBase + e * 13, Q.details > 0 ? 0.12 + 0.05 * p.irregularity : 0);
      poly(out, L, sp, { f: p.lead });
      if (Q.details > 0 && p.leadHighlight) poly(out, L, ed.pts, { s: rgba(p.leadHighlight, 0.45), w: Math.max(0.6, w * 0.18), open: true });
    }
  }

  function drawMosaic(out: any, v: any, Lb: any, p: any, Q: any): any {
    var b = { x: Lb.x, y: Lb.y + Lb.h * (1 - p.thickness) / 2, w: Lb.w, h: Lb.h * p.thickness };
    var T = tessellate(b, p), n = T.order.length, lit = v.progress * n, full = Math.floor(lit + 1e-9), frac = lit - full, unitW = Math.max(1.2, b.h * p.leadWidth);
    var blur = Q.blur && p.glow > 0 ? Math.round(b.h * 0.08 * p.glow) : 0;
    // layer 0: the window unlit (dim glass) — never changes
    for (var i = 0; i < T.cells.length; i++) { var c = T.cells[i], base = paneColor(c, p); poly(out, 0, c.path, { f: mix(p.shade, base, 0.2 + 0.45 * p.unlit), a: 0.5 + 0.45 * p.unlit }); }
    // layer 1: the lit panes (changes only when one more pane is lit)
    for (var k = 0; k < full && k < n; k++) { var cl = T.order[k], n0 = out.ops.length; glassPane(out, 1, cl, paneColor(cl, p), p, Q, 1, blur); tag(out, n0, k); }
    out.inc1 = ["m", full];
    // layer 2: the lead (never changes)
    leadEdges(out, 2, T.edges, unitW, p, Q, p.seed * 7);
    // layer 3: the pane being lit (fades in), then its own lead again on top
    var headPt = full > 0 ? T.order[Math.min(n, full) - 1].c : [b.x, b.y + b.h / 2];
    if (full < n && frac > 0.001) {
      var cp = T.order[full]; glassPane(out, 3, cp, paneColor(cp, p), p, Q, out3(frac), 0);
      var mine: any[] = []; for (var e = 0; e < T.edges.length; e++) { var ed = T.edges[e]; if (cp.ids && (cp.ids.indexOf(ed.a) >= 0 && cp.ids.indexOf(ed.b) >= 0)) mine.push(ed); }
      leadEdges(out, 3, mine, unitW, p, Q, p.seed * 7 + 999);
      headPt = cp.c;
    }
    out.key1 = "m" + full + (v.overflow > 0 ? "o" : "");
    return { shape: T.shape, head: headPt, box: b, panes: T.order, lit: full };
  }
  function drawRose(out: any, v: any, Lr: number[], p: any, Q: any): any {
    var G = roseGeom(Lr[0]!, Lr[1]!, Lr[2]! * 0.96, p), n = G.order.length, lit = v.progress * n, full = Math.floor(lit + 1e-9), frac = lit - full, lw = Math.max(1.2, Lr[2]! * 2 * p.leadWidth);
    var pq = { light: p.light, shade: p.shade, mottle: 0.4, bubbles: p.bubbles, streaks: 0.4, glowColor: p.glowColor, glow: p.glow };
    var shift = (v.level % Math.max(1, p.palette.length));
    function col(c: any): string { var pal = p.palette; return pal[(Math.floor(c.tone * pal.length) + shift) % pal.length]; }
    for (var i = 0; i < G.cells.length; i++) poly(out, 0, G.cells[i].path, { f: mix(p.shade, col(G.cells[i]), 0.2 + 0.45 * p.unlit), a: 0.5 + 0.45 * p.unlit });
    poly(out, 0, G.center, { f: mix(p.shade, p.center, 0.55), a: 0.9 });
    for (var k = 0; k < full && k < n; k++) { var n0 = out.ops.length; glassPane(out, 1, G.order[k], col(G.order[k]), pq, Q, 1, Q.blur ? Math.round(lw * 2 * p.glow) : 0); tag(out, n0, k); }
    out.inc1 = ["r" + v.level, full];
    for (var j = 0; j < G.cells.length; j++) poly(out, 2, G.cells[j].path, { s: p.lead, w: lw, j: "round" });
    poly(out, 2, G.center, { s: p.lead, w: lw * 1.2, j: "round" });
    poly(out, 2, G.outer, { s: p.lead, w: lw * 1.7, j: "round" });
    var head = full > 0 ? G.order[Math.min(n, full) - 1].c : [Lr[0], Lr[1]];
    if (full < n && frac > 0.001) { var cp = G.order[full]; glassPane(out, 3, cp, col(cp), pq, Q, out3(frac), 0); poly(out, 3, cp.path, { s: p.lead, w: lw, j: "round" }); head = cp.c; }
    out.key1 = "r" + full + ":" + v.level;
    return { shape: G.outer, head: head, box: { x: Lr[0]! - Lr[2]!, y: Lr[1]! - Lr[2]!, w: Lr[2]! * 2, h: Lr[2]! * 2 }, center: G.center };
  }
  function drawBar(out: any, v: any, Lb: any, p: any): any {
    var th = Lb.h * p.thickness, y = Lb.y + (Lb.h - th) / 2, r = th * p.radius, track = roundRect(Lb.x, y, Lb.w, th, r);
    poly(out, 0, track, { f: p.track, a: p.trackAlpha });
    var fw = Lb.w * v.progress;
    if (fw > 0.5) { var fill = roundRect(Lb.x, y, Math.max(fw, Math.min(Lb.w, r * 2)), th, r); poly(out, 3, fill, { f: p.fill, a: p.fillAlpha }); if (p.gradient > 0) poly(out, 3, fill, { f: linear(0, y, 0, y + th, [[0, rgba("#ffffff", p.gradient)], [0.6, rgba("#ffffff", 0)], [1, rgba("#000000", p.gradient * 0.6)]]) }); }
    return { shape: track, head: [Lb.x + fw, y + th / 2], box: { x: Lb.x, y: y, w: Lb.w, h: th } };
  }
  function tubePath(Lb: any, p: any): Pt[] {
    var th = Lb.h * p.thickness, y = Lb.y + Lb.h / 2;
    if (p.shape === "loop") { var rr = roundRect(Lb.x, Lb.y + (Lb.h - th) / 2, Lb.w, th, th * 0.5); rr.push(rr[0]!); return rr; }
    return [[Lb.x + th * p.width, y], [Lb.x + Lb.w - th * p.width, y]];
  }
  function sub(path: Pt[], a: number, b: number): Pt[] {
    var lens = [0], tot = 0; for (var i = 1; i < path.length; i++) { tot += Math.sqrt(Math.pow(path[i]![0]! - path[i - 1]![0]!, 2) + Math.pow(path[i]![1]! - path[i - 1]![1]!, 2)); lens.push(tot); }
    var out: Pt[] = [], A = a * tot, B = b * tot;
    function at(d: number): Pt { for (var j = 1; j < lens.length; j++) if (lens[j]! >= d) { var k = (d - lens[j - 1]!) / ((lens[j]! - lens[j - 1]!) || 1); return [path[j - 1]![0]! + (path[j]![0]! - path[j - 1]![0]!) * k, path[j - 1]![1]! + (path[j]![1]! - path[j - 1]![1]!) * k]; } return path[path.length - 1]!; }
    out.push(at(A)); for (var j2 = 1; j2 < lens.length; j2++) if (lens[j2]! > A && lens[j2]! < B) out.push(path[j2]!); out.push(at(B));
    return out;
  }
  function neonStroke(out: any, L: number, pts: Pt[], p: any, w: number, Q: any, alpha: number): void {
    if (Q.blur) poly(out, L, pts, { s: p.color, w: w, a: alpha, g: Math.round(w * 2.2 * p.glow), gc: p.color, open: true, cap: "round" });
    else { if (p.glow > 0 && Q.details > 0) { poly(out, L, pts, { s: rgba(p.color, 0.1 * p.glow * alpha), w: w * 3.2, open: true, cap: "round" }); poly(out, L, pts, { s: rgba(p.color, 0.22 * p.glow * alpha), w: w * 2, open: true, cap: "round" }); } poly(out, L, pts, { s: p.color, w: w, a: alpha, open: true, cap: "round" }); }
    poly(out, L, pts, { s: p.core, w: Math.max(1, w * 0.38), a: alpha, open: true, cap: "round" });
  }
  function drawTube(out: any, v: any, Lb: any, p: any, Q: any): any {
    var path = tubePath(Lb, p), w = Math.max(2, Lb.h * p.thickness * p.width), segs = p.segments, gap = segs > 1 ? 0.012 : 0;
    for (var s = 0; s < segs; s++) poly(out, 0, sub(path, s / segs + gap, (s + 1) / segs - gap), { s: p.dim, w: w, a: p.dimAlpha, open: true, cap: "round" });
    var pr = v.progress, head: Pt = path[0]!;
    if (pr > 0.0005) {
      if (segs > 1) { var fullSegs = Math.floor(pr * segs + 1e-9); for (var s2 = 0; s2 < fullSegs; s2++) neonStroke(out, 1, sub(path, s2 / segs + gap, (s2 + 1) / segs - gap), p, w, Q, 1); var fr = pr * segs - fullSegs; if (fr > 0.001 && fullSegs < segs) neonStroke(out, 3, sub(path, fullSegs / segs + gap, (fullSegs + 1) / segs - gap), p, w, Q, out3(fr)); out.key1 = "t" + fullSegs; var hp = sub(path, 0, Math.max(0.001, pr)); head = hp[hp.length - 1]!; }
      else { var sp = sub(path, 0, pr); neonStroke(out, 3, sp, p, w, Q, 1); head = sp[sp.length - 1]!; }
    }
    return { shape: roundRect(Lb.x, Lb.y + Lb.h / 2 - w, Lb.w, w * 2, w), head: head, box: { x: Lb.x, y: Lb.y + Lb.h / 2 - w * 2, w: Lb.w, h: w * 4 }, tube: true };
  }
  function drawCells(out: any, v: any, Lb: any, p: any, Q: any): any {
    var n = p.count, gap = (Lb.w / n) * p.gap, cw = (Lb.w - gap * (n - 1)) / n, ch = Math.min(Lb.h, cw * 1.2), y = Lb.y + (Lb.h - ch) / 2, lit = v.progress * n, full = Math.floor(lit + 1e-9), head: Pt = [Lb.x, y + ch / 2];
    for (var i = 0; i < n; i++) {
      var x = Lb.x + i * (cw + gap), rr = roundRect(x, y, cw, ch, Math.min(cw, ch) * p.radius);
      poly(out, 0, rr, { f: p.dim, a: p.dimAlpha });
      if (i < full) { poly(out, 1, rr, { f: p.color, g: Q.blur && p.glow ? Math.round(ch * 0.2 * p.glow) : 0, gc: p.color }); head = [x + cw, y + ch / 2]; }
      else if (i === full && lit - full > 0.001) { poly(out, 3, rr, { f: p.color, a: out3(lit - full) }); head = [x + cw * (lit - full), y + ch / 2]; }
    }
    out.key1 = "c" + full;
    return { shape: roundRect(Lb.x, y, Lb.w, ch, 4), head: head, box: { x: Lb.x, y: y, w: Lb.w, h: ch } };
  }
  function drawFrame(out: any, layers: any[], L: any, body: any, t: number, Q: any, calm: boolean): void {
    for (var i = 0; i < layers.length; i++) {
      var p = layers[i], b = L.frame || { x: body.box.x - L.pad * 0.5, y: body.box.y - L.pad * 0.5, w: body.box.w + L.pad, h: body.box.h + L.pad }, m = Math.min(L.w, L.h);
      if (p.draw === "outline") {
        var rr = roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * p.radius);
        if (p.irregularity > 0) { var pts: Pt[] = []; for (var k = 0; k < rr.length; k++) { var a = rr[k]!, nb = rr[(k + 1) % rr.length]!, hl = handLine(a, nb, p.seed * 41 + k, p.irregularity, 3); for (var z = 0; z < hl.length - 1; z++) pts.push(hl[z]!); } rr = pts; }
        poly(out, 0, rr, { s: p.color, a: p.alpha, w: Math.max(1, m * p.width), j: "round" });
      } else if (p.draw === "lead") {
        var plate = L.frame ? roundRect(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.18) : body.shape;
        if (p.backingAlpha > 0) poly(out, 0, plate, { f: p.backing, a: p.backingAlpha });
        var edges: any[] = [], pp = plate; for (var e = 0; e < pp.length; e++) edges.push({ pts: handLine(pp[e]!, pp[(e + 1) % pp.length]!, p.seed * 977 + e, p.irregularity, 3), border: false });
        leadEdges(out, 2, edges, Math.max(1.5, m * p.width), { lead: p.color, leadHighlight: p.highlight, irregularity: p.irregularity }, Q, p.seed);
      } else if (p.draw === "trace") {
        var R = rng(p.seed * 3 + 1), lw = Math.max(1, m * p.width);
        for (var ln = 0; ln < p.lines; ln++) {
          var top = ln % 2 === 0, yy = top ? b.y - L.pad * 0.15 - ln * lw * 3 : b.y + b.h + L.pad * 0.15 + ln * lw * 3, tp: Pt[] = [[b.x + b.w * (0.02 + R() * 0.1), yy]], x = tp[0]![0]!;
          while (x < b.x + b.w * 0.9) { x = Math.min(b.x + b.w * 0.97, x + b.w * (0.08 + R() * 0.18)); var jog = (R() < 0.5 ? -1 : 1) * lw * (2 + R() * 3); tp.push([x, yy]); if (R() < 0.6 && x < b.x + b.w * 0.9) { tp.push([x + lw * 3, yy + jog]); yy += jog; } }
          poly(out, 0, tp, { s: p.color, a: p.alpha, w: lw, open: true, j: "round", cap: "round" });
          for (var nd = 0; nd < Math.min(p.nodes, tp.length); nd++) { var np = tp[Math.floor((nd / Math.max(1, p.nodes)) * tp.length)]!; circ(out, 0, np[0]!, np[1]!, lw * 2, { f: p.color, a: p.alpha }); }
          if (p.pulse > 0 && !calm && Q.ambient) { var len = tp.length - 1, ph = ((t / 1000) * 0.25 + R()) % 1, idx = Math.floor(ph * len), fk = ph * len - idx, A = tp[idx]!, B = tp[Math.min(len, idx + 1)]!; circ(out, 3, A[0]! + (B[0]! - A[0]!) * fk, A[1]! + (B[1]! - A[1]!) * fk, lw * 2.2, { f: rgba(p.color, p.pulse), g: Q.blur ? lw * 4 : 0, gc: p.color }); out.animating = true; }
        }
      }
    }
  }
  function drawTicks(out: any, layers: any[], v: any, body: any, L: any): void {
    if (!v.milestones.length || !layers.length) return;
    var span = v.target - v.min; if (span <= 0) return;
    for (var i = 0; i < layers.length; i++) {
      var p = layers[i], b = body.box;
      for (var m = 0; m < v.milestones.length; m++) {
        var u = (v.milestones[m] - v.min) / span; if (u <= 0 || u >= 1) continue;
        var x = b.x + b.w * u, passed = v.display >= v.milestones[m];
        if (p.draw === "notch") poly(out, 3, [[x, b.y + b.h * (1 - p.length) / 2], [x, b.y + b.h * (1 + p.length) / 2]], { s: p.color, a: p.alpha, w: Math.max(1.5, L.h * 0.008), open: true, cap: "round" });
        else poly(out, 3, circlePts(x, b.y + b.h + L.pad * 0.2, Math.max(2, b.h * p.size), p.seed + m, p.irregularity, 14), { f: passed ? p.lit : p.color, s: "#000000", w: 1, a: passed ? 1 : 0.7 });
      }
    }
  }
  /** A text: the engine places it, sizes it (never under the TV minimum), and guarantees its contrast (outline or plate), whatever the skin asked. */
  function drawText(out: any, txt: string, pos: any, size: number, st: any, Q: any, alpha: number, dy: number, ctx: any): void {
    if (!txt) return;
    var fam = st.font === "skin" ? (ctx.font || FONTS.sans) : FONTS[st.font] || FONTS.sans, color = st.color, ow = size * st.outlineWidth, outline = st.outline;
    var plateOk = st.plate !== "none" && st.plateAlpha >= 0.8 && contrast(color, st.plateColor) >= 4.5;
    if (!plateOk && (ow < size * 0.04 || contrast(color, outline) < 4.5)) { outline = lum(color) > 0.4 ? "#000000" : "#ffffff"; ow = Math.max(ow, size * 0.08); if (contrast(color, outline) < 4.5) { color = "#ffffff"; outline = "#000000"; } }
    if (st.plate !== "none") {
      // the plate stays inside the frame: the text moves in by the plate's margin
      pos = { x: pos.x + (pos.align === "left" ? size * 0.4 : pos.align === "right" ? -size * 0.4 : 0), y: pos.y, align: pos.align, mw: Math.max(size, pos.mw - size * 0.8) };
      var tw = Math.min(pos.mw, txt.length * size * 0.6) + size * 0.8, th = size * 1.35, px = pos.align === "left" ? pos.x - size * 0.4 : pos.align === "right" ? pos.x - tw + size * 0.4 : pos.x - tw / 2, py = pos.y - th / 2 + dy;
      var shape = roundRect(px, py, tw, th, st.plate === "soft" ? th * 0.3 : th * 0.18);
      poly(out, 3, shape, { f: st.plateColor, a: st.plateAlpha * alpha });
      if (st.plate === "lead" || st.plate === "glass") { var ed: any[] = []; for (var e = 0; e < shape.length; e += 7) ed.push({ pts: handLine(shape[e]!, shape[(e + 7) % shape.length]!, st.seed * 13 + e, 1.2, 3) }); leadEdges(out, 3, ed, Math.max(1.5, size * 0.09), { lead: st.plateEdge, leadHighlight: "#8a7a6a", irregularity: 1 }, Q, st.seed); }
    }
    out.ops.push({ k: "text", L: 3, t: txt, x: r2(pos.x), y: r2(pos.y + dy), sz: r2(size), wt: st.weight, ff: fam, al: pos.align, f: color, o: outline, ow: r2(ow), a: r2(alpha), mw: r2(pos.mw), gl: Q.blur && st.glow > 0 ? r2(size * 0.5 * st.glow) : 0, gc: st.glowColor });
  }
  function drawTimer(out: any, layers: any[], v: any, L: any, valueStyle: any, Q: any, ctx: any): void {
    if (v.timerLeft === null || !L.timer) return;
    var left = v.timerLeft, total = v.timerTotal > 0 ? v.timerTotal / 1000 : Math.max(left, 1), u = clamp(left / total, 0, 1), st = null as any;
    for (var i = 0; i < layers.length; i++) {
      var p = layers[i];
      if (p.draw === "gaugeline") { var b = L.timer, th = Math.max(2, Math.min(b.h, L.h * p.thickness)); poly(out, 3, roundRect(b.x, b.y, b.w, th, th / 2), { f: p.track, a: p.trackAlpha }); if (u > 0) poly(out, 3, roundRect(b.x, b.y, Math.max(th, b.w * u), th, th / 2), { f: p.color, a: p.alpha }); }
      if (p.draw === "text") st = p;
    }
    if (L.timerText) drawText(out, clock(left), L.timerText, L.labelSize, st || valueStyle, Q, 1, 0, ctx);
  }

  // ───────────────────────── reactions and life ─────────────────────────
  function drawReaction(out: any, layers: any[], h: any, body: any, L: any, Q: any, calm: boolean, ctx: any): void {
    var origin = h.celebrate ? L.center : body.head, size = Math.max(body.box.h, Math.min(L.w, L.h) * 0.35), u = h.u, I = 0.45 + 0.55 * h.intensity, seed = hash(h.id + ":" + h.kind);
    for (var i = 0; i < layers.length; i++) {
      var p = layers[i];
      if (p.draw === "flash") { var e = calm ? 0.6 * Math.sin(Math.PI * u) : env(u, 0.1), r = size * p.size * (0.8 + 0.4 * out3(u)); if (e > 0.002) circ(out, 3, origin[0], origin[1], r, { f: radial(origin[0], origin[1], r, [[0, rgba(p.color, p.strength * I * e)], [0.45, rgba(p.color, p.strength * I * e * 0.45)], [1, rgba(p.color, 0)]]), b: "lighter" }); }
      else if (p.draw === "pulse") { var e2 = (calm ? 0.5 : 1) * Math.sin(Math.PI * u); if (e2 > 0.002) { out.ops.push({ k: "clip", L: 3, p: flat(body.shape) }); circ(out, 3, origin[0], origin[1], Math.max(body.box.w, body.box.h), { f: radial(origin[0], origin[1], Math.max(body.box.w, body.box.h), [[0, rgba("#ffffff", 0.35 * p.strength * I * e2)], [1, rgba("#ffffff", 0)]]), b: "lighter" }); out.ops.push({ k: "unclip", L: 3 }); } }
      else if (p.draw === "ring" && !calm && Q.particles > 0) { var rr = size * p.size * out3(u) + 4, al = (1 - u) * I; if (al > 0.01) poly(out, 3, circlePts(origin[0], origin[1], rr, seed + p.seed, p.irregularity * 2, Math.max(24, Math.min(90, Math.round(rr / 6)))), { s: p.color, w: Math.max(1, Math.min(L.w, L.h) * p.width * (1 - 0.7 * u)), a: al, j: "round" }); }
      else if (p.draw === "particles" && !calm && Q.particles > 0) drawParticles(out, p, origin, size, u, h.celebrate ? 1 : 0.5, I * Q.particles, seed, L);
      else if (p.draw === "rays" && Q.rays) { var e3 = calm ? 0.4 * Math.sin(Math.PI * u) : env(u, 0.2); if (e3 > 0.01) drawRays(out, p, origin, size * 2.2, e3 * I, seed, (h.start / 1000) * 0.2 + u * 0.3, null); }
    }
    // the amount of the highlight, written like the value (never distorted: it only rises and fades)
    if (h.amount && (h.kind === "step" || h.kind === "extend") && ctx.valuePos) {
      var a = Math.sin(Math.PI * clamp(u * 1.2, 0, 1)), txt = amountText(h, ctx.v.format, ctx.lang, ctx.v.currency);
      drawText(out, txt, { x: ctx.valuePos.x, y: ctx.valuePos.y, align: ctx.valuePos.align, mw: ctx.valuePos.mw }, L.valueSize * 0.62, ctx.valueStyle, Q, a, (ctx.v.genre === "counter" ? 1 : -1) * L.valueSize * (calm ? 1.05 : 0.9 + 0.4 * out3(u)), ctx);
    }
  }
  function drawParticles(out: any, p: any, origin: number[], size: number, u: number, scale: number, I: number, seed: number, L: any): void {
    var R = rng(seed + p.seed), n = Math.round(p.count * scale * I), m = Math.min(L.w, L.h), cols = p.colors;
    for (var i = 0; i < n; i++) {
      var ang = R() * Math.PI * 2, sp = (0.3 + R() * 0.9) * size * p.spread, life = 0.55 + R() * 0.45, k = u / life, col = cols[Math.floor(R() * cols.length) % cols.length], sz = m * p.size * (0.5 + R());
      var rot0 = R() * 6.28, spin = (R() - 0.5) * 8, wob = R();
      if (k >= 1 || k <= 0) continue;
      var e = out3(k), x = origin[0]! + Math.cos(ang) * sp * e, y = origin[1]! + Math.sin(ang) * sp * e + p.gravity * size * k * k, al = 1 - k;
      if (p.kind === "shards") { var ro = rot0 + spin * k, pts: Pt[] = [[x + Math.cos(ro) * sz * 1.6, y + Math.sin(ro) * sz * 1.6], [x + Math.cos(ro + 2.3) * sz, y + Math.sin(ro + 2.3) * sz], [x + Math.cos(ro + 4.1) * sz * 0.8, y + Math.sin(ro + 4.1) * sz * 0.8]]; poly(out, 3, pts, { f: col, a: al * 0.9, s: "#120c09", w: Math.max(0.6, sz * 0.12) }); }
      else if (p.kind === "sparks") { var dx = Math.cos(ang) * sz * 3 * (1 - k), dy = Math.sin(ang) * sz * 3 * (1 - k); poly(out, 3, [[x - dx, y - dy], [x, y]], { s: col, w: Math.max(1, sz * 0.5), a: al, open: true, cap: "round", b: "lighter" }); }
      else circ(out, 3, x + Math.sin(k * 6 + wob * 5) * sz * 2, y - (p.kind === "embers" ? size * 0.4 * k : 0), sz * (1 - k * 0.5), { f: col, a: al * (0.6 + 0.4 * Math.sin(k * 9 + wob * 6)), b: "lighter" });
    }
  }
  function drawRays(out: any, p: any, origin: number[], len: number, I: number, seed: number, turn: number, clipShape: any): void {
    var R = rng(seed + p.seed), base = (p.angle * Math.PI) / 180 + turn;
    if (clipShape) out.ops.push({ k: "clip", L: 3, p: flat(clipShape) });
    for (var i = 0; i < p.count; i++) {
      var a = base + (i / p.count) * Math.PI * 2 * (clipShape ? 0.12 : 1) + (R() - 0.5) * 0.4, wdt = 0.04 + R() * 0.07, l = len * (0.6 + R() * 0.5);
      var tip1 = [origin[0]! + Math.cos(a - wdt) * l, origin[1]! + Math.sin(a - wdt) * l], tip2 = [origin[0]! + Math.cos(a + wdt) * l, origin[1]! + Math.sin(a + wdt) * l];
      poly(out, 3, [origin, tip1, tip2], { f: linear(origin[0]!, origin[1]!, (tip1[0]! + tip2[0]!) / 2, (tip1[1]! + tip2[1]!) / 2, [[0, rgba(p.color, p.strength * I)], [1, rgba(p.color, 0)]]), b: "lighter" });
    }
    if (clipShape) out.ops.push({ k: "unclip", L: 3 });
  }
  function drawAmbient(out: any, layers: any[], v: any, body: any, L: any, t: number, Q: any, calm: boolean): void {
    if (!Q.ambient || calm) return;
    for (var i = 0; i < layers.length; i++) {
      var p = layers[i], s = t / 1000, b = body.box;
      if (p.draw === "shimmer" && v.progress > 0) {
        var ph = (s / p.period) % 1, x = b.x - b.w * 0.3 + ph * b.w * 1.6, wdt = b.h * 0.9;
        out.ops.push({ k: "clip", L: 3, p: flat(body.shape) });
        poly(out, 3, [[x, b.y + b.h], [x + wdt, b.y + b.h], [x + wdt + b.h * 0.6, b.y], [x + b.h * 0.6, b.y]], { f: linear(x, 0, x + wdt + b.h * 0.6, 0, [[0, rgba(p.color, 0)], [0.5, rgba(p.color, p.strength)], [1, rgba(p.color, 0)]]), b: "lighter" });
        out.ops.push({ k: "unclip", L: 3 });
        out.animating = true;
      } else if (p.draw === "flicker") {
        var nz = noise1(77)(s * p.rate * 2), dip = nz > 0.55 ? (nz - 0.55) * 2.2 : 0;   // smooth noise, rate bounded: never above 3 Hz
        out.layerAlpha[1] = 1 - p.strength * dip; out.animating = true;
      } else if (p.draw === "breathe") {
        var a = p.strength * (0.5 + 0.5 * Math.sin((s / p.period) * Math.PI * 2));
        out.layerAlpha[1] = 1 - p.strength * 0.5 + a * 0.5; out.animating = true;
      } else if (p.draw === "rays" && Q.rays && v.progress > 0) {
        drawRays(out, p, [b.x + b.w * 0.15, b.y - b.h * 0.6], Math.max(b.w, b.h) * 1.6, 0.6 + 0.4 * noise1(p.seed)(s * 0.15), p.seed, 0, body.shape); out.animating = true;
      } else if (p.draw === "particles" && Q.particles > 0) {
        var R = rng(p.seed), n = Math.round(p.count * Q.particles);
        for (var k = 0; k < n; k++) { var life = 3 + R() * 4, ph2 = ((s + R() * life) % life) / life, x0 = b.x + R() * b.w, y0 = b.y + b.h * (0.3 + R() * 0.7), col = p.colors[k % p.colors.length], sz = Math.min(L.w, L.h) * p.size * (0.4 + R() * 0.6); circ(out, 3, x0 + Math.sin(ph2 * 6 + k) * sz * 3, y0 - ph2 * b.h * 0.8 * p.spread, sz, { f: col, a: Math.sin(Math.PI * ph2) * 0.7, b: "lighter" }); }
        out.animating = true;
      }
    }
  }
  function drawEffects(out: any, eff: any, v: any, body: any, L: any, t: number, Q: any, ctx: any): void {
    if (!eff || typeof eff !== "object") return;
    var g = eff.bloom && paramsOf2("bloom", eff.bloom, ctx);
    if (g && Q.bloom && g.strength > 0) out.ops.push({ k: "bloom", L: 3, layer: 1, a: g.strength, blur: r2(Math.max(2, Math.min(L.w, L.h) * 0.03)) });
    var vg = eff.vignette && paramsOf2("vignette", eff.vignette, ctx);
    if (vg && Q.vignette && vg.strength > 0) out.ops.push({ k: "vignette", L: 3, a: vg.strength, c: vg.color });
    var gr = eff.grain && paramsOf2("grain", eff.grain, ctx);
    // grain changes with the frame index (seeded tiles) only while something else moves: at rest the picture stays still (no frame at all)
    if (gr && Q.grain && gr.amount > 0) out.ops.push({ k: "grain", L: 3, a: gr.amount, n: ctx.calm || !gr.rate ? 0 : Math.floor((t / 1000) * gr.rate) % 4 });
    var ef = eff.edgeFade && paramsOf2("edgeFade", eff.edgeFade, ctx);
    if (ef && (ef.left || ef.right || ef.bottom)) out.ops.push({ k: "fade", L: 3, l: ef.left, r: ef.right, b: ef.bottom });
  }
  function paramsOf2(name: string, raw: any, ctx: any): any {
    var spec = SPEC.effects[name], o: any = {}; raw = raw && typeof raw === "object" ? raw : {};
    for (var k in spec) { var s = spec[k], v = raw[k]; o[k] = s[0] === "color" ? colorOf(v, s[1], ctx) : num(v, s[1], s[2], s[3]); }
    return o;
  }

  /**
   * THE FRAME: state + recipe + instant + size → draw list. Pure. `opts`: quality ("full" | "light" | "minimal"), calm (reduced motion), tokens
   * ({ fg, accent, surface } as #rrggbb), font (the skin's font stack), lang ("fr" | "en"), minText (px: the smallest text allowed, TV-scaled).
   */
  function frame(stateRaw: any, recipe: any, t: number, size: any, opts: any): any {
    opts = opts || {};
    var s = normState(stateRaw), v = view(s, t), w = Math.max(40, num(size && size.w, 40, 8192, 640)), h = Math.max(20, num(size && size.h, 20, 8192, 200));
    var qn = QUALITY[opts.quality] ? opts.quality : "full", Q = QUALITY[qn], calm = !!opts.calm;
    var tokens = { fg: HEX.test((opts.tokens || {}).fg || "") ? opts.tokens.fg : "#ffffff", accent: HEX.test((opts.tokens || {}).accent || "") ? opts.tokens.accent : "#e8a23b", surface: HEX.test((opts.tokens || {}).surface || "") ? opts.tokens.surface : "#14171c" };
    var ok = usable(recipe), rc = ok ? recipe : null, cx: any = { tokens: tokens, colors: rc && rc.colors && typeof rc.colors === "object" ? rc.colors : {}, font: typeof opts.font === "string" ? opts.font : "", lang: opts.lang === "fr" ? "fr" : "en", calm: calm, v: v };
    var g = v.genre, roles = GENRES[g], lay: any = {};
    for (var i = 0; i < roles.length; i++) lay[roles[i]] = layersOf(rc, BASIC, g, roles[i], cx);
    var out = List(); out.animating = false; out.layerAlpha = [1, 1, 1];
    var valueStyle = textStyle(lay.value || []), labelStyle = (lay.label && lay.label.length) ? textStyle(lay.label) : valueStyle;
    var bodyLayer = (lay.body || [])[0] || null, bodyDraw = bodyLayer ? bodyLayer.draw : "none";
    var L = layout(g, w, h, bodyDraw, valueStyle, !!v.label, v.timerLeft !== null, num(opts.minText, 8, 200, 18));
    // body
    var body: any;
    if (g === "counter" || !bodyLayer) body = { shape: roundRect(L.body.x, L.body.y, L.body.w, L.body.h, 8), head: L.center, box: L.body };
    else if (bodyDraw === "mosaic") body = drawMosaic(out, v, L.body, bodyLayer, Q);
    else if (bodyDraw === "rose") body = L.rose ? drawRose(out, v, L.rose, bodyLayer, Q) : drawRose(out, v, [L.center[0], L.center[1], Math.min(L.body.w, L.body.h) / 2], bodyLayer, Q);
    else if (bodyDraw === "tube") body = drawTube(out, v, L.body, bodyLayer, Q);
    else if (bodyDraw === "cells") body = drawCells(out, v, L.body, bodyLayer, Q);
    else body = drawBar(out, v, L.body, bodyLayer);
    drawFrame(out, lay.frame || [], L, body, t, Q, calm);
    if (lay.ticks) drawTicks(out, lay.ticks, v, body, L);
    drawAmbient(out, lay.ambient || [], v, body, L, t, Q, calm);
    drawTimer(out, lay.timer || [], v, L, valueStyle, Q, cx);
    // texts: the value (formatted by the engine), the label (the module's words)
    var valueTxt = g === "levels" ? String(v.level) : g === "gauge" && v.format === "count" && v.target > 0 ? fmt(v.display, "count", cx.lang, "") + " / " + fmt(v.target, "count", cx.lang, "") : fmt(v.display, v.format, cx.lang, v.currency);
    cx.valuePos = L.value; cx.valueStyle = valueStyle;
    // reactions: steps and celebrations (merged bursts, at most one celebration at a time)
    for (var k = 0; k < v.highlights.length; k++) { var hl = v.highlights[k]; drawReaction(out, hl.celebrate ? lay.burst || [] : lay.step || [], hl, body, L, Q, calm, cx); out.animating = true; }
    drawText(out, v.label, L.label, L.labelSize, labelStyle, Q, 1, 0, cx);
    drawText(out, valueTxt, L.value, L.valueSize, valueStyle, Q, 1, 0, cx);
    drawEffects(out, rc && rc.effects, v, body, L, t, Q, cx);
    if (v.moving || v.timeLive) out.animating = true;
    var base = [w, h, qn, calm ? 1 : 0, ok ? hash(JSON.stringify(rc)) : 0, cx.font, tokens.fg, tokens.accent].join("|");
    return { ops: out.ops, keys: [base, base + "|" + (out.key1 || "") + "|" + v.level, base], inc1: out.inc1 ? [base + "|" + out.inc1[0], out.inc1[1]] : null, layerAlpha: out.layerAlpha, animating: out.animating, view: v, size: { w: w, h: h }, skin: ok, quality: qn, calm: calm };
  }

  // ───────────────────────── Canvas 2D output ─────────────────────────
  function paint(c: any, p: any): any {
    if (typeof p === "string") return p;
    if (!p || !p.s) return "rgba(0,0,0,0)";
    var gr = p.g === "rad" ? c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r) : c.createLinearGradient(p.x0, p.y0, p.x1, p.y1);
    for (var i = 0; i < p.s.length; i++) gr.addColorStop(clamp(p.s[i][0], 0, 1), p.s[i][1]);
    return gr;
  }
  function trace(c: any, pts: number[], closed: boolean): void { c.beginPath(); c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); if (closed) c.closePath(); }
  var GRAIN: any[] = [];
  function grainTile(doc: any, n: number): any {
    if (GRAIN[n]) return GRAIN[n];
    var cv = doc.createElement("canvas"); cv.width = 128; cv.height = 128; var g = cv.getContext("2d"), img = g.createImageData(128, 128), R = rng(9001 + n);
    for (var i = 0; i < img.data.length; i += 4) { var v = Math.floor(R() * 255); img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0); GRAIN[n] = cv; return cv;
  }
  function drawOps(c: any, ops: any[], layer: number, W: number, H: number): void {
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i]; if ((o.L === undefined ? 3 : o.L) !== layer) continue;
      if (o.k === "clip") { c.save(); trace(c, o.p, true); c.clip(); continue; }
      if (o.k === "unclip") { c.restore(); continue; }
      c.save();
      c.globalAlpha = o.a === undefined ? 1 : clamp(o.a, 0, 1);
      if (o.b === "lighter") c.globalCompositeOperation = "lighter";
      if (o.g) { c.shadowBlur = o.g; c.shadowColor = o.gc || "#ffffff"; }
      if (o.k === "poly") {
        trace(c, o.p, !o.open);
        if (o.f) { c.fillStyle = paint(c, o.f); c.fill(); }
        if (o.s) { c.shadowBlur = o.g && !o.f ? o.g : 0; c.strokeStyle = paint(c, o.s); c.lineWidth = o.w || 1; c.lineJoin = o.j || "round"; c.lineCap = o.cap || "butt"; c.stroke(); }
      } else if (o.k === "circ") {
        c.beginPath(); c.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        if (o.f) { c.fillStyle = paint(c, o.f); c.fill(); }
        if (o.s) { c.strokeStyle = paint(c, o.s); c.lineWidth = o.w || 1; c.stroke(); }
      } else if (o.k === "text") {
        var sz = o.sz; c.font = o.wt + " " + sz + "px " + o.ff;
        var mw = c.measureText(o.t).width;
        if (o.mw && mw > o.mw) { sz = Math.max(8, (sz * o.mw) / mw); c.font = o.wt + " " + sz + "px " + o.ff; }   // a smaller size, never a squeezed text
        c.textAlign = o.al || "left"; c.textBaseline = "middle"; c.lineJoin = "round"; c.miterLimit = 2;
        if (o.ow > 0) { c.strokeStyle = o.o; c.lineWidth = o.ow * 2 * (sz / o.sz); c.strokeText(o.t, o.x, o.y); }
        if (o.gl) { c.shadowBlur = o.gl; c.shadowColor = o.gc; }
        c.fillStyle = o.f; c.fillText(o.t, o.x, o.y);
      } else if (o.k === "vignette") {
        c.globalCompositeOperation = "source-atop"; var r = Math.sqrt(W * W + H * H) / 2, gv = c.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
        gv.addColorStop(0, rgba(o.c, 0)); gv.addColorStop(1, rgba(o.c, 1)); c.fillStyle = gv; c.fillRect(0, 0, W, H);
      } else if (o.k === "grain" && c.canvas && c.canvas.ownerDocument) {
        c.globalCompositeOperation = "source-atop"; c.globalAlpha = o.a; var pat = c.createPattern(grainTile(c.canvas.ownerDocument, o.n), "repeat"); c.fillStyle = pat; c.fillRect(0, 0, W, H);
      } else if (o.k === "fade") {
        c.globalCompositeOperation = "destination-out";
        if (o.l > 0) { var gl = c.createLinearGradient(0, 0, W * o.l, 0); gl.addColorStop(0, "rgba(0,0,0,1)"); gl.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gl; c.fillRect(0, 0, W * o.l, H); }
        if (o.r > 0) { var gr2 = c.createLinearGradient(W, 0, W * (1 - o.r), 0); gr2.addColorStop(0, "rgba(0,0,0,1)"); gr2.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr2; c.fillRect(W * (1 - o.r), 0, W * o.r, H); }
        if (o.b > 0) { var gb = c.createLinearGradient(0, H, 0, H * (1 - o.b)); gb.addColorStop(0, "rgba(0,0,0,1)"); gb.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gb; c.fillRect(0, H * (1 - o.b), W, H * o.b); }
      }
      c.restore();
    }
  }
  var POST: any = { bloom: 1, vignette: 1, grain: 1 };
  function layerCanvas(cache: any, l: number, f: any, W: number, H: number, dpr: number): any {
    var cv = cache.layers[l] || (cache.layers[l] = cache.doc.createElement("canvas"));
    var inc = l === 1 && f.inc1 && cache.inc1 && cache.inc1[0] === f.inc1[0] && f.inc1[1] > cache.inc1[1] && cv.width === Math.round(W * dpr) && cv.height === Math.round(H * dpr);
    if (inc && cache.keys[l] !== f.keys[l]) {
      var ic = cv.getContext("2d"), more: any[] = []; ic.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (var j = 0; j < f.ops.length; j++) { var oj = f.ops[j]; if (oj.L === 1 && oj.pr >= cache.inc1[1] && oj.pr < f.inc1[1]) more.push(oj); }
      drawOps(ic, more, 1, W, H); cv.__empty = false; cache.keys[l] = f.keys[l]; cache.inc1 = f.inc1; cache.redraws = (cache.redraws || 0) + 1;
      return cv;
    }
    if (l === 1) cache.inc1 = f.inc1;
    if (cache.keys[l] !== f.keys[l] || cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var lc = cv.getContext("2d"); lc.setTransform(dpr, 0, 0, dpr, 0, 0); lc.clearRect(0, 0, W, H);
      var any = false; for (var i = 0; i < f.ops.length; i++) if ((f.ops[i].L === undefined ? 3 : f.ops[i].L) === l) { any = true; break; }
      if (any) drawOps(lc, f.ops, l, W, H);
      cv.__empty = !any; cache.keys[l] = f.keys[l]; cache.redraws = (cache.redraws || 0) + 1;
    }
    return cv;
  }
  /**
   * Paints a frame on a 2D context. With a `cache`, layers 0-2 are bitmaps kept while their key does not change, and they are flattened with the costly post
   * effects (bloom, vignette, grain) into ONE composite bitmap, rebuilt only when a key, a layer's alpha or the grain index changes: a frame at rest costs one
   * image copy plus the moving pieces (layer 3), which are never blurred or grained (texts stay sharp).
   */
  function draw(c: any, f: any, cache: any): void {
    var W = f.size.w, H = f.size.h, dpr = cache && cache.dpr || 1, i: number;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    var post: any[] = [], live: any[] = [];
    for (i = 0; i < f.ops.length; i++) { var o = f.ops[i]; if (POST[o.k]) post.push(o); else if ((o.L === undefined ? 3 : o.L) === 3) live.push(o); }
    if (!cache || !cache.doc) {
      for (var l0 = 0; l0 < 3; l0++) { c.save(); c.globalAlpha = f.layerAlpha[l0]; drawOps(c, f.ops, l0, W, H); c.restore(); }
      drawOps(c, live, 3, W, H);
      return;
    }
    var ck = f.keys.join("#") + "|" + f.layerAlpha.join(",") + "|" + JSON.stringify(post) + "|" + W + "x" + H + "@" + dpr;
    var comp = cache.comp || (cache.comp = cache.doc.createElement("canvas"));
    if (cache.ck !== ck || comp.width !== Math.round(W * dpr) || comp.height !== Math.round(H * dpr)) {
      comp.width = Math.round(W * dpr); comp.height = Math.round(H * dpr);
      var cc = comp.getContext("2d"); cc.setTransform(1, 0, 0, 1, 0, 0); cc.clearRect(0, 0, comp.width, comp.height);
      for (var l = 0; l < 3; l++) { var cv = layerCanvas(cache, l, f, W, H, dpr); if (cv.__empty) continue; cc.globalAlpha = f.layerAlpha[l]; cc.drawImage(cv, 0, 0); }
      cc.globalAlpha = 1; cc.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (i = 0; i < post.length; i++) {
        var p = post[i];
        if (p.k === "bloom") {
          var src = cache.layers[p.layer]; if (!src || src.__empty) continue;
          var bk = cache.keys[p.layer] + "|" + p.blur, bc = cache.bloom || (cache.bloom = cache.doc.createElement("canvas"));
          if (cache.bloomKey !== bk || bc.width !== Math.max(1, Math.ceil(src.width / 4))) {   // blurred once per key, never per frame
            // at a quarter of the size: a blur is a low-frequency picture, so this costs 1/16 and looks the same once scaled back
            bc.width = Math.max(1, Math.ceil(src.width / 4)); bc.height = Math.max(1, Math.ceil(src.height / 4)); var bx = bc.getContext("2d"); bx.clearRect(0, 0, bc.width, bc.height); bx.filter = "blur(" + Math.max(1, (p.blur * dpr) / 4) + "px)"; bx.drawImage(src, 0, 0, bc.width, bc.height); bx.filter = "none"; cache.bloomKey = bk;
          }
          cc.save(); cc.setTransform(1, 0, 0, 1, 0, 0); cc.globalCompositeOperation = "lighter"; cc.globalAlpha = p.a; cc.imageSmoothingEnabled = true; cc.drawImage(bc, 0, 0, comp.width, comp.height); cc.restore();
        } else drawOps(cc, [p], 3, W, H);
      }
      cache.ck = ck; cache.composites = (cache.composites || 0) + 1;
    }
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(comp, 0, 0); c.restore();
    drawOps(c, live, 3, W, H);
  }

  // ───────────────────────── the live loop ─────────────────────────
  var HANDLES: any[] = [];
  function tokensOf(doc: any): any {
    var out: any = {};
    try {
      var cs = win.getComputedStyle(doc.documentElement), probe = doc.createElement("span"); doc.body.appendChild(probe);
      var names: any = { fg: "--ov-fg", accent: "--ov-accent", surface: "--ov-surface" };
      for (var k in names) { var raw = cs.getPropertyValue(names[k]).trim(); if (raw) { probe.style.color = raw; var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(win.getComputedStyle(probe).color); if (m) out[k] = hex([+m[1]!, +m[2]!, +m[3]!]); } }
      out.font = cs.getPropertyValue("--ov-font").trim();
      doc.body.removeChild(probe);
    } catch { /* the defaults */ }
    return out;
  }
  function mount(target: any, o: any): any {
    o = o || {};
    var doc = target.ownerDocument || win.document, canvas = target.tagName === "CANVAS" ? target : doc.createElement("canvas");
    if (canvas !== target) { canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block"; canvas.setAttribute("aria-hidden", "true"); target.appendChild(canvas); }
    var c = canvas.getContext("2d"), cache = { doc: doc, layers: [] as any[], keys: [] as any[], dpr: 1, redraws: 0 };
    var reduce = !!(win.matchMedia && win.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var H: any = { state: o.state || { genre: o.genre || "gauge" }, skin: o.skin !== undefined ? o.skin : win.__curiosaAnimSkin || null, quality: QUALITY[o.quality] ? o.quality : "full", auto: o.quality === "auto", win: [] as number[], calm: o.calm === true || (o.calm !== false && reduce), skew: 0, fps: num(o.fps, 1, 60, 30), lang: o.lang === "fr" ? "fr" : "en", minText: num(o.minText, 8, 200, 18), stats: { frames: 0, total: 0, max: 0, times: [] as number[] }, dirty: true, last: 0, alive: true, tokens: null };
    if (typeof o.serverNow === "number") H.skew = o.serverNow - Date.now();
    var raf = win.requestAnimationFrame ? function (f: any) { return win.requestAnimationFrame(f); } : function (f: any) { return win.setTimeout(f, 33); };
    function size(): any { var r = canvas.getBoundingClientRect(), w = Math.max(40, Math.round(r.width || target.clientWidth || 640)), h = Math.max(20, Math.round(r.height || target.clientHeight || 200)), dpr = Math.min(2, win.devicePixelRatio || 1); if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); cache.dpr = dpr; cache.keys = []; H.dirty = true; } return { w: w, h: h }; }
    var lastAnimating = true;
    function tick(): void {
      if (!H.alive) return;
      raf(tick);
      var now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      if (now - H.last < 1000 / H.fps - 2) return;
      if (!lastAnimating && !H.dirty) return;   // nothing moves: no frame at all (0 % at rest)
      H.last = now;
      if (!H.tokens) H.tokens = tokensOf(doc);
      var t0 = now, f = frame(H.state, H.skin, Date.now() + H.skew, size(), { quality: H.quality, calm: H.calm, tokens: H.tokens, font: H.tokens.font, lang: H.lang, minText: H.minText });
      draw(c, f, cache);
      var dt = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      // "auto" quality: a computer that cannot keep up (frames costing more than 14 ms on average) steps down once to light, then to minimal; never back up
      if (H.auto) { H.win.push(dt); if (H.win.length >= 45) { var sum = 0; for (var q = 0; q < H.win.length; q++) sum += H.win[q]; if (sum / H.win.length > 14 && H.quality !== "minimal") { H.quality = H.quality === "full" ? "light" : "minimal"; H.stats.downgrades = (H.stats.downgrades || 0) + 1; } H.win = []; } }
      H.stats.frames++; H.stats.total += dt; if (dt > H.stats.max) H.stats.max = dt; if (H.stats.times.length < 2000) H.stats.times.push(dt);
      lastAnimating = f.animating; H.dirty = false; H.lastFrame = f;
    }
    var api = {
      setState: function (s: any) { H.state = s; H.dirty = true; },
      setSkin: function (r: any) { H.skin = r || null; H.dirty = true; },
      setClock: function (serverNow: number) { if (typeof serverNow === "number") { H.skew = serverNow - Date.now(); H.dirty = true; } },
      setOptions: function (x: any) { if (x && (QUALITY[x.quality] || x.quality === "auto")) { H.auto = x.quality === "auto"; H.quality = H.auto ? "full" : x.quality; } if (x && typeof x.calm === "boolean") H.calm = x.calm || reduce; if (x && typeof x.fps === "number") H.fps = num(x.fps, 1, 60, 30); H.tokens = null; H.dirty = true; },
      refreshTokens: function () { H.tokens = null; H.dirty = true; },
      stats: function () { var ts = H.stats.times.slice().sort(function (a: number, b: number) { return a - b; }); return { quality: H.quality, auto: H.auto, downgrades: H.stats.downgrades || 0, frames: H.stats.frames, avg: H.stats.frames ? H.stats.total / H.stats.frames : 0, p95: ts.length ? ts[Math.floor(ts.length * 0.95)] : 0, max: H.stats.max, layerRedraws: cache.redraws, animating: lastAnimating }; },
      frameNow: function () { return H.lastFrame || null; },
      destroy: function () { H.alive = false; var i = HANDLES.indexOf(api); if (i >= 0) HANDLES.splice(i, 1); },
    };
    HANDLES.push(api);
    raf(tick);
    return api;
  }
  /** Element options of the animation, read from the element's address (`opt-animQuality`, `opt-animCalm`): the names a module declares to offer them. */
  function optionsFromQuery(q: string): any { var p: any = {}; String(q || "").replace(/^\?/, "").split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) p[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); }); var tv = +p["ov-tv"]; return { quality: QUALITY[p["opt-animQuality"]] || p["opt-animQuality"] === "auto" ? p["opt-animQuality"] : undefined, calm: p["opt-animCalm"] === "1" || p["opt-animCalm"] === "true" ? true : undefined, lang: p["ov-lang"] === "fr" ? "fr" : p["ov-lang"] ? "en" : undefined, minText: tv > 0 && tv < 20 ? 24 * tv : undefined }; }

  win.CuriosaAnimate = {
    version: SPEC.version, contract: SPEC.contract, spec: SPEC,
    view: view, frame: frame, draw: draw, mount: mount, basicRecipe: basicRecipe, usable: usable, optionsFromQuery: optionsFromQuery,
    format: fmt, contrast: contrast,
    /** Called by the core's overlay page when the page's skin (or an element's own skin) changes: every mounted element follows. */
    setSkin: function (r: any) { win.__curiosaAnimSkin = r || null; for (var i = 0; i < HANDLES.length; i++) HANDLES[i].setSkin(r || null); },
  };
}
