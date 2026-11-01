"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RATIOS, RATIO_MAX, RATIO_MIN, SMALL_SOURCE_PX, ZOOM_MAX, ZOOM_MIN, normalizeCrop, previewLayout, visibleRegion, type Crop } from "@/core/imageCrop";
import { useAdvancedMode, useCropLabels } from "./CropLabels";
import { ui } from "./ui";

/**
 * Éditeur de recadrage : glisser pour déplacer, molette / curseur / pincement / « + » « − » pour zoomer et dézoomer, choix du format
 * (ou « Libre » : on tire les poignées du cadre). Le cadre montre exactement ce que le site affichera ; l'original n'est jamais modifié.
 * Ne sait rien du champ qui l'ouvre : reçoit l'adresse de l'original et le cadrage actuel, rend le nouveau cadrage (ou `null` = aucun).
 */

type Mode = "o" | "free" | (typeof RATIOS)[number]["id"];
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const HANDLE_POS: Record<Handle, string> = {
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize", s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize", w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize", nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize", sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
};
const PAD = 22;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const CHECKER = "repeating-conic-gradient(#cfcfcf 0% 25%, #fff 0% 50%) 0 0 / 14px 14px";
const hexOf = (fill: string) => (fill === "t" ? "#ffffff" : `#${fill}`);

function modeOf(crop: Crop | null): Mode {
  if (!crop || crop.ratio === null) return "o";
  return RATIOS.find((r) => Math.abs(r.value - crop.ratio!) < 0.002)?.id ?? "free";
}

