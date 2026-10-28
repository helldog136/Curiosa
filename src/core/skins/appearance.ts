/**
 * CHOISIR, RETOUCHER, REVENIR AU SKIN, ANNULER (lot S7, docs/SKINS.md §3.3, §3.7, §10) : tout ce que la page Apparence ÉCRIT dans les réglages.
 *
 * Aucun accès à Next : les actions du serveur (`src/app/admin/(panel)/appearance/actions.ts`) et l'assistant (maintenance MCP) appellent ces fonctions, qui
 * rendent `{ ok: true, … }` ou `{ ok: false, error: "skins.error.…" }` (clés de traduction), jamais d'exception pour un cas prévu.
 *
 * Réglages touchés : `skin.active`, `skin.options`, `skin.snapshot` et les RETOUCHES (`theme.*` sauf `theme.admin`, `header.layout`). Le contenu du site
 * (pages, entrées, accueil, réglages des modules) ne référence jamais un skin et n'est jamais touché : changer de skin ne fait rien perdre (§0).
 *
 * Règles (décisions du propriétaire) :
 *  - choisir un skin copie d'abord les retouches dans `skin.snapshot` puis les supprime : le skin donne les valeurs de départ, « Annuler » remet tout ;
 *  - « Revenir au skin » fait pareil sans changer de skin ;
 *  - enregistrer des retouches ne garde QUE ce qui diffère du skin (sinon tout deviendrait « retouché » et « Revenir au skin » ne voudrait plus rien dire) ;
 *    sur basic (un site sans skin) les écritures sont EXACTEMENT celles d'avant les skins ;
 *  - une retouche illisible est enregistrée quand même (avertissement seulement) : c'est le rendu qui la corrige (§7.3).
 */
import { prisma } from "../db";
import { audit } from "../permissions";
import { deleteSetting, setSetting } from "../settings";
import { isHexColor } from "../color";
import { isBackgroundImage, isPreset, parseBackground } from "../background";
import { isGlowLevel, normalizeTuning } from "../glow";
import { isHeaderLayout } from "../header";
import { sanitizeSvg } from "../svg";
import { SKIN_ID_RE } from "./allowlist";
import { BASIC_ID, SETTING_ACTIVE, SETTING_OPTIONS } from "./constants";
import { invalidateSkinCache } from "./invalidate";
import { COLOR_FIELDS, RETOUCH_KEYS, type ColorField } from "./retouch";
import { readActiveSetting, readRows } from "./registry";
import { loadInstalledSkin } from "./service";
import type { SkinIssue } from "./messages";

export const SETTING_SNAPSHOT = "skin.snapshot";

/** Toutes les clés de réglage qui sont des RETOUCHES de la personne (couleurs des deux modes, police, halo, fond, en-tête). `theme.admin` n'en fait pas partie. */
export const RETOUCH_SETTINGS: readonly string[] = [
  ...RETOUCH_KEYS,
  "theme.glow", "theme.glow.custom", "theme.bgPreset", "theme.bgCustom", "theme.bgImage", "theme.bgSvg", "theme.bgSvgFit", "theme.bgSvgAlign", "theme.bgSvgTile",
  "header.layout",
];

export type SkinSnapshot = {
  v: 1;
  at: string;
  /** `choose` : un autre skin a été choisi ; `reset` : « Revenir au skin ». */
  kind: "choose" | "reset";
  fromSkin: string;
  fromOptions: Record<string, string> | null;
  values: Record<string, unknown>;
};

export type Failure = { ok: false; error: string; issues?: SkinIssue[] };
const fail = (error: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, error, ...extra });

/** Lecture directe en base (jamais le cache de requête : juste après une écriture, la valeur lue doit être la nouvelle). */
async function readKeys(keys: readonly string[]): Promise<Map<string, unknown>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [...keys] }, locale: "" } });
  const out = new Map<string, unknown>();
  for (const r of rows) { try { out.set(r.key, JSON.parse(r.value)); } catch { /* valeur illisible : comme absente */ } }
  return out;
}

