/**
 * LE MODÈLE DE LA PAGE APPARENCE (lot S7, docs/SKINS.md §10) : tout ce que l'écran montre, calculé côté serveur avec les MÊMES fonctions que le rendu du
 * site (`composeSkin`) : ce que la personne voit dans les aperçus est ce que verront les visiteurs. Aucun accès à Next.
 */
import { BASIC } from "./basic";
import { composeSkin, type Composed } from "./compose";
import { toSkinDefinition } from "./folder";
import type { Text } from "./messages";
import { getModuleSkinLayer, type ModuleSkinLayer } from "./moduleParts";
import { readActiveSetting } from "./registry";
import { COLOR_FIELDS, RETOUCH_KEYS, retouchesFrom, type ColorField } from "./retouch";
import { installed, loadInstalledSkin, type InstalledSkin } from "./service";
import { RETOUCH_SETTINGS, readSnapshot, type SkinBase, type SkinSnapshot } from "./appearance";
import { prisma } from "../db";
import { BASIC_ID, SETTING_OPTIONS } from "./constants";
import type { Mode, Retouches, SkinDefinition } from "./types";

export type ColorSet = Record<ColorField, string>;
export type ModeColors = Partial<Record<Mode, ColorSet>>;

/** Quelques couleurs pour dessiner la vignette d'un skin (carte sans image d'aperçu) : par mode. */
export type Swatch = { background: string; surface: string; text: string; accent: string; accent2: string };

export type SkinCardModel = {
  id: string;
  name: Text;
  description: Text;
  version: string;
  author?: string;
  license?: string;
  modes: Mode[];
  tags: string[];
  source: "basic" | "catalogue" | "personal";
  active: boolean;
  status: "ok" | "missing" | "modified" | "invalid";
  previews: { file: string; mode?: Mode; alt: Text }[];
  previousVersion?: string;
  swatches: Partial<Record<Mode, Swatch>>;
};

export type CreditModel = { file: string; kind: "font" | "image"; license?: string; author?: string; source?: string };

export type AppearanceView = {
  /** Le skin réglé (`skin.active`) n'est pas utilisable (fichiers absents ou abîmés) : basic s'applique en attendant. */
  activeProblem: boolean;
  activeId: string;
  active: SkinCardModel;
  cards: SkinCardModel[];
  /** Mode d'emploi des retouches : le skin actif et ses valeurs sans retouche (pour « ↺ valeur du skin » et pour ne garder que les différences). */
  base: SkinBase;
  skinColors: ModeColors;
  /** Valeurs affichées dans les champs de couleur. */
  single: ColorSet;
  both: ModeColors;
  retouches: Retouches;
  retouched: boolean;
  /** Les modes que le skin déclare. */
  modes: Mode[];
  palette: "single" | "both";
  switchAvailable: boolean;
  notices: Text[];
  suspended: Mode[];
  options: { id: string; label: Text; default: string; chosen: string; values: { id: string; label: Text }[] }[];
  credits: CreditModel[];
  /** Valeurs de départ du skin pour le halo, le fond, l'en-tête et la police. */
  skinDefaults: { headerLayout: string; font: string; glow: string; background: string };
  snapshot: { kind: SkinSnapshot["kind"]; fromSkin: string; fromName: Text | null; at: string } | null;
  /** Aperçu de l'ensemble des jetons effectifs, par mode (pour la maquette des deux modes). */
  mock: Partial<Record<Mode, Swatch>>;
  /** Ce que la personne a retouché (absent : la valeur du skin s'applique). */
  raw: { glow?: string; bgPreset?: string; headerLayout?: string; font?: string; bgImage?: string };
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const swatchOf = (c: Composed, mode: Mode): Swatch | undefined => {
  const m = c.modes.find((x) => x.mode === mode);
  if (!m) return undefined;
  return { background: m.theme.bg, surface: m.theme.surface, text: m.theme.fg, accent: m.theme.accent, accent2: m.theme.accent2 };
};

const colorsOf = (c: Composed, mode: Mode): ColorSet | undefined => {
  const m = c.modes.find((x) => x.mode === mode);
  if (!m) return undefined;
  return { background: m.theme.bg, surface: m.theme.surface, text: m.theme.fg, accent: m.theme.accent, accent2: m.theme.accent2.toLowerCase() === m.theme.accent.toLowerCase() ? "" : m.theme.accent2 };
};

async function readFresh(keys: readonly string[]): Promise<Map<string, unknown>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [...keys] }, locale: "" } });
  const out = new Map<string, unknown>();
  for (const r of rows) { try { out.set(r.key, JSON.parse(r.value)); } catch { /* illisible : comme absent */ } }
  return out;
}

/** Le skin (définition prête à composer) : basic ou un skin installé et intact ; `null` si le skin demandé n'est pas utilisable. */
export async function definitionOf(id: string, layer?: ModuleSkinLayer): Promise<SkinDefinition | null> {
  if (id === BASIC_ID) return BASIC;
  const l = layer ?? (await getModuleSkinLayer());
  const loaded = await loadInstalledSkin(id, { moduleParts: l.byModule });
  return loaded.ok ? toSkinDefinition(loaded) : null;
}

