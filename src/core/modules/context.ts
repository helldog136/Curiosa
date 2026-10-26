import { buildTheme, themeRef } from "@/core/color";
import { makeTranslator } from "@/core/i18n/dictionary";
import { pickName, type InstanceView } from "@/core/instances";
import { currentVisit } from "@/core/visit";
import { getSetting, getSettingByLocale, getSiteConfig, themeExtraOf } from "@/core/settings";
import { can, type AdminUser } from "@/core/auth/access";
import { makeApi, type CallerRef } from "./api";
import { makeLegacy } from "./legacySettings";
import type { LoadedModule } from "./registry";
import { followsSite, readMulti, resolveDefault } from "./settingValues";
import type { ModuleContext } from "./types";

export function instanceSettingKey(instanceId: string, key: string): string {
  return `instance.${instanceId}.${key}`;
}

/** Qui, parmi les contextes construits, porte les droits d'une personne pour `asCaller` (rempli par `forViewer` avec l option carryRights seulement). */
const CALLERS = new WeakMap<object, CallerRef>();

/** Contexte d'exécution d'un module pour une instance donnée. */
export async function buildContext(mod: LoadedModule, instance: InstanceView, locale?: string, lastVisit?: Date): Promise<ModuleContext> {
  const config = await getSiteConfig();
  const loc = locale ?? config.defaultLocale;

  const localized = await getSiteConfig(loc);
  const theme = buildTheme(localized.background, localized.accent, localized.font, themeExtraOf(localized));

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
    // (0.2.14) Plusieurs choix : toujours une liste, ramenée aux options actuelles du module (jamais une valeur inconnue).
    if (field.type === "multichoice") { values[field.key] = readMulti(field, stored); continue; }
    // Une couleur vide (ou jamais réglée) suit le thème du site quand son défaut est « theme:<jeton> ».
    const token = field.type === "color" ? themeRef(field.default) : null;
    values[field.key] = token ? (typeof stored === "string" && stored !== "" ? stored : theme[token]) : (stored ?? field.default);
  }

  const dict = (code: string) => mod.locales[code] ?? {};
  const ui = makeTranslator(loc);
  const caller: CallerRef = { person: null };
  const ctx: ModuleContext = {
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
    api: makeApi(instance, loc, mod.manifest.permissions, caller),
    // Réglages hérités (0.2.0) : seulement les clés déclarées dans `legacySettings`, pour cette instance.
    legacy: makeLegacy(mod.manifest, instance.id),
    // Refus par défaut : seul un contexte d'administration d'un humain (voir `forViewer`) répond autre chose que « non ».
    can: () => false,
    // Réglage « choix parmi » (0.2.0) : résolu à la demande, borné, jamais écrit ici (voir choice.ts).
    async resolveChoice(key: string) {
      const field = mod.manifest.settings.find((f) => f.key === key);
      if (!field || field.type !== "choice") return { status: "none" as const };
      const { resolveChoiceFor } = await import("./choice");
      return resolveChoiceFor({ mod, instance }, field, values[key], { locale: loc });
    },
  };
  CALLERS.set(ctx, caller);
  return ctx;
}

/**
 * Le même contexte, pour une personne qui regarde l'administration (`adminPanel`, `adminActions`, `entryPanels`) : `ctx.can("email.view")` vérifie
 * « <ce module>:email.view » pour elle (relue en base à cette requête). Le préfixe est imposé : un module ne teste jamais le droit d'un autre.
 */
export function forViewer<T extends ModuleContext>(ctx: T, viewer: AdminUser | null, opts: { carryRights?: boolean } = {}): T {
  // `carryRights` : SEULEMENT pour l'exécution d'une `adminAction` par la personne qui l'a déclenchée (jamais un panneau, jamais un service).
  // Les appels `ctx.api.services.call(…, { asCaller: true })` de cette action portent alors ses droits jusqu'au fournisseur (voir dependencies.ts).
  if (opts.carryRights === true) { const c = CALLERS.get(ctx); if (c) c.person = viewer; }
  const prefix = `${ctx.moduleId}:`;
  ctx.can = (rightId: string) => typeof rightId === "string" && rightId !== "" && !rightId.includes(":") && can(viewer, prefix + rightId);
  return ctx;
}
