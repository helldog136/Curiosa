"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FieldErrorText, useFieldError } from "./FieldErrors";
import { FieldLabel } from "./Field";
import { HelpBelow } from "./HelpTip";
import { ui } from "./ui";
import { addElement, anchorElement, changeResolution, newUid, removeElement, reorder, setField, setRect } from "@/core/overlays/editorModel";
import { ANCHORS, handlesFor, resizeRect, snapMove, type Anchor, type Guide, type Handle, type LayoutDecl, type Rect } from "@/core/overlays/layout";
import { catalogKey, type OptionValue, type OverlayStyle, type PageElement } from "@/core/overlays/model";

/** Éditeur d'une page d'overlay (navigateur de PC). Aperçu à l'échelle avec cadres nommés, glisser-déposer + poignées, champs précis, ancrages, ordre, options, style. Tout est faisable au clavier. */
export type ClientOption = { id: string; type: "choice" | "boolean" | "number" | "text"; label: string; help: string; example: string; choices: { value: string; label: string }[]; default: OptionValue };
export type ClientElement = { key: string; instance: string; element: string; group: string; title: string; label: string; description: string; layout: LayoutDecl; followsStyle: boolean; options: ClientOption[] };
export type EditorElement = PageElement & { missing?: boolean };
type Props = {
  pageId: string;
  initial: { name: string; width: number; height: number; style: OverlayStyle; elements: EditorElement[] };
  available: ClientElement[];
  resolutions: [number, number][];
  limits: { elements: number; fold: number; minSide: number; maxSide: number };
  previewSrc: string;
  strings: Record<string, string>;
};

const hue = (i: number) => (i * 47 + 10) % 360;
const GRID_ANCHORS: Anchor[] = [...ANCHORS];
const SNAP_PX = 8;

