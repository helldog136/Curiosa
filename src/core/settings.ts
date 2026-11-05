import { headerLink, isHeaderLayout, type HeaderConfig, type HeaderLayout } from "./header";
import { LOGO_KEYS, type LogoSet } from "./logos";
import { cache } from "react";
import { isBackgroundImage, isPreset, type BackgroundPreset } from "./background";
import { isGlowLevel, normalizeTuning, type GlowLevel, type GlowTuning } from "./glow";
import { prisma } from "./db";
import { settingsGeneration } from "./settingsGeneration";
import { isHexColor, type ThemeExtra } from "./color";
import { normalizePlacement, type SearchPlacementConfig } from "./search/config";

type Stored = Record<string, Record<string, unknown>>; // key → locale → value
type RawRows = Map<string, Map<string, string>>; // key → locale → JSON text

/**
 * The raw rows of the Setting table, cached for the whole process. Valid while no write to the table happened (generation counter bumped by the database client,
 * see db.ts) and for at most `MAX_AGE_MS` (a safety net for a writer in another process, e.g. a maintenance script). Only the JSON TEXT is cached: every read
 * parses its own copy, so a caller that mutates a value can never change what the next request sees. Before this cache every `getSetting` outside a page render
 * (sitemap, feeds, routes, MCP, start-up) read the whole table again: 578 times for one sitemap.xml.
 */
const MAX_AGE_MS = 15_000;
let rawCache: { generation: number; at: number; rows: Promise<RawRows> } | null = null;

/** Tests and tools that change the database behind the client's back. */
export function resetSettingsCache(): void { rawCache = null; }

function rawRows(): Promise<RawRows> {
  const generation = settingsGeneration();
  const now = Date.now();
  if (rawCache && rawCache.generation === generation && now - rawCache.at < MAX_AGE_MS) return rawCache.rows;
  const rows = prisma.setting.findMany().then((list) => {
    const out: RawRows = new Map();
    for (const row of list) {
      let byLocale = out.get(row.key);
      if (!byLocale) out.set(row.key, (byLocale = new Map()));
      byLocale.set(row.locale, row.value);
    }
    return out;
  });
  const entry = { generation, at: now, rows };
  rawCache = entry;
  rows.catch(() => { if (rawCache === entry) rawCache = null; });
  return rows;
}

const parse = (text: string | undefined): unknown => {
  if (text === undefined) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
};

/** Every setting, parsed (a fresh copy). Used by `getSiteConfig`; single settings go through `getSetting`, which parses only what it needs. */
const loadAll = cache(async (): Promise<Stored> => {
  const out: Stored = {};
  for (const [key, byLocale] of await rawRows()) {
    for (const [locale, text] of byLocale) {
      const value = parse(text);
      if (value === undefined) continue; // unreadable JSON is skipped, as before
      (out[key] ??= {})[locale] = value;
    }
  }
  return out;
});

/**
 * Lit un réglage. Pour un réglage traduisible, cherche la langue demandée,
 * puis la langue par défaut du site, puis la valeur non traduite.
 */
export async function getSetting<T = unknown>(key: string, locale?: string): Promise<T | undefined> {
  const rows = await rawRows();
  const byLocale = rows.get(key);
  if (!byLocale) return undefined;
  const read = (l: string): unknown => parse(byLocale.get(l));
  if (locale) { const v = read(locale); if (v !== undefined) return v as T; }
  const plain = read("");
  if (plain !== undefined) return plain as T;
  const def = parse(rows.get("i18n.default")?.get("")) as string | undefined;
  if (def) { const v = read(def); if (v !== undefined) return v as T; }
  return undefined;
}

/** Toutes les valeurs d'un réglage, par langue ("" = non traduit). */
export async function getSettingByLocale(key: string): Promise<Record<string, unknown>> {
  const byLocale = (await rawRows()).get(key);
  const out: Record<string, unknown> = {};
  if (byLocale) for (const [locale, text] of byLocale) { const v = parse(text); if (v !== undefined) out[locale] = v; }
  return out;
}

