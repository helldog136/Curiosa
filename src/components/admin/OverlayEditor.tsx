"use client";

import { PLAIN_INPUT } from "./managerHints";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FieldErrorText, useFieldError } from "./FieldErrors";
import { FieldLabel } from "./Field";
import { HelpBelow } from "./HelpTip";
import { ui } from "./ui";
import { TextSizeField } from "./TextSizeField";
import { HelpTip } from "./HelpTip";
import { OverlayLookPanel } from "./OverlayLookPanel";
import { NEW_ELEMENT_STYLE, appliedLook, presetShown, readabilityOf, type PageSide } from "@/core/overlays/appearance";
import type { SkinColors } from "@/core/overlays/skinSheet";
import { MoreOptions } from "./MoreOptions";
import { Choice } from "./OverlayLookPanel";
import { foldText, queryWords } from "@/core/adminkit/search";
import { addElement, anchorElement, changeResolution, newUid, removeElement, reorder, setField, setLook, setRect } from "@/core/overlays/editorModel";
import { ANCHORS, handlesFor, resizeRect, snapMove, type Anchor, type Guide, type Handle, type LayoutDecl, type Rect } from "@/core/overlays/layout";
import { placeLabels, previewScale, ZOOMS, LABEL_HEIGHT, OUTSIDE_GAP } from "@/core/overlays/previewView";
import { TEXT_SCALE_PRESETS, effectiveTextScale, tvTextTooLarge } from "@/core/overlays/textScale";
import { formatOf } from "@/core/overlays/model";
import { HISTORY_MAX, record, redo, replace, startHistory, undo, type History } from "@/core/compose/history";
import { nearEdge, safeLines, sameDoc } from "@/core/overlays/editorView";
import type { ElementStyle } from "@/core/overlays/appearance";
import { CvdFilters, PreviewToolbar, SafeOverlay, usePreviewView } from "./OverlayPreviewTools";
import { catalogKey, type OptionValue, type OverlayStyle, type PageElement } from "@/core/overlays/model";

/** Éditeur d'une page d'overlay (navigateur de PC). Aperçu à l'échelle avec cadres nommés, glisser-déposer + poignées, champs précis, ancrages, ordre, options, style. Tout est faisable au clavier. */
export type ClientOption = { id: string; type: "choice" | "boolean" | "number" | "text"; label: string; help: string; example: string; choices: { value: string; label: string }[]; default: OptionValue };
export type ClientElement = { key: string; instance: string; element: string; group: string; groupId: string; hint: string; title: string; label: string; description: string; layout: LayoutDecl; followsStyle: boolean; options: ClientOption[]; /** (0.23.0) The element sizes its text for TV itself. */ tvScale?: boolean };
export type EditorElement = PageElement & { missing?: boolean };
type Props = {
  initial: { name: string; width: number; height: number; style: OverlayStyle; elements: EditorElement[] };
  available: ClientElement[];
  resolutions: [number, number][];
  limits: { elements: number; fold: number; minSide: number; maxSide: number };
  previewSrc: string;
  strings: Record<string, string>;
  /** (0.17.0) The page wears an overlay skin (default skin or skin per context): the readability fix of a transparent page does not apply then. */
  pageSkin?: boolean;
  /** (0.20.0) The page id: the person's own preview screenshot is remembered per page, in this browser only. */
  pageId?: string;
  /** (0.21.0) Installed overlay skins an element may wear, the kit colours of each, and those of the page's skin now. */
  skins?: { id: string; name: string; colors: SkinColors | null }[];
  pageSkinColors?: SkinColors | null;
};
/** (0.20.0) One undo step: the size, the common style and the elements. */
type Doc = { size: { width: number; height: number }; style: OverlayStyle; elements: EditorElement[] };

const hue = (i: number) => (i * 47 + 10) % 360;
const GRID_ANCHORS: Anchor[] = [...ANCHORS];
const SNAP_PX = 8;
/** (0.23.0) "TV (recommended)": the text size a new element without TV sizes of its own starts with (owner design 3.3.3; elements already placed do not move). */
const TV_PERCENT = TEXT_SCALE_PRESETS.find((p) => p.id === "tv")!.percent;