export function ImageCropper({ src, initial, warnSmall, onApply, onCancel }: { src: string; initial: Crop | null; warnSmall: boolean; onApply: (crop: Crop | null) => void; onCancel: () => void }) {
  const c = useCropLabels();
  const advanced = useAdvancedMode();
  const [nat, setNat] = useState<{ W: number; H: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [avg, setAvg] = useState("ffffff");
  const [mode, setMode] = useState<Mode>(modeOf(initial));
  const [freeA, setFreeA] = useState(initial?.ratio ?? 1);
  const [freeK, setFreeK] = useState(1);
  const [view, setView] = useState({ zoom: initial?.zoom ?? 1, x: initial?.x ?? 0.5, y: initial?.y ?? 0.5 });
  /** "" = pas encore choisi : la couleur moyenne de l'image (connue après chargement). */
  const [fill, setFill] = useState(initial?.fill ?? "");
  const [stage, setStage] = useState({ w: 320, h: 300 });
  const stageRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ handle: Handle; x: number; y: number; fw: number; fh: number; scale: number } | null>(null);

  // Chargement de l'original (et couleur moyenne, proposée comme remplissage).
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setNat({ W: img.naturalWidth, H: img.naturalHeight });
      try {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 1;
        const g = cv.getContext("2d");
        g?.drawImage(img, 0, 0, 1, 1);
        const d = g?.getImageData(0, 0, 1, 1).data;
        if (d) setAvg([d[0]!, d[1]!, d[2]!].map((v) => v.toString(16).padStart(2, "0")).join(""));
      } catch { /* image non lisible : le remplissage reste blanc */ }
    };
    img.onerror = () => setFailed(true);
    img.src = src;
  }, [src]);

  // Taille de la zone de travail.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [nat]);

  // Fenêtre modale : page derrière figée, focus dedans, Échap ferme, Tab reste dans la fenêtre.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => { document.body.style.overflow = overflow; before?.focus?.(); };
  }, []);

  const W = nat?.W ?? 1, H = nat?.H ?? 1;
  const A = clamp(mode === "o" ? W / H : mode === "free" ? freeA : RATIOS.find((r) => r.id === mode)!.value, RATIO_MIN, RATIO_MAX);
  const availW = Math.max(40, stage.w - 2 * PAD), availH = Math.max(40, stage.h - 2 * PAD);
  const fitOf = useCallback((a: number) => (availW / availH > a ? { w: availH * a, h: availH } : { w: availW, h: availW / a }), [availW, availH]);
  const fit = fitOf(A);
  const frameW = fit.w * (mode === "free" ? freeK : 1), frameH = frameW / A;
  const cur: Crop = normalizeCrop({ ratio: mode === "o" ? null : A, ...view, fill: fill || avg });
  const lay = previewLayout(cur, W, H, frameW);
  const region = visibleRegion(cur, W, H);

  const latest = useRef({ lay, view, A, frameW, W, H });
  useEffect(() => { latest.current = { lay, view, A, frameW, W, H }; });
  const setZoom = (z: number) => setView((v) => ({ ...v, zoom: clamp(z, ZOOM_MIN, ZOOM_MAX) }));
  const zoomBy = (f: number) => setView((v) => ({ ...v, zoom: clamp(v.zoom * f, ZOOM_MIN, ZOOM_MAX) }));
  const panBy = (dx: number, dy: number) => setView((v) => {
    const { lay: l } = latest.current;
    return { ...v, x: clamp(v.x - dx / l.imgW, 0, 1), y: clamp(v.y - dy / l.imgH, 0, 1) };
  });

  // Molette : écouteur natif (React en pose un « passif », qui ne peut pas empêcher le défilement de la page).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [nat]);

  function down(e: React.PointerEvent) {
    stageRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function move(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 1) panBy(next.x - prev.x, next.y - prev.y);
    else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y), after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0 && after > 0) zoomBy(after / before);
      panBy((next.x - prev.x) / 2, (next.y - prev.y) / 2);
    }
    pointers.current.set(e.pointerId, next);
  }
  function up(e: React.PointerEvent) { pointers.current.delete(e.pointerId); }

  function key(e: React.KeyboardEvent) {
    const step = (e.shiftKey ? 0.15 : 0.04) * region.width;
    const l = latest.current.lay, s = l.imgW / W;
    if (e.key === "ArrowLeft") panBy(step * s, 0);
    else if (e.key === "ArrowRight") panBy(-step * s, 0);
    else if (e.key === "ArrowUp") panBy(0, step * s);
    else if (e.key === "ArrowDown") panBy(0, -step * s);
    else if (e.key === "+" || e.key === "=") zoomBy(1.1);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.1);
    else return;
    e.preventDefault();
  }

  // Poignées du cadre (ratio « Libre ») : le cadre change de forme, l'image garde son échelle à l'écran.
  function handleDown(h: Handle, e: React.PointerEvent) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle: h, x: e.clientX, y: e.clientY, fw: frameW, fh: frameH, scale: frameW / region.width };
    if (mode !== "free") { setMode("free"); setFreeA(A); setFreeK(1); }
  }
  function handleMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    let w = d.fw, h = d.fh;
    if (d.handle.includes("e")) w = d.fw + 2 * dx;
    if (d.handle.includes("w")) w = d.fw - 2 * dx;
    if (d.handle.includes("s")) h = d.fh + 2 * dy;
    if (d.handle.includes("n")) h = d.fh - 2 * dy;
    w = clamp(w, 60, availW); h = clamp(h, 60, availH);
    const a = clamp(w / h, RATIO_MIN, RATIO_MAX);
    const f = fitOf(a);
    setFreeA(a);
    setFreeK(clamp(w / f.w, 0.1, 1));
    // Même échelle à l'écran qu'avant : on recalcule le zoom pour le nouveau cadre.
    const base = a >= W / H ? W : H * a;
    setZoom(base / (w / d.scale));
  }
  function handleUp() { drag.current = null; }

  function pickMode(m: Mode) {
    if (m === "free") { setFreeA(A); setFreeK(1); }
    setMode(m);
  }
  function reset() {
    setMode("o"); setFreeA(1); setFreeK(1); setView({ zoom: 1, x: 0.5, y: 0.5 }); setFill("");
  }
  function apply() {
    const next = cur;
    const isDefault = next.ratio === null && next.zoom === 1 && next.x === 0.5 && next.y === 0.5;
    onApply(isDefault ? null : next);
  }
  function trap(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); onCancel(); return; }
    if (e.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, input, [tabindex='0']") ?? [])].filter((el) => !el.hasAttribute("disabled"));
    if (!items.length) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const sliderValue = Math.round((Math.log(view.zoom / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * 1000);
  const small = warnSmall && nat && region.width < SMALL_SOURCE_PX;
  const frameLeft = (stage.w - frameW) / 2, frameTop = (stage.h - frameH) / 2;
  const fillStyle = fill === "t" ? { background: CHECKER } : { background: hexOf(fill || avg) };
  // Aperçu : le résultat dans une boîte de 300 × 190 au plus, comme il apparaît sur le site (coins arrondis).
  const box = stage.w < 460 ? { w: 150, h: 110 } : { w: 300, h: 190 };
  const pv = A >= box.w / box.h ? { w: box.w, h: box.w / A } : { w: box.h * A, h: box.h };
  const pl = previewLayout(cur, W, H, pv.w);
  const label = mode === "o" ? c("original") : mode === "free" ? c("free") : mode;

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/60 sm:items-center sm:p-4" onKeyDown={trap}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={c("title")} className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto bg-surface outline-none px-4 pt-4 shadow-2xl sm:rounded-2xl sm:px-6 sm:pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{c("title")}</h2>
            <p className={ui.help}>{c("help")}<span className="hidden sm:inline"> {c("keys")}</span></p>
          </div>
          <button type="button" onClick={onCancel} aria-label={c("close")} className={`${ui.btn} !px-3`}>✕</button>
        </div>

        {failed && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-700">{c("loadError")}</p>}
        {!nat && !failed && <p className="p-6 text-center text-sm text-muted" role="status">{c("loading")}</p>}

        {nat && (
          <>
            <div role="group" aria-label={c("ratio")} className="flex flex-wrap gap-1.5">
              {([...RATIOS.map((r) => r.id), "o", "free"] as Mode[]).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => pickMode(m)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${mode === m ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface hover:border-accent"}`}>
                  {m === "o" ? c("original") : m === "free" ? c("free") : m}
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_300px]">
              <div ref={stageRef} tabIndex={0} role="application" aria-label={`${c("position")} — ${c("keys")}`} data-testid="crop-stage"
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
                className="relative h-[min(44vh,22rem)] w-full cursor-grab touch-none select-none overflow-hidden rounded-xl bg-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing">
                <div className="pointer-events-none absolute" style={{ left: frameLeft, top: frameTop, width: frameW, height: frameH, ...fillStyle }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left: frameLeft + lay.imgLeft, top: frameTop + lay.imgTop, width: lay.imgW, height: lay.imgH }} />
                <div className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,.55)]" data-testid="crop-frame" style={{ left: frameLeft, top: frameTop, width: frameW, height: frameH, pointerEvents: "none" }}>
                  {HANDLES.map((h) => (
                    <span key={h} role="presentation" data-handle={h} onPointerDown={(e) => handleDown(h, e)} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleUp}
                      className={`pointer-events-auto absolute flex h-9 w-9 touch-none items-center justify-center ${HANDLE_POS[h]}`}>
                      <span className="block h-3.5 w-3.5 rounded-sm border-2 border-white bg-accent" />
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-row items-center gap-3 sm:flex-col sm:items-start sm:gap-1" aria-live="polite">
                <p className="hidden text-sm font-medium sm:block">{c("preview")}</p>
                <div className="relative overflow-hidden rounded-xl border border-line" style={{ width: pv.w, height: pv.h, ...fillStyle }} data-testid="crop-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="pointer-events-none absolute max-w-none" style={{ left: pl.imgLeft, top: pl.imgTop, width: pl.imgW, height: pl.imgH }} />
                </div>
                <p className={ui.help}>{c("previewHelp")} · {label} · {Math.round(view.zoom * 100)} %</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label={c("zoomOut")} title={c("zoomOut")} className={`${ui.btn} !px-4 text-lg`}>−</button>
              <input type="range" min={0} max={1000} step={1} value={sliderValue} aria-label={c("zoom")} aria-valuetext={`${Math.round(view.zoom * 100)} %`}
                onChange={(e) => setZoom(ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, Number(e.target.value) / 1000))} className="h-10 min-w-0 flex-1 accent-accent" />
              <button type="button" onClick={() => zoomBy(1.25)} aria-label={c("zoomIn")} title={c("zoomIn")} className={`${ui.btn} !px-4 text-lg`}>+</button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{c("fill")}</span>
              {([["ffffff", "fillWhite"], ["000000", "fillBlack"], [avg, "fillImage"], ["t", "fillClear"]] as const).map(([v, k]) => (
                <button key={k} type="button" aria-pressed={(fill || avg) === v} onClick={() => setFill(v)} className={`${ui.btn} !px-3 !py-1.5 ${(fill || avg) === v ? "!border-accent" : ""}`}>
                  <span aria-hidden className="h-4 w-4 rounded-full border border-line" style={v === "t" ? { background: CHECKER } : { background: `#${v}` }} />{c(k)}
                </button>
              ))}
              {advanced && <input type="color" aria-label={c("fillPick")} value={hexOf(fill || avg)} onChange={(e) => setFill(e.target.value.slice(1).toLowerCase())} className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-surface p-0.5" />}
            </div>

            {small && <p role="alert" className="rounded-lg bg-amber-500/15 p-3 text-sm text-amber-800">{c("small")}</p>}
          </>
        )}

        <div className="sticky bottom-0 -mx-4 mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6">
          <button type="button" onClick={reset} disabled={!nat} className={ui.btn}>{c("reset")}</button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className={ui.btn}>{c("cancel")}</button>
            <button type="button" onClick={apply} disabled={!nat} className={ui.btnPrimary}>{c("apply")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