export function OverlayEditor({ pageId, initial, available, resolutions, limits, previewSrc, strings }: Props) {
  const s = useCallback((key: string, vars?: Record<string, string | number>) => {
    let text = strings[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  }, [strings]);
  const byKey = useMemo(() => new Map(available.map((a) => [catalogKey(a.instance, a.element), a])), [available]);
  const declOf = useCallback((instance: string, element: string): LayoutDecl | null => byKey.get(catalogKey(instance, element))?.layout ?? null, [byKey]);

  const [name, setName] = useState(initial.name);
  const [size, setSize] = useState({ width: initial.width, height: initial.height });
  const preset = resolutions.some(([w, h]) => w === size.width && h === size.height);
  const [custom, setCustom] = useState(!preset);
  const [style, setStyle] = useState(initial.style);
  const [elements, setElements] = useState<EditorElement[]>(initial.elements);
  const [selected, setSelected] = useState<string | null>(initial.elements.at(-1)?.uid ?? null);
  const [live, setLive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [margin, setMargin] = useState("24");
  const [guides, setGuides] = useState<Guide[]>([]);
  const [announce, setAnnounce] = useState("");
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{ uid: string; mode: "move" | Handle; x: number; y: number; start: Rect; scale: number; moved: boolean } | null>(null);

  const page = useMemo(() => ({ width: size.width, height: size.height }), [size.width, size.height]);
  const sel = elements.find((e) => e.uid === selected) ?? null;
  const selInfo = sel ? byKey.get(catalogKey(sel.instance, sel.element)) ?? null : null;

  const data = useMemo(() => JSON.stringify({ name, width: size.width, height: size.height, style, elements: elements.map(({ missing, ...e }) => { void missing; return e; }) }), [name, size, style, elements]);

  const update = (next: EditorElement[]) => setElements(next as EditorElement[]);
  const titleOf = (e: EditorElement) => byKey.get(catalogKey(e.instance, e.element))?.title ?? `${e.instance} · ${e.element}`;

  function add(a: ClientElement) {
    const taken = new Set(elements.map((e) => e.uid));
    const uid = newUid(taken);
    const defaults = Object.fromEntries(a.options.map((o) => [o.id, o.default]));
    update(addElement(elements, page, { instance: a.instance, element: a.element, decl: a.layout, defaults }, uid));
    setSelected(uid); setAdding(false);
    setAnnounce(s("ed.added", { name: a.title }));
  }

  function chooseResolution(value: string) {
    if (value === "custom") { setCustom(true); return; }
    const [w, h] = value.split("x").map(Number) as [number, number];
    setCustom(false);
    update(changeResolution(elements, size, { width: w, height: h }, declOf));
    setSize({ width: w, height: h });
  }
  function typeResolution(axis: "width" | "height", raw: string) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < limits.minSide || n > limits.maxSide) { setSize((p) => ({ ...p, [axis]: Number.isFinite(n) ? n : p[axis] })); return; }
    const to = { ...size, [axis]: n };
    update(changeResolution(elements, size, to, declOf));
    setSize(to);
  }

  // ── Glisser-déposer ───────────────────────────────────────────────────────────────────────────────────────────────
  function begin(e: React.PointerEvent, uid: string, mode: "move" | Handle) {
    const el = elements.find((x) => x.uid === uid);
    const box = canvas.current?.getBoundingClientRect();
    if (!el || !box) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(uid);
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
      const snapped = snapMove({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }, page, SNAP_PX / d.scale);
      setGuides(snapped.guides);
      update(setRect(elements, d.uid, snapped.rect));
    } else if (decl) {
      update(setRect(elements, d.uid, resizeRect(decl, d.start, d.mode, dx, dy, page)));
    }
  }
  function endDrag() { drag.current = null; setGuides([]); }

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

  const groups = useMemo(() => {
    const m = new Map<string, ClientElement[]>();
    for (const a of available) m.set(a.group, [...(m.get(a.group) ?? []), a]);
    return [...m.entries()];
  }, [available]);

  const nameError = useFieldError("name");
  const resError = useFieldError("resolution");
  const full = elements.length >= limits.elements;

  return (
    <div className="space-y-6">
      <input type="hidden" name="data" value={data} />
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>

      <section className={`${ui.card} grid gap-4 lg:grid-cols-[2fr_2fr_3fr]`}>
        <div>
          <label htmlFor="ov-name" className={ui.label}>{s("ed.name")}</label>
          <input id="ov-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${ui.input} ${nameError.className}`} {...nameError.props} />
          <FieldErrorText id={nameError.id} message={nameError.message} />
        </div>
        <div>
          <label htmlFor="ov-res" className={ui.label}>{s("ed.resolution")}</label>
          <select id="ov-res" value={custom ? "custom" : `${size.width}x${size.height}`} onChange={(e) => chooseResolution(e.target.value)} className={ui.input}>
            {resolutions.map(([w, h]) => <option key={`${w}x${h}`} value={`${w}x${h}`}>{w}×{h}</option>)}
            <option value="custom">{s("ed.resolutionOther")}</option>
          </select>
          {custom && (
            <div className="mt-2 flex items-center gap-2">
              <input aria-label={s("ed.width")} inputMode="numeric" value={size.width} onChange={(e) => typeResolution("width", e.target.value)} className={`${ui.input} w-28`} />
              <span aria-hidden>×</span>
              <input aria-label={s("ed.height")} inputMode="numeric" value={size.height} onChange={(e) => typeResolution("height", e.target.value)} className={`${ui.input} w-28`} />
              <span className="text-sm text-muted">px</span>
            </div>
          )}
          <FieldErrorText id={resError.id} message={resError.message} />
          <p className={ui.help}>{s("ed.resolutionHelp")}</p>
        </div>
        <fieldset className="min-w-0">
          <legend className={ui.label}>{s("ed.style")}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <StyleSelect label={s("ed.style.text")} value={style.text} onChange={(v) => setStyle({ ...style, text: v as OverlayStyle["text"] })} options={[["light", s("ed.style.text.light")], ["dark", s("ed.style.text.dark")]]} />
            <StyleSelect label={s("ed.style.background")} value={style.background} onChange={(v) => setStyle({ ...style, background: v as OverlayStyle["background"] })} options={[["transparent", s("ed.style.background.transparent")], ["soft", s("ed.style.background.soft")]]} />
            <StyleSelect label={s("ed.style.corners")} value={style.corners} onChange={(v) => setStyle({ ...style, corners: v as OverlayStyle["corners"] })} options={[["round", s("ed.style.corners.round")], ["square", s("ed.style.corners.square")]]} />
          </div>
          <p className={ui.help}>{s("ed.styleHelp")}</p>
        </fieldset>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 space-y-3" aria-label={s("ed.preview")}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ui.btnPrimary} aria-expanded={adding} onClick={() => setAdding(!adding)} disabled={full}>{s("ed.add")}</button>
            <button type="button" className={ui.btn} aria-pressed={live} onClick={() => setLive(!live)}>{live ? s("ed.backToEdit") : s("ed.live")}</button>
            <span className="text-sm text-muted">{s("ed.count", { n: elements.length, max: limits.elements })}</span>
          </div>
          {full && <p className={ui.help}>{s("ed.full", { max: limits.elements })}</p>}
          {adding && (
            <div role="dialog" aria-label={s("ed.add")} className={`${ui.card} space-y-4`}>
              {groups.length === 0 && <p className="text-sm text-muted">{s("ed.noneAvailable")}</p>}
              {groups.map(([group, items]) => (
                <fieldset key={group} className="space-y-2">
                  <legend className="text-sm font-semibold">{group}</legend>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {items.map((a) => (
                      <li key={a.key}>
                        <button type="button" onClick={() => add(a)} className="flex min-h-11 w-full flex-col items-start rounded-xl border border-line bg-bg px-3 py-2 text-left transition-colors hover:border-accent">
                          <span className="text-sm font-medium">{a.label}</span>
                          {a.description && <span className="text-[13px] leading-5 text-muted">{a.description}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ))}
              <button type="button" className={ui.btn} onClick={() => setAdding(false)}>{s("ed.cancel")}</button>
            </div>
          )}

          {live ? (
            <div className="space-y-2">
              <div className="w-full overflow-hidden rounded-xl border border-line bg-[repeating-conic-gradient(#0000000f_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
                <iframe title={s("ed.live")} src={previewSrc} sandbox="allow-scripts allow-same-origin" className="h-full w-full border-0" />
              </div>
              <p className={ui.help}>{s("ed.liveHelp")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div ref={canvas} data-testid="overlay-canvas" className="relative w-full select-none overflow-hidden rounded-xl border border-line bg-[repeating-conic-gradient(#0000000f_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]" style={{ aspectRatio: `${size.width} / ${size.height}`, touchAction: "none" }}
                onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
                {elements.map((el, i) => {
                  const c = `hsl(${hue(i)} 70% 42%)`;
                  const isSel = el.uid === selected;
                  const info = byKey.get(catalogKey(el.instance, el.element));
                  const gone = !info;
                  const decl = info?.layout;
                  return (
                    <div key={el.uid} role="button" tabIndex={0} aria-pressed={isSel}
                      aria-label={`${titleOf(el)} — ${el.w}×${el.h} px${el.visible ? "" : ` (${s("ed.hidden")})`}`}
                      onPointerDown={(e) => begin(e, el.uid, "move")} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                      onFocus={() => setSelected(el.uid)} onKeyDown={(e) => keys(e, el)}
                      className={`absolute cursor-move overflow-hidden border-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${isSel ? "border-solid shadow-lg" : "border-dashed"} ${el.visible ? "" : "opacity-45"}`}
                      style={{ left: `${(el.x / size.width) * 100}%`, top: `${(el.y / size.height) * 100}%`, width: `${(el.w / size.width) * 100}%`, height: `${(el.h / size.height) * 100}%`, zIndex: i + 1, borderColor: c, background: gone ? "repeating-linear-gradient(45deg,#8883 0 6px,transparent 6px 12px)" : `color-mix(in srgb, ${c} 14%, transparent)` }}>
                      <span className="absolute left-0 top-0 max-w-full truncate px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-white" style={{ background: c }}>
                        {gone ? s("ed.gone") : `${titleOf(el)} · ${el.w}×${el.h} px`}
                      </span>
                      {isSel && decl && handlesFor(decl).map((h) => (
                        <span key={h} onPointerDown={(e) => begin(e, el.uid, h)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} aria-hidden="true"
                          className="absolute h-3 w-3 rounded-sm border-2 border-white" style={{ background: c, ...handleStyle(h), cursor: handleCursor(h) }} />
                      ))}
                    </div>
                  );
                })}
                {guides.map((g, i) => (
                  <span key={i} aria-hidden="true" className="pointer-events-none absolute bg-accent/70" style={g.axis === "x" ? { left: `${(g.at / size.width) * 100}%`, top: 0, bottom: 0, width: 1 } : { top: `${(g.at / size.height) * 100}%`, left: 0, right: 0, height: 1 }} />
                ))}
              </div>
              <p className={ui.help}>{s("ed.canvasHelp")}</p>
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-4" aria-label={s("ed.panel")}>
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
              <div className="grid grid-cols-2 gap-3">
                {(["x", "y", "w", "h"] as const).map((f) => (
                  <div key={f}>
                    <label htmlFor={`ov-${f}`} className="mb-1 block text-sm font-medium">{s(`ed.field.${f}`)}</label>
                    <input id={`ov-${f}`} inputMode="numeric" defaultValue={sel[f]} key={`${sel.uid}-${f}-${sel[f]}`}
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
                  <input id="ov-margin" inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} className={`${ui.input} w-20`} />
                  <span className="text-sm text-muted">px</span>
                </div>
                <p id="ov-anchor-help" className={ui.help}>{s("ed.anchorHelp")}</p>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "front"))}>{s("ed.front")}</button>
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "back"))}>{s("ed.back")}</button>
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "up"))}>{s("ed.up")}</button>
                <button type="button" className={ui.btn} onClick={() => update(reorder(elements, sel.uid, "down"))}>{s("ed.down")}</button>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.visible} onChange={(e) => update(elements.map((x) => (x.uid === sel.uid ? { ...x, visible: e.target.checked } : x)))} className="h-4 w-4 accent-[var(--v-accent)]" />{s("ed.visible")}</label>
              {selInfo && selInfo.options.length > 0 && <OptionsForm info={selInfo} el={sel} s={s} fold={limits.fold} onChange={(id, v) => update(elements.map((x) => (x.uid === sel.uid ? { ...x, options: { ...x.options, [id]: v } } : x)))} />}
              {selInfo && !selInfo.followsStyle && <p className={ui.help}>{s("ed.noStyle")}</p>}
              <button type="button" className={ui.btnDanger} onClick={() => { const next = removeElement(elements, sel.uid); update(next); setSelected(next.at(-1)?.uid ?? null); setAnnounce(s("ed.removed")); }}>{s("ed.remove")}</button>
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
  ...(h.includes("n") ? { top: -7 } : h.includes("s") ? { bottom: -7 } : { top: "calc(50% - 6px)" }),
  ...(h.includes("w") ? { left: -7 } : h.includes("e") ? { right: -7 } : { left: "calc(50% - 6px)" }),
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
        <input id={id} inputMode={o.type === "number" ? "decimal" : undefined} value={String(value)} onChange={(e) => onChange(o.id, e.target.value)} className={`${ui.input} ${err.className}`} {...err.props} />
      )}
      <HelpBelow help={o.help} className={ui.help} />
      <FieldErrorText id={err.id} message={err.message} />
    </div>
  );
}
