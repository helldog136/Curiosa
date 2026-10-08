import { LOGO_KEYS, type LogoSet } from "./logos";
import { cache } from "react";
import { isBackgroundImage, isPreset, type BackgroundPreset } from "./background";
import { isGlowLevel, normalizeTuning, type GlowLevel, type GlowTuning } from "./glow";
import { prisma } from "./db";

type Stored = Record<string, Record<string, unknown>>; // key → locale → value

const loadAll = cache(async (): Promise<Stored> => {
  const rows = await prisma.setting.findMany();
  const out: Stored = {};
  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(row.value);
    } catch {
      continue;
    }
    (out[row.key] ??= {})[row.locale] = value;
  }
  return out;
});

/**
 * Lit un réglage. Pour un réglage traduisible, cherche la langue demandée,
 * puis la langue par défaut du site, puis la valeur non traduite.
 */
export async function getSetting<T = unknown>(key: string, locale?: string): Promise<T | undefined> {
  const all = await loadAll();
  const byLocale = all[key];
  if (!byLocale) return undefined;
  if (locale && byLocale[locale] !== undefined) return byLocale[locale] as T;
  if (byLocale[""] !== undefined) return byLocale[""] as T;
  const def = (all["i18n.default"]?.[""] as string | undefined) ?? undefined;
  if (def && byLocale[def] !== undefined) return byLocale[def] as T;
  return undefined;
}

/** Toutes les valeurs d'un réglage, par langue ("" = non traduit). */
export async function getSettingByLocale(key: string): Promise<Record<string, unknown>> {
  return (await loadAll())[key] ?? {};
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

export type NavItem = { label: Record<string, string>; href: string };
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
  font: "sans" | "serif" | "mono";
  /** Halo de couleur en fond de page (voir core/glow.ts) : niveau, et réglages du niveau « personnalisé ». */
  glow: { level: GlowLevel; custom: GlowTuning };
  /** Fond de page : préréglage, description personnalisée (JSON, voir core/background.ts) et image de fond éventuelle. */
  bg: { preset: BackgroundPreset; custom: string; image: string | null; svg: { markup: string; fit: "cover" | "contain" | "tile"; align: "left" | "center" | "right"; tile: number } };
  /** Compter les visites, anonymement (voir core/stats.ts). */
  statsEnabled: boolean;
  nav: NavItem[];
  homeSections: HomeSection[];
  setupCompleted: boolean;
};

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
    nav: (await getSetting<NavItem[]>("nav.custom")) ?? [],
    homeSections: (await getSetting<HomeSection[]>("home.sections")) ?? DEFAULT_HOME_SECTIONS,
    setupCompleted: (await getSetting<boolean>("setup.completed")) ?? false,
  };
});
