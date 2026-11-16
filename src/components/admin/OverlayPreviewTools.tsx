"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Choice } from "./OverlayLookPanel";
import { HelpTip } from "./HelpTip";
import { MoreOptions } from "./MoreOptions";
import { ui } from "./ui";
import {
  BACKDROP_CSS, CVD_MODES, OWN_BACKDROP_MAX_BYTES, PREVIEW_BACKDROPS, SAFE_MODES, cvdFilterValues, isCvdMode, isPreviewBackdrop, isSafeMode, safeAreas,
  type CvdMode, type PreviewBackdrop, type SafeMode,
} from "@/core/overlays/editorView";
import type { Size } from "@/core/overlays/layout";

/**
 * View tools of the overlay page editor (core 0.20.0): the preview background, the safe margins and the colour-blind view. They change what the EDITOR
 * shows, never the page: nothing is saved with the page, nothing reaches OBS. The person's choices are remembered in this browser only (a convenience:
 * the editor works the same when the browser keeps nothing).
 */
type S = (k: string, v?: Record<string, string | number>) => string;
export type ViewState = { backdrop: PreviewBackdrop; safe: SafeMode; cvd: CvdMode };
const VIEW_KEY = "curiosa.overlayEditor.view";
const ownKey = (pageId: string) => `curiosa.overlayEditor.own.${pageId}`;
const read = (key: string): string | null => { try { return window.localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* private window: not remembered */ } };

/** The view state and the person's own screenshot, remembered per browser (and per page for the screenshot). */
export function usePreviewView(pageId: string) {
  const [view, setView] = useState<ViewState>({ backdrop: "checker", safe: "none", cvd: "none" });
  const [own, setOwn] = useState<string | null>(null);
  const [ownTooBig, setOwnTooBig] = useState(false);
  useEffect(() => {
    // Read after the first render (the server has no browser storage): the editor starts with the checkerboard, then shows what this browser remembers.
    try {
      const v = JSON.parse(read(VIEW_KEY) ?? "{}") as Record<string, unknown>;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView({ backdrop: isPreviewBackdrop(v.backdrop) ? v.backdrop : "checker", safe: isSafeMode(v.safe) ? v.safe : "none", cvd: isCvdMode(v.cvd) ? v.cvd : "none" });
    } catch { /* nothing remembered */ }
    const img = read(ownKey(pageId));
    if (img && img.startsWith("data:image/")) setOwn(img);
  }, [pageId]);
  const change = (patch: Partial<ViewState>) => setView((cur) => { const next = { ...cur, ...patch }; write(VIEW_KEY, JSON.stringify(next)); return next; });
  const chooseOwn = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url.startsWith("data:image/")) return;
      setOwn(url);
      const big = file.size > OWN_BACKDROP_MAX_BYTES;
      setOwnTooBig(big);
      write(ownKey(pageId), big ? null : url);
      change({ backdrop: "own" });
    };
    reader.readAsDataURL(file);
  };
  const style: React.CSSProperties = view.backdrop === "own"
    ? (own ? { backgroundColor: "#000", backgroundImage: `url("${own}")`, backgroundSize: "cover", backgroundPosition: "center" } : BACKDROP_CSS.checker)
    : BACKDROP_CSS[view.backdrop];
  const filter = view.cvd === "none" ? undefined : `url(#ovp-cvd-${view.cvd})`;
  return { view, change, own, ownTooBig, chooseOwn, style, filter };
}
export type PreviewView = ReturnType<typeof usePreviewView>;

/** The colour matrices of the colour-blind view (drawn once, invisible). */
export function CvdFilters() {
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute" focusable="false">
      <defs>
        {CVD_MODES.filter((m): m is Exclude<CvdMode, "none"> => m !== "none").map((m) => (
          <filter key={m} id={`ovp-cvd-${m}`} colorInterpolationFilters="linearRGB"><feColorMatrix type="matrix" values={cvdFilterValues(m)} /></filter>
        ))}
      </defs>
    </svg>
  );
}

/** Dotted safe zones over the preview (never clickable). Percentages of the page, so they follow the zoom. */
export function SafeOverlay({ mode, page }: { mode: SafeMode; page: Size }) {
  const areas = safeAreas(mode, page);
  if (!areas.length) return null;
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" data-testid="safe-overlay" data-safe={mode}>
      {areas.map((a, i) => (
        <span key={i} data-safe-kind={a.kind} className={`absolute ${a.kind === "app" ? "bg-fuchsia-500/15 [background-image:repeating-linear-gradient(45deg,#d946ef33_0_6px,transparent_6px_12px)]" : `border border-dashed ${a.kind === "action" ? "border-sky-400/90" : "border-amber-400/90"}`}`}
          style={{ left: pct(a.x, page.width), top: pct(a.y, page.height), width: pct(a.w, page.width), height: pct(a.h, page.height) }} />
      ))}
    </div>
  );
}

/** The tools row above the preview: the preview background (5 choices: a list, R19), then the guides and colours, folded with a one-line summary. */
export function PreviewToolbar({ v, s }: { v: PreviewView; s: S }) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const pick = (value: string) => {
    if (!isPreviewBackdrop(value)) return;
    if (value === "own" && !v.own) { file.current?.click(); return; }
    v.change({ backdrop: value });
  };
  const summary = [v.view.safe === "none" ? "" : s(`ed.safe.${v.view.safe}`), v.view.cvd === "none" ? "" : s(`ed.cvd.${v.view.cvd}`)].filter(Boolean).join(" · ") || s("ed.safe.none");
  return (
    <div className="flex flex-wrap items-start gap-3" data-testid="preview-tools">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`${id}-bg`} className="flex items-center gap-1 text-sm font-medium">{s("ed.backdrop")}<HelpTip help={s("ed.backdropHelp")} name={s("ed.backdrop")} always /></label>
        <select id={`${id}-bg`} data-testid="preview-backdrop" value={v.view.backdrop} onChange={(e) => pick(e.target.value)} className={`${ui.input} min-h-11 !w-auto`}>
          {PREVIEW_BACKDROPS.map((b) => <option key={b} value={b}>{s(`ed.backdrop.${b}`)}</option>)}
        </select>
        {v.view.backdrop === "own" && (
          <button type="button" className={`${ui.btn} min-h-11`} onClick={() => file.current?.click()}>{s("ed.backdrop.ownChange")}</button>
        )}
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-label={s("ed.backdrop.own")} data-testid="preview-own-file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) v.chooseOwn(f); e.target.value = ""; }} />
        {v.ownTooBig && v.view.backdrop === "own" && <p role="status" className="basis-full text-[13px] text-muted">{s("ed.backdrop.ownTooBig")}</p>}
      </div>
      <MoreOptions title={s("ed.viewTools")} summary={summary} className="min-w-0 flex-1 basis-72">
        <Choice legend={s("ed.safe")} help={s("ed.safeHelp")} name={`${id}-safe`} value={v.view.safe}
          options={SAFE_MODES.map((m) => ({ value: m, label: s(`ed.safe.${m}`) }))} onChange={(m) => v.change({ safe: m as SafeMode })} />
        <Choice legend={s("ed.cvd")} help={s("ed.cvdHelp")} name={`${id}-cvd`} value={v.view.cvd}
          options={CVD_MODES.map((m) => ({ value: m, label: s(`ed.cvd.${m}`) }))} onChange={(m) => v.change({ cvd: m as CvdMode })} />
      </MoreOptions>
    </div>
  );
}