function cardOf(def: SkinDefinition | null, row: InstalledSkin | null, layer: ModuleSkinLayer, active: boolean): SkinCardModel {
  const swatches: SkinCardModel["swatches"] = {};
  if (def) {
    const c = composeSkin({ skin: def === BASIC ? null : def, moduleTokens: layer.tokens, modulePairs: layer.pairs });
    for (const m of ["light", "dark"] as const) { const s = swatchOf(c, m); if (s) swatches[m] = s; }
  }
  if (!row) {
    return { id: BASIC_ID, name: BASIC.name, description: { fr: "L'apparence de Curiosa : sombre, douce, arrondie. C'est la base de tous les skins.", en: "The Curiosa look: dark, soft, rounded. It is the base of every skin." }, version: BASIC.version, modes: ["dark"], tags: ["dark", "sans"], source: "basic", active, status: "ok", previews: [], swatches };
  }
  return {
    id: row.id, name: row.name, description: row.description, version: row.version, author: row.author, license: row.license, modes: [...row.modes], tags: row.tags,
    source: row.source, active, status: row.status, previews: row.previews, previousVersion: row.previous?.version, swatches,
  };
}

/** Tout ce qu'il faut pour dessiner la page. */
export async function loadAppearanceView(): Promise<AppearanceView> {
  const layer = await getModuleSkinLayer();
  const rawActive = await readActiveSetting();
  const rows = await installed();
  const rowOf = (id: string) => rows.find((r) => r.id === id) ?? null;

  let activeDef = rawActive === BASIC_ID ? BASIC : null;
  if (!activeDef && rowOf(rawActive)?.status === "ok") activeDef = await definitionOf(rawActive, layer);
  const activeProblem = rawActive !== BASIC_ID && !activeDef;
  if (!activeDef) activeDef = BASIC;
  const activeId = activeDef.id;

  const fresh = await readFresh([...RETOUCH_SETTINGS, SETTING_OPTIONS]);
  const retouches = retouchesFrom((k) => fresh.get(k));
  const optionsRaw = fresh.get(SETTING_OPTIONS);
  const chosenOptions = optionsRaw && typeof optionsRaw === "object" && !Array.isArray(optionsRaw) ? (optionsRaw as Record<string, string>) : {};
  const skinArg = activeDef === BASIC ? null : activeDef;
  const input = { skin: skinArg, options: chosenOptions, moduleTokens: layer.tokens, modulePairs: layer.pairs };
  const bare = composeSkin(input);
  const now = composeSkin({ ...input, retouches });

  const modes: Mode[] = activeDef.modes.filter((m): m is Mode => m === "light" || m === "dark");
  const skinColors: ModeColors = {};
  for (const m of modes) { const c = colorsOf(bare, m); if (c) skinColors[m] = c; }

  const palette: "single" | "both" = retouches.palette === "both" && modes.length === 2 ? "both" : "single";
  // « un seul mode » : les champs montrent le mode que dit le fond choisi, sinon le premier mode du skin (le clair s'il y en a deux)
  const first = now.modes[0]?.mode ?? modes[0] ?? "dark";
  const single = colorsOf(now, first) ?? colorsOf(bare, first)!;

  // « clair et sombre » : la valeur actuelle de chaque mode ; en passant de « un seul mode », le jeu choisi va dans le mode qui lui correspond (par luminance)
  const both: ModeColors = {};
  for (const m of modes) {
    const cur = palette === "both" ? colorsOf(now, m) : undefined;
    both[m] = cur ?? skinColors[m]!;
  }
  if (palette === "single" && modes.length === 2 && retouches.single.background) both[now.modes[0]!.mode] = single;

  const optionModels: AppearanceView["options"] = activeDef.options.map((o) => ({
    id: o.id, label: o.label, default: o.default,
    chosen: o.values.some((v) => v.id === chosenOptions[o.id]) ? chosenOptions[o.id]! : o.default,
    values: o.values.map((v) => ({ id: v.id, label: v.label })),
  }));

  let credits: CreditModel[] = [];
  if (activeDef !== BASIC) {
    const loaded = await loadInstalledSkin(activeId, { moduleParts: layer.byModule });
    if (loaded.ok) credits = loaded.manifest.assets.map((a) => ({ file: a.file, kind: a.kind, license: a.license, author: a.author, source: a.source }));
  }

  const d = activeDef.defaults;
  const bgDefault = d.background === undefined || d.background === "none" ? "none" : Array.isArray(d.background) ? "custom" : String(d.background);
  const base: SkinBase = { id: activeId, colors: skinColors as SkinBase["colors"], modes, defaults: { headerLayout: d.headerLayout } };

  const snap = await readSnapshot();
  const cards: SkinCardModel[] = [cardOf(BASIC, null, layer, activeId === BASIC_ID)];
  for (const r of rows) {
    const def = r.status === "ok" ? await definitionOf(r.id, layer) : null;
    cards.push(cardOf(def, r, layer, activeId === r.id));
  }
  const activeCard = cards.find((c) => c.id === activeId) ?? cards[0]!;

  return {
    activeProblem, activeId, active: activeCard, cards, base, skinColors, single, both, retouches,
    retouched: [...RETOUCH_SETTINGS].some((k) => fresh.has(k)),
    modes, palette, switchAvailable: now.switchAvailable,
    notices: now.notices, suspended: now.modes.filter((m) => m.suspended).map((m) => m.mode),
    options: optionModels, credits,
    skinDefaults: { headerLayout: d.headerLayout ?? "classic", font: d.font ?? "sans", glow: d.glow ?? "none", background: bgDefault },
    snapshot: snap ? { kind: snap.kind, fromSkin: snap.fromSkin, fromName: snap.fromSkin === BASIC_ID ? BASIC.name : (rowOf(snap.fromSkin)?.name ?? null), at: snap.at } : null,
    mock: { light: swatchOf(now, "light"), dark: swatchOf(now, "dark") },
    raw: {
      glow: str(fresh.get("theme.glow")), bgPreset: str(fresh.get("theme.bgPreset")), headerLayout: str(fresh.get("header.layout")), font: str(fresh.get("theme.font")), bgImage: str(fresh.get("theme.bgImage")),
    },
  };
}

export { COLOR_FIELDS, RETOUCH_KEYS };
