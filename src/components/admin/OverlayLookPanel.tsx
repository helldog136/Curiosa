"use client";

import { useId, useState } from "react";
import { FieldErrorText, useFieldError } from "./FieldErrors";
import { HelpTip } from "./HelpTip";
import { MoreOptions } from "./MoreOptions";
import { ui } from "./ui";
import {
  LOOK_BACKGROUND, LOOK_CORNERS, LOOK_OUTLINE, LOOK_TEXT, OPACITY_MAX, OPACITY_MIN, OPACITY_STEP, OUTLINE_BELOW, presetShown,
  type Applied, type ElementStyle, type LookPreset, type Readability,
} from "@/core/overlays/appearance";

/**
 * "Appearance" tab of an overlay element (core 0.17.0). Short path: the readability preset and the text colour (2 fields). The rest (background, opacity,
 * colour, outline, corners) is folded under "More options" with a one-line summary. A non-blocking pill warns when the text could be hard to read over a
 * bright video, with "Fix" (the "Readable everywhere" preset). All words come from the editor strings (`ed.look.*`).
 */
type S = (k: string, v?: Record<string, string | number>) => string;
const BASE: ElementStyle = { preset: "readable" };

export function OverlayLookPanel({ uid, style, applied, readable, onChange, s, pageLook = null, skins = [], skin, onSkin, wearsSkin = false }: {
  uid: string; style: ElementStyle | null; applied: Applied | null; readable: Readability; onChange: (next: ElementStyle | null) => void; s: S;
  /** (0.21.0) The page's readability default: "Like the page" follows it, and a fine setting starts from it. */
  pageLook?: ElementStyle | null;
  /** (0.21.0) Installed overlay skins, the element's own choice (undefined: the page's; null: none) and how to change it. */
  skins?: { id: string; name: string }[]; skin?: string | null; onSkin?: (next: string | null | undefined) => void;
  /** (0.21.0) The element wears a skin now (its own or the page's): "Take the skin's colours" is offered. */
  wearsSkin?: boolean;
}) {
  const shown = presetShown(style);
  const edit = (patch: Partial<ElementStyle>) => {
    const next: ElementStyle = { ...(style ?? (applied?.source === "page" && pageLook ? pageLook : applied?.source === "auto" && applied.text === "dark" ? { ...BASE, text: "dark" } : BASE)), ...patch };
    for (const k of Object.keys(next) as (keyof ElementStyle)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const setPreset = (p: LookPreset | "page") => onChange(p === "page" ? null : { preset: p });
  const summary = applied ? [
    s(`ed.look.background.${applied.background}`) + (applied.background === "none" ? "" : ` ${applied.opacity} %`),
    applied.outline === "none" ? "" : s(`ed.look.outline.${applied.outline}`),
  ].filter(Boolean).join(" · ") : "";
  return (
    <div className="space-y-4" data-testid="look-panel">
      {!readable.ok && (
        <p role="status" data-testid="look-warning" className="flex flex-wrap items-center gap-2">
          <span className={ui.chipWarn}><span aria-hidden>⚠</span>{s("ed.look.warn")}</span>
          <button type="button" className={`${ui.btn} min-h-11`} onClick={() => setPreset("readable")}>{s("ed.look.fix")}</button>
        </p>
      )}
      <Choice legend={s("ed.look.preset")} help={s("ed.look.presetHelp")} name={`look-preset-${uid}`} value={shown === "custom" ? null : shown}
        options={(["readable", "discreet", "bare", "page"] as const).map((v) => ({ value: v, label: s(`ed.look.preset.${v}`) }))} onChange={(v) => setPreset(v as LookPreset | "page")}
        note={shown === "custom" ? s("ed.look.custom") : applied?.source === "auto" ? s("ed.look.auto") : applied?.source === "page" && pageLook ? s("ed.look.fromPage", { preset: s(`ed.look.preset.${presetShown(pageLook) === "custom" ? "readable" : presetShown(pageLook)}`) }) : undefined} />
      {applied && (
        <Choice legend={s("ed.look.text")} name={`look-text-${uid}`} value={style?.text ?? (!style && applied.text === "dark" ? "dark" : "auto")}
          options={LOOK_TEXT.map((v) => ({ value: v, label: s(`ed.look.text.${v}`) }))} onChange={(v) => edit({ text: v as ElementStyle["text"] })} />
      )}
      {applied && (
        <MoreOptions title={s("ed.look.more")} summary={summary} defaultOpen={shown === "custom" || undefined}>
          <Choice legend={s("ed.look.background")} name={`look-bg-${uid}`} value={applied.background}
            options={LOOK_BACKGROUND.map((v) => ({ value: v, label: s(`ed.look.background.${v}`) }))} onChange={(v) => edit({ background: v as ElementStyle["background"], opacity: undefined })} />
          {applied.background !== "none" && <Opacity uid={uid} value={applied.opacity} s={s} onChange={(n) => edit({ opacity: n })} />}
          {applied.background !== "none" && wearsSkin && !style?.color && (
            <label className="flex min-h-11 items-center gap-2 text-sm" data-testid="look-skin-colours">
              <input type="checkbox" className="h-4 w-4 accent-[var(--v-accent)]" checked={style?.colorFrom === "skin"} onChange={(e) => edit({ colorFrom: e.target.checked ? "skin" : undefined })} />
              {s("ed.look.colorFromSkin")}
            </label>
          )}
          {applied.background !== "none" && style?.colorFrom !== "skin" && <Colour uid={uid} value={applied.color} own={!!style?.color} s={s} onChange={(c) => edit({ color: c })} />}
          <Choice legend={s("ed.look.outline")} help={s("ed.look.outlineHelp", { pct: OUTLINE_BELOW })} name={`look-outline-${uid}`} value={applied.outline}
            options={LOOK_OUTLINE.map((v) => ({ value: v, label: s(`ed.look.outline.${v}`), disabled: v === "none" && applied.opacity < OUTLINE_BELOW }))} onChange={(v) => edit({ outline: v as ElementStyle["outline"] })} />
          <Choice legend={s("ed.look.corners")} name={`look-corners-${uid}`} value={style?.corners ?? "page"}
            options={[{ value: "page", label: s("ed.look.corners.page") }, ...LOOK_CORNERS.map((v) => ({ value: v, label: s(`ed.look.corners.${v}`) }))]} onChange={(v) => edit({ corners: v === "page" ? undefined : (v as ElementStyle["corners"]) })} />
          {onSkin && <SkinSelect uid={uid} skins={skins} value={skin} s={s} onChange={onSkin} />}
        </MoreOptions>
      )}
    </div>
  );
}

const pill = "inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-bg px-3.5 text-sm font-medium transition-colors hover:border-accent peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50";

/** 2 to 4 choices as radio buttons dressed as buttons (R19): arrow keys move between them, labels wrap, never truncated, 44 px targets. */
export function Choice({ legend, help, name, value, options, onChange, note }: {
  legend: string; help?: string; name: string; value: string | null; options: { value: string; label: string; disabled?: boolean }[]; onChange: (v: string) => void; note?: string;
}) {
  return (
    <fieldset className="min-w-0" data-look-field={name}>
      <legend className="mb-1 flex items-center gap-1 text-sm font-medium">{legend}{help && <HelpTip help={help} name={legend} always />}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <span key={o.value} className="relative">
            <input id={`${name}-${o.value}`} type="radio" name={name} className="peer sr-only" checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
            <label htmlFor={`${name}-${o.value}`} className={pill}>{o.label}</label>
          </span>
        ))}
      </div>
      {note && <p className="mt-1.5 text-[13px] text-muted" data-testid="look-note">{note}</p>}
    </fieldset>
  );
}

