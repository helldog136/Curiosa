"use client";

import { useState, type ComponentProps } from "react";
import { Segmented } from "@/components/admin/Segmented";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { PersonalRepo } from "./PersonalRepo";
import { UploadSkin } from "./UploadSkin";

type Way = "file" | "address";

/**
 * "Add a skin" for a skin that is not in the catalogue: ONE entry with two ways, a file (.zip) or an address (repository). The choice is two buttons side by side; only the
 * panel of the chosen way is visible, the other keeps what was typed or checked (it is hidden, not removed).
 */
export function AddSkin({ locale, initial }: { locale: "fr" | "en"; /** The state the block starts in (render tests and screenshots): the way, and what each way starts with. */ initial?: { way?: Way; address?: ComponentProps<typeof PersonalRepo>["initial"]; file?: ComponentProps<typeof UploadSkin>["initial"] } }) {
  const al = useAL();
  const [way, setWay] = useState<Way>(initial?.way ?? "file");
  return (
    <section className={`${ui.card} space-y-4`} data-testid="add-skin" aria-label={al("appearance.add.title")}>
      <div className="max-w-md"><Segmented label={al("appearance.way.label")} name="skinWay" value={way} onChange={(v) => setWay(v === "address" ? "address" : "file")}
        options={[{ value: "file", label: al("appearance.way.file") }, { value: "address", label: al("appearance.way.address") }]} /></div>
      <div hidden={way !== "file"} data-way="file"><UploadSkin bare initial={initial?.file} /></div>
      <div hidden={way !== "address"} data-way="address"><PersonalRepo locale={locale} initial={initial?.address} /></div>
    </section>
  );
}
