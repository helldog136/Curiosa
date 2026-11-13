"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  GALLERY_EXTENSIONS, GALLERY_HARD_MAX, GALLERY_KINDS, GALLERY_MARK, GALLERY_MAX_BYTES, galleryAccept, galleryKindOf, galleryMark, galleryMax, galleryMin, readGallery, writeGallery,
  type GalleryChoice, type GalleryKind,
} from "@/core/gallery";
import { ui } from "./ui";
import { FieldLabel } from "./Field";
import { HelpBelow } from "./HelpTip";

/** The texts of the gallery, already translated by the server (`gallery.*` of the locale files; `{n}`, `{name}`… are filled here). */
export type GalleryLabels = Record<string, string>;
const text = (labels: GalleryLabels, key: string, vars: Record<string, string | number> = {}): string => {
  let out = (vars.n === 1 ? labels[`${key}.one`] : undefined) ?? labels[key] ?? key;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
};

type Entry = {
  id: number;
  /** The address once the file is on the site (an item that is still sending has none). */
  src?: string;
  kind: GalleryKind;
  /** What the tile names the item (the file name, or "Image 3"). */
  name: string;
  label: string;
  status: "ready" | "sending" | "error";
  pct: number;
  error?: string;
  /** A failed upload keeps its file so that "Try again" does not ask for it again (a connection problem only). */
  retry?: boolean;
  preview?: string;
};

/** How many files travel at the same time. */
const PARALLEL = 3;
const MB = 1048576;

/** The kind of a picked file as the BROWSER sees it (extension or announced type): only to refuse the obvious early; the server reads the real content. */
function guessKind(file: File): GalleryKind | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  for (const k of GALLERY_KINDS) if (GALLERY_EXTENSIONS[k].includes(ext)) return k;
  if (/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return "image";
  if (/^video\/(mp4|webm)$/.test(file.type)) return "video";
  if (/^audio\//.test(file.type)) return "audio";
  return null;
}
const acceptAttr = (kinds: GalleryKind[]) => kinds.map((k) => (k === "image" ? "image/png,image/jpeg,image/webp,image/gif" : k === "video" ? "video/mp4,video/webm" : "audio/mpeg,audio/ogg,audio/wav,audio/mp4,audio/aac,.mp3,.ogg,.wav,.m4a,.aac")).join(",");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** One upload with progress. Resolves with the address, or what went wrong (`format` and `size` come from the server). */
function send(file: File, kinds: GalleryKind[], onProgress: (pct: number) => void, abort: { current: (() => void) | null }): Promise<{ url: string } | { error: "format" | "size" | "network" }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const body = new FormData();
    body.set("file", file);
    body.set("kind", "gallery");
    body.set("accept", kinds.join(","));
    xhr.open("POST", "/api/admin/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => resolve({ error: "network" });
    xhr.onabort = () => resolve({ error: "network" });
    xhr.onload = () => {
      let json: { url?: string; error?: string } = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* not JSON: a proxy page */ }
      if (xhr.status >= 200 && xhr.status < 300 && json.url) resolve({ url: json.url });
      else resolve({ error: json.error === "size" ? "size" : json.error === "format" ? "format" : "network" });
    };
    abort.current = () => xhr.abort();
    xhr.send(body);
  });
}

/**
 * `kind: "gallery"` of an `adminForm` (core 0.14.0): one control for an ordered list of files. A grid of items (picture, video poster, sound icon and name), an "Add files"
 * tile that opens the picker with several files at once (drag and drop too), a remove button and two move buttons on every item (tap targets of 44 px, keyboard), an optional
 * caption, an optional list of files already on the site, and per-item progress and error. The value posted with the form is the canonical JSON of the items that are on the site
 * (`[{ src, label? }]`); `<name>__gallery` tells the server which rules to check again (kinds, maximum, minimum). While files are still sending, saving waits.
 */
