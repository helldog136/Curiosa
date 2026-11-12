"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore, startTransition } from "react";
import { EditDialog } from "./EditDialog";
import { PendingButton } from "./PendingButton";
import { useModalWindow } from "./ModalWindow";
import { FieldErrorText } from "./FieldErrors";
import { ui } from "./ui";
import type { ActionState } from "./ActionForm";

/**
 * Client pieces of the skin tab of an overlay page (core 0.8.0): the scaled sample of a skin, and the dialog that creates or edits ONE rule
 * ("this value wears this skin") with a searchable picker (no typed keys) and a live preview of the skin.
 */
const SAMPLE_W = 640, SAMPLE_H = 360;

/**
 * ANIMATION BUDGET of the previews (core 0.9.0): at most `MAX_PLAYING` previews animate at once, only the ones on screen, none when the person prefers reduced motion,
 * none while the tab is hidden or when the person paused them with the button. Module level, shared by every preview of the page.
 */
const MAX_PLAYING = 6;
const playing = new Set<symbol>();
let paused = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
export const animationsAllowed = () => !paused && !reduced() && (typeof document === "undefined" || !document.hidden);

/** The "Pause the animations / Play the animations" button of a gallery: the choice lasts for the page and is not stored. */
export function AnimationsToggle({ pauseLabel, playLabel }: { pauseLabel: string; playLabel: string }) {
  const [p, setP] = useState(false);
  const rm = useSyncExternalStore(() => () => {}, reduced, () => false);
  if (rm) return null;
  return <button type="button" aria-pressed={p} onClick={() => { paused = !p; setP(!p); emit(); }} className={`${ui.btn} min-h-11`} data-testid="animations-toggle">{p ? playLabel : pauseLabel}</button>;
}

/**
 * The sample scene (640 x 360) scaled to the width it is given. Decorative: the skin name is written next to it. The scene is in a sandbox WITHOUT same-origin: it runs its own
 * scripted scenario only when this component says so (message), while the card is on screen and the budget allows.
 */
export function ScaledFrame({ src, title, className = "", animate = true }: { src: string; title: string; className?: string; animate?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / SAMPLE_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el || !animate) return;
    const me = Symbol("preview");
    let visible = false, loaded = false;
    const send = (on: boolean) => frame.current?.contentWindow?.postMessage({ ov: on ? "play" : "pause" }, "*");
    const sync = () => {
      const want = visible && loaded && animationsAllowed();
      if (want && !playing.has(me) && playing.size < MAX_PLAYING) { playing.add(me); send(true); }
      else if (!want && playing.has(me)) { playing.delete(me); send(false); }
    };
    const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); sync(); }, { threshold: 0.4 });
    io.observe(el);
    const onLoad = () => { loaded = true; sync(); };
    const f = frame.current;
    f?.addEventListener("load", onLoad);
    listeners.add(sync);
    document.addEventListener("visibilitychange", sync);
    return () => { io.disconnect(); f?.removeEventListener("load", onLoad); listeners.delete(sync); document.removeEventListener("visibilitychange", sync); playing.delete(me); };
  }, [animate]);
  return (
    <div ref={box} className={`relative w-full overflow-hidden rounded-lg border border-line bg-black ${className}`} style={{ aspectRatio: `${SAMPLE_W} / ${SAMPLE_H}` }}>
      <iframe ref={frame} src={src} title={title} loading="lazy" sandbox="allow-scripts" tabIndex={-1} className="absolute left-0 top-0 border-0"
        style={{ width: SAMPLE_W, height: SAMPLE_H, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: "none" }} />
    </div>
  );
}

/**
 * Preview of a CATALOGUE skin: the still image first; when the card is on screen and the animation budget allows, the animated image (served by the site, cached like the
 * still one) replaces it, and the still one comes back when the card leaves the screen, when animations are paused, or if the animated image is not available.
 */
export function CatalogueThumb({ still, animated, alt, hasAnimation }: { still: string; animated: string; alt: string; hasAnimation: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [play, setPlay] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || !hasAnimation) return;
    const me = Symbol("thumb");
    let visible = false;
    const sync = () => {
      const want = visible && animationsAllowed();
      if (want && !playing.has(me) && playing.size < MAX_PLAYING) { playing.add(me); setPlay(true); }
      else if (!want && playing.has(me)) { playing.delete(me); setPlay(false); }
    };
    const io = new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); sync(); }, { threshold: 0.5 });
    io.observe(el);
    listeners.add(sync);
    document.addEventListener("visibilitychange", sync);
    return () => { io.disconnect(); listeners.delete(sync); document.removeEventListener("visibilitychange", sync); playing.delete(me); };
  }, [hasAnimation]);
  return (
    <div ref={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={play && !failed ? animated : still} alt={alt} width={640} height={360} loading="lazy" decoding="async" onError={() => { if (play) setFailed(true); }} className="aspect-[16/9] w-full rounded-lg border border-line bg-black object-cover" />
    </div>
  );
}

export type RuleLabels = {
  title: string; close: string; cancel: string; save: string; remove: string; removeConfirm: string; discard: { message: string; discard: string; keep: string };
  valueLabel: string; search: string; picked: string; change: string; none: string; searching: string; skinLabel: string; preview: string; saved: string;
};