export async function setSetting(key: string, value: unknown, locale = ""): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.setting.upsert({
    where: { key_locale: { key, locale } },
    create: { key, locale, value: json },
    update: { value: json },
  });
}

export async function deleteSetting(key: string, locale?: string): Promise<void> {
  await prisma.setting.deleteMany({ where: locale === undefined ? { key } : { key, locale } });
}

// ─── Réglages du site ─────────────────────────────────────────────────────

export type NavLeaf = { label: Record<string, string>; href: string };
/** Entrée du menu : un lien, ou un GROUPE (menu déroulant : `children`, un seul niveau ; son `href` est alors vide). */
export type NavItem = NavLeaf & { children?: NavLeaf[] };
/** Un morceau placé sur la page d'accueil : une section proposée par une instance de module. */
export type HomeSection = {
  id: string; instance: string; section: string; options: Record<string, unknown>;
  /** Taille naturelle choisie dans l'admin. Absent = celle que recommande le module. */
  size?: "small" | "medium" | "large" | "full";
  /** Isolé : seul sur sa ligne, centré, avec un retour à la ligne avant et après. */
  isolated?: boolean;
};

export type SiteConfig = {
  defaultLocale: string;
  locales: string[];
  autoDetect: boolean;
  adminLocale: string | null;
  name: string;
  tagline: string;
  /** Présentation longue du site/de la personne (Markdown) — identité, réglée dans l'admin. */
  about: string;
  /** Icône / logo carré (le « logo » historique). Le jeu complet est dans `logos`. */
  logo: string | null;
  /** Jeu de logos : horizontal, carré, versions pour fond sombre, favicon, image de partage (voir core/logos.ts). */
  logos: LogoSet;
  /** Image de l'onglet du navigateur ; vide : l'icône générée (voir core/favicon.ts). */
  favicon: string | null;
  footerText: string;
  contactEmail: string;
  accent: string;
  background: string;
  /** Choix facultatifs du thème (vide = dérivé) : accent secondaire, fond des cartes, couleur du texte. */
  accent2: string;
  surface: string;
  textColor: string;
  font: "sans" | "serif" | "mono";
  /** Halo de couleur en fond de page (voir core/glow.ts) : niveau, et réglages du niveau « personnalisé ». */
  glow: { level: GlowLevel; custom: GlowTuning };
  /** Fond de page : préréglage, description personnalisée (JSON, voir core/background.ts) et image de fond éventuelle. */
  bg: { preset: BackgroundPreset; custom: string; image: string | null; svg: { markup: string; fit: "cover" | "contain" | "tile"; align: "left" | "center" | "right"; tile: number } };
  /** Compter les visites, anonymement (voir core/stats.ts). */
  statsEnabled: boolean;
  /** Proposer aux visiteurs le bandeau de cookies « Accepter les cookies » (pastilles de nouveautés, avec leur accord : voir core/visit.ts et core/cookieTray.ts). */
  newsToggle: boolean;
  /** Montrer l'icône du flux RSS dans le pied de page (par défaut oui ; elle n'apparaît de toute façon que si le site a de quoi alimenter un flux : voir core/feeds.ts). */
  feedLink: boolean;
  /** Recherche dans le site (voir core/search/) : active par défaut ; `placement` dit où se met le champ (en-tête, pied de page, ou nulle part : la page /search seule). */
  search: SearchPlacementConfig;
  nav: NavItem[];
  /** Mise en page de l'en-tête et ses éléments facultatifs (voir core/header.ts). */
  header: HeaderConfig;
  homeSections: HomeSection[];
  setupCompleted: boolean;
};

const optionalHex = (v: unknown): string => (isHexColor(v) ? v.toLowerCase() : "");

/** Les choix facultatifs du thème d'une configuration, au format attendu par `buildTheme` / `buildPalette`. */
export const themeExtraOf = (c: Pick<SiteConfig, "accent2" | "surface" | "textColor">): ThemeExtra => ({ accent2: c.accent2, surface: c.surface, text: c.textColor });

export const DEFAULT_HOME_SECTIONS: HomeSection[] = [];

