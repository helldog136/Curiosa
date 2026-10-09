"use client";

import { useEffect, useRef, useState } from "react";
import { CUSTOM_PALETTE, THEME_PRESETS, matchPalette } from "@/core/palettes";
import { ui } from "./ui";

export { THEME_PRESETS };

/**
 * Choix de l'apparence : des thèmes prêts à l'emploi pour tout le monde ; les deux
 * sélecteurs de couleur (fond, accent) n'apparaissent qu'en version avancée.
 */
export function ThemePicker({ background, accent, advanced, names, labels }: {
  background: string; accent: string; advanced: boolean; names: Record<string, string>; labels: { background: string; accent: string };
}) {
  const [bg, setBg] = useState(background);
  const [ac, setAc] = useState(accent);
  const [wantCustom, setWantCustom] = useState(false); // champs révélés (mode simple)
  const [forced, setForced] = useState(false); // « Personnalisé » choisi explicitement avec des couleurs identiques à une palette
  const bgRef = useRef<HTMLInputElement>(null);
  const focusBg = useRef(false);
  const selected = forced ? CUSTOM_PALETTE : matchPalette(bg, ac);
  const custom = selected === CUSTOM_PALETTE;
  const showFields = advanced || custom || wantCustom;
  useEffect(() => {
    if (focusBg.current && bgRef.current) { focusBg.current = false; bgRef.current.focus(); }
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {THEME_PRESETS.map((p) => {
          const on = selected === p.id;
          return (
            <button key={p.id} type="button" onClick={() => { setBg(p.background); setAc(p.accent); setWantCustom(false); setForced(false); }}
              aria-pressed={on}
              className={`flex w-28 flex-col items-center gap-2 rounded-xl border p-2 text-xs ${on ? "border-accent ring-2 ring-accent" : "border-line"}`}>
              <span className="flex h-12 w-full items-end justify-end rounded-lg p-1.5" style={{ background: p.background }}>
                <span className="h-4 w-8 rounded" style={{ background: p.accent }} />
              </span>
              {names[p.id]}
            </button>
          );
        })}
        <button type="button" data-testid="theme-custom" aria-pressed={custom}
          onClick={() => { setWantCustom(true); setForced(true); focusBg.current = true; }}
          className={`flex w-28 flex-col items-center gap-2 rounded-xl border p-2 text-xs ${custom ? "border-accent ring-2 ring-accent" : "border-line"}`}>
          <span className="flex h-12 w-full items-end justify-end rounded-lg border border-line p-1.5" style={{ background: bg }}>
            <span className="h-4 w-8 rounded" style={{ background: ac }} />
          </span>
          {names[CUSTOM_PALETTE]}
        </button>
      </div>
      {showFields ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm"><span className={ui.label}>{labels.background}</span>
            <input name="background" type="color" ref={bgRef} value={bg} onChange={(e) => { setBg(e.target.value); setForced(false); }} className={ui.colorInput} /></label>
          <label className="block text-sm"><span className={ui.label}>{labels.accent}</span>
            <input name="accent" type="color" value={ac} onChange={(e) => { setAc(e.target.value); setForced(false); }} className={ui.colorInput} /></label>
        </div>
      ) : (
        <>
          <input type="hidden" name="background" value={bg} />
          <input type="hidden" name="accent" value={ac} />
        </>
      )}
    </div>
  );
}
