"use client";

import { useEffect, useRef, useState } from "react";
import { contrastIssues, isHexColor, buildPalette } from "@/core/color";
import { CUSTOM_PALETTE, THEME_PRESETS, matchPalette } from "@/core/palettes";
import { probableIllegibility, type ProbableField, type ProbableIssue } from "@/core/skins/readability";
import { ui } from "./ui";

export { THEME_PRESETS };

type Labels = {
  background: string; accent: string; accent2: string; surface: string; text: string;
  addSecond: string; removeSecond: string; optionalHint: string; invalid: string;
  /** Avertissements de contraste ; `{ratio}` est remplacé par le rapport mesuré. */
  warnText: string; warnAccent: string; warnAccent2: string;
  /** Skins (page Apparence) : « ↺ Valeur du skin » à côté d'un champ retouché, et « Détails » (replié) sous un avertissement. */
  resetField?: string; details?: string;
};

type Values = { background: string; accent: string; accent2: string; surface: string; text: string };

/** Réglages propres à un skin à deux modes (page Apparence) ; sans eux, le sélecteur est celui d'avant les skins. */
type SkinProps = {
  /** Préfixe des noms de champs (`light_` / `dark_`) pour qu'un formulaire en porte deux jeux ; vide : `background`, `accent`… comme toujours. */
  prefix?: string;
  /** Mode que montre ce jeu (avertissements « dans le mode sombre… ») ; `null` : un seul mode. Absent : avertissements d'avant les skins. */
  mode?: "light" | "dark" | null;
  /** Seules les palettes de ce mode sont proposées. */
  presetMode?: "light" | "dark";
  /** Valeurs du skin : « ↺ Valeur du skin » rend la valeur d'un champ retouché. */
  skinValues?: Values;
  locale?: "fr" | "en";
  /** Appelé à chaque changement (maquette des deux modes). */
  onValues?: (v: Values) => void;
};

/** Miniature d'une palette : fond, carte (surface), barre d'accent et pastille d'accent 2. */
function Swatch({ bg, surface, accent, accent2, bordered }: { bg: string; surface: string; accent: string; accent2: string; bordered?: boolean }) {
  return (
    <span className={`relative block h-14 w-full overflow-hidden rounded-lg ${bordered ? "border border-line" : ""}`} style={{ background: bg }} aria-hidden="true">
      <span className="absolute inset-y-1.5 left-1.5 right-7 rounded" style={{ background: surface }}>
        <span className="ml-1.5 mt-2 block h-1.5 w-8 rounded" style={{ background: accent }} />
        <span className="ml-1.5 mt-1.5 block h-1 w-5 rounded opacity-60" style={{ background: accent }} />
      </span>
      <span className="absolute bottom-1.5 right-1.5 h-4 w-4 rounded-full" style={{ background: accent2 }} />
    </span>
  );
}

/** Couleur facultative : sélecteur + champ #rrggbb ; vide = automatique (le champ montre alors la valeur dérivée). */
function OptionalColor({ label, value, derived, onChange, testid, invalid, hint, action, below }: {
  label: string; value: string; derived: string; onChange: (v: string) => void; testid: string; invalid: string; hint?: string; action?: React.ReactNode; below?: React.ReactNode;
}) {
  const bad = value !== "" && !isHexColor(value);
  return (
    <div className="block text-sm">
      <div className="flex items-baseline justify-between gap-2"><span className={ui.label}>{label}</span>{action}</div>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={isHexColor(value) ? value : derived} onChange={(e) => onChange(e.target.value)} className={`${ui.colorInput} !w-14 shrink-0`} />
        <input type="text" data-testid={testid} value={value} placeholder={derived} maxLength={7} spellCheck={false} autoComplete="off"
          aria-label={label} aria-invalid={bad || undefined}
          onChange={(e) => onChange(e.target.value.trim().toLowerCase())} className={`${ui.input} font-mono`} />
      </div>
      {bad ? <p className={`${ui.help} !text-danger`}>{invalid}</p> : hint ? <p className={ui.help}>{hint}</p> : null}
      {below}
    </div>
  );
}