export const getSiteConfig = cache(async (locale?: string): Promise<SiteConfig> => {
  const all = await loadAll();
  const defaultLocale = (all["i18n.default"]?.[""] as string | undefined) ?? "en";
  const locales = (all["i18n.enabled"]?.[""] as string[] | undefined) ?? [defaultLocale];
  const loc = locale ?? defaultLocale;
  const str = async (key: string, fallback = "") => (await getSetting<string>(key, loc)) ?? fallback;
  return {
    defaultLocale,
    locales: locales.includes(defaultLocale) ? locales : [defaultLocale, ...locales],
    autoDetect: (await getSetting<boolean>("i18n.autoDetect")) ?? false,
    adminLocale: (await getSetting<string>("i18n.adminDefault")) ?? null,
    name: await str("site.name", "Curiosa"),
    tagline: await str("site.tagline"),
    about: await str("site.about"),
    logo: (await getSetting<string>("site.logo")) ?? null,
    logos: {
      square: (await getSetting<string>(LOGO_KEYS.square)) || null, wide: (await getSetting<string>(LOGO_KEYS.wide)) || null,
      squareDark: (await getSetting<string>(LOGO_KEYS.squareDark)) || null, wideDark: (await getSetting<string>(LOGO_KEYS.wideDark)) || null,
      favicon: (await getSetting<string>(LOGO_KEYS.favicon)) || null, share: (await getSetting<string>(LOGO_KEYS.share)) || null,
    },
    favicon: (await getSetting<string>("site.favicon")) || null,
    footerText: await str("footer.text"),
    contactEmail: (await getSetting<string>("site.contactEmail")) ?? "",
    accent: (await getSetting<string>("theme.accent")) ?? "#e8a23b",
    background: (await getSetting<string>("theme.background")) ?? "#121214",
    accent2: optionalHex(await getSetting("theme.accent2")),
    surface: optionalHex(await getSetting("theme.surface")),
    textColor: optionalHex(await getSetting("theme.text")),
    font: (await getSetting<SiteConfig["font"]>("theme.font")) ?? "sans",
    glow: { level: isGlowLevel(all["theme.glow"]?.[""]) ? (all["theme.glow"]![""] as GlowLevel) : "none", custom: normalizeTuning(all["theme.glow.custom"]?.[""]) },
    bg: {
      preset: isPreset(all["theme.bgPreset"]?.[""]) ? (all["theme.bgPreset"]![""] as BackgroundPreset) : "none",
      custom: String(all["theme.bgCustom"]?.[""] ?? ""),
      image: isBackgroundImage(all["theme.bgImage"]?.[""]) ? (all["theme.bgImage"]![""] as string) : null,
      svg: {
        markup: String(all["theme.bgSvg"]?.[""] ?? ""),
        fit: (["contain", "tile"] as const).find((f) => f === all["theme.bgSvgFit"]?.[""]) ?? "cover",
        align: (["left", "right"] as const).find((f) => f === all["theme.bgSvgAlign"]?.[""]) ?? "center",
        tile: Math.min(1200, Math.max(20, Math.round(Number(all["theme.bgSvgTile"]?.[""]) || 200))),
      },
    },
    statsEnabled: (await getSetting<boolean>("stats.enabled")) !== false,
    newsToggle: (await getSetting<boolean>("news.toggle")) === true,
    feedLink: (await getSetting<boolean>("feed.showLink")) !== false,
    search: { enabled: (await getSetting<boolean>("search.enabled")) !== false, placement: normalizePlacement(await getSetting("search.placement")) },
    nav: (await getSetting<NavItem[]>("nav.custom")) ?? [],
    header: {
      layout: isHeaderLayout(all["header.layout"]?.[""]) ? (all["header.layout"]![""] as HeaderLayout) : "classic",
      socials: all["header.socials"]?.[""] !== false,
      secondary: headerLink(await str("header.secondaryLabel"), all["header.secondaryHref"]?.[""]),
      button: headerLink(await str("header.buttonLabel"), all["header.buttonHref"]?.[""]),
    },
    homeSections: (await getSetting<HomeSection[]>("home.sections")) ?? DEFAULT_HOME_SECTIONS,
    setupCompleted: (await getSetting<boolean>("setup.completed")) ?? false,
  };
});
