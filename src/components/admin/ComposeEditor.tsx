"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ALIGNS, ANIMS, BOX_FITS, FONTS, LIMITS, PLACEMENTS, SIZE_STEPS, canonicalComposition, checkComposition, defaultBox, defaultComposition, frameRatio, resolveComposition,
  type Box, type ComposeError, type ComposeFormat, type Composition, type PlacementId,
} from "@/core/compose/model";
import { HANDLES, baseFrame, clampRect, fitZoom, moveRect, nudge, overlapShare, placeOf, rectOf, resizeRect, snapLines, snapMove, snapResize, stepZoom, clampZoom, zoomAround, type Handle, type PRect, type SnapLine } from "@/core/compose/layout";
import { record, redo, replace, startHistory, undo, type History } from "@/core/compose/history";
import { samplePhrase, sampleValues, segments, toDisplay, toStored } from "@/core/compose/tokens";
import type { ComposeOption } from "@/core/compose/option";
import { pickTextColour, needsMeasure } from "@/core/compose/contrast";
import { COMPOSE_CSS, composeEngine } from "@/core/compose/render";
import { askConfirm } from "./confirmDialog";
import { HelpTip } from "./HelpTip";
import { ui } from "./ui";

/** The `compose.*` texts, already translated by the server. */
export type ComposeLabels = Record<string, string>;
export type { ComposeOption };
type Sample = "normal" | "long" | "big";
type PreviewBg = "checker" | "dark" | "light";

