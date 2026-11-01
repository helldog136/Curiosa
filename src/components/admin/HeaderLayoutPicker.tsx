import { HEADER_LAYOUTS, type HeaderLayout } from "@/core/header";
import { ui } from "./ui";

/** Petits schémas des quatre dispositions de l'en-tête : un cadre, des barres pour le logo, le menu, les icônes et le bouton. */
const SKETCH: Record<HeaderLayout, React.ReactNode> = {
  classic: <><rect x="6" y="9" width="16" height="8" rx="2" /><rect x="52" y="10" width="10" height="2.5" rx="1" /><rect x="66" y="10" width="10" height="2.5" rx="1" /><rect x="80" y="10" width="10" height="2.5" rx="1" /></>,
  twoRows: <><rect x="6" y="5" width="16" height="7" rx="2" /><circle cx="64" cy="8.5" r="2" /><circle cx="71" cy="8.5" r="2" /><rect x="78" y="5" width="14" height="7" rx="3.5" /><rect x="6" y="19" width="10" height="2.5" rx="1" /><rect x="20" y="19" width="10" height="2.5" rx="1" /><rect x="34" y="19" width="10" height="2.5" rx="1" /></>,
  centered: <><rect x="40" y="4" width="16" height="8" rx="2" /><rect x="26" y="19" width="10" height="2.5" rx="1" /><rect x="40" y="19" width="10" height="2.5" rx="1" /><rect x="54" y="19" width="10" height="2.5" rx="1" /></>,
  minimal: <><rect x="6" y="9" width="16" height="8" rx="2" /><rect x="74" y="8.5" width="16" height="9" rx="4.5" /></>,
};

export function HeaderLayoutPicker({ name, value, labels }: { name: string; value: HeaderLayout; labels: Record<HeaderLayout, { title: string; help: string }> }) {
  return (
    <fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {HEADER_LAYOUTS.map((id) => (
          <label key={id} className="block cursor-pointer">
            <input type="radio" name={name} value={id} defaultChecked={value === id} className="peer sr-only" />
            <span className={`${ui.card} block space-y-2 transition-colors peer-checked:border-accent peer-checked:bg-accent/5 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent`}>
              <svg viewBox="0 0 96 26" className="h-12 w-full rounded-lg border border-line bg-bg fill-current text-muted" aria-hidden="true">{SKETCH[id]}</svg>
              <span className="block text-sm font-semibold">{labels[id].title}</span>
              <span className="block text-xs text-muted">{labels[id].help}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