export function GalleryField({ name, label, defaultValue, accept, max, min, itemLabel = false, library, required, help, example, labels }: {
  name: string; label: string; defaultValue?: string; accept?: unknown; max?: unknown; min?: unknown; itemLabel?: boolean; library?: GalleryChoice[]; required?: boolean; help?: string; example?: string; labels: GalleryLabels;
}) {
  const kinds = useMemo(() => galleryAccept(accept), [accept]);
  const limit = galleryMax(max);
  const least = Math.max(galleryMin(min, limit), required ? 1 : 0);
  const uid = useId();
  const nextId = useRef(1);
  const initial = useMemo<Entry[]>(() => {
    const read = readGallery(defaultValue ?? "", { accept: GALLERY_KINDS, max: GALLERY_HARD_MAX });
    if (!read.ok) return [];
    const counts: Record<string, number> = {};
    return read.items.map((item) => {
      const kind = galleryKindOf(item.src)!;
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { id: nextId.current++, src: item.src, kind, name: item.label || text(labels, `gallery.name.${kind}`, { n: counts[kind]! }), label: item.label ?? "", status: "ready" as const, pct: 100 };
    });
    // The initial list is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [note, setNote] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [dragging, setDragging] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const files = useRef(new Map<number, File>());
  const aborts = useRef(new Map<number, { current: (() => void) | null }>());
  const queue = useRef<number[]>([]);
  const running = useRef(0);
  const hidden = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<{ move?: string; remove?: number; add?: boolean } | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const ready = entries.filter((e) => e.status === "ready" && e.src);
  const value = writeGallery(ready.map((e) => ({ src: e.src!, ...(e.label.trim() ? { label: e.label.trim() } : {}) })));
  const counted = entries.filter((e) => e.status !== "error").length;
  const busy = entries.some((e) => e.status === "sending");
  const full = counted >= limit;

  // The form is told that the value changed (the "discard changes?" question, the error under the field that clears on its own).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [value]);

  // Saving waits for the files that are still travelling.
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const guard = (e: Event) => {
      if (!entriesRef.current.some((x) => x.status === "sending")) return;
      e.preventDefault();
      e.stopPropagation();
      setNote(text(labels, "gallery.busy"));
    };
    form.addEventListener("submit", guard, true);
    return () => form.removeEventListener("submit", guard, true);
  }, [labels]);

  // Leaving the page or closing the window cancels what is still sending.
  useEffect(() => () => { for (const a of aborts.current.values()) a.current?.(); }, []);

  // Focus follows what the person just did (a moved item keeps the focus; a removed one hands it to its neighbour).
  useEffect(() => {
    const want = focusAfter.current;
    if (!want) return;
    focusAfter.current = null;
    const list = root.current;
    if (!list) return;
    if (want.move) list.querySelector<HTMLElement>(`[data-gallery-move="${want.move}"]`)?.focus();
    else if (want.remove !== undefined) {
      const rows = entriesRef.current;
      const target = rows[Math.min(want.remove, rows.length - 1)];
      (target ? list.querySelector<HTMLElement>(`[data-gallery-remove="${target.id}"]`) : addButton.current)?.focus();
    } else if (want.add) addButton.current?.focus();
  }, [entries]);

  const patch = useCallback((id: number, change: Partial<Entry>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...change } : e))), []);

  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length) {
      const id = queue.current.shift()!;
      const file = files.current.get(id);
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!file || !entry) continue;
      running.current++;
      const abort = { current: null as (() => void) | null };
      aborts.current.set(id, abort);
      patch(id, { status: "sending", pct: 0, error: undefined, retry: false });
      void send(file, kinds, (pct) => patch(id, { pct }), abort).then((result) => {
        running.current--;
        aborts.current.delete(id);
        if (!entriesRef.current.some((e) => e.id === id)) { pump(); return; }
        if ("url" in result) {
          files.current.delete(id);
          const kind = galleryKindOf(result.url) ?? entry.kind;
          patch(id, { src: result.url, kind, status: "ready", pct: 100, retry: false });
        } else {
          const key = result.error === "format" ? "gallery.error.type" : result.error === "size" ? "gallery.error.size" : "gallery.error.network";
          const k0 = kinds[0]!;
          if (entry.preview) URL.revokeObjectURL(entry.preview);
          patch(id, {
            status: "error", preview: undefined, retry: result.error === "network",
            error: text(labels, key, { name: entry.name, types: kinds.map((k) => text(labels, `gallery.types.${k}`)).join(" / "), example: text(labels, `gallery.example.${k0}`), size: String(Math.round(GALLERY_MAX_BYTES[entry.kind] / MB)) }),
          });
          if (result.error !== "network") files.current.delete(id);
        }
        pump();
      });
    }
  }, [kinds, labels, patch]);

  const addFiles = useCallback((picked: File[]) => {
    if (!picked.length) return;
    const room = Math.max(0, limit - entriesRef.current.filter((e) => e.status !== "error").length);
    const taken = picked.slice(0, room);
    const rest = picked.length - taken.length;
    setNote(rest > 0 ? text(labels, "gallery.error.limit", { n: room, max: limit }) : null);
    if (!taken.length) return;
    const fresh: Entry[] = taken.map((file) => {
      const id = nextId.current++;
      const guess = guessKind(file);
      const kind = guess ?? kinds[0]!;
      const problem = !guess || !kinds.includes(guess) ? "format" : file.size > GALLERY_MAX_BYTES[guess] ? "size" : null;
      const entry: Entry = { id, kind, name: file.name || text(labels, `gallery.name.${kind}`, { n: id }), label: "", status: problem ? "error" : "sending", pct: 0 };
      if (problem) {
        entry.error = text(labels, problem === "format" ? "gallery.error.type" : "gallery.error.size", {
          name: entry.name, types: kinds.map((k) => text(labels, `gallery.types.${k}`)).join(" / "), example: text(labels, `gallery.example.${kinds[0]!}`), size: String(Math.round(GALLERY_MAX_BYTES[guess ?? kind] / MB)),
        });
      } else {
        files.current.set(id, file);
        if (kind === "image" && typeof URL !== "undefined" && URL.createObjectURL) entry.preview = URL.createObjectURL(file);
        queue.current.push(id);
      }
      return entry;
    });
    entriesRef.current = [...entriesRef.current, ...fresh];
    setEntries(entriesRef.current);
    pump();
  }, [kinds, labels, limit, pump]);

  // The picture previews of files being sent are released with the field.
  useEffect(() => () => { for (const e of entriesRef.current) if (e.preview) URL.revokeObjectURL(e.preview); }, []);

  const remove = (entry: Entry, index: number) => {
    aborts.current.get(entry.id)?.current?.();
    files.current.delete(entry.id);
    queue.current = queue.current.filter((x) => x !== entry.id);
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    focusAfter.current = { remove: index };
    setNote(null);
    setLive(text(labels, "gallery.removed", { name: entry.name }));
    setEntries((list) => list.filter((e) => e.id !== entry.id));
  };
  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    const list = entriesRef.current;
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    focusAfter.current = { move: `${item!.id}:${by < 0 ? "earlier" : "later"}` };
    setLive(text(labels, "gallery.moved", { name: item!.name, n: to + 1, total: next.length }));
    setEntries(next);
  };
  const retry = (entry: Entry) => { if (!files.current.has(entry.id)) return; queue.current.push(entry.id); patch(entry.id, { status: "sending", pct: 0, error: undefined }); pump(); };

  const addFromLibrary = (picked: GalleryChoice[]) => {
    const room = Math.max(0, limit - entriesRef.current.filter((e) => e.status !== "error").length);
    const have = new Set(entriesRef.current.map((e) => e.src));
    const take = picked.filter((c) => !have.has(c.value)).slice(0, room);
    setNote(picked.length > take.length && take.length < picked.filter((c) => !have.has(c.value)).length ? text(labels, "gallery.error.limit", { n: room, max: limit }) : null);
    if (!take.length) return;
    const fresh: Entry[] = take.map((c) => ({ id: nextId.current++, src: c.value, kind: c.kind, name: c.label, label: "", status: "ready" as const, pct: 100 }));
    entriesRef.current = [...entriesRef.current, ...fresh];
    setEntries(entriesRef.current);
    setLive(text(labels, "gallery.added", { n: take.length }));
    setLibOpen(false);
    focusAfter.current = { add: true };
  };

  const dropProps = {
    onDragEnter: (e: React.DragEvent) => { if (!full && e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDragging(true); } },
    onDragOver: (e: React.DragEvent) => { if (!full && e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragging(true); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); },
    onDrop: (e: React.DragEvent) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); setDragging(false); if (!full) addFiles(Array.from(e.dataTransfer.files)); },
  };

  const groupId = `g_${name}`;
  const count = text(labels, "gallery.count", { n: counted, max: limit });
  const small = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-base transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

  return (
    <div ref={root} data-gallery="" data-gallery-count={counted} role="group" aria-label={label} className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <FieldLabel id={`${groupId}_add`} className={`${ui.label} !mb-0`} help={help} text={label}>{label}</FieldLabel>
        <span className="shrink-0 text-[13px] text-muted" data-gallery-counter="">{count}</span>
      </div>
      <input ref={hidden} type="hidden" name={name} value={value} data-gallery-value="" />
      <input type="hidden" name={`${name}${GALLERY_MARK}`} value={galleryMark(kinds, limit, least)} />
      <div {...dropProps} className={`relative rounded-2xl border border-dashed p-3 transition-colors ${dragging ? "border-accent bg-accent/10" : "border-line bg-bg/40"}`}>
        <ul role="list" data-gallery-grid="" className="grid list-none grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 p-0">
          {entries.map((entry, index) => {
            const itemName = entry.name;
            const ext = entry.src ? entry.src.split(".").pop()!.toUpperCase() : "";
            return (
              <li key={entry.id} data-gallery-item={entry.id} data-status={entry.status} aria-label={text(labels, "gallery.item", { name: itemName, n: index + 1, total: entries.length })}
                className={`flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface ${entry.status === "error" ? "border-red-500" : "border-line"}`}>
                <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-bg">
                  {entry.kind === "image" && (entry.src || entry.preview) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={entry.src ?? entry.preview} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                  {entry.kind === "video" && entry.src && <video src={`${entry.src}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} className="h-full w-full object-cover" />}
                  {(entry.kind === "audio" || (entry.kind === "video" && !entry.src) || (entry.kind === "image" && !entry.src && !entry.preview)) && (
                    <span aria-hidden="true" className="text-4xl text-muted">{entry.kind === "audio" ? "♪" : entry.kind === "video" ? "▶" : "▢"}</span>
                  )}
                  {entry.kind === "video" && entry.src && <span aria-hidden="true" className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">▶</span>}
                  {entry.src && entry.kind !== "image" && <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">{ext}</span>}
                  {entry.status === "sending" && (
                    <div className="absolute inset-x-0 bottom-0 bg-surface/90 p-2" data-gallery-progress={entry.pct}>
                      <div role="progressbar" aria-label={text(labels, "gallery.sending", { name: itemName })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={entry.pct} className="h-2 overflow-hidden rounded-full bg-line">
                        <div className="h-full bg-accent transition-[width]" style={{ width: `${entry.pct}%` }} />
                      </div>
                      <p className="mt-1 text-center text-xs text-muted">{entry.pct}%</p>
                    </div>
                  )}
                </div>
                <p className="truncate px-2 pt-1.5 text-[13px]" title={itemName}>{itemName}</p>
                {itemLabel && entry.status === "ready" && (
                  <input type="text" value={entry.label} maxLength={120} aria-label={text(labels, "gallery.captionFor", { name: itemName })} placeholder={text(labels, "gallery.caption")}
                    onChange={(e) => patch(entry.id, { label: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    className={`${ui.input} mx-2 mt-1.5 !w-[calc(100%-1rem)] !px-2.5 !py-1.5 !text-[13px]`} />
                )}
                {entry.status === "error" && (
                  <p role="alert" data-gallery-error="" className="px-2 pt-1.5 text-xs font-medium text-red-700 [overflow-wrap:anywhere]"><span aria-hidden="true">⚠ </span>{entry.error}</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-1 p-1.5">
                  {entry.status === "error" ? (
                    <>
                      {entry.retry ? <button type="button" onClick={() => retry(entry)} className={`${ui.btn} min-h-11 !px-3`}>{text(labels, "gallery.retry")}</button> : <span />}
                      <button type="button" data-gallery-remove={entry.id} aria-label={text(labels, "gallery.remove", { name: itemName })} onClick={() => remove(entry, index)} className={small}><span aria-hidden="true">✕</span></button>
                    </>
                  ) : (
                    <>
                      <button type="button" data-gallery-move={`${entry.id}:earlier`} aria-label={text(labels, "gallery.earlier", { name: itemName })} aria-disabled={index === 0 || undefined}
                        onClick={() => move(index, -1)} className={`${small} ${index === 0 ? "opacity-40" : ""}`}><span aria-hidden="true">←</span></button>
                      <button type="button" data-gallery-remove={entry.id} aria-label={text(labels, "gallery.remove", { name: itemName })} onClick={() => remove(entry, index)} className={small}><span aria-hidden="true">✕</span></button>
                      <button type="button" data-gallery-move={`${entry.id}:later`} aria-label={text(labels, "gallery.later", { name: itemName })} aria-disabled={index === entries.length - 1 || undefined}
                        onClick={() => move(index, 1)} className={`${small} ${index === entries.length - 1 ? "opacity-40" : ""}`}><span aria-hidden="true">→</span></button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
          {entries.length === 0 && <li className="col-span-full flex min-h-11 items-center text-sm text-muted" data-gallery-empty="">{text(labels, "gallery.empty")}</li>}
          <li className="min-w-0">
            {full ? (
              <p className="flex aspect-square items-center justify-center rounded-xl border border-line bg-surface p-3 text-center text-sm text-muted" data-gallery-full="">{text(labels, "gallery.full")}</p>
            ) : (
              <button ref={addButton} id={`${groupId}_add`} type="button" data-gallery-focus="" data-gallery-add="" onClick={() => picker.current?.click()}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-accent/60 bg-surface p-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                <span aria-hidden="true" className="text-2xl leading-none">+</span>
                <span>{text(labels, "gallery.add")}</span>
              </button>
            )}
          </li>
        </ul>
        <input ref={picker} type="file" multiple accept={acceptAttr(kinds)} tabIndex={-1} aria-hidden="true" className="hidden" data-gallery-picker=""
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {dragging && <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-accent/10 text-sm font-medium text-accent">{text(labels, "gallery.drop")}</div>}
      </div>
      {library && library.length > 0 && (
        <div className="mt-2">
          <button type="button" aria-expanded={libOpen} aria-controls={`${uid}-lib`} onClick={() => setLibOpen((v) => !v)} className={`${ui.btn} min-h-11`} data-gallery-library-toggle="">{text(labels, "gallery.library")}</button>
          {libOpen && <LibraryPicker id={`${uid}-lib`} items={library} taken={new Set(entries.map((e) => e.src))} room={Math.max(0, limit - counted)} labels={labels} onAdd={addFromLibrary} onClose={() => { setLibOpen(false); focusAfter.current = { add: true }; setEntries((l) => [...l]); }} />}
        </div>
      )}
      {note && <p role="status" data-gallery-note="" className="mt-1.5 text-[13px] leading-5 text-red-700">{note}</p>}
      <span role="status" aria-live="polite" className="sr-only" data-gallery-live="">{live}</span>
      {busy && <span className="sr-only" role="status">{text(labels, "gallery.sending", { name: "" })}</span>}
      <HelpBelow help={help} className={ui.help} />
      {example && <p id={`ex-${name}`} className={ui.help} data-field-example="">{example}</p>}
    </div>
  );
}

/** "Already on the site": a search box and a list to tick (the module gave the names and the addresses). The first 100 matches are shown. */
function LibraryPicker({ id, items, taken, room, labels, onAdd, onClose }: { id: string; items: GalleryChoice[]; taken: Set<string | undefined>; room: number; labels: GalleryLabels; onAdd: (c: GalleryChoice[]) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus({ preventScroll: true }); search.current?.closest("[data-gallery-library]")?.scrollIntoView({ block: "center", behavior: "auto" }); }, []);
  const needle = fold(q.trim());
  const matches = items.filter((c) => !needle || fold(c.label).includes(needle));
  const shown = matches.slice(0, 100);
  const toggle = (value: string) => setPicked((p) => { const n = new Set(p); if (n.has(value)) n.delete(value); else if (n.size < room) n.add(value); return n; });
  return (
    <div id={id} role="group" aria-label={text(labels, "gallery.library")} data-gallery-library="" className="mt-2 rounded-2xl border border-line bg-surface p-3"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
      <input ref={search} type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label={text(labels, "gallery.libSearch")} placeholder={text(labels, "gallery.libSearch")} className={ui.input} />
      {shown.length === 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted" role="status">{text(labels, "gallery.libNone")}<button type="button" onClick={() => setQ("")} className="inline-flex min-h-11 items-center text-accent underline-offset-2 hover:underline">{text(labels, "gallery.libClear")}</button></p>
      ) : (
        <ul role="list" className="mt-2 max-h-64 list-none divide-y divide-line overflow-y-auto p-0">
          {shown.map((c) => {
            const already = taken.has(c.value);
            const on = already || picked.has(c.value);
            return (
              <li key={c.value}>
                <label className={`flex min-h-11 cursor-pointer items-center gap-3 px-1 py-1 ${already ? "opacity-60" : ""}`}>
                  <input type="checkbox" checked={on} disabled={already || (!on && picked.size >= room)} onChange={() => toggle(c.value)} className="h-5 w-5 shrink-0 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={c.label}>{c.label}</span>
                  <span className={ui.chip}>{already ? text(labels, "gallery.libTaken") : text(labels, `gallery.kind.${c.kind}`)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {matches.length > shown.length && <p className="mt-1 text-xs text-muted">{text(labels, "gallery.libMore", { n: shown.length })}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={picked.size === 0} onClick={() => onAdd(items.filter((c) => picked.has(c.value)))} className={`${ui.btnPrimary} min-h-11`} data-gallery-library-add="">{text(labels, "gallery.libAdd")}</button>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center px-3 text-sm text-muted underline-offset-2 hover:text-fg hover:underline">{text(labels, "gallery.libClose")}</button>
      </div>
    </div>
  );
}
