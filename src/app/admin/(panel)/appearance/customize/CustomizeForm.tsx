"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ActionForm } from "@/components/admin/ActionForm";
import { FieldErrorText, useFieldError } from "@/components/admin/FieldErrors";
import type { FloatingLabels } from "@/components/admin/floating";
import { HelpTip } from "@/components/admin/HelpTip";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { ui } from "@/components/admin/ui";
import { useAL, type AL } from "../AppearanceLabels";
import { previewLinkAction } from "../actions";
import { previewDraftAction, resetCustomizationAction, saveCustomizationAction } from "./actions";
import type { CzControl, CzGroup, CzModel } from "./model";
import { OPTION_PREFIX, fieldName } from "./shared";

export type PreviewPageRef = { label: string; path: string };
type Values = Record<string, unknown>;
type Signal = { control: string; mode: "light" | "dark"; ratio: number; min: number };
type Picture = { upload: string; still?: string; lum?: [number, number] };
const HEX = /^#[0-9a-fA-F]{6}$/;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const isPicture = (v: unknown): v is Picture => !!v && typeof v === "object" && typeof (v as Picture).upload === "string";

/** What a value is called on screen (for the one-line summary of a folded group). */
function valueName(c: CzControl, v: unknown, al: AL): string {
  if (c.type === "color") return c.swatches?.find((s) => s.id === v)?.label ?? String(v);
  if (c.type === "choice") return c.choices?.find((x) => x.id === v)?.label ?? "";
  if (c.type === "toggle") return v ? al("appearance.cz.on") : al("appearance.cz.off");
  if (c.type === "slider") return `${v}${c.unit ?? ""}`;
  if (isPicture(v)) return al("appearance.cz.pictureMine");
  if (v === "none") return al("appearance.cz.pictureNone");
  return c.pictures?.find((p) => p.id === v)?.label ?? "";
}