/** Avertissement « difficile à lire » sous le champ concerné : une phrase simple avec un exemple, les chiffres dans « Détails » (replié). Jamais bloquant. */
function Warnings({ issues, field, locale, details }: { issues: ProbableIssue[]; field: ProbableField; locale: "fr" | "en"; details?: string }) {
  const mine = issues.filter((i) => i.field === field);
  if (!mine.length) return null;
  return (
    <ul role="status" data-testid={`warn-${field}`} className="mt-1.5 space-y-1 rounded-xl border border-warning/60 bg-warning/10 px-3 py-2 text-[13px] leading-5">
      {mine.map((i) => (
        <li key={`${i.pair}-${i.field}`}>
          ⚠ {i.message[locale]}{i.exampleHint ? ` ${i.exampleHint[locale]}` : ""}
          <details className="mt-0.5"><summary className="inline-flex min-h-6 cursor-pointer text-muted">{details ?? "…"}</summary><span className="block text-muted">{i.detail[locale]}</span></details>
        </li>
      ))}
    </ul>
  );
}

/**
 * Choix de l'apparence : des palettes prêtes à l'emploi pour tout le monde (elles fixent les cinq couleurs d'un coup) ;
 * « Personnalisé » ouvre le fond, l'accent et, au choix, une couleur secondaire ; la version avancée ajoute la surface et le texte.
 * Un avertissement de contraste s'affiche en direct (sans jamais bloquer l'enregistrement).
 */
