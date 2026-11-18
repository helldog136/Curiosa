/**
 * `valueHint` of an `adminForm` field (pure): a value IS set but is not shown, so the field must never look empty (R33.3).
 * A secret shows dots; a text shows "…" and the last characters the module gave (`valueTail`, 4 at most); the line under it says that leaving it empty keeps the current value
 * and, for a value carried over from another place, where it comes from.
 */
import type { AdminField } from "../blocks";

export type ValueHintView = { placeholder: string; line: string };

const DOTS = "••••••••";

/** The placeholder and the line under the field, or null when the field has no valid hint or the sentences are not available. */
export function valueHintView(f: Pick<AdminField, "kind" | "valueHint" | "valueSource" | "valueTail">, texts: { kept: string; carried: string } | undefined): ValueHintView | null {
  if (!texts || (f.valueHint !== "kept" && f.valueHint !== "carried")) return null;
  const secret = f.kind === "secret";
  const tail = !secret && typeof f.valueTail === "string" ? Array.from(f.valueTail.replace(/[\u0000-\u001f\u007f\s]/g, "")).slice(-4).join("") : "";
  const source = f.valueHint === "carried" && typeof f.valueSource === "string" ? f.valueSource.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const line = [source ? texts.carried.replace("{source}", source) : "", texts.kept].filter(Boolean).join(" · ");
  return { placeholder: secret || !tail ? DOTS : `…${tail}`, line };
}
