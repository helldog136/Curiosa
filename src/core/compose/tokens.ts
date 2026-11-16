/**
 * Automatic values in a text written by the person (core 0.19.0). Stored as `{token}` (what modules fill), SHOWN as `[Label]` in the text field of the editor and
 * as chips under it: people never see braces (R9). Pure, tested alone.
 */
export type ComposeVariable = { token: string; label: string; sample: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `Merci {name}` → `Merci [Pseudo]` (a token the place does not know stays as the person wrote it, without braces). */
export function toDisplay(stored: string, vars: readonly ComposeVariable[]): string {
  return String(stored ?? "").replace(/\{([^{}]*)\}/g, (_, w: string) => { const v = vars.find((x) => x.token === w); return v ? `[${v.label}]` : w; });
}
/** `Merci [Pseudo]` → `Merci {name}`. Braces typed by hand are removed (they would be read as a value); an unknown `[…]` stays plain text. */
export function toStored(display: string, vars: readonly ComposeVariable[]): string {
  let out = String(display ?? "").replace(/[{}]/g, "");
  for (const v of [...vars].sort((a, b) => b.label.length - a.label.length)) out = out.replace(new RegExp(`\\[\\s*${esc(v.label)}\\s*\\]`, "gi"), `{${v.token}}`);
  return out;
}
/** The pieces of a stored text, for the chips: plain text and values. */
export function segments(stored: string, vars: readonly ComposeVariable[]): ({ text: string } | { token: string; label: string })[] {
  const out: ({ text: string } | { token: string; label: string })[] = [];
  let last = 0;
  for (const m of String(stored ?? "").matchAll(/\{([^{}]*)\}/g)) {
    if (m.index! > last) out.push({ text: stored.slice(last, m.index) });
    const v = vars.find((x) => x.token === m[1]);
    out.push(v ? { token: v.token, label: v.label } : { text: m[1]! });
    last = m.index! + m[0].length;
  }
  if (last < stored.length) out.push({ text: stored.slice(last) });
  return out;
}
/** The values used to draw the preview: each sample, or a 25-character name ("Very long name") and 1 000 000 for numbers ("Huge amount"). */
export const LONG_NAME = "etoile_nord_lune_douce_xy";
export function sampleValues(vars: readonly ComposeVariable[], mode: "normal" | "long" | "big"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) {
    const numeric = /^[\d\s.,  ]+$/.test(v.sample);
    out[v.token] = mode === "long" && !numeric ? LONG_NAME : mode === "big" && numeric ? "1 000 000" : v.sample;
  }
  return out;
}
/** The sentence of the place in the preview: its sample, with the samples of the values swapped as `sampleValues` does. */
export function samplePhrase(phrase: string, vars: readonly ComposeVariable[], mode: "normal" | "long" | "big"): string {
  if (mode === "normal") return phrase;
  const values = sampleValues(vars, mode);
  let out = phrase;
  for (const v of vars) if (v.sample && values[v.token] !== v.sample) out = out.split(v.sample).join(values[v.token]!);
  return out;
}
