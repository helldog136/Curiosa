/**
 * THE SCENE CHECKER (core 0.40.0): reads a skin's `scene.json` (animateContract 3, docs/OVERLAY-ANIMATIONS.md "Scenes") with the closed grammar of `SCENE` in
 * spec.ts. Run at install, at every reading of an installed skin and by `skin:check`. Pure (no file, no network): the pictures' sizes come from the caller,
 * who read their headers (imageProbe.ts).
 *
 * TOLERANT READER from the first day: an anchor, a reveal mode, an event, a property, a kit or a key this core does not know is skipped with a warning; a known
 * word with a value out of its bounds, a picture that is not declared, a timeline that does not exist: an error (the author fixes it at once). A scene WRITTEN
 * for a later contract (`animateContract` above ours, `animateMinContract` not above ours) is read as far as we know it, and even a bad value is only a warning.
 * A minimum above ours switches the scene off (`newer`): the skin installs with the basic look.
 *
 * The result is the CLEANED scene (only what is known and valid, numbers inside their bounds): that object is what the engine gets.
 */
import { MOTION, PRIMITIVES, SCENE, SCENE_CONTRACT } from "./spec";
import { contrastRatio } from "./recipe";

export type SceneIssue = { code: "shape" | "contract" | "contract-newer" | "contract-ahead" | "unknown" | "asset" | "param" | "reference" | "limit" | "text-contrast"; path: string; severity: "error" | "warning" };
/** What the caller knows of each declared picture of the skin (by its file path in the skin): size read from its header, and whether it is a vector picture. */
export type SceneAssetInfo = { w: number; h: number; svg: boolean };
export type SceneCheck = { ok: boolean; scene: Record<string, unknown> | null; issues: SceneIssue[]; newer?: boolean };