function Opacity({ uid, value, s, onChange }: { uid: string; value: number; s: S; onChange: (n: number) => void }) {
  const id = useId();
  const server = useFieldError(`elements.${uid}.style.opacity`);
  const [draft, setDraft] = useState(String(value));
  const [bad, setBad] = useState(false);
  const shownDraft = bad ? draft : String(value);
  const type = (raw: string) => {
    setDraft(raw);
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(n) || n < OPACITY_MIN || n > OPACITY_MAX) { setBad(true); return; }
    setBad(false); onChange(n);
  };
  const message = bad ? s("ed.look.opacityErr", { min: OPACITY_MIN, max: OPACITY_MAX }) : server.message;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{s("ed.look.opacity")}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} type="number" inputMode="numeric" min={OPACITY_MIN} max={OPACITY_MAX} step={OPACITY_STEP} value={shownDraft} onChange={(e) => type(e.target.value)}
          aria-invalid={message ? true : undefined} aria-describedby={message ? `${id}-err` : `${id}-b`} className={`${ui.input} ${message ? "border-red-500" : ""}`} style={{ width: "6.5rem" }} />
        <span className="text-sm text-muted" aria-hidden>%</span>
        <span id={`${id}-b`} className="text-sm text-muted">{s("ed.look.opacityBounds", { min: OPACITY_MIN, max: OPACITY_MAX })}</span>
      </div>
      <FieldErrorText id={`${id}-err`} message={message} />
    </div>
  );
}

function Colour({ uid, value, own, s, onChange }: { uid: string; value: string; own: boolean; s: S; onChange: (c: string | undefined) => void }) {
  const id = useId();
  const server = useFieldError(`elements.${uid}.style.color`);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{s("ed.look.color")}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} className="h-11 w-16 cursor-pointer rounded-xl border border-line bg-bg p-1" />
        <span className="font-mono text-sm text-muted">{value}</span>
        {own && <button type="button" className={`${ui.btn} min-h-11`} onClick={() => onChange(undefined)}>{s("ed.look.colorReset")}</button>}
      </div>
      <FieldErrorText id={`${id}-err`} message={server.message} />
    </div>
  );
}

/** (0.21.0) "Skin of this element" (owner decision 3, folded): like the page (default), no skin, or one installed skin. A skin that is no longer installed stays listed while chosen. */
function SkinSelect({ uid, skins, value, s, onChange }: { uid: string; skins: { id: string; name: string }[]; value: string | null | undefined; s: S; onChange: (next: string | null | undefined) => void }) {
  const id = `look-skin-${uid}`;
  const server = useFieldError(`elements.${uid}.skin`);
  const list = typeof value === "string" && !skins.some((k) => k.id === value) ? [...skins, { id: value, name: value }] : skins;
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-1 text-sm font-medium">{s("ed.look.skin")}<HelpTip help={s("ed.look.skinHelp")} name={s("ed.look.skin")} always /></label>
      <select id={id} data-testid="look-skin" value={value === undefined ? "__page" : value === null ? "__none" : value} onChange={(e) => onChange(e.target.value === "__page" ? undefined : e.target.value === "__none" ? null : e.target.value)} className={`${ui.input} ${server.className}`} {...server.props}>
        <option value="__page">{s("ed.look.skin.page")}</option>
        <option value="__none">{s("ed.look.skin.none")}</option>
        {list.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      </select>
      <FieldErrorText id={server.id} message={server.message} />
    </div>
  );
}