export async function readSnapshot(): Promise<SkinSnapshot | null> {
  const v = (await readKeys([SETTING_SNAPSHOT])).get(SETTING_SNAPSHOT);
  if (!v || typeof v !== "object") return null;
  const s = v as Partial<SkinSnapshot>;
  if (s.v !== 1 || (s.kind !== "choose" && s.kind !== "reset") || typeof s.fromSkin !== "string" || !s.values || typeof s.values !== "object" || Array.isArray(s.values)) return null;
  const values: Record<string, unknown> = {};
  for (const k of RETOUCH_SETTINGS) if (k in s.values) values[k] = (s.values as Record<string, unknown>)[k];
  const opts = s.fromOptions && typeof s.fromOptions === "object" && !Array.isArray(s.fromOptions) ? s.fromOptions : null;
  return { v: 1, at: typeof s.at === "string" ? s.at : "", kind: s.kind, fromSkin: s.fromSkin, fromOptions: opts, values };
}

export async function dropSnapshot(): Promise<void> {
  await deleteSetting(SETTING_SNAPSHOT);
}

async function clearRetouches(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: { in: [...RETOUCH_SETTINGS] }, locale: "" } });
}

async function takeSnapshot(kind: SkinSnapshot["kind"]): Promise<{ snapshot: SkinSnapshot; hadRetouches: boolean }> {
  const current = await readKeys([...RETOUCH_SETTINGS, SETTING_OPTIONS]);
  const values: Record<string, unknown> = {};
  for (const k of RETOUCH_SETTINGS) if (current.has(k)) values[k] = current.get(k);
  const opt = current.get(SETTING_OPTIONS);
  const snapshot: SkinSnapshot = {
    v: 1, at: new Date().toISOString(), kind, fromSkin: await readActiveSetting(), fromOptions: opt && typeof opt === "object" && !Array.isArray(opt) ? (opt as Record<string, string>) : null, values,
  };
  return { snapshot, hadRetouches: Object.keys(values).length > 0 };
}

/** Un skin peut-il être appliqué ? `basic` toujours ; un autre doit être installé et passer encore le contrôle (fichiers présents et intacts). */
export async function usableSkin(id: string): Promise<true | Failure> {
  if (id === BASIC_ID) return true;
  if (!SKIN_ID_RE.test(id) || !(await readRows()).some((r) => r.id === id)) return fail("skins.error.notfound");
  const loaded = await loadInstalledSkin(id);
  return loaded.ok ? true : fail("skins.error.invalid", { issues: loaded.issues });
}

export type ChooseResult = { ok: true; changed: boolean; /** Des retouches ont été mises de côté (« Annuler » les remet). */ keptSnapshot: boolean } | Failure;

/** Choisir un skin (§3.3) : snapshot des retouches, `skin.active`, retouches et options supprimées. Le même skin deux fois : rien ne change. */
export async function chooseSkin(id: string, opts: { actor?: string } = {}): Promise<ChooseResult> {
  const usable = await usableSkin(id);
  if (usable !== true) return usable;
  if ((await readActiveSetting()) === id) return { ok: true, changed: false, keptSnapshot: (await readSnapshot()) !== null };
  const { snapshot } = await takeSnapshot("choose");
  await setSetting(SETTING_SNAPSHOT, snapshot);
  await setSetting(SETTING_ACTIVE, id);
  await deleteSetting(SETTING_OPTIONS);
  await clearRetouches();
  invalidateSkinCache();
  await audit(opts.actor ?? "system", "skin.activate", id);
  return { ok: true, changed: true, keptSnapshot: true };
}

/** « Revenir au skin » : supprime toutes les retouches (avec snapshot : « Annuler » les remet). */
export async function resetToSkin(opts: { actor?: string } = {}): Promise<{ ok: true; changed: boolean }> {
  const { snapshot, hadRetouches } = await takeSnapshot("reset");
  if (!hadRetouches) return { ok: true, changed: false };
  await setSetting(SETTING_SNAPSHOT, snapshot);
  await clearRetouches();
  invalidateSkinCache();
  await audit(opts.actor ?? "system", "skin.reset", snapshot.fromSkin);
  return { ok: true, changed: true };
}

