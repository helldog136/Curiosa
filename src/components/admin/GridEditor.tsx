"use client";

import { useRef, useState, useTransition } from "react";
import { runModuleAdminAction, runModuleGridGenerate } from "@/app/admin/(panel)/instances/module-actions";
import type { Block } from "@/core/blocks";
import { parseGeneratedGrid } from "@/core/gridEditor";
import { ActionForm } from "./ActionForm";
import type { FloatingLabels } from "./floating";
import { ui } from "./ui";

type GridBlock = Extract<Block, { type: "gridEditor" }>;
const MAX_PIXELS = 640;

/** Éditeur de grille générique (palette de pinceaux, peinture au glisser, redimensionnement). Ne sait rien de ce que la grille représente. */
export function GridEditor({ instanceId, block, floating }: { instanceId: string; block: GridBlock; floating?: FloatingLabels }) {
  const min = block.minSize ?? 3, max = block.maxSize ?? 41;
  const values = block.palette.map((p) => p.value);
  const first = values[0] ?? "0";
  const [w, setW] = useState(block.width);
  const [h, setH] = useState(block.height);
  const [cells, setCells] = useState<string[]>(() => Array.from({ length: block.width * block.height }, (_, i) => (values.includes(block.cells[i] ?? "") ? block.cells[i]! : first)));
  const [brush, setBrush] = useState(values[1] ?? first);
  const [auto, setAuto] = useState(!!block.autoLabel && !!block.autoActive);
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const painting = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const L = { width: "Width", height: "Height", fillAll: "Fill everything", border: "Frame", reset: "Undo changes", hint: "Pick a brush, then click or drag over the cells.", generateError: "The generated layout is not valid.", ...block.labels };
  const color = (v: string) => block.palette.find((p) => p.value === v)?.color ?? "#000";

  /** Toute retouche de la grille sort du mode automatique. */
  const edited = () => { setAuto(false); setGenError(null); };
  const resize = (nw: number, nh: number) => {
    edited();
    const cw = Math.min(max, Math.max(min, Math.trunc(nw) || w)), ch = Math.min(max, Math.max(min, Math.trunc(nh) || h));
    setCells((old) => Array.from({ length: cw * ch }, (_, i) => { const x = i % cw, y = Math.floor(i / cw); return x < w && y < h ? old[y * w + x]! : first; }));
    setW(cw); setH(ch);
  };
  const paintAt = (clientX: number, clientY: number) => {
    const r = gridRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.floor(((clientX - r.left) / r.width) * w), y = Math.floor(((clientY - r.top) / r.height) * h);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    if (auto) setAuto(false);
    setCells((old) => (old[y * w + x] === brush ? old : old.map((v, i) => (i === y * w + x ? brush : v))));
  };
  const reset = () => { setAuto(!!block.autoLabel && !!block.autoActive); setGenError(null); setW(block.width); setH(block.height); setCells(Array.from({ length: block.width * block.height }, (_, i) => (values.includes(block.cells[i] ?? "") ? block.cells[i]! : first))); };
  /** Demande un tracé au module (action serveur, rien n'est enregistré) et le charge dans l'éditeur ; un tracé invalide est refusé. */
  const generate = () => {
    if (!block.generateAction) return;
    const actionName = block.generateAction;
    startGenerate(async () => {
      const res = await runModuleGridGenerate(instanceId, actionName);
      const grid = res.grid ? parseGeneratedGrid(res.grid, { min, max, allowed: values }) : null;
      if (!grid) { setGenError(res.error ?? L.generateError); return; }
      setGenError(null); setAuto(false); setW(grid.width); setH(grid.height); setCells(Array.from(grid.cells));
    });
  };
  const cell = Math.max(6, Math.min(24, Math.floor(MAX_PIXELS / Math.max(w, h))));

  return (
    <ActionForm action={runModuleAdminAction.bind(null, instanceId, block.action)} floating={floating} hideSubmit submitLabel={block.submitLabel} className={`${ui.card} space-y-4 [&>div[aria-hidden]]:hidden`}>
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
        <button type="button" className={ui.btn} onClick={() => { edited(); setCells(Array.from({ length: w * h }, () => brush)); }}>{L.fillAll}</button>
        <button type="button" className={ui.btn} onClick={() => { edited(); setCells((old) => old.map((v, i) => { const x = i % w, y = Math.floor(i / w); return x === 0 || y === 0 || x === w - 1 || y === h - 1 ? brush : v; })); }}>{L.border}</button>
        <button type="button" className={ui.btn} onClick={reset}>{L.reset}</button>
      </div>
      {(block.generateAction || block.autoLabel) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {block.generateAction && <button type="button" disabled={generating} className={ui.btn} onClick={generate}>{block.generateLabel ?? "Generate"}</button>}
          {block.autoLabel && <button type="button" aria-pressed={auto} className={ui.btn} onClick={() => { setAuto(true); setGenError(null); }}>{block.autoLabel}</button>}
        </div>
      )}
      {genError && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{genError}</p>}
      {auto && block.autoNotice && <p role="status" data-testid="grid-auto-notice" className="rounded-lg border border-accent/60 bg-accent/10 p-3 text-sm">{block.autoNotice}</p>}
      <div ref={gridRef} role="application" aria-label={block.title ?? "grid"} data-auto={auto ? "true" : undefined} className={`touch-none select-none overflow-hidden rounded-lg border border-line ${auto ? "opacity-30 grayscale" : ""}`}
        style={{ width: "100%", maxWidth: w * cell, display: "grid", gridTemplateColumns: `repeat(${w}, minmax(0, 1fr))`, cursor: "crosshair" }}
        onPointerDown={(e) => { painting.current = true; paintAt(e.clientX, e.clientY); try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch { /* le doigt est déjà suivi par le navigateur */ } }}
        onPointerMove={(e) => { if (painting.current) paintAt(e.clientX, e.clientY); }}
        onPointerUp={() => { painting.current = false; }} onPointerCancel={() => { painting.current = false; }}>
        {cells.map((v, i) => <div key={i} style={{ aspectRatio: "1 / 1", background: color(v), boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,.25)" }} />)}
      </div>
      {auto
        ? <input type="hidden" name="auto" value="true" />
        : <><input type="hidden" name="width" value={w} /><input type="hidden" name="height" value={h} /><input type="hidden" name="cells" value={cells.join("")} /></>}
      <div className="flex items-center gap-3">
        <button type="submit" className={ui.btnPrimary}>{block.submitLabel}</button>
        {block.cancelHref && <a href={block.cancelHref} className={ui.btn}>↩</a>}
      </div>
    </ActionForm>
  );
}