export function OverlayEditor({ initial, available, resolutions, limits, previewSrc, strings, pageSkin = false, pageId = "", skins = [], pageSkinColors = null }: Props) {
  const s = useCallback((key: string, vars?: Record<string, string | number>) => {
    let text = strings[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  }, [strings]);
  const byKey = useMemo(() => new Map(available.map((a) => [catalogKey(a.instance, a.element), a])), [available]);
  const declOf = useCallback((instance: string, element: string): LayoutDecl | null => byKey.get(catalogKey(instance, element))?.layout ?? null, [byKey]);

  const [name, setName] = useState(initial.name);
  // (0.20.0) Undo and redo: 50 steps for the time the editor is open (the same history as the composition editor). A drag is ONE step.
  const [hist, setHist] = useState<History<Doc>>(() => startHistory({ size: { width: initial.width, height: initial.height }, style: initial.style, elements: initial.elements }));
  const { size, style, elements } = hist.present;
  const commit = (patch: Partial<Doc>) => setHist((h) => record(h, { ...h.present, ...patch }, sameDoc));
  const setStyle = (next: OverlayStyle | ((cur: OverlayStyle) => OverlayStyle)) => setHist((h) => record(h, { ...h.present, style: typeof next === "function" ? next(h.present.style) : next }, sameDoc));
  const dragBase = useRef<Doc | null>(null);
  const preset = resolutions.some(([w, h]) => w === size.width && h === size.height);
  const [custom, setCustom] = useState(!preset);
  const pv = usePreviewView(pageId);
  const lines = useMemo(() => safeLines(pv.view.safe, { width: size.width, height: size.height }), [pv.view.safe, size.width, size.height]);
  const [clip, setClip] = useState<{ style: ElementStyle | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(initial.elements.at(-1)?.uid ?? null);
  const [live, setLive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [margin, setMargin] = useState("24");
  const [guides, setGuides] = useState<Guide[]>([]);
  const [announce, setAnnounce] = useState("");
  const [zoom, setZoom] = useState<number>(1);
  const [avail, setAvail] = useState(880);
  const canvas = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ uid: string; mode: "move" | Handle; x: number; y: number; start: Rect; scale: number; moved: boolean } | null>(null);

  const page = useMemo(() => ({ width: size.width, height: size.height }), [size.width, size.height]);
  const sel = elements.find((e) => e.uid === selected) ?? null;
  const selInfo = sel ? byKey.get(catalogKey(sel.instance, sel.element)) ?? null : null;
  const pageSide: PageSide = useMemo(() => ({ style, skin: pageSkin }), [style, pageSkin]);
  const skinById = useMemo(() => new Map(skins.map((k) => [k.id, k])), [skins]);
  // (0.21.0) An element wearing its own skin (or none) is judged with that skin's colours, like the public page does.
  const wears = (e: EditorElement): boolean => (e.skin === undefined ? pageSkin : !!e.skin);
  const lookOf = (e: EditorElement) => {
    const info = byKey.get(catalogKey(e.instance, e.element));
    const colors = e.skin === undefined ? pageSkinColors : e.skin ? skinById.get(e.skin)?.colors ?? null : null;
    const applied = appliedLook(e.style, { ...pageSide, skin: wears(e) }, !!info?.followsStyle, colors);
    return { applied, readable: readabilityOf(applied) };
  };
  const autoCount = elements.filter((e) => lookOf(e).applied?.source === "auto").length;
  const selLook = sel ? lookOf(sel) : null;
  // The tab of the selected element: chosen by the person, else its appearance when it is hard to read (design 7.1), else its place.
  const [tabOf, setTabOf] = useState<{ uid: string | null; tab: "place" | "look" | "options" }>({ uid: null, tab: "place" });
  const tab = tabOf.uid === selected ? tabOf.tab : selLook && !selLook.readable.ok ? "look" : "place";
  const setTab = (t: "place" | "look" | "options") => setTabOf({ uid: selected, tab: t });

  const data = useMemo(() => JSON.stringify({ name, width: size.width, height: size.height, style, elements: elements.map(({ missing, ...e }) => { void missing; return e; }) }), [name, size, style, elements]);

  const update = (next: EditorElement[]) => commit({ elements: next as EditorElement[] });
  const doUndo = useCallback(() => setHist((h) => { if (h.past.length) setAnnounce(s("ed.undone")); return undo(h); }), [s]);
  const doRedo = useCallback(() => setHist((h) => { if (h.future.length) setAnnounce(s("ed.redone")); return redo(h); }), [s]);
  const root = useRef<HTMLDivElement>(null);
  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y): only when the focus is in the editor or on the page itself, never inside a text field (it has its own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || (t !== document.body && !root.current?.contains(t)))) return;
      e.preventDefault();
      if (k === "y" || e.shiftKey) doRedo(); else doUndo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);
  const titleOf = (e: EditorElement) => byKey.get(catalogKey(e.instance, e.element))?.title ?? `${e.instance} · ${e.element}`;
  const sizeNote = (e: EditorElement) => { const p = effectiveTextScale(e.textScale, style.textScale); return p === 100 ? "" : ` · ${s("ed.textSize.note", { pct: p })}`; };

  // Largeur disponible pour l'aperçu : mesurée, et suivie quand la fenêtre change.
  useEffect(() => {
    const node = stage.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => { const w = Math.floor(entries[0]?.contentRect.width ?? 0); if (w > 0) setAvail(w); });
    ro.observe(node);
    return () => ro.disconnect();
  }, [live]);
  const view = previewScale(avail, page, zoom);
  const labels = useMemo(() => {
    const placed = placeLabels(elements.map((el) => ({ uid: el.uid, x: el.x * view.scale, y: el.y * view.scale, w: el.w * view.scale, h: el.h * view.scale, text: byKey.get(catalogKey(el.instance, el.element)) ? `${titleOf(el)} · ${el.w}×${el.h} px${sizeNote(el)}` : s("ed.gone") })), { width: view.width, height: view.height });
    return new Map(placed.map((p) => [p.uid, p]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, view.scale, view.width, view.height, byKey, style.textScale]);

  function add(a: ClientElement) {
    const taken = new Set(elements.map((e) => e.uid));
    const uid = newUid(taken);
    const defaults = Object.fromEntries(a.options.map((o) => [o.id, o.default]));
    update(addElement(elements, page, { instance: a.instance, element: a.element, decl: a.layout, defaults, ...(a.followsStyle && !style.readability ? { style: NEW_ELEMENT_STYLE } : {}), ...(a.tvScale === false && (style.textScale ?? 100) <= 100 ? { textScale: TV_PERCENT } : {}) }, uid));
    setSelected(uid); setAdding(false);
    setAnnounce(s("ed.added", { name: a.title }));
  }

  function chooseResolution(value: string) {
    if (value === "custom") { setCustom(true); return; }
    const [w, h] = value.split("x").map(Number) as [number, number];
    setCustom(false);
    commit({ elements: changeResolution(elements, size, { width: w, height: h }, declOf), size: { width: w, height: h } });
  }
  function typeResolution(axis: "width" | "height", raw: string) {
    const n = Math.round(Number(raw));
    // A side being typed (out of bounds for now) is shown, not recorded as an undo step.
    if (!Number.isFinite(n) || n < limits.minSide || n > limits.maxSide) { setHist((h) => replace(h, { ...h.present, size: { ...h.present.size, [axis]: Number.isFinite(n) ? n : h.present.size[axis] } })); return; }
    const to = { ...size, [axis]: n };
    commit({ elements: changeResolution(elements, size, to, declOf), size: to });
  }

  // ── Glisser-déposer ───────────────────────────────────────────────────────────────────────────────────────────────
  function begin(e: React.PointerEvent, uid: string, mode: "move" | Handle) {
    const el = elements.find((x) => x.uid === uid);
    const box = canvas.current?.getBoundingClientRect();
    if (!el || !box) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(uid);
    dragBase.current = hist.present;
    drag.current = { uid, mode, x: e.clientX, y: e.clientY, start: { x: el.x, y: el.y, w: el.w, h: el.h }, scale: box.width / size.width, moved: false };
  }
  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.scale, dy = (e.clientY - d.y) / d.scale;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2 / d.scale) return;
    d.moved = true;
    const el = elements.find((x) => x.uid === d.uid);
    if (!el) return;
    const decl = declOf(el.instance, el.element);
    if (d.mode === "move") {
      const snapped = snapMove({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, page, SNAP_PX / d.scale, lines);
      setGuides(snapped.guides);
      setHist((h) => replace(h, { ...h.present, elements: setRect(h.present.elements, d.uid, snapped.rect) as EditorElement[] }));
    } else if (decl) {
      const handle = d.mode;
      setHist((h) => replace(h, { ...h.present, elements: setRect(h.present.elements, d.uid, resizeRect(decl, d.start, handle, dx, dy, page)) as EditorElement[] }));
    }
  }
  function endDrag() {
    const d = drag.current, base = dragBase.current;
    drag.current = null; dragBase.current = null; setGuides([]);
    // The whole drag is one step: the state before it goes to the past.
    if (d?.moved && base) setHist((h) => (sameDoc(base, h.present) ? h : { past: [...h.past, base].slice(-HISTORY_MAX), present: h.present, future: [] }));
  }

  // ── Clavier sur un cadre : flèches = déplacer (Maj : 10 px) ; Alt + flèches = redimensionner ────────────────────────
  function keys(e: React.KeyboardEvent, el: EditorElement) {
    const step = e.shiftKey ? 10 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    if (e.altKey) {
      update(setField(elements, el.uid, v[0] !== 0 ? "w" : "h", (v[0] !== 0 ? el.w + v[0] : el.h + v[1]), page, declOf));
    } else {
      update(setField(setField(elements, el.uid, "x", el.x + v[0], page, declOf), el.uid, "y", el.y + v[1], page, declOf));
    }
  }

  // Une page sans cadre sélectionné : Échap quitte l'ajout.
  useEffect(() => {
    if (!adding) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") setAdding(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [adding]);

  // Groups by module (already sorted by the server in the person's language), filtered live on group title, element name, description and instance hint.
  const [pickQuery, setPickQuery] = useState("");
  const groups = useMemo(() => {
    const words = queryWords(pickQuery);
    const m = new Map<string, { title: string; items: ClientElement[]; total: number }>();
    for (const a of available) {
      const g = m.get(a.groupId) ?? { title: a.group, items: [], total: 0 };
      g.total++;
      if (words.every((w) => foldText(`${a.group} ${a.label} ${a.description} ${a.hint}`).includes(w))) g.items.push(a);
      m.set(a.groupId, g);
    }
    return [...m.entries()].filter(([, g]) => g.items.length > 0);
  }, [available, pickQuery]);

  const nameError = useFieldError("name");
  const resError = useFieldError("resolution");
  const full = elements.length >= limits.elements;

  return (
    <div ref={root} className="space-y-6" data-admin-wide="">
      <input type="hidden" name="data" value={data} />
      <CvdFilters />
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      <section className={`${ui.card} max-w-4xl space-y-5`}>
        <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="ov-name" className={ui.label}>{s("ed.name")}</label>
          <input {...PLAIN_INPUT} id="ov-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${ui.input} ${nameError.className}`} {...nameError.props} />
          <FieldErrorText id={nameError.id} message={nameError.message} />
        </div>
        <div>
          <label htmlFor="ov-res" className={ui.label}>{s("ed.resolution")}</label>
          <select id="ov-res" value={custom ? "custom" : `${size.width}x${size.height}`} onChange={(e) => chooseResolution(e.target.value)} className={ui.input}>
            {resolutions.map(([w, h]) => { const f = formatOf(w, h); return <option key={`${w}x${h}`} value={`${w}x${h}`}>{w}×{h}{f ? ` · ${s(`ed.format.${f}`)}` : ""}</option>; })}
            <option value="custom">{s("ed.resolutionOther")}</option>
          </select>
          {custom && (
            <div className="mt-2 flex items-center gap-2">
              <input {...PLAIN_INPUT} aria-label={s("ed.width")} inputMode="numeric" value={size.width} onChange={(e) => typeResolution("width", e.target.value)} className={`${ui.input} w-28`} />
              <span aria-hidden>×</span>
              <input {...PLAIN_INPUT} aria-label={s("ed.height")} inputMode="numeric" value={size.height} onChange={(e) => typeResolution("height", e.target.value)} className={`${ui.input} w-28`} />
              <span className="text-sm text-muted">px</span>
            </div>
          )}
          <FieldErrorText id={resError.id} message={resError.message} />
          <p className={ui.help}>{s("ed.resolutionHelp")}</p>
        </div>
        </div>
        {/* (0.21.0) The page's readability default replaces the three lists, which move under "More options" (design 7.2). */}
        <Choice legend={s("ed.pageLook")} help={s("ed.pageLookHelp")} name="ov-page-look" value={style.readability ? (presetShown(style.readability) === "custom" ? null : presetShown(style.readability)) : "none"}
          options={(["readable", "discreet", "bare", "none"] as const).map((v) => ({ value: v, label: s(v === "none" ? "ed.pageLook.none" : `ed.look.preset.${v}`) }))}
          onChange={(v) => setStyle((cur) => { const { readability, ...rest } = cur; void readability; return v === "none" ? rest : { ...rest, readability: { preset: v as "readable" | "discreet" | "bare" } }; })} />
        {tvTextTooLarge({ width: size.width, height: size.height, style }) && (
          <p role="status" data-testid="tv-fix" className="flex flex-wrap items-center gap-2">
            <span className={ui.chipWarn}><span aria-hidden>⚠</span>{s("ed.tvFix.warn")}</span>
            <button type="button" className={`${ui.btn} min-h-11`} onClick={() => { setStyle((cur) => ({ ...cur, tvBase: "short" })); setAnnounce(s("ed.tvFix.done")); }}>{s("ed.tvFix")}</button>
            <HelpTip help={s("ed.tvFix.help")} name={s("ed.tvFix")} />
          </p>
        )}
        <TextSizeField testId="text-size-page" legend={s("ed.textSize.page")} help={s("ed.textSize.pageHelp")} value={style.textScale ?? null} inherit={false} errorPath="style.textScale" s={s}
          onChange={(v) => setStyle((cur) => { const { textScale, ...rest } = cur; void textScale; return v === null || v === 100 ? rest : { ...rest, textScale: v }; })} />
        <MoreOptions title={s("ed.pageMore")} summary={[s(`ed.style.text.${style.text}`), s(`ed.style.background.${style.background}`), s(`ed.style.corners.${style.corners}`)].join(" · ")}>
        <fieldset className="min-w-0">
          <legend className={ui.label}>{s("ed.style")}</legend>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
            <StyleSelect label={s("ed.style.text")} value={style.text} onChange={(v) => setStyle({ ...style, text: v as OverlayStyle["text"] })} options={[["light", s("ed.style.text.light")], ["dark", s("ed.style.text.dark")]]} />
            <StyleSelect label={s("ed.style.background")} value={style.background} onChange={(v) => setStyle({ ...style, background: v as OverlayStyle["background"] })} options={[["transparent", s("ed.style.background.transparent")], ["soft", s("ed.style.background.soft")], ["opaque", s("ed.style.background.opaque")]]} />
            <StyleSelect label={s("ed.style.corners")} value={style.corners} onChange={(v) => setStyle({ ...style, corners: v as OverlayStyle["corners"] })} options={[["round", s("ed.style.corners.round")], ["square", s("ed.style.corners.square")]]} />
          </div>
          <p className={ui.help}>{s("ed.styleHelp")}</p>
        </fieldset>
        </MoreOptions>
      </section>

      <div className="space-y-6">
        <section className="min-w-0 space-y-3" aria-label={s("ed.preview")}>
          <div className="flex flex-wrap items-center gap-2">
            {/* (0.26.0) Secondary (R3): the one primary action of the page is "Save" in the save bar. */}
            <button type="button" className={ui.btn} aria-expanded={adding} onClick={() => setAdding(!adding)} disabled={full} data-testid="ov-add">{s("ed.add")}</button>
            <button type="button" className={ui.btn} aria-pressed={live} onClick={() => setLive(!live)}>{live ? s("ed.backToEdit") : s("ed.live")}</button>
            <div role="group" aria-label={s("ed.history")} className="flex items-center gap-1">
              <button type="button" className={`${ui.btn} min-h-11 min-w-11 !px-3`} onClick={doUndo} disabled={!hist.past.length} aria-label={s("ed.undo")} title={s("ed.undoKeys")} data-testid="ov-undo"><span aria-hidden>↶</span></button>
              <button type="button" className={`${ui.btn} min-h-11 min-w-11 !px-3`} onClick={doRedo} disabled={!hist.future.length} aria-label={s("ed.redo")} title={s("ed.redoKeys")} data-testid="ov-redo"><span aria-hidden>↷</span></button>
            </div>
            <span className="text-sm text-muted">{s("ed.count", { n: elements.length, max: limits.elements })}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted" data-testid="overlay-scale" role="status">{s("ed.previewScale", { pct: view.percent })}</span>
              {!live && (
                <div role="group" aria-label={s("ed.zoom")} className="flex items-center gap-1">
                  <span className="text-sm text-muted" aria-hidden>{s("ed.zoom")}</span>
                  {ZOOMS.map((z) => <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} className={`${ui.btn} min-w-11 !px-3 ${zoom === z ? "!border-accent !text-accent" : ""}`}>{z === 1 ? s("ed.zoomFit") : s("ed.zoomX", { n: z })}</button>)}
                </div>
              )}
            </div>
          </div>
          <PreviewToolbar v={pv} s={s} />
          {full && <p className={ui.help}>{s("ed.full", { max: limits.elements })}</p>}
          {autoCount > 0 && <p role="status" data-testid="look-auto-notice" className="flex items-center gap-1 text-sm text-muted">{s(autoCount === 1 ? "ed.look.autoNotice.one" : "ed.look.autoNotice", { n: autoCount })}<HelpTip help={s("ed.look.autoNoticeHelp")} name={s("ed.look.preset")} always /></p>}
          {adding && (
            <div role="dialog" aria-label={s("ed.add")} className={`${ui.card} space-y-4`}>
              {available.length === 0 && <p className="text-sm text-muted">{s("ed.noneAvailable")}</p>}
              {available.length > 0 && (
                <div className="relative">
                  <input type="search" value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder={s("ed.pickSearch")} aria-label={s("ed.pickSearch")} {...PLAIN_INPUT} data-testid="picker-search" className={`${ui.input} min-h-11`} />
                </div>
              )}
              {available.length > 0 && groups.length === 0 && (
                <p role="status" className="flex flex-wrap items-center gap-3 text-sm text-muted">{s("ed.pickNone")}<button type="button" className={ui.btn} onClick={() => setPickQuery("")}>{s("ed.pickClear")}</button></p>
              )}
              {groups.map(([id, g]) => (
                <details key={id} open data-testid="picker-group" className="group space-y-2">
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold"><span>{g.title}</span><span className="rounded-full bg-line/60 px-2 py-0.5 text-xs font-medium text-muted">{g.items.length}</span></summary>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {g.items.map((a) => (
                      <li key={a.key} className="flex">
                        <button type="button" onClick={() => add(a)} title={a.description || a.label} className="flex min-h-[5rem] w-full flex-col items-start gap-0.5 rounded-xl border border-line bg-bg px-3 py-2 text-left transition-colors hover:border-accent">
                          <span className="text-sm font-medium">{a.label}{a.hint && <span className="font-normal text-muted"> · {a.hint}</span>}</span>
                          {a.description && <span className="line-clamp-2 text-[13px] leading-5 text-muted">{a.description}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              <button type="button" className={ui.btn} onClick={() => setAdding(false)}>{s("ed.cancel")}</button>
            </div>
          )}

          {live ? (
            <div className="space-y-2">
              <div ref={stage} className="overflow-auto rounded-xl">
                <div className="relative mx-auto overflow-hidden rounded-xl border border-line" data-testid="overlay-live" data-backdrop={pv.view.backdrop} style={{ width: view.width || "100%", aspectRatio: `${size.width} / ${size.height}`, ...pv.style, filter: pv.filter }}>
                  <iframe title={s("ed.live")} src={previewSrc} sandbox="allow-scripts allow-same-origin" className="h-full w-full border-0" />
                  <SafeOverlay mode={pv.view.safe} page={page} />
                </div>
              </div>
              <p className={ui.help}>{s("ed.liveHelp")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div ref={stage} className="overflow-auto rounded-xl border border-line bg-surface p-3" data-testid="overlay-stage">
                <div ref={canvas} data-testid="overlay-canvas" data-backdrop={pv.view.backdrop} className="relative mx-auto select-none rounded-md border border-line" style={{ width: view.width, height: view.height, touchAction: "none", ...pv.style, filter: pv.filter }}
                  onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
                  {elements.map((el, i) => {
                    const c = `hsl(${hue(i)} 70% 42%)`;
                    const isSel = el.uid === selected;
                    const info = byKey.get(catalogKey(el.instance, el.element));
                    const gone = !info;
                    const decl = info?.layout;
                    const lab = labels.get(el.uid);
                    const out = lab?.corner === "ot" || lab?.corner === "ob";
                    const inset = isSel && decl ? 12 : 0;   // laisse la poignée du coin libre
                    const text = gone ? s("ed.gone") : `${titleOf(el)} · ${el.w}×${el.h} px${sizeNote(el)}`;
                    return (
                      <div key={el.uid} role="button" tabIndex={0} aria-pressed={isSel} title={text}
                        aria-label={`${titleOf(el)} — ${el.w}×${el.h} px${el.visible ? "" : ` (${s("ed.hidden")})`}`}
                        onPointerDown={(e) => begin(e, el.uid, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                        onFocus={() => setSelected(el.uid)} onKeyDown={(e) => keys(e, el)}
                        className={`absolute cursor-move border-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${isSel ? "border-solid shadow-lg" : "border-dashed"} ${el.visible ? "" : "opacity-45"}`}
                        style={{ left: `${(el.x / size.width) * 100}%`, top: `${(el.y / size.height) * 100}%`, width: `${(el.w / size.width) * 100}%`, height: `${(el.h / size.height) * 100}%`, zIndex: i + 1, borderColor: c, background: gone ? "repeating-linear-gradient(45deg,#8883 0 6px,transparent 6px 12px)" : `color-mix(in srgb, ${c} ${isSel ? 22 : 14}%, transparent)` }}>
                        {view.width >= 420 && <span data-label={lab?.corner} className={`pointer-events-none absolute block truncate px-1.5 text-[11px] font-semibold text-white ${out ? "rounded-sm shadow" : ""}`} style={{ background: c, height: LABEL_HEIGHT, lineHeight: `${LABEL_HEIGHT}px`, ...(out ? { width: lab?.width, ...(lab?.corner === "ot" ? { bottom: `calc(100% + ${OUTSIDE_GAP - 2}px)` } : { top: `calc(100% + ${OUTSIDE_GAP - 2}px)` }), ...(lab && lab.x < el.x * view.scale + el.w * view.scale / 2 ? { left: -2 } : { right: -2 }) } : { maxWidth: `calc(100% - ${inset}px)`, ...(lab?.corner === "tr" || lab?.corner === "br" ? { right: -2 + inset } : { left: -2 + inset }), ...(lab?.corner === "bl" || lab?.corner === "br" ? { bottom: -2 } : { top: -2 }) }) }}>
                          {text}
                        </span>}
                        {isSel && decl && handlesFor(decl).map((h) => (
                          <span key={h} onPointerDown={(e) => begin(e, el.uid, h)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} aria-hidden="true"
                            className="absolute flex h-6 w-6 items-center justify-center" style={{ ...handleStyle(h), cursor: handleCursor(h) }}>
                            <span className="block h-3.5 w-3.5 rounded-sm border-2 border-white shadow" style={{ background: c }} />
                          </span>
                        ))}
                      </div>
                    );
                  })}
                  <SafeOverlay mode={pv.view.safe} page={page} />
                  {guides.map((g, i) => (
                    <span key={i} aria-hidden="true" className="pointer-events-none absolute bg-accent/70" style={g.axis === "x" ? { left: `${(g.at / size.width) * 100}%`, top: 0, bottom: 0, width: 1 } : { top: `${(g.at / size.height) * 100}%`, left: 0, right: 0, height: 1 }} />
                  ))}
                </div>
              </div>
              <p className={ui.help}>{s("ed.canvasHelp")}</p>
            </div>
          )}
        </section>

        <aside className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]" aria-label={s("ed.panel")}>
          <section className={`${ui.card} space-y-2`}>
            <h2 className="text-base font-semibold">{s("ed.elements")}</h2>
            {elements.length === 0 ? <p className="text-sm text-muted">{s("ed.empty")}</p> : (
              <ol className="space-y-1.5">
                {[...elements].reverse().map((el) => {
                  const info = byKey.get(catalogKey(el.instance, el.element));
                  return (
                    <li key={el.uid} className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 ${el.uid === selected ? "border-accent bg-accent/5" : "border-line"}`}>
                      <button type="button" onClick={() => setSelected(el.uid)} aria-pressed={el.uid === selected} className="min-h-9 min-w-0 flex-1 truncate text-left text-sm">
                        {info ? info.title : s("ed.gone")}
                      </button>
                      {nearEdge(el, pv.view.safe, page) && <span className={`${ui.chipWarn} shrink-0`} data-testid="near-edge">{s("ed.nearEdge")}</span>}
                      <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={el.visible} onChange={(e) => update(elements.map((x) => (x.uid === el.uid ? { ...x, visible: e.target.checked } : x)))} className="h-4 w-4 accent-[var(--v-accent)]" aria-label={`${s("ed.visible")} — ${info?.title ?? ""}`} /><span aria-hidden>{el.visible ? "👁" : "—"}</span></label>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {sel && (
            <section className={`${ui.card} space-y-4`} aria-label={selInfo?.title ?? s("ed.gone")}>
              <div>
                <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{selInfo ? selInfo.title : s("ed.gone")}</h2>
                {selInfo?.description && <p className="mt-1 text-[13px] leading-5 text-muted">{selInfo.description}</p>}
                {!selInfo && <p className={ui.help}>{s("ed.goneHelp")}</p>}
                {selInfo && <p className={ui.help}>{s(`ed.fit.${selInfo.layout.fit}`)}</p>}
              </div>
              {(() => {
                const tabs = [{ id: "place" as const, label: s("ed.tab.place") }, ...(selInfo?.followsStyle ? [{ id: "look" as const, label: s("ed.tab.look") }] : []), ...(selInfo && selInfo.options.length > 0 ? [{ id: "options" as const, label: s("ed.tab.options") }] : [])];
                const current = tabs.some((t) => t.id === tab) ? tab : "place";
                return (
                  <>
                    {tabs.length > 1 && (
                      <div role="tablist" aria-label={s("ed.tab.label")} className="flex flex-wrap gap-1 border-b border-line" data-testid="element-tabs">
                        {tabs.map((t) => (
                          <button key={t.id} type="button" role="tab" id={`ov-tab-${t.id}`} aria-selected={current === t.id} aria-controls={`ov-tabpanel-${t.id}`} onClick={() => setTab(t.id)}
                            className={`-mb-px min-h-11 rounded-t-lg border-b-2 px-3 text-sm font-medium ${current === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
                            {t.label}{t.id === "look" && selLook && !selLook.readable.ok ? <span aria-hidden className="ml-1 text-amber-600">⚠</span> : null}
                          </button>
                        ))}
                      </div>
                    )}
                    {current === "place" && (
                      <div role={tabs.length > 1 ? "tabpanel" : undefined} id="ov-tabpanel-place" aria-labelledby={tabs.length > 1 ? "ov-tab-place" : undefined} className="space-y-4">
              <div className="grid gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div className="grid grid-cols-2 gap-3 self-start">
                {(["x", "y", "w", "h"] as const).map((f) => (
                  <div key={f}>
                    <label htmlFor={`ov-${f}`} className="mb-1 block text-sm font-medium">{s(`ed.field.${f}`)}</label>
                    <input {...PLAIN_INPUT} id={`ov-${f}`} inputMode="numeric" defaultValue={sel[f]} key={`${sel.uid}-${f}-${sel[f]}`}
                      onBlur={(e) => update(setField(elements, sel.uid, f, Number(e.target.value), page, declOf))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); update(setField(elements, sel.uid, f, Number((e.target as HTMLInputElement).value), page, declOf)); } }}
                      className={ui.input} />
                  </div>
                ))}
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">{s("ed.anchor")}</legend>
                <div className="grid w-40 grid-cols-3 gap-1" role="group">
                  {GRID_ANCHORS.map((a) => (
                    <button key={a} type="button" onClick={() => update(anchorElement(elements, sel.uid, a, Number(margin), page))} aria-label={s(`ed.anchor.${a}`)} title={s(`ed.anchor.${a}`)}
                      className="flex h-10 items-center justify-center rounded-lg border border-line bg-bg text-lg leading-none transition-colors hover:border-accent hover:text-accent" aria-describedby="ov-anchor-help">
                      <span aria-hidden>{ARROWS[a]}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <label htmlFor="ov-margin" className="text-sm">{s("ed.margin")}</label>
                  <input {...PLAIN_INPUT} id="ov-margin" inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} className={`${ui.input} w-20`} />
                  <span className="text-sm text-muted">px</span>
                </div>
                <p id="ov-anchor-help" className={`${ui.help} max-w-[16rem]`}>{s("ed.anchorHelp")}</p>
              </fieldset>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "front"))}>{s("ed.front")}</button>
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "back"))}>{s("ed.back")}</button>
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "up"))}>{s("ed.up")}</button>
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "down"))}>{s("ed.down")}</button>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.visible} onChange={(e) => update(elements.map((x) => (x.uid === sel.uid ? { ...x, visible: e.target.checked } : x)))} className="h-4 w-4 accent-[var(--v-accent)]" />{s("ed.visible")}</label>
              <TextSizeField key={sel.uid} testId="text-size-element" legend={s("ed.textSize.element")} help={s("ed.textSize.elementHelp")} value={sel.textScale ?? null} inherit errorPath={`elements.${sel.uid}.textScale`} s={s}
                onChange={(v) => update(elements.map((x) => { if (x.uid !== sel.uid) return x; const { textScale, ...rest } = x; void textScale; return v === null ? rest : { ...rest, textScale: v }; }))} />
              {selInfo && !selInfo.followsStyle && <p className={ui.help}>{s("ed.noStyle")}</p>}
              <button type="button" className={ui.btnDanger} onClick={() => { const next = removeElement(elements, sel.uid); update(next); setSelected(next.at(-1)?.uid ?? null); setAnnounce(s("ed.removed")); }}>{s("ed.remove")}</button>
                      </div>
                    )}
                    {current === "look" && selInfo?.followsStyle && selLook && (
                      <div role="tabpanel" id="ov-tabpanel-look" aria-labelledby="ov-tab-look">
                        <OverlayLookPanel key={sel.uid} uid={sel.uid} style={sel.style ?? null} applied={selLook.applied} readable={selLook.readable} s={s}
                          pageLook={style.readability ?? null} skins={skins} skin={sel.skin} wearsSkin={wears(sel)}
                          onSkin={(next) => update(elements.map((x) => { if (x.uid !== sel.uid) return x; const { skin, ...rest } = x; void skin; return next === undefined ? rest : { ...rest, skin: next }; }))}
                          onChange={(next) => update(setLook(elements, sel.uid, next) as EditorElement[])} />
                        <div role="group" aria-label={s("ed.lookClip")} className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3" data-testid="look-clip">
                          <button type="button" className={`${ui.btn} min-h-11`} onClick={() => { setClip({ style: sel.style ?? null }); setAnnounce(s("ed.lookCopied")); }}>{s("ed.copyLook")}</button>
                          <button type="button" className={`${ui.btn} min-h-11`} disabled={!clip} onClick={() => { if (!clip) return; update(setLook(elements, sel.uid, clip.style) as EditorElement[]); setAnnounce(s("ed.lookPasted")); }}>{s("ed.pasteLook")}</button>
                          <button type="button" className={`${ui.btn} min-h-11`} onClick={() => {
                            const targets = elements.filter((x) => x.uid !== sel.uid && byKey.get(catalogKey(x.instance, x.element))?.followsStyle);
                            update(targets.reduce((list, x) => setLook(list, x.uid, sel.style ?? null), elements as PageElement[]) as EditorElement[]);
                            setAnnounce(s(targets.length === 1 ? "ed.lookAppliedAll.one" : "ed.lookAppliedAll", { n: targets.length }));
                          }}>{s("ed.applyLookAll")}</button>
                        </div>
                      </div>
                    )}
                    {current === "options" && selInfo && selInfo.options.length > 0 && (
                      <div role="tabpanel" id="ov-tabpanel-options" aria-labelledby="ov-tab-options">
                        <OptionsForm info={selInfo} el={sel} s={s} fold={limits.fold} onChange={(id, v) => update(elements.map((x) => (x.uid === sel.uid ? { ...x, options: { ...x.options, [id]: v } } : x)))} />
                      </div>
                    )}
                  </>
                );
              })()}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function StyleSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const id = `ov-style-${label}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={ui.input}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
}

const ARROWS: Record<Anchor, string> = { tl: "↖", tc: "↑", tr: "↗", ml: "←", c: "●", mr: "→", bl: "↙", bc: "↓", br: "↘" };
const handleStyle = (h: Handle): React.CSSProperties => ({
  ...(h.includes("n") ? { top: -13 } : h.includes("s") ? { bottom: -13 } : { top: "calc(50% - 12px)" }),
  ...(h.includes("w") ? { left: -13 } : h.includes("e") ? { right: -13 } : { left: "calc(50% - 12px)" }),
});
const handleCursor = (h: Handle): string => ({ n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" })[h];

/** Formulaire des options, dessiné d'après la déclaration de l'élément. Au-delà de `fold` options, les suivantes sont rangées sous « Plus d'options » (replié). */
function OptionsForm({ info, el, s, fold, onChange }: { info: ClientElement; el: EditorElement; s: (k: string, v?: Record<string, string | number>) => string; fold: number; onChange: (id: string, v: OptionValue) => void }) {
  const shown = info.options.slice(0, fold), folded = info.options.slice(fold);
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{s("ed.options")}</h3>
      {shown.map((o) => <OptionField key={`${el.uid}-${o.id}`} o={o} el={el} onChange={onChange} />)}
      {folded.length > 0 && (
        <details className="rounded-xl border border-line">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">{s("ed.moreOptions", { n: folded.length })}</summary>
          <div className="space-y-4 border-t border-line p-3">{folded.map((o) => <OptionField key={`${el.uid}-${o.id}`} o={o} el={el} onChange={onChange} />)}</div>
        </details>
      )}
    </div>
  );
}

function OptionField({ o, el, onChange }: { o: ClientOption; el: EditorElement; onChange: (id: string, v: OptionValue) => void }) {
  const path = `elements.${el.uid}.options.${o.id}`;
  const err = useFieldError(path);
  const id = `ov-opt-${el.uid}-${o.id}`;
  const value = el.options[o.id] ?? o.default;
  if (o.type === "boolean") {
    return (
      <div>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value === true} onChange={(e) => onChange(o.id, e.target.checked)} className="h-4 w-4 accent-[var(--v-accent)]" {...err.props} />{o.label}</label>
        </div>
        <HelpBelow help={o.help} className={ui.help} />
        <FieldErrorText id={err.id} message={err.message} />
      </div>
    );
  }
  return (
    <div>
      <FieldLabel id={id} className="mb-1 block text-sm font-medium" help={o.help} text={o.label}>{o.label}</FieldLabel>
      {o.type === "choice" ? (
        <select id={id} value={String(value)} onChange={(e) => onChange(o.id, e.target.value)} className={`${ui.input} ${err.className}`} {...err.props}>{o.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
      ) : (
        <input {...PLAIN_INPUT} id={id} inputMode={o.type === "number" ? "decimal" : undefined} value={String(value)} onChange={(e) => onChange(o.id, e.target.value)} className={`${ui.input} ${err.className}`} {...err.props} />
      )}
      <HelpBelow help={o.help} className={ui.help} />
      <FieldErrorText id={err.id} message={err.message} />
    </div>
  );
}
