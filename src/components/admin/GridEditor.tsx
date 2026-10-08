"use client";

import { useActionState, useRef, useState } from "react";
import { runModuleAdminAction } from "@/app/admin/(panel)/instances/module-actions";
import type { Block } from "@/core/blocks";
import { ui } from "./ui";

type GridBlock = Extract<Block, { type: "gridEditor" }>;
const MAX_PIXELS = 640;

/** Éditeur de grille générique (palette de pinceaux, peinture au glisser, redimensionnement). Ne sait rien de ce que la grille représente. */
export function GridEditor({ instanceId, block }: { instanceId: string; block: GridBlock }) {
  const min = block.minSize ?? 3, max = block.maxSize ?? 41;
  const values = block.palette.map((p) => p.value);
  const first = values[0] ?? "0";
  const [w, setW] = useState(block.width);
  const [h, setH] = useState(block.height);
  const [cells, setCells] = useState<string[]>(() => Array.from({ length: block.width * block.height }, (_, i) => (values.includes(block.cells[i] ?? "") ? block.cells[i]! : first)));
  const [brush, setBrush] = useState(values[1] ?? first);
  const [state, action, pending] = useActionState(runModuleAdminAction.bind(null, instanceId, block.action), null);
  const painting = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const L = { width: "Width", height: "Height", fillAll: "Fill everything", border: "Frame", reset: "Undo changes", hint: "Pick a brush, then click or drag over the cells.", ...block.labels };
  const color = (v: string) => block.palette.find((p) => p.value === v)?.color ?? "#000";

  const resize = (nw: number, nh: number) => {
    const cw = Math.min(max, Math.max(min, Math.trunc(nw) || w)), ch = Math.min(max, Math.max(min, Math.trunc(nh) || h));
    setCells((old) => Array.from({ length: cw * ch }, (_, i) => { const x = i % cw, y = Math.floor(i / cw); return x < w && y < h ? old[y * w + x]! : first; }));
    setW(cw); setH(ch);
  };
  const paintAt = (clientX: number, clientY: number) => {
    const r = gridRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.floor(((clientX - r.left) / r.width) * w), y = Math.floor(((clientY - r.top) / r.height) * h);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    setCells((old) => (old[y * w + x] === brush ? old : old.map((v, i) => (i === y * w + x ? brush : v))));
  };
  const reset = () => { setW(block.width); setH(block.height); setCells(Array.from({ length: block.width * block.height }, (_, i) => (values.includes(block.cells[i] ?? "") ? block.cells[i]! : first))); };
  const cell = Math.max(6, Math.min(24, Math.floor(MAX_PIXELS / Math.max(w, h))));

  return (
    <form action={action} className={`${ui.card} space-y-4`}>
      {block.title && <h3 className="text-lg font-semibold">{block.title}</h3>}
      <p className="text-sm text-muted">{L.hint}</p>
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="brush">
        {block.palette.map((p) => (
          <button key={p.value} type="button" role="radio" aria-checked={brush === p.value} onClick={() => setBrush(p.value)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${brush === p.value ? "border-accent ring-2 ring-accent" : "border-line"}`}>
            <span className="inline-block h-4 w-4 rounded border border-black/30" style={{ background: p.color }} />{p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>{L.width}<input type="number" min={min} max={max} value={w} onChange={(e) => resize(Number(e.target.value), h)} className={`${ui.input} ml-2 w-20`} /></label>
        <label>{L.height}<input type="number" min={min} max={max} value={h} onChange={(e) => resize(w, Number(e.target.value))} className={`${ui.input} ml-2 w-20`} /></label>
        <button type="button" className={ui.btn} onClick={() => setCells(Array.from({ length: w * h }, () => brush))}>{L.fillAll}</button>
        <button type="button" className={ui.btn} onClick={() => setCells((old) => old.map((v, i) => { const x = i % w, y = Math.floor(i / w); return x === 0 || y === 0 || x === w - 1 || y === h - 1 ? brush : v; }))}>{L.border}</button>
        <button type="button" className={ui.btn} onClick={reset}>{L.reset}</button>
      </div>
      <div ref={gridRef} role="application" aria-label={block.title ?? "grid"} className="touch-none select-none overflow-hidden rounded-lg border border-line"
        style={{ width: "100%", maxWidth: w * cell, display: "grid", gridTemplateColumns: `repeat(${w}, minmax(0, 1fr))`, cursor: "crosshair" }}
        onPointerDown={(e) => { painting.current = true; paintAt(e.clientX, e.clientY); try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch { /* le doigt est déjà suivi par le navigateur */ } }}
        onPointerMove={(e) => { if (painting.current) paintAt(e.clientX, e.clientY); }}
        onPointerUp={() => { painting.current = false; }} onPointerCancel={() => { painting.current = false; }}>
        {cells.map((v, i) => <div key={i} style={{ aspectRatio: "1 / 1", background: color(v), boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,.25)" }} />)}
      </div>
      <input type="hidden" name="width" value={w} /><input type="hidden" name="height" value={h} /><input type="hidden" name="cells" value={cells.join("")} />
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3 text-sm text-emerald-700">{state.ok}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={ui.btnPrimary}>{block.submitLabel}</button>
        {block.cancelHref && <a href={block.cancelHref} className={ui.btn}>↩</a>}
      </div>
    </form>
  );
}
