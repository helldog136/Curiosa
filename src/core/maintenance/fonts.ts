import type { JsonSchemaLite } from "@/core/modules/types";
import { McpToolError } from "@/core/services/mcp/validate";
import { loadLibrary } from "@/core/fonts/library";
import { uploadFamilies, uploadWeights } from "@/core/fonts/registry";
import { choiceValue, fontAdvice, parseChoice, SYSTEM_KEYS, type AdviceCode, type AdviceInfo, type Role, type UploadedFont } from "@/core/fonts/types";
import { saveFontChoices } from "@/core/skins/appearance";
import { loadAppearanceView } from "@/core/skins/appearanceView";
import type { Outcome } from "./actions";
import type { Plan } from "./requests";

/**
 * LES POLICES POUR UNE IA (docs/POLICES.md, docs/MAINTENANCE-IA.md) :
 *  - lecture (dans `skin_status`, niveau 1) : le choix des titres et du texte, les conseils, la liste de ce qu'on peut choisir ;
 *  - écriture : `font_set` (niveau 3) = une DEMANDE que la personne propriétaire approuve, comme `skin_activate` (l'apparence du site change tout de suite).
 * Jamais : envoyer un fichier de police (réservé à l'administration humaine : la personne engage sa licence), ni supprimer une police envoyée.
 */
const WHERE = "Admin > Appearance > Fonts.";

export const FONT_SET_ARG: JsonSchemaLite = {
  type: "object",
  properties: {
    titles: { type: "string", maxLength: 60, description: "Font of titles: \"skin\" (the skin's own), or a value listed in maintenance_skin_status > fonts.available (for example lib:lora, sys:serif). Omit to leave it unchanged." },
    text: { type: "string", maxLength: 60, description: "Font of body text: same values as titles. Omit to leave it unchanged." },
  },
};

type Entry = { value: string; name: string; group: string; info: AdviceInfo };

function entries(uploads: readonly UploadedFont[]): Entry[] {
  const out: Entry[] = SYSTEM_KEYS.map((k) => ({ value: `sys:${k}`, name: `system ${k === "sans" ? "sans-serif" : k === "serif" ? "serif" : "monospace"}`, group: "system", info: { group: "system" as const, weights: [400, 700] } }));
  for (const f of loadLibrary().families) out.push({ value: `lib:${f.id}`, name: f.name, group: f.group, info: { group: f.group, weights: f.weights } });
  for (const g of uploadFamilies(uploads)) out.push({ value: `up:${g.slug}`, name: g.family, group: "uploaded by the owner", info: { group: "upload", weights: uploadWeights(g.files) } });
  return out;
}

const describe = (value: string | undefined, role: Role, list: readonly Entry[]) => {
  const c = parseChoice(value);
  const v = choiceValue(c);
  const e = v ? list.find((x) => x.value === v) : undefined;
  return { choice: v === "" || !e ? "skin" : v, name: e?.name ?? "the skin's own", advice: (e ? fontAdvice(role, e.info) : []) as AdviceCode[] };
};

const ADVICE_TEXT: Record<AdviceCode, string> = {
  "no-bold": "No bold version: the browser fakes bold.",
  "title-font-for-text": "Made for short titles; harder to read as long text.",
  "mono-for-text": "Monospace tires the eyes on long text.",
};

/** Niveau 1 : le bloc « polices » de `skin_status`. */
export async function fontStatus(): Promise<unknown> {
  const v = await loadAppearanceView();
  const list = entries(v.fonts.uploads);
  const side = (d: ReturnType<typeof describe>) => ({ choice: d.choice, name: d.name, tips: d.advice.map((c) => ADVICE_TEXT[c]) });
  const byGroup: Record<string, { value: string; name: string }[]> = {};
  for (const e of list) (byGroup[e.group] ??= []).push({ value: e.value, name: e.name });
  return {
    titles: side(describe(v.raw.fontHeading, "heading", list)),
    text: side(describe(v.raw.fontBody ?? (v.raw.font ? `sys:${v.raw.font}` : undefined), "body", list)),
    available: { skin: "skin = the skin's own font (nothing is changed)", ...byGroup },
    howTo: `To change them, call maintenance_font_set (a request the owner approves). Tips are advice only: the chosen font is always applied. Only the owner can upload a font file, in ${WHERE}`,
  };
}

const wanted = (v: unknown, name: string, list: readonly Entry[]): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new McpToolError(`argument "${name}" must be a string`);
  const s = v.trim();
  if (s === "" || s.toLowerCase() === "skin") return "";
  const c = parseChoice(s);
  const value = choiceValue(c);
  if (value === "" || !list.some((e) => e.value === value)) throw new McpToolError(`"${s}" is not a font of this site. Use "skin" or a value from maintenance_skin_status > fonts.available.`);
  return value;
};

/** Niveau 3, préparation (lecture seule) : vérifie les valeurs et fige ce qui sera changé. */
export async function prepareFont(args: { titles?: unknown; text?: unknown }): Promise<Plan> {
  const v = await loadAppearanceView();
  const list = entries(v.fonts.uploads);
  const titles = wanted(args.titles, "titles", list);
  const text = wanted(args.text, "text", list);
  if (titles === undefined && text === undefined) throw new McpToolError('Give at least one of "titles" or "text".');
  const nowTitles = describe(v.raw.fontHeading, "heading", list).choice, nowText = describe(v.raw.fontBody ?? (v.raw.font ? `sys:${v.raw.font}` : undefined), "body", list).choice;
  const same = (titles === undefined || (titles || "skin") === nowTitles) && (text === undefined || (text || "skin") === nowText);
  if (same) throw new McpToolError("These fonts are already in place: nothing to change.");
  const name = (value: string) => (value ? (list.find((e) => e.value === value)?.name ?? value) : "the skin's own");
  return { fonts: { ...(titles !== undefined ? { titles } : {}), ...(text !== undefined ? { text } : {}), names: [titles !== undefined ? `titles: ${name(titles)}` : "", text !== undefined ? `text: ${name(text)}` : ""].filter(Boolean).join(", ") } };
}

/** Niveau 3, exécution (après l'accord de la personne propriétaire) : mêmes écritures que la page Apparence. */
export async function executeFont(plan: Plan, actorLabel: string): Promise<Outcome> {
  const f = plan.fonts;
  if (!f) return { ok: false, message: "Not done: the request is empty." };
  const r = await saveFontChoices({ heading: f.titles, body: f.text }, { actor: actorLabel });
  if (!r.ok) return { ok: false, message: "Not done: one of these fonts no longer exists. Check maintenance_skin_status and ask again." };
  const v = await loadAppearanceView();
  const list = entries(v.fonts.uploads);
  const tips = [describe(v.raw.fontHeading, "heading", list), describe(v.raw.fontBody, "body", list)].flatMap((d, i) => d.advice.map((c) => `${i === 0 ? "titles" : "text"}: ${ADVICE_TEXT[c]}`));
  return { ok: true, message: `Fonts changed (${plan.fonts?.names ?? ""}). The site shows them now; the owner can go back with "Back to the skin" in ${WHERE}${tips.length ? ` Tips (advice only, the fonts are applied): ${tips.join(" ")}` : ""}` };
}