type Value = { id: string; name: string };

export function RuleDialog({ pageId, closeHref, skins, current, labels, saveAction, removeAction, searchAction, sampleBase, previousValue }: {
  pageId: string; closeHref: string; skins: { id: string; name: string }[]; current: { value: string; label: string; skin: string } | null; labels: RuleLabels;
  saveAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  removeAction?: () => Promise<void>;
  searchAction: (query: string) => Promise<Value[]>;
  /** Address of the sample page, without the skin id (`…/skin-sample`). */
  sampleBase: string;
  previousValue: string;
}) {
  const [state, action, pending] = useActionState(saveAction, null);
  const [picked, setPicked] = useState<Value | null>(current ? { id: current.value, name: current.label } : null);
  const [skin, setSkin] = useState(current?.skin ?? skins[0]?.id ?? "");
  const formId = `rule-${pageId}`;
  return (
    <EditDialog title={labels.title} closeLabel={labels.close} closeHref={closeHref} guard={labels.discard}
      footer={<Footer formId={formId} labels={labels} pending={pending} state={state} closeHref={closeHref} removeAction={removeAction} />}>
      <form id={formId} className="space-y-5" data-testid="rule-form" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); data.set("value", picked?.id ?? ""); data.set("label", picked?.name ?? ""); startTransition(() => action(data)); }}>
        <input type="hidden" name="previous" value={previousValue} />
        <Picker labels={labels} picked={picked} onPick={setPicked} search={searchAction} error={state?.errors?.value} />
        <div>
          <label htmlFor="rule-skin" className={ui.label}>{labels.skinLabel}</label>
          <select id="rule-skin" name="skin" value={skin} onChange={(e) => setSkin(e.target.value)} className={`${ui.input} min-h-11`} aria-invalid={state?.errors?.skin ? true : undefined}>
            {skins.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <FieldErrorText id="err-skin" message={state?.errors?.skin ?? null} />
        </div>
        {skin && <ScaledFrame src={`${sampleBase}/${encodeURIComponent(skin)}`} title={labels.preview} className="max-w-md" />}
      </form>
    </EditDialog>
  );
}

function Footer({ formId, labels, pending, state, closeHref, removeAction }: { formId: string; labels: RuleLabels; pending: boolean; state: ActionState; closeHref: string; removeAction?: () => Promise<void> }) {
  const win = useModalWindow();
  useEffect(() => { if (state?.ok) { win?.markClean(); win?.close(true); } }, [state, win]);
  const look = "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm text-muted underline-offset-2 hover:text-fg hover:underline";
  return (
    <div className="space-y-2">
      {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        {removeAction && (
          <button type="button" className={`${look} text-red-700 sm:mr-auto`} data-testid="rule-remove"
            onClick={() => { if (window.confirm(labels.removeConfirm)) startTransition(() => { void removeAction(); }); }}>{labels.remove}</button>
        )}
        <a href={closeHref} onClick={(e) => { e.preventDefault(); win?.close(); }} className={look} data-testid="edit-dialog-cancel">{labels.cancel}</a>
        <PendingButton pending={pending} variant="primary" form={formId} testid="edit-dialog-submit">{labels.save}</PendingButton>
      </div>
    </div>
  );
}

/** Searchable list of the values the module has seen. The person picks; nothing is typed as a key. */
function Picker({ labels, picked, onPick, search, error }: { labels: RuleLabels; picked: Value | null; onPick: (v: Value | null) => void; search: (q: string) => Promise<Value[]>; error?: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Value[] | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (picked) return;
    const mine = ++seq.current;
    const timer = setTimeout(() => { void search(q).then((r) => { if (mine === seq.current) setItems(r); }).catch(() => { if (mine === seq.current) setItems([]); }); }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q, picked, search]);
  if (picked) {
    return (
      <div>
        <p className={ui.label}>{labels.valueLabel}</p>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg p-3">
          <span className="min-w-0 flex-1 break-words font-medium" data-testid="rule-picked">{picked.name}</span>
          <button type="button" onClick={() => onPick(null)} className={`${ui.btn} min-h-11`}>{labels.change}</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor="rule-search" className={ui.label}>{labels.valueLabel}</label>
      <input id="rule-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={labels.search} autoComplete="off" className={`${ui.input} min-h-11`} aria-invalid={error ? true : undefined} />
      <ul role="listbox" aria-label={labels.valueLabel} className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line" data-testid="rule-values">
        {items === null && <li className="p-3 text-sm text-muted">{labels.searching}</li>}
        {items !== null && items.length === 0 && <li className="p-3 text-sm text-muted">{labels.none}</li>}
        {(items ?? []).map((v) => (
          <li key={v.id} role="option" aria-selected={false}>
            <button type="button" onClick={() => onPick(v)} className="block min-h-11 w-full break-words px-3 py-2 text-left text-sm hover:bg-accent/10">{v.name}</button>
          </li>
        ))}
      </ul>
      <FieldErrorText id="err-value" message={error ?? null} />
    </div>
  );
}
