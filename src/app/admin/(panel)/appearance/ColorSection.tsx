"use client";

import { useState } from "react";
import { buildPalette, isHexColor } from "@/core/color";
import { ThemePicker } from "@/components/admin/ThemePicker";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";

type Mode = "light" | "dark";
export type Values = { background: string; accent: string; accent2: string; surface: string; text: string };
type PickerLabels = Parameters<typeof ThemePicker>[0]["labels"];

/** Petite maquette d'un mode : fond, carte, titre, texte secondaire, bouton et lien, avec les couleurs que la personne a choisies (celles du rendu du site). */
function Mock({ v, title }: { v: Values; title: string }) {
  const bg = isHexColor(v.background) ? v.background : "#121214";
  const ac = isHexColor(v.accent) ? v.accent : "#e8a23b";
  const p = buildPalette(bg, ac, { accent2: isHexColor(v.accent2) ? v.accent2 : null, surface: isHexColor(v.surface) ? v.surface : null, text: isHexColor(v.text) ? v.text : null });
  return (
    <figure className="min-w-0 flex-1" data-testid="color-mock">
      <figcaption className="mb-1.5 text-sm font-medium">{title}</figcaption>
      <div aria-hidden="true" className="rounded-xl border border-line p-3" style={{ background: p["--v-bg"], color: p["--v-fg"] }}>
        <div className="rounded-lg p-3" style={{ background: p["--v-surface"], border: `1px solid ${p["--v-line"]}` }}>
          <div className="text-base font-semibold">Aa</div>
          <div className="text-xs" style={{ color: p["--v-muted"] }}>Lorem ipsum dolor sit amet</div>
          <div className="mt-2 flex items-center gap-3">
            <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: p["--v-accent"], color: p["--v-accent-fg"] }}>OK</span>
            <span className="text-xs underline" style={{ color: p["--v-accent"] }}>Lien</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/**
 * « Mes couleurs » : un seul mode (comme toujours) ou clair ET sombre (skin à deux modes). Les avertissements de lisibilité sont en direct, sous le champ, jamais
 * bloquants ; la maquette montre les deux modes côte à côte (l'un sous l'autre sur téléphone) ; le texte dit si les visiteurs auront le bouton Clair / Sombre.
 */
export function ColorSection({ locale, modes, palette: initialPalette, legacy, advanced, single, both, skinColors, names, labels, skinBackgrounds }: {
  locale: "fr" | "en"; modes: Mode[]; palette: "single" | "both"; legacy: boolean; advanced: boolean;
  single: Values; both: Partial<Record<Mode, Values>>; skinColors: Partial<Record<Mode, Values>>; names: Record<string, string>; labels: PickerLabels;
  /** Fond du skin pour chaque mode (pour dire si « un seul mode » rend le site mono-mode). */
  skinBackgrounds: Partial<Record<Mode, string>>;
}) {
  const al = useAL();
  const two = modes.length === 2;
  const [palette, setPalette] = useState<"single" | "both">(two ? initialPalette : "single");
  const [tab, setTab] = useState<Mode>(modes[0] ?? "dark");
  const [sets, setSets] = useState<{ single: Values; light?: Values; dark?: Values }>({ single, light: both.light, dark: both.dark });
  const skinMode = !legacy;
  const singleMode = two ? null : (modes[0] ?? "dark");
  // « Un seul mode » : si le fond choisi n'est plus celui du skin, le site n'a plus qu'un mode et le bouton Clair / Sombre disparaît.
  const bgChanged = two && palette === "single" && [skinBackgrounds.light, skinBackgrounds.dark].every((b) => (b ?? "").toLowerCase() !== sets.single.background.toLowerCase());
  const switchOn = two && !bgChanged;
  return (
    <div className="space-y-4" data-testid="color-section">
      {two && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[15px] font-medium">{al("appearance.palette.legend")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["single", "both"] as const).map((p) => (
              <label key={p} className="block cursor-pointer">
                <input type="radio" name="palette" value={p} checked={palette === p} onChange={() => setPalette(p)} className="peer sr-only" />
                <span className="block min-h-11 rounded-2xl border border-line bg-bg p-4 transition-colors peer-checked:border-accent peer-checked:bg-accent/5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                  <span className="block text-sm font-semibold">{al(`appearance.palette.${p}`)}</span>
                  <span className="block text-[13px] text-muted">{al(`appearance.palette.${p}Help`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!two && <input type="hidden" name="palette" value="single" />}

      {palette === "single" ? (
        <ThemePicker background={sets.single.background} accent={sets.single.accent} accent2={sets.single.accent2} surface={sets.single.surface} text={sets.single.text} advanced={advanced}
          mode={skinMode ? singleMode : undefined} skinValues={skinMode ? skinColors[modes[0] ?? "dark"] : undefined} locale={locale}
          onValues={(v) => setSets((s) => ({ ...s, single: v }))} labels={labels} names={names} />
      ) : (
        <div className="space-y-3">
          <div role="tablist" aria-label={al("appearance.palette.tabs")} className="inline-flex overflow-hidden rounded-xl border border-line">
            {modes.map((m) => (
              <button key={m} type="button" role="tab" id={`tab-${m}`} aria-selected={tab === m} aria-controls={`panel-${m}`} tabIndex={tab === m ? 0 : -1} data-testid={`color-tab-${m}`}
                onClick={() => setTab(m)}
                onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = modes[(modes.indexOf(m) + 1) % modes.length]!; setTab(next); document.getElementById(`tab-${next}`)?.focus(); } }}
                className={`min-h-11 px-5 text-sm ${tab === m ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{al(`appearance.mode.${m}`)}</button>
            ))}
          </div>
          {modes.map((m) => (
            <div key={m} role="tabpanel" id={`panel-${m}`} aria-labelledby={`tab-${m}`} hidden={tab !== m} data-testid={`color-panel-${m}`}>
              <ThemePicker prefix={`${m}_`} mode={m} presetMode={m} locale={locale} skinValues={skinColors[m]} advanced={advanced}
                background={(both[m] ?? skinColors[m])!.background} accent={(both[m] ?? skinColors[m])!.accent} accent2={(both[m] ?? skinColors[m])!.accent2} surface={(both[m] ?? skinColors[m])!.surface} text={(both[m] ?? skinColors[m])!.text}
                onValues={(v) => setSets((s) => ({ ...s, [m]: v }))} labels={labels} names={names} />
            </div>
          ))}
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-medium">{al(two && palette === "both" ? "appearance.mock.both" : "appearance.mock.one")}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {palette === "both" && two
            ? modes.map((m) => <Mock key={m} v={sets[m] ?? both[m]!} title={al(`appearance.mode.${m}`)} />)
            : <Mock v={sets.single} title={two ? al("appearance.mock.yours") : al("appearance.mock.site")} />}
        </div>
      </div>
      {skinMode && (
        <p className={`${ui.help} !mt-0 rounded-xl border border-line bg-bg p-3`} data-testid="switch-note" data-switch={switchOn ? "on" : "off"}>
          {two ? al(switchOn ? "appearance.switch.on" : "appearance.switch.offOneMode") : al("appearance.switch.offSkin")}
        </p>
      )}
    </div>
  );
}