/** « Annuler » : remet le skin et les retouches d'avant le dernier changement. Un skin qui n'est plus installé est remplacé par basic ; les retouches reviennent quand même. */
export async function undoLastChange(opts: { actor?: string } = {}): Promise<{ ok: true; skin: string } | Failure> {
  const snap = await readSnapshot();
  if (!snap) return fail("skins.error.nosnapshot");
  const back = (await usableSkin(snap.fromSkin)) === true ? snap.fromSkin : BASIC_ID;
  await clearRetouches();
  for (const [k, v] of Object.entries(snap.values)) await setSetting(k, v);
  await setSetting(SETTING_ACTIVE, back);
  if (back === snap.fromSkin && snap.fromOptions) await setSetting(SETTING_OPTIONS, snap.fromOptions);
  else await deleteSetting(SETTING_OPTIONS);
  await deleteSetting(SETTING_SNAPSHOT);
  invalidateSkinCache();
  await audit(opts.actor ?? "system", "skin.undo", back);
  return { ok: true, skin: back };
}

/** Options du skin actif (§3.4) : seulement des valeurs déclarées par le skin ; une valeur égale au défaut n'est pas enregistrée. */
export async function saveSkinOptions(declared: readonly { id: string; default: string; values: readonly { id: string }[] }[], chosen: Record<string, unknown>, opts: { actor?: string } = {}): Promise<{ ok: true; changed: boolean }> {
  const out: Record<string, string> = {};
  for (const o of declared) {
    const v = chosen[o.id];
    if (typeof v === "string" && v !== o.default && o.values.some((x) => x.id === v)) out[o.id] = v;
  }
  const before = (await readKeys([SETTING_OPTIONS])).get(SETTING_OPTIONS);
  const same = JSON.stringify(before ?? {}) === JSON.stringify(out);
  if (Object.keys(out).length) await setSetting(SETTING_OPTIONS, out); else await deleteSetting(SETTING_OPTIONS);
  if (!same) { invalidateSkinCache(); await dropSnapshot(); await audit(opts.actor ?? "system", "skin.options", Object.keys(out).join(",")); }
  return { ok: true, changed: !same };
}

// ---------------------------------------------------------------------------------------------------------------------
// Retouches : l'écran « Mes retouches »

export type ColorSetInput = Partial<Record<ColorField, string>>;
const MODES = ["light", "dark"] as const;

export type RetouchInput = {
  /** L'écran en mode avancé (les réglages techniques sont envoyés) ; sinon on n'y touche pas. */
  advanced: boolean;
  palette: "single" | "both";
  single: ColorSetInput;
  light: ColorSetInput;
  dark: ColorSetInput;
  font: string | null;
  glow: string;
  glowTuning: Record<string, unknown> | null;
  bgPreset: string;
  bgImage: string;
  bgCustom: string | null;
  bgSvg: { markup: string; fit: string; align: string; tile: number } | null;
  headerLayout: string;
};

export type SkinColors = Record<"light" | "dark", Record<ColorField, string>>;
export type SkinBase = {
  id: string;
  /** Valeurs du skin SANS retouches, par mode (hexadécimal ; `accent2` vide = pas de second accent). Absent pour basic. */
  colors: Partial<SkinColors>;
  modes: readonly ("light" | "dark")[];
  defaults: { headerLayout?: string };
};