export function ThemePicker({ background, accent, accent2, surface, text, advanced, names, labels, prefix = "", mode, presetMode, skinValues, locale = "fr", onValues }: {
  background: string; accent: string; accent2: string; surface: string; text: string; advanced: boolean; names: Record<string, string>; labels: Labels;
} & SkinProps) {
  const [bg, setBg] = useState(background);
  const [ac, setAc] = useState(accent);
  const [a2, setA2] = useState(accent2);
  const [sf, setSf] = useState(surface);
  const [tx, setTx] = useState(text);
  const [wantCustom, setWantCustom] = useState(false); // champs révélés (mode simple)
  const [forced, setForced] = useState(false); // « Personnalisé » choisi explicitement avec des couleurs identiques à une palette
  const bgRef = useRef<HTMLInputElement>(null);
  const focusBg = useRef(false);
  const selected = forced ? CUSTOM_PALETTE : matchPalette(bg, ac, a2, sf, tx);
  const custom = selected === CUSTOM_PALETTE;
  const showFields = advanced || custom || wantCustom;
  useEffect(() => {
    if (focusBg.current && bgRef.current) { focusBg.current = false; bgRef.current.focus(); }
  });
  const edit = (set: (v: string) => void) => (v: string) => { set(v); setForced(false); };
  const derived = buildPalette(bg, ac);
  const valid = (v: string) => (isHexColor(v) ? v : undefined);
  const skinMode = mode !== undefined;
  // Skins : avertissements « illisibilité probable » (phrase simple + exemple sous le champ) ; sans skin : ceux d'avant, en liste.
  const probable = skinMode ? probableIllegibility({ background: bg, accent: ac, accent2: valid(a2), surface: valid(sf), text: valid(tx) }, mode) : [];
  const issues = skinMode ? [] : contrastIssues(bg, ac, { accent2: valid(a2), surface: valid(sf), text: valid(tx) });
  const warn = { text: labels.warnText, accent: labels.warnAccent, accent2: labels.warnAccent2 };
  const current: Values = { background: bg, accent: ac, accent2: a2, surface: sf, text: tx };
  const onValuesRef = useRef(onValues);
  useEffect(() => { onValuesRef.current = onValues; });
  useEffect(() => { onValuesRef.current?.({ background: bg, accent: ac, accent2: a2, surface: sf, text: tx }); }, [bg, ac, a2, sf, tx]);
  const fixed = (k: keyof Values, set: (v: string) => void) => (skinValues && labels.resetField && (current[k] ?? "").toLowerCase() !== (skinValues[k] ?? "").toLowerCase()
    ? <button type="button" data-testid={`reset-${prefix}${k}`} onClick={() => { set(skinValues[k]); setForced(false); }} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg hover:underline">{labels.resetField}<span className="sr-only"> — {labels[k === "text" ? "text" : k]}</span></button>
    : null);
  const shown = THEME_PRESETS.filter((p) => !presetMode || p.mode === presetMode);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3" data-testid="theme-palettes">
        {shown.map((p) => {
          const on = selected === p.id;
          return (
            <button key={p.id} type="button" data-palette={p.id} aria-pressed={on}
              onClick={() => { setBg(p.background); setAc(p.accent); setA2(p.accent2); setSf(p.surface); setTx(p.text); setWantCustom(false); setForced(false); }}
              className={`flex w-28 flex-col items-center gap-2 rounded-xl border p-2 text-xs ${on ? "border-accent ring-2 ring-accent" : "border-line"}`}>
              <Swatch bg={p.background} surface={p.surface} accent={p.accent} accent2={p.accent2} />
              {names[p.id]}
            </button>
          );
        })}
        <button type="button" data-testid="theme-custom" aria-pressed={custom}
          onClick={() => { setWantCustom(true); setForced(true); focusBg.current = true; }}
          className={`flex w-28 flex-col items-center gap-2 rounded-xl border p-2 text-xs ${custom ? "border-accent ring-2 ring-accent" : "border-line"}`}>
          <Swatch bg={bg} surface={valid(sf) ?? derived["--v-surface"]!} accent={ac} accent2={valid(a2) ?? ac} bordered />
          {names[CUSTOM_PALETTE]}
        </button>
      </div>
      {showFields ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="block text-sm"><label htmlFor={`${prefix}background-color`} className={ui.label}>{labels.background}</label>
              <input id={`${prefix}background-color`} name={`${prefix}background`} type="color" ref={bgRef} value={bg} onChange={(e) => edit(setBg)(e.target.value)} className={ui.colorInput} />
              <Warnings issues={probable} field="background" locale={locale} details={labels.details} />{fixed("background", setBg)}</div>
            <div className="block text-sm"><label htmlFor={`${prefix}accent-color`} className={ui.label}>{labels.accent}</label>
              <input id={`${prefix}accent-color`} name={`${prefix}accent`} type="color" value={ac} onChange={(e) => edit(setAc)(e.target.value)} className={ui.colorInput} />
              <Warnings issues={probable} field="accent" locale={locale} details={labels.details} />{fixed("accent", setAc)}</div>
          </div>
          {a2 === "" ? (
            <button type="button" data-testid="theme-add-second" onClick={() => { setA2(ac); setForced(false); }} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">{labels.addSecond}</button>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <OptionalColor testid="theme-accent2" label={labels.accent2} value={a2} derived={ac} invalid={labels.invalid} onChange={edit(setA2)} below={<><Warnings issues={probable} field="accent2" locale={locale} details={labels.details} />{fixed("accent2", setA2)}</>}
                action={<button type="button" data-testid="theme-remove-second" onClick={() => { setA2(""); setForced(false); }} className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg hover:underline">{labels.removeSecond}</button>} />
            </div>
          )}
          {advanced && (
            <div className="grid gap-4 sm:grid-cols-2">
              <OptionalColor testid="theme-surface" label={labels.surface} value={sf} derived={derived["--v-surface"]!} invalid={labels.invalid} hint={labels.optionalHint} onChange={edit(setSf)} below={<><Warnings issues={probable} field="surface" locale={locale} details={labels.details} />{fixed("surface", setSf)}</>} />
              <OptionalColor testid="theme-text" label={labels.text} value={tx} derived={derived["--v-fg"]!} invalid={labels.invalid} hint={labels.optionalHint} onChange={edit(setTx)} below={<><Warnings issues={probable} field="text" locale={locale} details={labels.details} />{fixed("text", setTx)}</>} />
            </div>
          )}
        </div>
      ) : (
        <>
          <input type="hidden" name={`${prefix}background`} value={bg} />
          <input type="hidden" name={`${prefix}accent`} value={ac} />
        </>
      )}
      <input type="hidden" name={`${prefix}accent2`} value={a2} />
      <input type="hidden" name={`${prefix}surface`} value={sf} />
      <input type="hidden" name={`${prefix}text`} value={tx} />
      {skinMode && !showFields && probable.length > 0 && (
        <ul role="status" data-testid="theme-contrast-warning" className="space-y-1 rounded-xl border border-warning/60 bg-warning/10 px-4 py-3 text-sm">
          {probable.map((i) => <li key={`${i.pair}-${i.field}`}>⚠ {i.message[locale]}{i.exampleHint ? ` ${i.exampleHint[locale]}` : ""}</li>)}
        </ul>
      )}
      {issues.length > 0 && (
        <ul role="status" data-testid="theme-contrast-warning" className="space-y-1 rounded-xl border border-warning/60 bg-warning/10 px-4 py-3 text-sm">
          {issues.map((i) => <li key={i.kind}>⚠ {warn[i.kind].replace("{ratio}", i.ratio.toFixed(1))}</li>)}
        </ul>
      )}
    </div>
  );
}
