import { buildTheme, themeRef } from "@/core/color";
import { makeTranslator } from "@/core/i18n/dictionary";
import { pickName, type InstanceView } from "@/core/instances";
import { currentVisit } from "@/core/visit";
import { getSetting, getSettingByLocale, getSiteConfig } from "@/core/settings";
import { makeApi } from "./api";
import type { LoadedModule } from "./registry";
import { followsSite, resolveDefault } from "./settingValues";
import type { ModuleContext } from "./types";

export function instanceSettingKey(instanceId: string, key: string): string {
  return `instance.${instanceId}.${key}`;
}

/** Contexte d'exécution d'un module pour une instance donnée. */
export async function buildContext(mod: LoadedModule, instance: InstanceView, locale?: string, lastVisit?: Date): Promise<ModuleContext> {
  const config = await getSiteConfig();
  const loc = locale ?? config.defaultLocale;

  const localized = await getSiteConfig(loc);
  const theme = buildTheme(localized.background, localized.accent, localized.font);

  const values: Record<string, unknown> = {};
  for (const field of mod.manifest.settings) {
    // Un défaut qui suit le site (« site:name ») : la valeur propre à CETTE langue, sinon le nom / l'accroche du site dans cette langue
    // (pas la valeur d'une autre langue, ce qui masquerait le nom du site).
    if (followsSite(field)) {
      const own = (await getSettingByLocale(instanceSettingKey(instance.id, field.key)))[field.translatable ? loc : ""];
      values[field.key] = typeof own === "string" && own !== "" ? own : resolveDefault(field, localized);
      continue;
    }
    const stored = await getSetting(instanceSettingKey(instance.id, field.key), loc);
    // Une couleur vide (ou jamais réglée) suit le thème du site quand son défaut est « theme:<jeton> ».
    const token = field.type === "color" ? themeRef(field.default) : null;
    values[field.key] = token ? (typeof stored === "string" && stored !== "" ? stored : theme[token]) : (stored ?? field.default);
  }

  const dict = (code: string) => mod.locales[code] ?? {};
  const ui = makeTranslator(loc);
  return {
    moduleId: mod.manifest.id,
    instance: { id: instance.id, key: instance.key, basePath: instance.basePath, name: pickName(instance, loc, config.defaultLocale) },
    locale: loc,
    defaultLocale: config.defaultLocale,
    locales: config.locales,
    setting: <T = string>(key: string) => values[key] as T | undefined,
    theme,
    visit: { lastVisit: lastVisit ?? (await currentVisit().catch(() => ({ lastVisit: new Date(0) }))).lastVisit },
    t(key, vars) {
      let text = dict(loc)[key] ?? dict(config.defaultLocale)[key] ?? dict("en")[key];
      if (text === undefined) return ui(key, vars);
      for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, String(value));
      return text;
    },
    api: makeApi(instance, loc),
  };
}