const NAME = /^[a-z][a-z0-9-]{0,20}$/;
const FILE = /^images\/[a-z0-9][a-z0-9._-]{0,63}\.(png|webp|svg)$/;
const TOKEN_REFS = new Set(["fg", "accent", "surface"]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const B = SCENE.bounds, LIM = SCENE.limits;
const TOP_KEYS = new Set(["animateContract", "animateMinContract", "assets", "kits", "timelines", "emitters", "$comment"]);
const LAYER_KEYS = new Set(["id", "src", "at", "role", "fit", "size", "offset", "pivot", "alpha", "alphaUnlit", "rot", "blend", "tier", "reveal", "along", "loop", "calmFrame", "on", "$comment"]);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const inList = (list: readonly string[], v: unknown): v is string => typeof v === "string" && list.includes(v);

export function checkScene(raw: unknown, assetsByFile: ReadonlyMap<string, SceneAssetInfo>): SceneCheck {
  const issues: SceneIssue[] = [];
  const push = (code: SceneIssue["code"], path: string, severity: "error" | "warning") => { if (issues.length < 40) issues.push({ code, path: path.slice(0, 80), severity }); };
  if (!isObj(raw)) return { ok: false, scene: null, issues: [{ code: "shape", path: "scene.json", severity: "error" }] };
  const c = raw.animateContract as number;
  if (!Number.isInteger(c) || c < 3) return { ok: false, scene: null, issues: [{ code: "contract", path: "animateContract", severity: "error" }] };
  const minC = raw.animateMinContract === undefined ? c : raw.animateMinContract;
  if (!Number.isInteger(minC) || (minC as number) < 3 || (minC as number) > c) return { ok: false, scene: null, issues: [{ code: "contract", path: "animateMinContract", severity: "error" }] };
  if ((minC as number) > SCENE_CONTRACT) return { ok: true, scene: null, newer: true, issues: [{ code: "contract-newer", path: "animateContract", severity: "warning" }] };
  const ahead = c > SCENE_CONTRACT;
  if (ahead) push("contract-ahead", "animateContract", "warning");
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) push("unknown", k, "warning");
  /** An error for a value out of its bounds; only a warning for a scene written for a later contract. */
  const bad = (code: SceneIssue["code"], path: string) => push(code, path, ahead ? "warning" : "error");

  /** A bounded number: its value, or null (reported). */
  const num = (v: unknown, b: readonly number[], path: string, int = false): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < b[0]! || v > b[1]! || (int && !Number.isInteger(v))) { bad("param", path); return null; }
    return v;
  };
  const pair = (v: unknown, b: readonly number[], path: string, ordered = false): [number, number] | null => {
    if (!Array.isArray(v) || v.length !== 2) { bad("param", path); return null; }
    const a = num(v[0], b, `${path}.0`), z = num(v[1], b, `${path}.1`);
    if (a === null || z === null) return null;
    if (ordered && a > z) { bad("param", path); return null; }
    return [a, z];
  };
  /** Keyframes [[u, value], …]: 2 to 12, u strictly rising inside 0..1. */
  const keys = (v: unknown, b: readonly number[], path: string, int = false): number[][] | null => {
    if (!Array.isArray(v) || v.length < 2 || v.length > LIM.keys) { bad("param", path); return null; }
    const out: number[][] = [];
    for (let i = 0; i < v.length; i++) {
      const k = v[i];
      const u = Array.isArray(k) && k.length === 2 ? num(k[0], B.keyU, `${path}.${i}`) : null, x = Array.isArray(k) && k.length === 2 ? num(k[1], b, `${path}.${i}`, int) : null;
      if (u === null || x === null || (out.length && u <= out[out.length - 1]![0]!)) { bad("param", `${path}.${i}`); return null; }
      out.push([u, x]);
    }
    return out;
  };

  // ---- the pictures: a key names a file declared by the skin (and listed in its manifest, so licensed and measured)
  const assets: Record<string, { file: string; w: number; h: number; svg: boolean; cols: number; rows: number }> = {};
  if (!isObj(raw.assets)) bad("shape", "assets");
  else {
    const entries = Object.entries(raw.assets);
    if (entries.length > LIM.assets) bad("limit", "assets");
    let total = 0;
    for (const [key, def] of entries.slice(0, LIM.assets)) {
      const path = `assets.${key}`;
      if (!NAME.test(key)) { bad("shape", path); continue; }
      if (!isObj(def) || typeof def.file !== "string" || !FILE.test(def.file)) { bad("asset", path); continue; }
      const info = assetsByFile.get(def.file);
      if (!info) { bad("asset", `${path}.file`); continue; }
      let cols = 1, rows = 1;
      if (def.grid !== undefined) {
        const g = pair(def.grid, [1, LIM.grid], `${path}.grid`);
        if (!g || !Number.isInteger(g[0]) || !Number.isInteger(g[1]) || g[0] * g[1] > LIM.frames) { if (g) bad("limit", `${path}.grid`); continue; }
        [cols, rows] = g;
      }
      if (info.w > LIM.side || info.h > LIM.side || info.w * info.h > LIM.pixels) { bad("limit", `${path}.file`); continue; }
      total += info.w * info.h;
      if (total > LIM.totalPixels) { bad("limit", "assets"); break; }
      assets[key] = { file: def.file, w: info.w, h: info.h, svg: info.svg, cols, rows };
    }
  }

  // ---- timelines
  const timelines: Record<string, unknown> = {};
  if (raw.timelines !== undefined) {
    if (!isObj(raw.timelines)) bad("shape", "timelines");
    else {
      const entries = Object.entries(raw.timelines);
      if (entries.length > LIM.timelines) bad("limit", "timelines");
      for (const [name, def] of entries.slice(0, LIM.timelines)) {
        const path = `timelines.${name}`;
        if (!NAME.test(name) || !isObj(def) || !isObj(def.tracks)) { bad("shape", path); continue; }
        const out: { ease: string; spring?: string; tracks: Record<string, number[][]> } = { ease: "out", tracks: {} };
        if (def.ease !== undefined) { if (inList(SCENE.eases, def.ease)) out.ease = def.ease; else bad("param", `${path}.ease`); }
        if (def.spring !== undefined) { if (typeof def.spring === "string" && def.spring in MOTION.springs) out.spring = def.spring; else bad("param", `${path}.spring`); }
        for (const [prop, ks] of Object.entries(def.tracks)) {
          if (!inList(SCENE.props, prop)) { push("unknown", `${path}.tracks.${prop}`, "warning"); continue; }   // a property of a later contract: skipped
          const b = prop === "alpha" ? B.keyAlpha : prop === "scale" ? B.keyScale : prop === "rot" ? B.keyRot : prop === "frame" ? B.keyFrame : B.keyX;
          const k = keys(ks, b, `${path}.tracks.${prop}`, prop === "frame");
          if (k) out.tracks[prop] = k;
        }
        timelines[name] = out;
      }
    }
  }

  // ---- emitters
  const emitters: Record<string, unknown> = {};
  if (raw.emitters !== undefined) {
    if (!isObj(raw.emitters)) bad("shape", "emitters");
    else {
      const entries = Object.entries(raw.emitters);
      if (entries.length > LIM.emitters) bad("limit", "emitters");
      for (const [name, def] of entries.slice(0, LIM.emitters)) {
        const path = `emitters.${name}`;
        if (!NAME.test(name) || !isObj(def)) { bad("shape", path); continue; }
        if (typeof def.src !== "string" || !assets[def.src]) { bad("reference", `${path}.src`); continue; }
        const e: Record<string, unknown> = { src: def.src, count: B.count[2], delay: B.delay[2], life: [0.5, 1], speed: [0.4, 1.2], angle: [0, 360], gravity: B.gravity[2], spin: [0, 0], size: B.size[2], scale: [[0, 1], [1, 0]], alpha: [[0, 1], [1, 0]], blend: "normal", frame: "random", seed: B.seed[2] };
        let good = true;
        const take = (k: string, v: unknown) => { if (v === null) good = false; else e[k] = v; };
        if (def.count !== undefined) take("count", num(def.count, B.count, `${path}.count`, true));
        if (def.delay !== undefined) take("delay", num(def.delay, B.delay, `${path}.delay`));
        if (def.life !== undefined) take("life", pair(def.life, B.life, `${path}.life`, true));
        if (def.speed !== undefined) take("speed", pair(def.speed, B.speed, `${path}.speed`, true));
        if (def.angle !== undefined) take("angle", pair(def.angle, B.angle, `${path}.angle`, true));
        if (def.gravity !== undefined) take("gravity", num(def.gravity, B.gravity, `${path}.gravity`));
        if (def.spin !== undefined) take("spin", pair(def.spin, B.spin, `${path}.spin`, true));
        if (def.size !== undefined) take("size", num(def.size, B.size, `${path}.size`));
        if (def.scale !== undefined) take("scale", keys(def.scale, B.keyScale, `${path}.scale`));
        if (def.alpha !== undefined) take("alpha", keys(def.alpha, B.keyAlpha, `${path}.alpha`));
        if (def.seed !== undefined) take("seed", num(def.seed, B.seed, `${path}.seed`, true));
        if (def.blend !== undefined) { if (inList(SCENE.blends, def.blend)) e.blend = def.blend; else { push("unknown", `${path}.blend`, "warning"); } }
        if (def.frame !== undefined) { if (def.frame === "random") e.frame = "random"; else take("frame", num(def.frame, B.keyFrame, `${path}.frame`, true)); }
        if (good) emitters[name] = e;
      }
    }
  }

  // ---- kits
  const kits: Record<string, unknown> = {};
  if (!isObj(raw.kits)) bad("shape", "kits");
  else for (const [kit, def] of Object.entries(raw.kits)) {
    const kp = `kits.${kit}`;
    if (!inList(SCENE.kits, kit)) { push("unknown", kp, "warning"); continue; }   // a bar kind this core does not draw with scenes yet: its basic look
    if (!isObj(def)) { bad("shape", kp); continue; }
    const out: { thickness: number; layers: Record<string, unknown>[]; text: Record<string, Record<string, unknown>>; on: Record<string, { emit: string; at: string }[]> } = { thickness: B.thickness[2], layers: [], text: {}, on: {} };
    if (def.thickness !== undefined) { const t = num(def.thickness, B.thickness, `${kp}.thickness`); if (t !== null) out.thickness = t; }
    const layers = Array.isArray(def.layers) ? def.layers : (bad("shape", `${kp}.layers`), []);
    if (layers.length > LIM.layers) bad("limit", `${kp}.layers`);
    const seenIds = new Set<string>();
    layers.slice(0, LIM.layers).forEach((L: unknown, i: number) => {
      const lp = `${kp}.layers.${i}`;
      if (!isObj(L)) { bad("shape", lp); return; }
      for (const k of Object.keys(L)) if (!LAYER_KEYS.has(k)) push("unknown", `${lp}.${k}`, "warning");
      if (typeof L.src !== "string" || !assets[L.src]) { bad("reference", `${lp}.src`); return; }
      if (!inList(SCENE.anchors, L.at)) { push("unknown", `${lp}.at`, "warning"); return; }   // an anchor of a later contract: the layer is skipped
      const layer: Record<string, unknown> = { src: L.src, at: L.at, role: "deco", fit: L.at === "head" || L.at === "tick" ? "contain" : "stretch", alpha: 1, blend: "normal", tier: "minimal" };
      let good = true;
      const take = (k: string, v: unknown) => { if (v === null) good = false; else layer[k] = v; };
      if (L.id !== undefined) { if (typeof L.id === "string" && NAME.test(L.id) && !seenIds.has(L.id)) { seenIds.add(L.id); layer.id = L.id; } else bad("shape", `${lp}.id`); }
      if (L.role !== undefined) { if (inList(SCENE.roles, L.role)) layer.role = L.role; else push("unknown", `${lp}.role`, "warning"); }
      if (L.fit !== undefined) { if (inList(SCENE.fits, L.fit)) layer.fit = L.fit; else push("unknown", `${lp}.fit`, "warning"); }
      if (L.blend !== undefined) { if (inList(SCENE.blends, L.blend)) layer.blend = L.blend; else push("unknown", `${lp}.blend`, "warning"); }
      if (L.tier !== undefined) { if (inList(SCENE.tiers, L.tier)) layer.tier = L.tier; else bad("param", `${lp}.tier`); }
      if (L.alpha !== undefined) take("alpha", num(L.alpha, B.alpha, `${lp}.alpha`));
      if (L.alphaUnlit !== undefined) take("alphaUnlit", num(L.alphaUnlit, B.alphaUnlit, `${lp}.alphaUnlit`));
      if (L.rot !== undefined) take("rot", num(L.rot, B.rot, `${lp}.rot`));
      if (L.calmFrame !== undefined) take("calmFrame", num(L.calmFrame, B.calmFrame, `${lp}.calmFrame`, true));
      if (L.offset !== undefined) take("offset", pair(L.offset, B.offset, `${lp}.offset`));
      if (L.pivot !== undefined) take("pivot", pair(L.pivot, B.pivot, `${lp}.pivot`));
      if (L.size !== undefined) {
        if (!isObj(L.size)) { bad("param", `${lp}.size`); good = false; }
        else {
          const size: Record<string, number> = {};
          if (L.size.h !== undefined) { const h = num(L.size.h, B.sizeH, `${lp}.size.h`); if (h === null) good = false; else size.h = h; }
          if (L.size.w !== undefined) { const w = num(L.size.w, B.sizeW, `${lp}.size.w`); if (w === null) good = false; else size.w = w; }
          layer.size = size;
        }
      }
      if (L.reveal !== undefined) {
        if (!isObj(L.reveal) || !inList(SCENE.reveals, L.reveal.mode)) { push("unknown", `${lp}.reveal`, "warning"); }   // a reveal mode of a later contract: the layer is simply always shown
        else if (L.at !== "track") { bad("param", `${lp}.reveal`); good = false; }
        else layer.reveal = { mode: L.reveal.mode };
      }
      if (L.along !== undefined) {
        if (!isObj(L.along) || L.at !== "fill") { bad("param", `${lp}.along`); good = false; }
        else { const e = num(L.along.every ?? B.every[2], B.every, `${lp}.along.every`); if (e === null) good = false; else layer.along = { every: e }; }
      }
      if (L.loop !== undefined) {
        const a = assets[L.src]!;
        if (!isObj(L.loop) || a.cols * a.rows < 2) { bad("param", `${lp}.loop`); good = false; }
        else { const f = num(L.loop.fps ?? B.fps[2], B.fps, `${lp}.loop.fps`, true); if (f === null) good = false; else layer.loop = { fps: f }; }
      }
      if (L.on !== undefined) {
        if (!isObj(L.on)) { bad("shape", `${lp}.on`); good = false; }
        else {
          const on: Record<string, string> = {};
          for (const [ev, tl] of Object.entries(L.on)) {
            if (!inList(SCENE.events, ev)) { push("unknown", `${lp}.on.${ev}`, "warning"); continue; }
            if (typeof tl !== "string" || !timelines[tl]) { bad("reference", `${lp}.on.${ev}`); good = false; continue; }
            on[ev] = tl;
          }
          layer.on = on;
        }
      }
      if (good) out.layers.push(layer);
    });
    // texts: the core draws them; a scene only styles them (the `text` primitive's words), and the readability rule is decided here when the colours are known
    if (def.text !== undefined) {
      if (!isObj(def.text)) bad("shape", `${kp}.text`);
      else for (const role of ["value", "label"] as const) {
        const t = (def.text as Record<string, unknown>)[role];
        if (t === undefined) continue;
        const tp = `${kp}.text.${role}`;
        if (!isObj(t)) { bad("shape", tp); continue; }
        const spec = PRIMITIVES.text!.params, clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(t)) {
          const s = spec[k];
          if (!s) { push("unknown", `${tp}.${k}`, "warning"); continue; }
          let ok = true;
          switch (s[0]) {
            case "num": ok = typeof v === "number" && v >= s[1] && v <= s[2]; break;
            case "int": ok = Number.isInteger(v) && (v as number) >= s[1] && (v as number) <= s[2]; break;
            case "seed": ok = Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 999999; break;
            case "enum": ok = typeof v === "string" && s[1].includes(v); break;
            case "color": ok = typeof v === "string" && (HEX.test(v) || (v.startsWith("@") && TOKEN_REFS.has(v.slice(1)))); break;
            default: ok = false;
          }
          if (ok) clean[k] = v; else bad("param", `${tp}.${k}`);
        }
        const known = (v: unknown, d: string): string | null => (typeof v !== "string" ? d : HEX.test(v) ? v.toLowerCase() : null);
        const color = known(clean.color, "#ffffff"), outline = known(clean.outline, "#000000"), plateColor = known(clean.plateColor, "#14171c");
        const ow = typeof clean.outlineWidth === "number" ? clean.outlineWidth : 0.08, plate = typeof clean.plate === "string" ? clean.plate : "none", plateAlpha = typeof clean.plateAlpha === "number" ? clean.plateAlpha : 0.85;
        if (color && outline && plateColor && !(ow >= 0.04 && contrastRatio(color, outline) >= 4.5) && !(plate !== "none" && plateAlpha >= 0.8 && contrastRatio(color, plateColor) >= 4.5)) push("text-contrast", tp, "error");
        out.text[role] = clean;
      }
    }
    // what the kit's events fire: emitters only (timelines are bound on layers)
    if (def.on !== undefined) {
      if (!isObj(def.on)) bad("shape", `${kp}.on`);
      else for (const [ev, list] of Object.entries(def.on)) {
        if (!inList(SCENE.events, ev)) { push("unknown", `${kp}.on.${ev}`, "warning"); continue; }
        if (!Array.isArray(list) || list.length > 4) { bad("shape", `${kp}.on.${ev}`); continue; }
        const acts: { emit: string; at: string }[] = [];
        list.forEach((a: unknown, i: number) => {
          const ap = `${kp}.on.${ev}.${i}`;
          if (!isObj(a) || typeof a.emit !== "string") { push("unknown", ap, "warning"); return; }   // an action of a later contract (a timeline on an anchor…): skipped
          if (!emitters[a.emit]) { bad("reference", `${ap}.emit`); return; }
          const at = a.at === undefined ? "head" : a.at;
          if (!inList(SCENE.emitAt, at)) { push("unknown", `${ap}.at`, "warning"); return; }
          acts.push({ emit: a.emit, at });
        });
        out.on[ev] = acts;
      }
    }
    kits[kit] = out;
  }
  const ok = !issues.some((i) => i.severity === "error");
  return { ok, scene: ok ? { animateContract: Math.min(c, SCENE_CONTRACT), assets, kits, timelines, emitters } : null, issues };
}
