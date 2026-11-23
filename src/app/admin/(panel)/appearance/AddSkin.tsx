"use client";

import { useState, type ComponentProps } from "react";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { PersonalRepo } from "./PersonalRepo";
import { UploadSkin } from "./UploadSkin";

type Way = "file" | "address";
const WAYS: Way[] = ["file", "address"];

/**
 * "Add a skin" for a skin that is not in the catalogue: ONE entry with two ways, a file (.zip) or an address (repository). The choice is two tabs side by side (arrow keys
 * move between them); only the panel of the chosen way is visible, the other keeps what was typed or checked (it is hidden, not removed).
 */
export function AddSkin({ locale, initial }: { locale: "fr" | "en"; /** The state the block starts in (render tests and screenshots): the way, and what each way starts with. */ initial?: { way?: Way; address?: ComponentProps<typeof PersonalRepo>["initial"]; file?: ComponentProps<typeof UploadSkin>["initial"] } }) {
  const al = useAL();
  const [way, setWay] = useState<Way>(initial?.way ?? "file");
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = WAYS[(WAYS.indexOf(way) + 1) % WAYS.length]!;
    setWay(next);
    requestAnimationFrame(() => document.getElementById(`skin-way-${next}`)?.focus());
  };
  return (
    <section className={`${ui.card} space-y-4`} data-testid="add-skin" aria-label={al("appearance.add.title")}>
      <div role="tablist" aria-label={al("appearance.way.label")} className="flex max-w-md flex-wrap gap-1.5 rounded-2xl border border-line bg-bg p-1" onKeyDown={onKey}>
        {WAYS.map((w) => (
          <button key={w} type="button" role="tab" id={`skin-way-${w}`} aria-selected={way === w} aria-controls={`skin-panel-${w}`} tabIndex={way === w ? 0 : -1} data-testid={`skin-way-${w}`}
            onClick={() => setWay(w)}
            className={`min-h-11 min-w-[7rem] flex-1 rounded-xl px-4 py-2 text-center text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${way === w ? "bg-accent text-accent-fg shadow-sm" : "hover:bg-surface"}`}>
            <span className="[overflow-wrap:anywhere]">{al(`appearance.way.${w}`)}</span>
          </button>
        ))}
      </div>
      <div hidden={way !== "file"} data-way="file" role="tabpanel" id="skin-panel-file" aria-labelledby="skin-way-file"><UploadSkin bare initial={initial?.file} /></div>
      <div hidden={way !== "address"} data-way="address" role="tabpanel" id="skin-panel-address" aria-labelledby="skin-way-address"><PersonalRepo locale={locale} initial={initial?.address} /></div>
    </section>
  );
}
