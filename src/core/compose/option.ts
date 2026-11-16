/**
 * The `compose` option of a gallery field (core 0.19.0), as a module declares it, read by the core: every part checked and bounded, the rest dropped.
 *
 *   compose: {
 *     variables: [{ token: "name", label: "Pseudo", sample: "etoile_nord" }, …],   // 0 to 20 automatic values (chips in the editor)
 *     phrase: { label: "La phrase de la réaction", sample: "Merci etoile_nord" },   // what a "sentence" box shows in the editor
 *     formats: ["media", "16:9", …], defaultFormat: "media", maxBoxes: 4,
 *     testAction: "testReaction",   // optional: "Test on the overlay" runs this action of the module with the form
 *   }
 */
import { FORMATS, LIMITS, type ComposeFormat } from "./model";
import type { ComposeVariable } from "./tokens";

export type ComposeOption = {
  variables: ComposeVariable[];
  phrase: { label: string; sample: string };
  formats: ComposeFormat[];
  defaultFormat?: ComposeFormat;
  maxBoxes: number;
  testAction?: string;
};
const TOKEN = /^[a-z][a-zA-Z0-9_]{0,23}$/;
const ACTION = /^[A-Za-z][A-Za-z0-9_-]{0,60}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

export function composeOption(raw: unknown): ComposeOption | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const variables: ComposeVariable[] = [];
  for (const v of Array.isArray(o.variables) ? o.variables : []) {
    if (!v || typeof v !== "object") continue;
    const { token, label, sample } = v as Record<string, unknown>;
    const t = typeof token === "string" && TOKEN.test(token) ? token : "";
    const l = str(label, 40).replace(/[[\]{}]/g, "");
    if (!t || !l || seen.has(t) || variables.length >= LIMITS.variables) continue;
    seen.add(t);
    variables.push({ token: t, label: l, sample: str(sample, 40) });
  }
  const p = o.phrase && typeof o.phrase === "object" ? (o.phrase as Record<string, unknown>) : {};
  const formats = (Array.isArray(o.formats) ? o.formats : []).filter((f): f is ComposeFormat => (FORMATS as readonly unknown[]).includes(f));
  const list = formats.length ? [...new Set(formats)] : [...FORMATS];
  const n = Number(o.maxBoxes);
  const def = (FORMATS as readonly unknown[]).includes(o.defaultFormat) && list.includes(o.defaultFormat as ComposeFormat) ? (o.defaultFormat as ComposeFormat) : undefined;
  return {
    variables,
    phrase: { label: str(p.label, 60) || "Phrase", sample: str(p.sample, 200) },
    formats: list,
    ...(def ? { defaultFormat: def } : {}),
    maxBoxes: Number.isInteger(n) && n >= 1 ? Math.min(n, LIMITS.boxes) : LIMITS.boxes,
    ...(typeof o.testAction === "string" && ACTION.test(o.testAction) ? { testAction: o.testAction } : {}),
  };
}