const tx = (labels: ComposeLabels, key: string, vars: Record<string, string | number> = {}): string => {
  let out = (vars.n === 1 ? labels[`${key}.one`] : undefined) ?? labels[key] ?? key;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
};
const same = (a: Composition, b: Composition) => canonicalComposition(a) === canonicalComposition(b);
const SNAP_PX = 8;
/** A number as the page language writes it ("87,9" in French). */
const fmt = (n: number) => { try { return n.toLocaleString(typeof document === "undefined" ? undefined : document.documentElement.lang || undefined); } catch { return String(n); } };
const BG: Record<PreviewBg, React.CSSProperties> = {
  checker: { backgroundColor: "#ffffff", backgroundImage: "linear-gradient(45deg,#d6d6d6 25%,transparent 25%),linear-gradient(-45deg,#d6d6d6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d6d6d6 75%),linear-gradient(-45deg,transparent 75%,#d6d6d6 75%)", backgroundSize: "20px 20px", backgroundPosition: "0 0,0 10px,10px -10px,-10px 0" },
  dark: { backgroundColor: "#16181d" },
  light: { backgroundColor: "#f4f4f2" },
};
const field = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-[15px] min-h-11";
const small = "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl border border-line bg-surface px-3 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Two to four choices as buttons (R19), controlled, outside any form (the editor is not part of the page's form). */
function Seg<T extends string | number>({ label, value, options, onChange, help, testid }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T) => void; help?: string; testid?: string }) {
  const name = useId();
  return (
    <fieldset className="min-w-0" data-testid={testid}>
      <legend className="mb-1.5 flex items-center gap-1 text-[15px] font-medium">{label}{help && <HelpTip help={help} name={label} />}</legend>
      <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-bg p-1">
        {options.map((o) => (
          <label key={String(o.value)} className="relative flex min-h-11 min-w-[3.25rem] flex-1 cursor-pointer items-center justify-center rounded-xl px-2 py-1.5 text-center text-sm font-medium transition-colors hover:bg-surface has-[:checked]:bg-accent has-[:checked]:text-accent-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
            <input type="radio" name={name} className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="[overflow-wrap:anywhere]">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function Num({ label, value, min, max, step, hint, onChange, id }: { label: string; value: number; min: number; max: number; step: number; hint: string; onChange: (n: number) => void; id: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[14px] font-medium">{label}</label>
      <input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={text} aria-describedby={`${id}-h`} className={field}
        onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n); }}
        onBlur={() => setDraft(null)} />
      <p id={`${id}-h`} className="mt-1 text-[12px] text-muted">{hint}</p>
    </div>
  );
}

/** Pixels of the picture under a box, read through a small canvas (the picture is a file of the site: same origin). Null when the browser cannot read it. */
function pixelsUnder(img: HTMLImageElement, comp: Composition, box: PRect): Uint8ClampedArray | null {
  try {
    const r = frameRatio(comp.format, { width: img.naturalWidth, height: img.naturalHeight });
    const W = 160, H = Math.max(1, Math.round(W / r));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const k = comp.backdrop.fit === "contain" ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
    const dw = iw * k, dh = ih * k;
    g.drawImage(img, (W - dw) * (comp.backdrop.focus[0] / 100), (H - dh) * (comp.backdrop.focus[1] / 100), dw, dh);
    const x = Math.floor((box.x / 100) * W), y = Math.floor((box.y / 100) * H);
    return g.getImageData(x, y, Math.max(1, Math.round((box.w / 100) * W)), Math.max(1, Math.round((box.h / 100) * H))).data;
  } catch { return null; }
}

/**
 * THE COMPOSITION EDITOR (core 0.19.0): place the sentence of a reaction on a picture or a GIF. A full-screen window above the module's window (a native
 * <dialog>, so the window below neither closes on Esc nor takes the keyboard), drawn by the SAME engine as the overlay page (compose/render.ts).
 *
 * Short path (R2): drag the text, then "Use this placement" (one click). Visible fields: Text, Size, Readability (R4: 3, 4 with your own text). Everything else
 * is folded. Keyboard (R28): every box is a button; arrows move it (Shift 0.1 %, Ctrl 10 %), Alt and arrows resize it, Delete removes it; + and - zoom, 0 fits,
 * 1 is 100 %; Ctrl+Z and Ctrl+Shift+Z (or Ctrl+Y) undo and redo, 50 steps. Exact numbers live under "More options". On a phone the settings become a sheet at
 * the bottom; one finger moves a box, two fingers zoom and move the view.
 */
export function ComposeEditor({ src, name, initial, option, labels, others, onUse, onApply, onRemove, onTest, onClose }: {
  src: string; name: string; initial: Composition | null; option: ComposeOption; labels: ComposeLabels;
  /** How many other pictures of the list can receive this placement ("Apply to the other files"). */
  others: number;
  onUse: (c: Composition) => void;
  onApply: (c: Composition) => void;
  onRemove: () => void;
  onTest?: (c: Composition) => Promise<{ ok?: string; error?: string }>;
  onClose: () => void;
}) {
  const vars = option.variables;
  const start = useMemo(() => initial ?? defaultComposition(src, { format: option.formats.includes(option.defaultFormat ?? "media") ? option.defaultFormat ?? "media" : option.formats[0] }), [initial, src, option]);
  const [hist, setHist] = useState<History<Composition>>(() => startHistory(start));
  const comp = hist.present;
  const [sel, setSel] = useState(comp.boxes[0]?.id ?? "t1");
  const box = comp.boxes.find((b) => b.id === sel) ?? comp.boxes[0]!;
  const [media, setMedia] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [bg, setBg] = useState<PreviewBg>("checker");
  const [sample, setSample] = useState<Sample>("normal");
  const [guides, setGuides] = useState<SnapLine[]>([]);
  const [live, setLive] = useState("");
  const [errors, setErrors] = useState<ComposeError[]>([]);
  const [sheetFull, setSheetFull] = useState(false);
  const [test, setTest] = useState<{ pending: boolean; ok?: string; error?: string }>({ pending: false });
  const [overflow, setOverflow] = useState<Set<string>>(new Set());
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const textRef = useRef<HTMLSelectElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const space = useRef(false);
  const ids = useId();
  const L = useCallback((k: string, v?: Record<string, string | number>) => tx(labels, k, v), [labels]);

  // The window opens as a modal dialog (top layer: the window below is inert and never answers Esc).
  useEffect(() => { const d = dialog.current; if (d && !d.open) d.showModal(); return () => { if (d?.open) d.close(); }; }, []);
  // The picture: its own size (100 % zoom, the "file's own" format) and the pixels for the "auto" colour.
  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; setMedia({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.src = src;
  }, [src]);
  // The engine runs in this page too: one implementation for the editor and OBS.
  useEffect(() => { const w = window as unknown as { CuriosaCompose?: unknown }; if (!w.CuriosaCompose) composeEngine(window); }, []);

  const ratio = frameRatio(comp.format, media);
  const base = baseFrame(ratio, media);
  const stage = { width: Math.round(base.width * zoom), height: Math.round(base.height * zoom) };

  // "Fit" follows the size of the window until the person zooms on purpose.
  const fit = useCallback(() => {
    const v = viewport.current;
    if (!v) return;
    setZoom(fitZoom(base, { width: v.clientWidth - 32, height: v.clientHeight - 32 }));
    setFitMode(true);
  }, [base]);
  useLayoutEffect(() => {
    if (!fitMode) return;
    fit();
    const v = viewport.current;
    if (!v || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(v);
    return () => ro.disconnect();
  }, [fitMode, fit]);
  const setZoomAt = useCallback((to: number, point?: { x: number; y: number }) => {
    const v = viewport.current;
    const next = clampZoom(to);
    setFitMode(false);
    setZoom((from) => {
      if (v && from !== next) {
        const p = point ?? { x: v.clientWidth / 2, y: v.clientHeight / 2 };
        const s = zoomAround({ left: v.scrollLeft, top: v.scrollTop }, p, from, next);
        requestAnimationFrame(() => { v.scrollLeft = s.left; v.scrollTop = s.top; });
      }
      return next;
    });
  }, []);

  // The preview: the engine draws the composition with the sample values, still (no video play, no entrance), in the stage.
  const resolved = useMemo(() => resolveComposition(comp, { phrase: samplePhrase(option.phrase.sample, vars, sample), values: sampleValues(vars, sample) }), [comp, option.phrase.sample, vars, sample]);
  useEffect(() => {
    const h = host.current, engine = (window as unknown as { CuriosaCompose?: { mount: (c: HTMLElement, x: unknown, o: unknown) => HTMLElement; unmount: (r: HTMLElement) => void } }).CuriosaCompose;
    if (!h || !engine) return;
    const root = engine.mount(h, resolved, { still: true, motion: false });
    const read = () => setOverflow(new Set([...root.querySelectorAll<HTMLElement>("[data-overflow]")].map((n) => n.dataset.box ?? "")));
    const t = setTimeout(read, 60);
    return () => { clearTimeout(t); engine.unmount(root); };
  }, [resolved, stage.width, stage.height]);

  const commit = useCallback((next: Composition) => setHist((h) => record(h, next, same)), []);
  const patchBox = useCallback((id: string, change: Partial<Box>, step = true) => {
    setHist((h) => {
      const next = { ...h.present, boxes: h.present.boxes.map((b) => (b.id === id ? { ...b, ...change } : b)) };
      return step ? record(h, next, same) : replace(h, next);
    });
  }, []);
  const patch = (change: Partial<Box>) => patchBox(box.id, change);
  const dirty = !same(comp, start) || !initial;

  const requestClose = useCallback(async () => {
    if (!same(comp, start) && !(await askConfirm(L("compose.discard"), { confirmLabel: L("compose.discardYes"), cancelLabel: L("compose.discardNo"), danger: true, focusCancel: true }))) return;
    onClose();
  }, [comp, start, L, onClose]);

  /** The composition as it will be used: checked, "auto" colours measured under each box (bare text only). */
  const finished = useCallback((): Composition | null => {
    const img = imgRef.current;
    const measured: Composition = { ...comp, boxes: comp.boxes.map((b) => {
      if (!needsMeasure(b)) { const rest = { ...b }; delete rest.resolved; return rest; }
      const px = img ? pixelsUnder(img, comp, rectOf(b)) : null;
      return px ? { ...b, resolved: pickTextColour(px, 2).colour } : b;
    }) };
    const check = checkComposition(measured, { src, variables: vars.map((v) => v.token), maxBoxes: option.maxBoxes, formats: option.formats });
    if (!check.ok) {
      setErrors(check.errors);
      const bad = /^boxes\[(\d+)\]/.exec(check.errors[0]?.path ?? "");
      if (bad) { const b = comp.boxes[Number(bad[1])]; if (b) setSel(b.id); }
      requestAnimationFrame(() => (customRef.current ?? textRef.current)?.focus());
      return null;
    }
    setErrors([]);
    return check.value;
  }, [comp, src, vars, option]);

  // Keyboard of the whole window: undo/redo, zoom (never while typing in a field).
  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); setHist((h) => (e.shiftKey ? redo(h) : undo(h))); return; }
    if (mod && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); setHist(redo); return; }
    if (typing || mod) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoomAt(stepZoom(zoom, 1)); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoomAt(stepZoom(zoom, -1)); }
    else if (e.key === "0") { e.preventDefault(); fit(); }
    else if (e.key === "1") { e.preventDefault(); setZoomAt(1); }
    else if (e.key === " " && t.dataset.composeBox === undefined && t.tagName !== "BUTTON") { space.current = true; }
  };

  // ── Pointer: drag a box, a handle, pan the view (space + drag, middle button), pinch with two fingers ──
  const drag = useRef<null | { kind: "move" | "resize" | "pan" | "pinch"; id?: string; handle?: Handle; startRect?: PRect; x: number; y: number; scroll?: { left: number; top: number }; dist?: number; zoom?: number; before?: Composition }>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const lines = useMemo(() => snapLines(comp.guides, comp.boxes.filter((b) => b.id !== sel).map(rectOf)), [comp, sel]);
  const threshold = { x: (SNAP_PX / Math.max(1, stage.width)) * 100, y: (SNAP_PX / Math.max(1, stage.height)) * 100 };

  const beginBox = (e: React.PointerEvent, id: string, handle?: Handle) => {
    if (e.button !== 0 || space.current) return;
    if (e.pointerType === "touch") { touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.current.size > 1) return; }
    e.stopPropagation();
    e.preventDefault();
    const b = comp.boxes.find((x) => x.id === id);
    if (!b) return;
    setSel(id);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: handle ? "resize" : "move", id, handle, startRect: rectOf(b), x: e.clientX, y: e.clientY, before: comp };
  };
  const moveBox = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || (d.kind !== "move" && d.kind !== "resize") || !d.startRect || !d.id) return;
    const dx = ((e.clientX - d.x) / Math.max(1, stage.width)) * 100, dy = ((e.clientY - d.y) / Math.max(1, stage.height)) * 100;
    let rect: PRect, g: SnapLine[] = [];
    if (d.kind === "move") { rect = moveRect(d.startRect, dx, dy); if (!e.shiftKey) ({ rect, guides: g } = snapMove(rect, lines, threshold)); }
    else { rect = resizeRect(d.startRect, d.handle!, dx, dy, e.altKey); if (!e.shiftKey && !e.altKey) ({ rect, guides: g } = snapResize(rect, d.handle!, lines, threshold)); }
    setGuides(g);
    patchBox(d.id, rect, false);
  };
  const endBox = () => {
    const d = drag.current;
    if (!d || !d.before || !d.id) { drag.current = null; return; }
    drag.current = null;
    setGuides([]);
    setHist((h) => (same(h.present, d.before!) ? h : { past: [...h.past, d.before!].slice(-50), present: h.present, future: [] }));
    const b = comp.boxes.find((x) => x.id === d.id);
    if (b) setLive(d.kind === "move" ? L("compose.moved", { x: fmt(b.x), y: fmt(b.y) }) : L("compose.resized", { w: fmt(b.w), h: fmt(b.h) }));
  };
  const viewDown = (e: React.PointerEvent) => {
    const v = viewport.current;
    if (!v) return;
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        if (drag.current?.kind === "move" || drag.current?.kind === "resize") { const before = drag.current.before; drag.current = null; if (before) setHist((h) => replace(h, before)); }
        drag.current = { kind: "pinch", x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom, scroll: { left: v.scrollLeft, top: v.scrollTop } };
      }
      return;
    }
    if (e.button === 1 || space.current) {
      e.preventDefault();
      v.setPointerCapture?.(e.pointerId);
      drag.current = { kind: "pan", x: e.clientX, y: e.clientY, scroll: { left: v.scrollLeft, top: v.scrollTop } };
    }
  };
  const viewMove = (e: React.PointerEvent) => {
    const v = viewport.current, d = drag.current;
    if (e.pointerType === "touch" && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!v || !d) return;
    if (d.kind === "pan") { v.scrollLeft = d.scroll!.left - (e.clientX - d.x); v.scrollTop = d.scroll!.top - (e.clientY - d.y); }
    else if (d.kind === "pinch" && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()];
      const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      const next = clampZoom(d.zoom! * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / Math.max(1, d.dist!)));
      setFitMode(false);
      setZoom(next);
      const rect = v.getBoundingClientRect();
      const s = zoomAround(d.scroll!, { x: d.x - rect.left, y: d.y - rect.top }, d.zoom!, next);
      v.scrollLeft = s.left - (mid.x - d.x); v.scrollTop = s.top - (mid.y - d.y);
    } else moveBox(e);
  };
  const viewUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.kind === "pan" || d?.kind === "pinch") { if (touches.current.size < 2) drag.current = null; return; }
    endBox();
  };
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  // The wheel zooms on the canvas (with or without Ctrl), around the cursor. A non-passive listener: the page itself does not scroll.
  useEffect(() => {
    const v = viewport.current;
    if (!v) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = v.getBoundingClientRect();
      setZoomAt(stepZoom(zoomRef.current, e.deltaY < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    v.addEventListener("wheel", wheel, { passive: false });
    return () => v.removeEventListener("wheel", wheel);
  }, [setZoomAt]);
  useEffect(() => { const up = (e: KeyboardEvent) => { if (e.key === " ") space.current = false; }; window.addEventListener("keyup", up); return () => window.removeEventListener("keyup", up); }, []);

  const boxKey = (e: React.KeyboardEvent, b: Box) => {
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (comp.boxes.length > 1) removeBox(b.id); return; }
    if (e.key === "Enter") { e.preventDefault(); textRef.current?.focus(); return; }
    const r = nudge(rectOf(b), e.key, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    patchBox(b.id, r);
    setLive(e.altKey ? L("compose.resized", { w: fmt(r.w), h: fmt(r.h) }) : L("compose.moved", { x: fmt(r.x), y: fmt(r.y) }));
  };

  const addBox = () => {
    if (comp.boxes.length >= option.maxBoxes) return;
    let n = 1; while (comp.boxes.some((b) => b.id === `t${n}`)) n++;
    const placed = defaultBox(`t${n}`, { ...PLACEMENTS.title, ...(comp.boxes.length ? { content: { kind: "custom", text: vars[0] ? `{${vars[0].token}}` : "Merci" } } : {}) });
    commit({ ...comp, boxes: [...comp.boxes, placed] });
    setSel(placed.id);
  };
  const removeBox = (id: string) => {
    if (comp.boxes.length <= 1) return;
    const rest = comp.boxes.filter((b) => b.id !== id);
    commit({ ...comp, boxes: rest });
    setSel(rest[0]!.id);
    requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>(`[data-compose-box="${rest[0]!.id}"]`)?.focus());
  };
  const preset = (id: PlacementId) => patch({ ...PLACEMENTS[id] });

  const use = () => { const c = finished(); if (c) onUse(c); };
  const apply = async () => {
    const c = finished();
    if (!c) return;
    if (!(await askConfirm(L("compose.applyConfirm", { n: others }), { confirmLabel: L("compose.applyYes") }))) return;
    onApply(c);
    setLive(L("compose.applied", { n: others }));
  };
  const remove = async () => {
    if (!(await askConfirm(L("compose.removeConfirm"), { confirmLabel: L("compose.removeYes"), danger: true, focusCancel: true }))) return;
    onRemove();
  };
  const runTest = async () => {
    const c = finished();
    if (!c || !onTest) return;
    setTest({ pending: true });
    try { setTest({ pending: false, ...(await onTest(c)) }); } catch { setTest({ pending: false, error: L("compose.testHelp") }); }
  };

  const boxIndex = comp.boxes.findIndex((b) => b.id === box.id);
  const errorFor = (suffix: string) => errors.find((e) => e.path === `boxes[${boxIndex}]${suffix}`);
  const textError = errorFor(".content.text");
  const own = box.content.kind === "custom";
  const display = own ? toDisplay(box.content.kind === "custom" ? box.content.text : "", vars) : "";
  const insert = (token: string) => {
    const v = vars.find((x) => x.token === token);
    if (!v) return;
    const el = customRef.current;
    const at = el?.selectionStart ?? display.length;
    const next = `${display.slice(0, at)}[${v.label}]${display.slice(el?.selectionEnd ?? at)}`;
    patch({ content: { kind: "custom", text: toStored(next, vars).slice(0, LIMITS.custom) } });
    requestAnimationFrame(() => { const p = at + v.label.length + 2; el?.focus(); el?.setSelectionRange(p, p); });
  };
  const looks = (["element", "readable", "discreet", "bare"] as const).map((v) => ({ value: v, label: L(`compose.look.${v}`) }));
  const colourMode = box.color === "auto" ? "auto" : box.color === "#ffffff" ? "light" : box.color === "#111111" ? "dark" : "pick";
  const overlapped = comp.boxes.findIndex((o) => o.id !== box.id && overlapShare(rectOf(o), rectOf(box)) > 0.1);
  const sizeStep = (SIZE_STEPS as readonly number[]).includes(box.size) ? box.size : null;
  const hasBig = vars.some((v) => /^[\d\s.,  ]+$/.test(v.sample));
  const pill = "inline-flex items-center rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-800";

  const body = (
    <dialog ref={dialog} aria-labelledby={`${ids}-t`} data-compose-editor="" onCancel={(e) => { e.preventDefault(); void requestClose(); }} onKeyDown={onKey}
      className="m-0 h-[100dvh] max-h-none w-screen max-w-none bg-surface p-0 text-fg backdrop:bg-black/70">
      <style>{COMPOSE_CSS}</style>
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b border-line px-3 py-2 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id={`${ids}-t`} className="truncate text-lg font-semibold" title={L("compose.title", { name })}>{L("compose.title", { name })}</h2>
            <p className="hidden truncate text-sm text-muted sm:block">{L("compose.intro")}</p>
          </div>
          <button type="button" onClick={() => void requestClose()} className={`${small} rounded-full`} data-testid="compose-close"><span aria-hidden="true">✕</span>{L("compose.close")}</button>
        </header>
        <div role="toolbar" aria-label={L("compose.canvas")} className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 sm:px-5">
          <button type="button" className={small} onClick={() => setHist(undo)} disabled={!hist.past.length} aria-label={L("compose.undo")} title={L("compose.undo")} data-testid="compose-undo"><span aria-hidden="true">↶</span></button>
          <button type="button" className={small} onClick={() => setHist(redo)} disabled={!hist.future.length} aria-label={L("compose.redo")} title={L("compose.redo")} data-testid="compose-redo"><span aria-hidden="true">↷</span></button>
          <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
          <button type="button" className={small} onClick={() => setZoomAt(stepZoom(zoom, -1))} aria-label={L("compose.zoomOut")} title={L("compose.zoomOut")} data-testid="compose-zoom-out"><span aria-hidden="true">−</span></button>
          <span className="min-w-[3rem] text-center text-sm tabular-nums" aria-live="polite" data-testid="compose-zoom" data-zoom={zoom}>{L("compose.zoom", { n: Math.round(zoom * 100) })}</span>
          <button type="button" className={small} onClick={() => setZoomAt(stepZoom(zoom, 1))} aria-label={L("compose.zoomIn")} title={L("compose.zoomIn")} data-testid="compose-zoom-in"><span aria-hidden="true">+</span></button>
          <button type="button" className={small} onClick={fit} aria-pressed={fitMode} data-testid="compose-fit">{L("compose.fit")}</button>
          <button type="button" className={`${small} max-sm:hidden`} onClick={() => setZoomAt(1)} data-testid="compose-actual">{L("compose.actual")}</button>
          <span className="max-sm:hidden"><HelpTip help={L("compose.keysHelp")} name={L("compose.canvas")} /></span>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          <div className="flex items-center gap-1 max-sm:hidden" role="group" aria-label={L("compose.preview")}>
            <span className="hidden text-sm text-muted md:inline">{L("compose.preview")}</span>
            {(["checker", "dark", "light"] as const).map((k) => (
              <button key={k} type="button" className={`${small} ${bg === k ? "!border-accent !bg-accent !text-accent-fg" : ""}`} aria-pressed={bg === k} onClick={() => setBg(k)} data-testid={`compose-bg-${k}`}>{L(`compose.preview.${k}`)}</button>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div ref={viewport} className="relative min-h-0 flex-1 overflow-auto bg-bg/60 [touch-action:none]" data-testid="compose-viewport"
              onPointerDown={viewDown} onPointerMove={viewMove} onPointerUp={viewUp} onPointerCancel={viewUp}>
              <div className="flex min-h-full min-w-full items-center justify-center p-4" style={{ width: "max-content", height: "max-content" }}>
                <div className="relative shrink-0 shadow-lg" style={{ width: stage.width, height: stage.height, ...BG[bg] }} data-compose-stage="" data-testid="compose-stage">
                  <div ref={host} className="absolute inset-0" aria-hidden="true" />
                  {!media && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">{L("compose.loading")}</p>}
                  {comp.guides !== "none" && <div aria-hidden="true" className="pointer-events-none absolute border border-dashed border-sky-400/80" style={{ inset: `${comp.guides === "title" ? 5 : 3.5}%` }} />}
                  {guides.map((g, i) => <div key={i} aria-hidden="true" data-compose-guide={g.axis} className="pointer-events-none absolute bg-fuchsia-500" style={g.axis === "x" ? { left: `${g.at}%`, top: 0, bottom: 0, width: 1 } : { top: `${g.at}%`, left: 0, right: 0, height: 1 }} />)}
                  {comp.boxes.map((b, i) => {
                    const on = b.id === box.id;
                    const text = resolved.boxes.find((r) => r.id === b.id)?.text ?? "";
                    return (
                      <div key={b.id} role="button" tabIndex={0} data-compose-box={b.id} aria-pressed={on}
                        aria-label={L("compose.boxAria", { n: i + 1, text, place: L(`compose.place.${placeOf(b)}`) })}
                        onFocus={() => setSel(b.id)} onKeyDown={(e) => boxKey(e, b)} onPointerDown={(e) => beginBox(e, b.id)}
                        className={`absolute cursor-move outline-none ${on ? "outline-2 outline-offset-0 outline-sky-500" : "outline-1 outline-dashed outline-white/70 hover:outline-sky-400"} focus-visible:outline-[3px] focus-visible:outline-amber-400`}
                        style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, touchAction: "none", boxShadow: on ? "0 0 0 1px rgba(0,0,0,.5)" : undefined }}>
                        {on && HANDLES.map((h) => (
                          <span key={h} aria-hidden="true" data-handle={h} onPointerDown={(e) => beginBox(e, b.id, h)}
                            className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                            style={{ left: h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%", top: h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%", cursor: `${h}-resize`, touchAction: "none" }}>
                            <span className="block h-3.5 w-3.5 rounded-sm border-2 border-white bg-sky-500 shadow" />
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-1.5 sm:px-5" role="group" aria-label={L("compose.sample")} data-testid="compose-samples">
              <span className="text-sm text-muted max-sm:hidden">{L("compose.sample")}</span>
              {(["normal", "long", ...(hasBig ? ["big"] : [])] as Sample[]).map((s) => (
                <button key={s} type="button" className={`${small} ${sample === s ? "!border-accent !text-accent" : ""}`} aria-pressed={sample === s} onClick={() => setSample(s)}>{L(`compose.sample.${s}`)}</button>
              ))}
            </div>
          </div>
          <aside aria-label={L("compose.panel")} data-testid="compose-panel"
            className={`flex min-h-0 flex-col border-line bg-surface max-sm:rounded-t-2xl max-sm:border-t max-sm:shadow-[0_-8px_24px_rgba(0,0,0,.15)] sm:w-[23rem] sm:border-l ${sheetFull ? "max-sm:max-h-[70dvh]" : "max-sm:max-h-[38dvh]"}`}>
            <button type="button" className="mx-auto flex min-h-11 w-full items-center justify-center sm:hidden" aria-expanded={sheetFull} onClick={() => setSheetFull((v) => !v)} data-testid="compose-sheet">
              <span className="sr-only">{L(sheetFull ? "compose.sheetClose" : "compose.sheetOpen")}</span><span aria-hidden="true" className="h-1.5 w-12 rounded-full bg-line" />
            </button>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 pb-4 sm:pt-4">
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap gap-1" role="group" aria-label={L("compose.boxes")}>
                  {comp.boxes.map((b, i) => (
                    <button key={b.id} type="button" className={`${small} ${b.id === box.id ? "!border-accent !text-accent" : ""}`} aria-pressed={b.id === box.id} onClick={() => setSel(b.id)}>{L("compose.box", { n: i + 1 })}</button>
                  ))}
                </div>
                <details className="relative" data-testid="compose-menu">
                  <summary aria-label={L("compose.menu")} title={L("compose.menu")} className={`${small} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><span aria-hidden="true">⋯</span></summary>
                  <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg" onClick={(e) => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
                    {(["band", "title", "centre"] as const).map((p) => <button key={p} type="button" className="flex min-h-11 w-full items-center px-4 text-left text-sm hover:bg-bg" onClick={() => preset(p)}>{L(`compose.preset.${p}`)}</button>)}
                    {comp.boxes.length < option.maxBoxes && <button type="button" className="flex min-h-11 w-full items-center px-4 text-left text-sm hover:bg-bg" onClick={addBox} data-testid="compose-add">{L("compose.addBox")}</button>}
                    {comp.boxes.length > 1 && <button type="button" className="flex min-h-11 w-full items-center px-4 text-left text-sm hover:bg-bg" onClick={() => removeBox(box.id)}>{L("compose.removeBox")}</button>}
                    {others > 0 && <button type="button" className="flex min-h-11 w-full items-center px-4 text-left text-sm hover:bg-bg" onClick={() => void apply()} data-testid="compose-apply">{L("compose.apply")}</button>}
                    {initial && <button type="button" className="flex min-h-11 w-full items-center border-t border-line px-4 text-left text-sm text-red-600 hover:bg-red-500/10" onClick={() => void remove()} data-testid="compose-remove">{L("compose.remove")}</button>}
                  </div>
                </details>
              </div>
              {(overlapped >= 0 || overflow.has(box.id)) && (
                <p className="flex flex-wrap gap-1.5" role="status">
                  {overlapped >= 0 && <span className={pill}>{L("compose.overlap", { n: overlapped + 1 })}</span>}
                  {overflow.has(box.id) && <span className={pill} data-testid="compose-overflow">{L("compose.overflow")}</span>}
                </p>
              )}
              <div>
                <label htmlFor={`${ids}-text`} className="mb-1.5 block text-[15px] font-medium">{L("compose.f.text")}</label>
                <select ref={textRef} id={`${ids}-text`} className={field} value={own ? "custom" : "phrase"} data-testid="compose-text-kind"
                  onChange={(e) => patch({ content: e.target.value === "custom" ? { kind: "custom", text: vars[0] ? `{${vars[0].token}}` : "" } : { kind: "phrase" } })}>
                  <option value="phrase">{option.phrase.label}</option>
                  <option value="custom">{L("compose.f.own")}</option>
                </select>
              </div>
              {own && (
                <div>
                  <label htmlFor={`${ids}-custom`} className="mb-1.5 block text-[15px] font-medium">{L("compose.f.custom")}</label>
                  <input ref={customRef} id={`${ids}-custom`} type="text" className={field} value={display} maxLength={LIMITS.custom + 40} data-testid="compose-custom"
                    aria-invalid={textError ? true : undefined} aria-describedby={`${ids}-cx${textError ? ` ${ids}-ce` : ""}`}
                    onChange={(e) => patch({ content: { kind: "custom", text: toStored(e.target.value, vars).slice(0, LIMITS.custom) } }, )} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-hidden="true">
                    {segments(box.content.kind === "custom" ? box.content.text : "", vars).map((s, i) => "token" in s
                      ? <span key={i} className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">{s.label}</span>
                      : <span key={i} className="text-sm">{s.text}</span>)}
                  </div>
                  {vars.length > 0 && (
                    <select className={`${field} mt-1.5`} value="" aria-label={L("compose.insert")} onChange={(e) => insert(e.target.value)} data-testid="compose-insert">
                      <option value="">{L("compose.insert")}</option>
                      {vars.map((v) => <option key={v.token} value={v.token}>{v.label}</option>)}
                    </select>
                  )}
                  <p id={`${ids}-cx`} className="mt-1 text-[13px] text-muted">{vars[0] ? L("compose.f.customExample", { value: vars[0].label }) : L("compose.f.customPlain")}</p>
                  {textError && <p id={`${ids}-ce`} role="alert" className="mt-1 text-[13px] font-medium text-red-700" data-testid="compose-error">{L(`compose.err.${textError.code}`, { max: LIMITS.custom })}</p>}
                </div>
              )}
              <Seg label={L("compose.f.size")} value={sizeStep} testid="compose-size" options={SIZE_STEPS.map((s, i) => ({ value: s, label: ["M", "L", "XL", "XXL"][i]! }))} onChange={(s) => patch({ size: s, minSize: Math.min(box.minSize, s) })} />
              <div className="hidden sm:block"><Seg label={L("compose.f.look")} help={L("compose.lookHelp")} value={box.look === "custom" ? null : box.look} options={looks} onChange={(v) => patch({ look: v })} testid="compose-look" /></div>
              <div className="sm:hidden">
                <label htmlFor={`${ids}-look`} className="mb-1.5 flex items-center gap-1 text-[15px] font-medium">{L("compose.f.look")}<HelpTip help={L("compose.lookHelp")} name={L("compose.f.look")} /></label>
                <select id={`${ids}-look`} className={field} value={box.look} onChange={(e) => patch({ look: e.target.value as Box["look"] })}>{looks.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </div>
              <details className="group rounded-2xl border border-line bg-bg/40" data-testid="compose-more">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="text-xs text-muted transition-transform group-open:rotate-90">▶</span>{L("compose.more")}</summary>
                <div className="space-y-4 border-t border-line px-4 py-4">
                  <Seg label={L("compose.f.align")} value={box.align} options={ALIGNS.map((a) => ({ value: a, label: L(`compose.align.${a}`) }))} onChange={(v) => patch({ align: v })} />
                  <Seg label={L("compose.f.fit")} value={box.fit} options={BOX_FITS.map((a) => ({ value: a, label: L(`compose.fit.${a}`) }))} onChange={(v) => patch({ fit: v })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Num id={`${ids}-lines`} label={L("compose.f.lines")} value={box.maxLines} min={1} max={4} step={1} hint={L("compose.linesHint")} onChange={(n) => patch({ maxLines: Math.round(n) })} />
                    <Num id={`${ids}-px`} label={L("compose.f.exact")} value={box.size} min={LIMITS.size.min} max={LIMITS.size.max} step={1} hint={L("compose.exactHint")} onChange={(n) => patch({ size: Math.round(n), minSize: Math.min(box.minSize, Math.round(n)) })} />
                  </div>
                  <Seg label={L("compose.f.color")} value={colourMode} options={(["auto", "light", "dark", "pick"] as const).map((v) => ({ value: v, label: L(`compose.color.${v}`) }))}
                    onChange={(v) => patch({ color: v === "auto" ? "auto" : v === "light" ? "#ffffff" : v === "dark" ? "#111111" : "#ffd400" })} />
                  {colourMode === "pick" && (
                    <div>
                      <label htmlFor={`${ids}-hex`} className="mb-1 block text-[14px] font-medium">{L("compose.f.hex")}</label>
                      <input id={`${ids}-hex`} type="color" className={ui.colorInput} value={box.color} onChange={(e) => patch({ color: e.target.value.toLowerCase() })} />
                    </div>
                  )}
                  <div>
                    <label htmlFor={`${ids}-font`} className="mb-1 block text-[14px] font-medium">{L("compose.f.font")}</label>
                    <select id={`${ids}-font`} className={field} value={box.font} onChange={(e) => patch({ font: e.target.value as Box["font"] })}>{FONTS.map((f) => <option key={f} value={f}>{L(`compose.font.${f}`)}</option>)}</select>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={box.weight === 700} onChange={(e) => patch({ weight: e.target.checked ? 700 : 400 })} />{L("compose.f.bold")}</label>
                    <label className="flex min-h-11 items-center gap-2 text-[15px]"><input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={box.case === "upper"} onChange={(e) => patch({ case: e.target.checked ? "upper" : "none" })} />{L("compose.f.upper")}</label>
                  </div>
                  <fieldset className="min-w-0">
                    <legend className="mb-1.5 text-[15px] font-medium">{L("compose.f.exactPlace")}</legend>
                    <div className="grid grid-cols-2 gap-3" data-testid="compose-exact">
                      {(["x", "y", "w", "h"] as const).map((k) => (
                        <Num key={k} id={`${ids}-${k}`} label={L(`compose.f.${k}`)} value={box[k]} min={k === "w" || k === "h" ? LIMITS.minBox : 0} max={100} step={0.1} hint={L("compose.percentHint")}
                          onChange={(n) => patch(clampRect({ ...rectOf(box), [k]: n }))} />
                      ))}
                    </div>
                  </fieldset>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor={`${ids}-in`} className="mb-1 block text-[14px] font-medium">{L("compose.f.in")}</label>
                      <select id={`${ids}-in`} className={field} value={box.in.anim} onChange={(e) => patch({ in: { ...box.in, anim: e.target.value as Box["in"]["anim"] } })}>{ANIMS.map((a) => <option key={a} value={a}>{L(`compose.anim.${a}`)}</option>)}</select>
                    </div>
                    <Num id={`${ids}-at`} label={L("compose.f.at")} value={box.in.at} min={0} max={60} step={0.1} hint={L("compose.secondsHint")} onChange={(n) => patch({ in: { ...box.in, at: Math.round(n * 10) / 10 } })} />
                    <div className="col-span-2">
                      <label htmlFor={`${ids}-out`} className="mb-1 block text-[14px] font-medium">{L("compose.f.out")}</label>
                      <select id={`${ids}-out`} className={field} value={box.out.anim} onChange={(e) => patch({ out: { ...box.out, anim: e.target.value as Box["out"]["anim"] } })}>{ANIMS.map((a) => <option key={a} value={a}>{L(`compose.anim.${a}`)}</option>)}</select>
                    </div>
                  </div>
                </div>
              </details>
              <details className="group rounded-2xl border border-line bg-bg/40" data-testid="compose-backdrop">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden"><span aria-hidden="true" className="text-xs text-muted transition-transform group-open:rotate-90">▶</span>{L("compose.backdrop")}</summary>
                <div className="space-y-4 border-t border-line px-4 py-4">
                  <Seg label={L("compose.f.cover")} value={comp.backdrop.fit} options={(["cover", "contain"] as const).map((v) => ({ value: v, label: L(`compose.cover.${v}`) }))} onChange={(v) => commit({ ...comp, backdrop: { ...comp.backdrop, fit: v } })} />
                  {option.formats.length > 1 && (
                    <div>
                      <label htmlFor={`${ids}-format`} className="mb-1 block text-[14px] font-medium">{L("compose.f.format")}</label>
                      <select id={`${ids}-format`} className={field} value={comp.format} onChange={(e) => { commit({ ...comp, format: e.target.value as ComposeFormat }); setFitMode(true); }}>{option.formats.map((f) => <option key={f} value={f}>{L(`compose.format.${f}`)}</option>)}</select>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </aside>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-5">
          {(test.ok || test.error) && <p role={test.error ? "alert" : "status"} className={`mr-auto text-sm ${test.error ? "text-red-700" : "text-emerald-700"}`} data-testid="compose-test-result">{test.error ?? test.ok}</p>}
          {errors.length > 0 && !textError && <p role="alert" className="mr-auto text-sm text-red-700" data-testid="compose-error">{L("compose.err.generic")}</p>}
          {onTest && (
            <button type="button" className={`${ui.btn} min-h-11`} onClick={() => void runTest()} disabled={test.pending} aria-busy={test.pending || undefined} title={L("compose.testHelp")} data-testid="compose-test">
              {test.pending && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}{L("compose.test")}
            </button>
          )}
          <button type="button" className={`${ui.btnPrimary} min-h-11`} onClick={use} data-testid="compose-use" data-dirty={dirty ? "1" : undefined}>{L("compose.use")}</button>
        </footer>
        <span role="status" aria-live="polite" className="sr-only" data-testid="compose-live">{live}</span>
      </div>
    </dialog>
  );
  return typeof document === "undefined" ? null : createPortal(body, document.body);
}