/** Lit le formulaire de l'écran (champs `background`… pour « un seul mode », `light_background`… `dark_text` pour « clair et sombre »). Rend `null` si une couleur est invalide. */
export function parseRetouchForm(f: { has(n: string): boolean; get(n: string): unknown }): RetouchInput | null {
  const str = (n: string) => String(f.get(n) ?? "").trim();
  const sets: Record<"single" | "light" | "dark", ColorSetInput> = { single: {}, light: {}, dark: {} };
  for (const [set, prefix] of [["single", ""], ["light", "light_"], ["dark", "dark_"]] as const) {
    for (const c of COLOR_FIELDS) {
      if (!f.has(`${prefix}${c}`)) continue;
      const raw = str(`${prefix}${c}`);
      // le fond et l'accent gardent leur casse d'origine (comme avant les skins), les autres sont en minuscules
      const v = c === "background" || c === "accent" ? raw : raw.toLowerCase();
      if (v && !isHexColor(v)) return null;
      sets[set][c] = v;
    }
  }
  const adv = f.get("__adv") === "1";
  const raw: Record<string, unknown> = Object.fromEntries(["count", "size", "variance", "hue", "intensity", "seed"].map((k) => [k, f.get(`glow_${k}`)]));
  raw.color = f.get("glow_followAccent") === "on" ? "" : str("glow_color");
  const fit = ["contain", "tile"].includes(str("bgSvgFit")) ? str("bgSvgFit") : "cover";
  const align = ["left", "right"].includes(str("bgSvgAlign")) ? str("bgSvgAlign") : "center";
  return {
    advanced: adv,
    palette: f.get("palette") === "both" ? "both" : "single",
    single: sets.single, light: sets.light, dark: sets.dark,
    font: f.has("font") ? str("font") : null,
    glow: str("glow") || "none",
    glowTuning: adv ? raw : null,
    bgPreset: str("bgPreset") || "none",
    bgImage: str("bgImage"),
    bgCustom: adv ? str("bgCustom") : null,
    bgSvg: adv ? { markup: str("bgSvg"), fit, align, tile: Math.min(1200, Math.max(20, Math.round(Number(f.get("bgSvgTile")) || 200))) } : null,
    headerLayout: str("headerLayout") || "classic",
  };
}