/** One choice among several, drawn as buttons side by side (2 to 4) or chips. Real radio buttons: arrows and Tab work, a screen reader says "2 of 3". */
function Choices({ name, label, hint, options, value, onChange, segmented, error, invalid, children }: {
  name: string; label: string; hint?: string; options: { id: string; label: string; swatch?: string; thumb?: string }[]; value: string | null; onChange: (id: string) => void; segmented?: boolean;
  error: string | null; invalid: boolean; children?: React.ReactNode;
}) {
  const uid = useId();
  return (
    <fieldset id={`${uid}-g`} tabIndex={-1} aria-invalid={invalid || undefined} aria-describedby={error ? `err-${name}` : undefined} className="min-w-0 space-y-1.5">
      <legend className={`${ui.label} max-w-full`}>{label}<HelpTip help={hint} name={label} always /></legend>
      <div className={segmented ? "flex flex-wrap gap-1.5 rounded-2xl border border-line bg-bg p-1" : "flex flex-wrap gap-2"} role="presentation">
        {options.map((o) => (
          <label key={o.id} className={`relative flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
            segmented ? "min-w-[7rem] flex-1 justify-center rounded-xl px-4 py-2 text-center hover:bg-accent/10 has-[:checked]:bg-accent has-[:checked]:text-accent-fg" : "rounded-xl border border-line bg-surface px-3 py-2 hover:border-accent has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent"}`}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="peer sr-only" />
            {o.swatch && <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border border-line" style={{ background: o.swatch }} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- a skin picture, decorative: the choice has its name beside it */}
            {o.thumb && <img src={o.thumb} alt="" className="h-8 w-12 shrink-0 rounded border border-line object-contain" />}
            <span className="[overflow-wrap:anywhere]">{o.label}</span>
          </label>
        ))}
      </div>
      {children}
      <FieldErrorText id={`err-${name}`} message={error} />
    </fieldset>
  );
}

function Signals({ id, signals, bothModes }: { id: string; signals: Signal[]; bothModes: boolean }) {
  const al = useAL();
  const mine = signals.filter((s) => s.control === id);
  if (!mine.length) return null;
  // one line per distinct risk; the mode is named only when the skin has both and the risk is in one of them
  const modes = new Set(mine.map((s) => s.mode));
  const worst = mine.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const text = bothModes && modes.size === 1
    ? al("appearance.cz.signalMode", { mode: al(`appearance.cz.mode.${worst.mode}`), ratio: String(worst.ratio).replace(".", al("appearance.cz.decimal")), min: String(worst.min).replace(".", al("appearance.cz.decimal")) })
    : al("appearance.cz.signal", { ratio: String(worst.ratio).replace(".", al("appearance.cz.decimal")), min: String(worst.min).replace(".", al("appearance.cz.decimal")) });
  return <p data-testid={`signal-${id}`} className="flex items-start gap-1.5 text-sm font-medium text-amber-700"><span aria-hidden="true">⚠</span><span>{text}</span></p>;
}

function ResetButton({ c, value, onReset }: { c: CzControl; value: unknown; onReset: () => void }) {
  const al = useAL();
  if (same(value, c.default)) return null;
  return <button type="button" onClick={onReset} className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted underline-offset-2 hover:text-accent hover:underline" aria-label={`${al("appearance.cz.resetField")} — ${c.label}`}><span aria-hidden="true">↺</span> {al("appearance.cz.resetField")}</button>;
}

function ColorControl({ c, value, set, signals, bothModes }: { c: CzControl; value: unknown; set: (v: unknown) => void; signals: Signal[]; bothModes: boolean }) {
  const al = useAL();
  const err = useFieldError(fieldName(c.id));
  const free = typeof value === "string" && HEX.test(value);
  const [open, setOpen] = useState(free);
  const [typed, setTyped] = useState<string | null>(null);
  // what the field shows: what is being typed, unless the colour in use is another one (a free colour comes back inside the range the skin allows)
  const text = typed !== null && (!HEX.test(typed) || typed.toLowerCase() === value) ? typed : (free ? (value as string) : (c.swatches?.[0]?.light ?? "#808080"));
  const setText = setTyped;
  const palette = c.swatches ?? [];
  const options = [...palette.map((s) => ({ id: s.id, label: s.label, swatch: s.light })), ...(c.custom ? [{ id: "__custom", label: al("appearance.cz.customColor"), swatch: free ? (value as string) : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }] : [])];
  const current = free || (open && c.custom) ? "__custom" : (typeof value === "string" ? value : null);
  const invalidText = text !== "" && !HEX.test(text);
  return (
    <div className="space-y-2">
      <Choices name={`ui-${c.id}`} label={c.label} hint={c.hint} options={options} value={current} error={err.message} invalid={!!err.message}
        onChange={(id) => { if (id === "__custom") { setOpen(true); if (HEX.test(text)) set(text.toLowerCase()); } else { setOpen(false); set(id); } }}>
        {(open || free) && c.custom && (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <label className="text-sm"><span className="mb-1 block font-medium">{al("appearance.cz.colorPicker")}</span>
              <input type="color" value={HEX.test(text) ? text : "#808080"} onChange={(e) => { setText(e.target.value); set(e.target.value.toLowerCase()); }} className={`${ui.colorInput} !w-16`} />
            </label>
            <label className="text-sm"><span className="mb-1 block font-medium">{al("appearance.cz.colorCode")}</span>
              <input type="text" value={text} maxLength={7} inputMode="text" spellCheck={false} autoComplete="off" aria-invalid={invalidText || undefined} aria-describedby={invalidText ? `${fieldName(c.id)}-bad` : undefined}
                onChange={(e) => { setText(e.target.value); if (HEX.test(e.target.value)) set(e.target.value.toLowerCase()); }} className={`${ui.input} !w-32 font-mono`} />
              {invalidText && <p id={`${fieldName(c.id)}-bad`} data-field-error="" className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-red-700"><span aria-hidden="true">⚠</span><span>{al("appearance.cz.colorError")}</span></p>}
            </label>
          </div>
        )}
      </Choices>
      <Signals id={c.id} signals={signals} bothModes={bothModes} />
    </div>
  );
}

function SliderControl({ c, value, set }: { c: CzControl; value: unknown; set: (v: unknown) => void }) {
  const al = useAL();
  const id = useId();
  const unit = c.unit ?? "";
  const n = typeof value === "number" ? value : (c.default as number);
  const note = al("appearance.cz.sliderRange", { min: c.min ?? 0, max: c.max ?? 0, unit, default: String(c.default) });
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`${ui.label} flex items-center gap-1`}>{c.label}<HelpTip help={c.hint} name={c.label} always /></label>
      <div className="flex items-center gap-3">
        <input id={id} type="range" min={c.min} max={c.max} step={c.step} value={n} onChange={(e) => set(Number(e.target.value))} aria-describedby={`${id}-n`} className="min-h-11 w-full max-w-xs accent-accent" />
        <output className="w-24 shrink-0 text-sm font-medium tabular-nums">{n} {unit}</output>
      </div>
      <p id={`${id}-n`} className={ui.help}>{note}</p>
    </div>
  );
}

