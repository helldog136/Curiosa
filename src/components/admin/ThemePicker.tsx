"use client";

import { useState } from "react";
import { ui } from "./ui";

export const THEME_PRESETS = [
  { id: "night", background: "#121214", accent: "#e8a23b" },
  { id: "ocean", background: "#0b1220", accent: "#38bdf8" },
  { id: "forest", background: "#0f1a14", accent: "#4ade80" },
  { id: "rose", background: "#1a0f14", accent: "#f472b6" },
  { id: "violet", background: "#14111f", accent: "#a78bfa" },
  { id: "daylight", background: "#fafafa", accent: "#2563eb" },
  { id: "paper", background: "#f5f0e6", accent: "#c2410c" },
] as const;

/**
 * Choix de l'apparence : des thèmes prêts à l'emploi pour tout le monde ; les deux
 * sélecteurs de couleur (fond, accent) n'apparaissent qu'en version avancée.
 */
export function ThemePicker({ background, accent, advanced, names, labels }: {
  background: string; accent: string; advanced: boolean; names: Record<string, string>; labels: { background: string; accent: string };
}) {
  const [bg, setBg] = useState(background);
  const [ac, setAc] = useState(accent);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {THEME_PRESETS.map((p) => {
          const on = bg.toLowerCase() === p.background && ac.toLowerCase() === p.accent;
          return (
            <button key={p.id} type="button" onClick={() => { setBg(p.background); setAc(p.accent); }}
              aria-pressed={on}
              className={`flex w-28 flex-col items-center gap-2 rounded-xl border p-2 text-xs ${on ? "border-accent ring-2 ring-accent" : "border-line"}`}>
              <span className="flex h-12 w-full items-end justify-end rounded-lg p-1.5" style={{ background: p.background }}>
                <span className="h-4 w-8 rounded" style={{ background: p.accent }} />
              </span>
              {names[p.id]}
            </button>
          );
        })}
      </div>
      {advanced ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm"><span className={ui.label}>{labels.background}</span>
            <input name="background" type="color" value={bg} onChange={(e) => setBg(e.target.value)} className={ui.input} /></label>
          <label className="block text-sm"><span className={ui.label}>{labels.accent}</span>
            <input name="accent" type="color" value={ac} onChange={(e) => setAc(e.target.value)} className={ui.input} /></label>
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