/** Contrôles qui refusent d'enregistrer (adresse d'image, fond personnalisé, dessin SVG invalides) : de quoi dire quoi, et RIEN d'écrit. */
export type RetouchRefusal = { kind: "image" } | { kind: "bgCustom" | "bgSvg"; detail: string };
export function checkRetouchInput(i: RetouchInput): RetouchRefusal | null {
  if (i.bgImage && !isBackgroundImage(i.bgImage)) return { kind: "image" };
  if (i.bgCustom) {
    const parsed = parseBackground(i.bgCustom);
    if (!parsed.ok) return { kind: "bgCustom", detail: parsed.error };
  }
  if (i.bgSvg?.markup) {
    const checked = sanitizeSvg(i.bgSvg.markup, undefined, i.bgSvg.fit as "cover" | "contain" | "tile", i.bgSvg.align as "left" | "center" | "right");
    if (!checked.ok) return { kind: "bgSvg", detail: checked.error };
  }
  return null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Enregistre les retouches. `base` : le skin actif (valeurs sans retouches) ; basic = le comportement d'avant les skins, écriture pour écriture.
 * Rend le nombre de réglages qui ont VRAIMENT changé (0 : rien n'a été touché, le « Annuler » du dernier changement reste possible).
 */
export async function saveRetouches(input: RetouchInput, base: SkinBase, opts: { actor?: string } = {}): Promise<{ ok: true; changed: number } | Failure> {
  const keys = [...RETOUCH_SETTINGS];
  const before = await readKeys(keys);
  const target = new Map<string, unknown>(); // valeur voulue (undefined = supprimer)
  const want = (k: string, v: unknown) => { target.set(k, v); };
  const legacy = base.id === BASIC_ID;

  // ── couleurs
  const colorKey = (set: "single" | "light" | "dark", c: ColorField) => (set === "single" ? `theme.${c}` : `theme.${set}.${c}`);
  const writeColors = (set: "single" | "light" | "dark", fields: ColorSetInput, skinValue?: Record<ColorField, string>) => {
    for (const c of COLOR_FIELDS) {
      const v = fields[c];
      if (v === undefined) continue; // champ absent du formulaire : on n'y touche pas
      const key = colorKey(set, c);
      if (legacy && set === "single") continue; // géré plus bas, comme avant les skins
      const same = skinValue && (skinValue[c] ?? "").toLowerCase() === v.toLowerCase();
      want(key, v === "" || same ? undefined : (c === "background" || c === "accent" ? v : v.toLowerCase()));
    }
  };
  if (legacy) {
    // EXACTEMENT l'ancien enregistrement : fond et accent obligatoires, les trois autres selon le formulaire (vide = retour au dérivé).
    const bg = input.single.background ?? "", ac = input.single.accent ?? "";
    if (!isHexColor(bg) || !isHexColor(ac)) return fail("error.generic");
    want("theme.background", bg);
    want("theme.accent", ac);
    for (const c of ["accent2", "surface", "text"] as const) if (input.single[c] !== undefined) want(`theme.${c}`, input.single[c] === "" ? undefined : input.single[c]);
  } else if (input.palette === "both" && base.modes.length === 2) {
    want("theme.palette", "both");
    for (const m of MODES) writeColors(m, input[m], base.colors[m]);
  } else {
    want("theme.palette", undefined);
    // « un seul mode » : comparées aux valeurs du skin pour le mode que montrent les champs (le premier déclaré)
    const m = base.modes[0] ?? "dark";
    writeColors("single", input.single, base.colors[m]);
  }

  // ── police (réglage avancé : absent du formulaire simple = on n'y touche pas)
  if (input.font !== null) {
    if (legacy) want("theme.font", ["sans", "serif", "mono"].includes(input.font) ? input.font : "sans");
    else want("theme.font", ["sans", "serif", "mono"].includes(input.font) ? input.font : undefined);
  }

  // ── halo
  if (legacy) {
    want("theme.glow", isGlowLevel(input.glow) && (input.advanced || input.glow !== "custom") ? input.glow : "none");
  } else if (input.glow === "skin") {
    want("theme.glow", undefined);
  } else {
    want("theme.glow", isGlowLevel(input.glow) && (input.advanced || input.glow !== "custom") ? input.glow : undefined);
  }
  if (input.glowTuning && (legacy || input.glow === "custom")) want("theme.glow.custom", normalizeTuning(input.glowTuning));

  // ── fond
  const skinBg = !legacy && input.bgPreset === "skin";
  if (skinBg) {
    want("theme.bgPreset", undefined);
  } else {
    want("theme.bgPreset", isPreset(input.bgPreset) && (input.advanced || (input.bgPreset !== "custom" && input.bgPreset !== "svg")) ? input.bgPreset : "none");
  }
  if (input.bgSvg && !skinBg && (legacy || input.bgPreset === "svg")) {
    want("theme.bgSvg", input.bgSvg.markup);
    want("theme.bgSvgFit", input.bgSvg.fit);
    want("theme.bgSvgAlign", input.bgSvg.align);
    want("theme.bgSvgTile", input.bgSvg.tile);
  }
  if (input.bgCustom !== null && !skinBg && (legacy || input.bgPreset === "custom")) want("theme.bgCustom", input.bgCustom);
  want("theme.bgImage", input.bgImage || undefined);

  // ── en-tête
  const layout = isHeaderLayout(input.headerLayout) ? input.headerLayout : "classic";
  if (legacy) want("header.layout", layout);
  else want("header.layout", layout === (base.defaults.headerLayout ?? "classic") ? undefined : layout);

  // ── écriture (seulement ce qui change)
  let changed = 0;
  for (const [key, value] of target) {
    const had = before.has(key);
    if (value === undefined) {
      if (had) { await deleteSetting(key); changed++; }
    } else if (!had || !same(before.get(key), value)) {
      await setSetting(key, value);
      changed++;
    }
  }
  if (changed > 0) {
    await dropSnapshot();                       // « tant qu'on n'a pas changé autre chose » (§3.3)
    invalidateSkinCache();
    await audit(opts.actor ?? "system", "appearance.update", base.id);
  }
  return { ok: true, changed };
}
