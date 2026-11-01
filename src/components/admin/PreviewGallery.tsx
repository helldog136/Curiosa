"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ui } from "./ui";

export type GalleryItem = { src: string; width: number; height: number; caption: string; alt: string; /** Ce que la capture montre, en toutes lettres (« Page du site »). */ typeLabel: string };
export type GalleryLabels = { title: string; open: string; close: string; prev: string; next: string; count: string; sample: string };

/** `{n}`, `{total}` et `{caption}` d'un texte déjà traduit, remplacés ici (le texte vient du serveur). */
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/**
 * Galerie des visuels d'une extension : grandes vignettes avec leur légende (jamais une image sans texte), chargement paresseux, et agrandissement au clic dans une boîte
 * native (`<dialog>`) : Échap ferme, ← et → changent d'image, le focus reste dans la boîte et revient sur la vignette à la fermeture. Les images viennent du site lui-même
 * (jamais d'un site tiers). Une image qui ne se charge pas disparaît seule : pas de trou. Aucune animation.
 */
export function PreviewGallery({ items, labels }: { items: GalleryItem[]; labels: GalleryLabels }) {
  const [failed, setFailed] = useState<ReadonlySet<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = items.map((item, index) => ({ item, index })).filter((x) => !failed.has(x.index));

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);

  const step = useCallback((by: number) => {
    setOpen((cur) => {
      if (cur === null || shown.length < 2) return cur;
      const at = shown.findIndex((x) => x.index === cur);
      return shown[(at + by + shown.length) % shown.length]!.index;
    });
  }, [shown]);

  if (shown.length === 0) return null;
  const big = shown.length >= 3 ? 0 : -1;
  const current = open === null ? null : items[open] ?? null;
  const position = open === null ? 0 : shown.findIndex((x) => x.index === open) + 1;

  return (
    <section aria-labelledby="gallery-title" data-testid="preview-gallery" className="space-y-3">
      <h2 id="gallery-title" className="text-lg font-semibold">{labels.title}</h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        {shown.map(({ item, index }, at) => (
          <li key={item.src} className={at === big ? "sm:col-span-2" : ""}>
            <figure className="m-0 space-y-2">
              <button type="button" onClick={() => setOpen(index)} aria-haspopup="dialog" aria-label={fill(labels.open, { caption: item.caption })}
                className="block min-h-11 w-full cursor-zoom-in overflow-hidden rounded-2xl border border-line bg-bg p-0 transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                {/* eslint-disable-next-line @next/next/no-img-element -- image servie par le cœur lui-même, déjà vérifiée et dimensionnée */}
                <img src={item.src} alt={item.alt} width={item.width} height={item.height} loading="lazy" decoding="async" onError={() => setFailed((s) => new Set(s).add(index))} className="block h-auto w-full" />
              </button>
              <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5">
                <span className={ui.chip}>{item.typeLabel}</span>
                <span className="min-w-0">{item.caption}</span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">{labels.sample}</p>

      <dialog ref={dialog} aria-label={current?.caption ?? labels.title} onClose={() => setOpen(null)}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}
        onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); step(1); } else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); } }}
        className="m-auto max-h-[96vh] w-[min(96vw,64rem)] max-w-none overflow-hidden rounded-2xl border border-line bg-surface p-0 text-fg backdrop:bg-black/70">
        {current && (
          <div className="flex max-h-[96vh] flex-col gap-3 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted" aria-live="polite">{fill(labels.count, { n: position, total: shown.length })}</p>
              <button type="button" onClick={() => setOpen(null)} className={`${ui.btn} min-h-11`}><span aria-hidden>✕</span>{labels.close}</button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-bg">
              {/* eslint-disable-next-line @next/next/no-img-element -- idem */}
              <img src={current.src} alt={current.alt} width={current.width} height={current.height} className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full object-contain" />
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm leading-5"><span className={ui.chip}>{current.typeLabel}</span><span className="min-w-0">{current.caption}</span></p>
            {shown.length > 1 && (
              <div className="flex justify-between gap-3">
                <button type="button" onClick={() => step(-1)} className={`${ui.btn} min-h-11 min-w-32`}><span aria-hidden>←</span>{labels.prev}</button>
                <button type="button" onClick={() => step(1)} className={`${ui.btn} min-h-11 min-w-32`}>{labels.next}<span aria-hidden>→</span></button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </section>
  );
}
