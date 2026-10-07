import { cache } from "react";
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
  /** Taille sur la grille de l'accueil, en cases. Absent = la taille recommandée par le module. */
  w?: number; h?: number;
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
  logo: string | null;
  footerText: string;
  contactEmail: string;
  accent: string;
  background: string;
  font: "sans" | "serif" | "mono";
  nav: NavItem[];
  homeSections: HomeSection[];
  /** Nombre maximal de colonnes de la grille de l'accueil (1 à 12) ; l'affichage en montre moins sur un petit écran. */
  homeColumns: number;
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
    name: await str("site.name", "Vitrine"),
    tagline: await str("site.tagline"),
    about: await str("site.about"),
    logo: (await getSetting<string>("site.logo")) ?? null,
    footerText: await str("footer.text"),
    contactEmail: (await getSetting<string>("site.contactEmail")) ?? "",
    accent: (await getSetting<string>("theme.accent")) ?? "#e8a23b",
    background: (await getSetting<string>("theme.background")) ?? "#121214",
    font: (await getSetting<SiteConfig["font"]>("theme.font")) ?? "sans",
    nav: (await getSetting<NavItem[]>("nav.custom")) ?? [],
    homeSections: (await getSetting<HomeSection[]>("home.sections")) ?? DEFAULT_HOME_SECTIONS,
    homeColumns: Math.min(12, Math.max(1, Math.trunc(Number(await getSetting<number>("home.columns"))) || 4)),
    setupCompleted: (await getSetting<boolean>("setup.completed")) ?? false,
  };
});