function ToggleControl({ c, value, set }: { c: CzControl; value: unknown; set: (v: unknown) => void }) {
  const al = useAL();
  const on = value === true;
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span className="flex items-center gap-1 text-[15px] font-medium">{c.label}<HelpTip help={c.hint} name={c.label} always /></span>
      <button type="button" role="switch" aria-checked={on} aria-label={c.label} onClick={() => set(!on)}
        className={`inline-flex min-h-11 min-w-[6.5rem] items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${on ? "border-accent bg-accent text-accent-fg" : "border-line bg-surface"}`}>
        <span aria-hidden="true">{on ? "●" : "○"}</span>{on ? al("appearance.cz.on") : al("appearance.cz.off")}
      </button>
    </div>
  );
}

type Busy = { id: string } | null;

function ImageControl({ c, value, set, missing, signals, bothModes, setFile, busy, uploadError }: {
  c: CzControl; value: unknown; set: (v: unknown) => void; missing: boolean; signals: Signal[]; bothModes: boolean;
  setFile: (id: string, file: File | null, focal: { x: number; y: number }) => void; busy: boolean; uploadError: string | null;
}) {
  const al = useAL();
  const err = useFieldError(fieldName(c.id));
  const input = useRef<HTMLInputElement>(null);
  const [focal, setFocal] = useState({ x: 50, y: 50 });
  const [hasFile, setHasFile] = useState(false);
  const mine = isPicture(value);
  const none = c.default === "none";
  const options = [
    ...(none ? [{ id: "none", label: al("appearance.cz.pictureNone") }] : []),
    ...(c.pictures ?? []).map((p) => ({ id: p.id, label: p.label, thumb: p.url })),
    ...(c.upload ? [{ id: "__mine", label: al("appearance.cz.pictureMine"), thumb: mine ? `/uploads/${(value as Picture).upload}` : undefined }] : []),
  ];
  const current = mine ? "__mine" : (typeof value === "string" ? value : null);
  const u = c.upload;
  const need = u ? al("appearance.cz.pictureNeed", { formats: u.formats.map((f) => f.toUpperCase()).join(", "), w: u.ratio[0], h: u.ratio[1], min: u.minWidth, max: u.maxWidth, kb: u.maxKb }) : "";
  const message = uploadError ?? err.message;
  return (
    <div className="space-y-2">
      <Choices name={`ui-${c.id}`} label={c.label} hint={c.hint} options={options} value={current} error={message} invalid={!!message}
        onChange={(id) => { if (id === "__mine") { if (!mine) input.current?.click(); } else set(id); }}>
        {u && (current === "__mine" || busy) && (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={`${ui.btn} min-h-11`} onClick={() => input.current?.click()} disabled={busy}>{mine ? al("appearance.cz.pictureReplace") : al("appearance.cz.pictureChoose")}</button>
              {busy && <span role="status" className="text-sm text-muted">{al("appearance.cz.pictureWorking")}</span>}
            </div>
            <p className={ui.help}>{need}</p>
            {u.focal && hasFile && (
              <div className="grid max-w-xs gap-2 sm:grid-cols-2">
                {(["x", "y"] as const).map((axis) => (
                  <label key={axis} className="text-sm"><span className="mb-1 block font-medium">{al(`appearance.cz.focal${axis.toUpperCase()}`)}</span>
                    <input type="range" min={0} max={100} step={5} value={focal[axis]} className="min-h-11 w-full"
                      onChange={(e) => { const next = { ...focal, [axis]: Number(e.target.value) }; setFocal(next); setFile(c.id, null, { x: next.x / 100, y: next.y / 100 }); }} />
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        <input ref={input} type="file" tabIndex={-1} className="sr-only" aria-label={al("appearance.cz.pictureChoose")}
          accept={u?.formats.map((f) => (f === "svg" ? "image/svg+xml" : f === "jpg" ? "image/jpeg" : `image/${f}`)).join(",")}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setHasFile(true); setFile(c.id, f, { x: focal.x / 100, y: focal.y / 100 }); } }} />
      </Choices>
      {missing && <p role="status" className="flex items-start gap-1.5 text-sm font-medium text-amber-700"><span aria-hidden="true">⚠</span><span>{al("appearance.cz.pictureMissing")}</span></p>}
      <Signals id={c.id} signals={signals} bothModes={bothModes} />
    </div>
  );
}

export function CustomizeForm({ model, pages, initialSrc, bothModes, floating, hasPictures, canReset }: {
  model: CzModel; pages: PreviewPageRef[]; initialSrc: string | null; bothModes: boolean; floating: FloatingLabels; hasPictures: boolean; canReset: boolean;
}) {
  const al = useAL();
  const skinId = model.skin.id;
  const [values, setValues] = useState<Values>(model.values);
  const [look, setLook] = useState<string | null>(model.look);
  const [signals, setSignals] = useState<Signal[]>(model.signals);
  const [css, setCss] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [uploadErrors, setUploadErrors] = useState<Record<string, string | null>>({});
  const files = useRef<Record<string, File>>({});
  const touched = useRef(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(initialSrc);
  const [path, setPath] = useState(pages[0]?.path ?? "/");
  const [width, setWidth] = useState<"phone" | "desktop">("desktop");
  const [mode, setMode] = useState<"auto" | "light" | "dark">("auto");
  const [sheet, setSheet] = useState(false);
  const [loaded, setLoaded] = useState(0);

  const setValue = useCallback((id: string, v: unknown) => { touched.current = true; setValues((cur) => ({ ...cur, [id]: v })); }, []);
  const controls = useMemo(() => model.groups.flatMap((g) => g.controls), [model.groups]);
  const featured = controls.filter((c) => c.featured && !c.option);
  const changedIds = controls.filter((c) => !same(values[c.id], c.default)).map((c) => c.id);
  const activeLook = model.looks.find((l) => Object.entries(l.values).every(([k, v]) => same(values[k], v)))?.id ?? null;

  const applyLook = (id: string) => {
    const l = model.looks.find((x) => x.id === id);
    if (!l) return;
    touched.current = true;
    setLook(id);
    setValues((cur) => ({ ...cur, ...l.values }));
  };

  // the state sent to the server: skin options apart from the customization's own values
  const state = useMemo(() => {
    const own: Values = {}, opts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) { if (k.startsWith(OPTION_PREFIX)) opts[k.slice(OPTION_PREFIX.length)] = v; else own[k] = v; }
    return { values: own, look: activeLook ?? look, options: opts };
  }, [values, look, activeLook]);

  // live preview: the draft composed on the server like the public render, laid over the page shown
  useEffect(() => {
    if (!touched.current) return;
    const handle = window.setTimeout(async () => {
      const r = await previewDraftAction(skinId, state).catch(() => null);
      if (!r?.ok) return;
      setCss(r.css);
      setSignals(r.signals);
      // a free colour comes back inside the range the skin allows: the field shows what is really used
      setValues((cur) => { let next = cur; for (const c of controls) { const v = r.values[c.id]; if (c.type === "color" && typeof v === "string" && typeof cur[c.id] === "string" && HEX.test(cur[c.id] as string) && v !== cur[c.id]) next = { ...next, [c.id]: v }; } return next; });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [state, skinId, controls]);

  const loadPreview = useCallback(async (p: string) => {
    const r = await previewLinkAction(skinId, p);
    if (r.ok) setSrc(r.url);
  }, [skinId]);

  const inject = useCallback(() => {
    try {
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      const root = doc.documentElement;
      if (mode === "auto") root.removeAttribute("data-mode"); else root.setAttribute("data-mode", mode);
      if (css === null) return;
      let el = doc.getElementById("cz-draft");
      if (!el) { el = doc.createElement("style"); el.id = "cz-draft"; doc.head.appendChild(el); }
      el.textContent = css;
    } catch { /* a page of another origin: nothing to do */ }
  }, [css, mode]);
  useEffect(() => { inject(); }, [inject, loaded]);

  const upload = useCallback(async (id: string, file: File | null, focal: { x: number; y: number }) => {
    const f = file ?? files.current[id];
    if (!f) return;
    files.current[id] = f;
    setBusy({ id });
    setUploadErrors((e) => ({ ...e, [id]: null }));
    try {
      const fd = new FormData();
      fd.set("skin", skinId); fd.set("slot", id); fd.set("file", f); fd.set("fx", String(focal.x)); fd.set("fy", String(focal.y));
      const res = await fetch("/api/admin/skin-custom/upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; value?: Picture; code?: string; detail?: Record<string, string | number> };
      if (j.ok && j.value) setValue(id, j.value);
      else {
        const ctl = controls.find((c) => c.id === id);
        const detail = { ...(j.detail ?? {}), formats: (ctl?.upload?.formats ?? []).map((x) => x.toUpperCase()).join(", ") };
        const key = `appearance.cz.img.${j.code ?? "failed"}`;
        const text = al(key, detail);
        setUploadErrors((e) => ({ ...e, [id]: text === key ? al("appearance.cz.img.failed") : text }));
      }
    } catch {
      setUploadErrors((e) => ({ ...e, [id]: al("appearance.cz.img.failed") }));
    } finally { setBusy(null); }
  }, [skinId, controls, al, setValue]);

  const draw = (c: CzControl) => {
    const v = values[c.id];
    const common = { c, value: v, set: (x: unknown) => setValue(c.id, x) };
    let body: React.ReactNode = null;
    if (c.type === "color") body = <ColorControl {...common} signals={signals} bothModes={bothModes} />;
    else if (c.type === "slider") body = <SliderControl {...common} />;
    else if (c.type === "toggle") body = <ToggleControl {...common} />;
    else if (c.type === "image") body = <ImageControl {...common} missing={model.missing.includes(c.id) && isPicture(v)} signals={signals} bothModes={bothModes} setFile={upload} busy={busy?.id === c.id} uploadError={uploadErrors[c.id] ?? null} />;
    else body = <ChoiceField {...common} />;
    return (
      <div key={c.id} data-control={c.id} className="space-y-1">
        {body}
        <ResetButton c={c} value={v} onReset={() => setValue(c.id, c.default)} />
      </div>
    );
  };

  const groupSummary = (g: CzGroup): string => g.controls.slice(0, 3).map((c) => valueName(c, values[c.id], al)).filter(Boolean).join(" · ");
  const foldedGroups = model.groups.map((g) => ({ ...g, controls: g.controls.filter((c) => !(c.featured && !c.option)) })).filter((g) => g.controls.length > 0);
  const pictures = controls.filter((c) => isPicture(values[c.id])).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <ActionForm id="customize-form" action={saveCustomizationAction} floating={floating} submitLabel={al("appearance.cz.save")} className="space-y-6">
          <input type="hidden" name="skin" value={skinId} />
          <input type="hidden" name="state" value={JSON.stringify(state)} />
          {model.looks.length > 0 && (
            <Choices name="ui-look" label={al("appearance.cz.looks")} options={model.looks.map((l) => ({ id: l.id, label: l.label }))} value={activeLook} onChange={applyLook} error={null} invalid={false}>
              {!activeLook && look && <p className={ui.help} data-testid="look-adjusted">{al("appearance.cz.lookAdjusted", { name: model.looks.find((l) => l.id === look)?.label ?? "" })}</p>}
            </Choices>
          )}
          {featured.length > 0 && <div className="space-y-5" data-testid="featured">{featured.map(draw)}</div>}
          <div className="space-y-3">
            {foldedGroups.map((g) => (
              <MoreOptions key={g.id} title={g.label} summary={groupSummary(g)}>
                <div className="space-y-5">{g.controls.map(draw)}</div>
              </MoreOptions>
            ))}
          </div>
          {changedIds.length > 0 && <p className={ui.help} data-testid="changed-count">{al("appearance.cz.changed", { count: changedIds.length })}</p>}
        </ActionForm>
        {canReset && (changedIds.length > 0 || hasPictures) && (
          <ActionForm action={resetCustomizationAction} submitLabel={al("appearance.cz.resetAll")} pendingLabel={al("appearance.cz.resetting")} secondary
            confirm={al("appearance.cz.resetConfirm", { count: changedIds.length, pictures })} className="space-y-1">
            <input type="hidden" name="skin" value={skinId} /><input type="hidden" name="what" value="all" />
          </ActionForm>
        )}
      </div>

      <aside className={`${sheet ? "fixed inset-x-0 bottom-0 z-[70] flex h-[80dvh] rounded-t-2xl border border-line bg-surface shadow-2xl" : "hidden"} min-w-0 flex-col lg:static lg:flex lg:h-[calc(100dvh-8rem)] lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:shadow-none lg:sticky lg:top-4`} aria-label={al("appearance.cz.previewTitle", { name: model.skin.name })}>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-3">
          {pages.length > 1 && (
            <label className="text-sm"><span className="mb-1 block font-medium">{al("appearance.preview.page")}</span>
              <select value={path} onChange={(e) => { setPath(e.target.value); void loadPreview(e.target.value); }} className={`${ui.input} min-h-11 !w-auto`}>{pages.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</select>
            </label>
          )}
          <fieldset className="hidden text-sm lg:block"><legend className="mb-1 font-medium">{al("appearance.preview.size")}</legend>
            <div className="inline-flex overflow-hidden rounded-xl border border-line">
              {(["phone", "desktop"] as const).map((w) => <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)} className={`min-h-11 px-4 text-sm ${width === w ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{al(`appearance.preview.${w}`)}</button>)}
            </div>
          </fieldset>
          {bothModes && (
            <fieldset className="text-sm"><legend className="mb-1 font-medium">{al("appearance.preview.mode")}</legend>
              <div className="inline-flex overflow-hidden rounded-xl border border-line">
                {(["auto", "light", "dark"] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`min-h-11 px-4 text-sm ${mode === m ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{al(`appearance.mode.${m}`)}</button>)}
              </div>
            </fieldset>
          )}
          <button type="button" className={`${ui.btn} ml-auto min-h-11 lg:hidden`} onClick={() => setSheet(false)}>{al("appearance.cz.closePreview")}</button>
        </div>
        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-bg/60 p-2">
          {src && <iframe ref={frame} src={src} title={al("appearance.preview.frameTitle", { name: model.skin.name })} data-testid="preview-frame" onLoad={() => setLoaded((n) => n + 1)}
            className={`h-full rounded-xl border border-line bg-white ${width === "phone" ? "w-full lg:w-[390px] lg:max-w-full" : "w-full"}`} />}
        </div>
      </aside>
      {!sheet && <button type="button" onClick={() => setSheet(true)} className={`${ui.btnPrimary} fixed bottom-28 right-4 z-40 min-h-11 shadow-lg lg:hidden`}>{al("appearance.cz.seeResult")}</button>}
    </div>
  );
}

function ChoiceField({ c, value, set }: { c: CzControl; value: unknown; set: (v: unknown) => void }) {
  const err = useFieldError(fieldName(c.id));
  return <Choices name={`ui-${c.id}`} label={c.label} hint={c.hint} options={(c.choices ?? []).map((x) => ({ id: x.id, label: x.label }))} value={typeof value === "string" ? value : null} onChange={set} segmented={c.segmented} error={err.message} invalid={!!err.message} />;
}
