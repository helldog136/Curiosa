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
export type HomeSection =
  | { id: string; type: "hero" }
  | { id: string; type: "collection"; collection: string; count: number }
  | { id: string; type: "slot"; slot: string };

export type SiteConfig = {
  defaultLocale: string;
  locales: string[];
  autoDetect: boolean;
  adminLocale: string | null;
  name: string;
  tagline: string;
  logo: string | null;
  heroTitle: string;
  heroText: string;
  footerText: string;
  contactEmail: string;
  accent: string;
  background: string;
  font: "sans" | "serif" | "mono";
  nav: NavItem[];
  homeSections: HomeSection[];
  setupCompleted: boolean;
};

export const DEFAULT_HOME_SECTIONS: HomeSection[] = [{ id: "hero", type: "hero" }];

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
    logo: (await getSetting<string>("site.logo")) ?? null,
    heroTitle: await str("hero.title"),
    heroText: await str("hero.text"),
    footerText: await str("footer.text"),
    contactEmail: (await getSetting<string>("site.contactEmail")) ?? "",
    accent: (await getSetting<string>("theme.accent")) ?? "#e8a23b",
    background: (await getSetting<string>("theme.background")) ?? "#121214",
    font: (await getSetting<SiteConfig["font"]>("theme.font")) ?? "sans",
    nav: (await getSetting<NavItem[]>("nav.custom")) ?? [],
    homeSections: (await getSetting<HomeSection[]>("home.sections")) ?? DEFAULT_HOME_SECTIONS,
    setupCompleted: (await getSetting<boolean>("setup.completed")) ?? false,
  };
});
