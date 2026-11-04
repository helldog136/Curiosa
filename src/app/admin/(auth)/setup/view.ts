import { pickText } from "@/core/i18n/audit.mjs";
import type { SetupModules } from "@/core/modules/starter";

/**
 * What the setup wizard receives about the extensions and profiles, with every text RESOLVED on the server for every language the person can pick
 * (requested language -> English). The wizard never picks a language by itself: it shows the text of its language or the English one, never another language.
 */
export function setupView(data: Pick<SetupModules, "modules" | "profiles">, codes: string[]) {
  const perLanguage = (value: Parameters<typeof pickText>[0]): Record<string, string> => Object.fromEntries(codes.map((code) => [code, pickText(value, code, "en")]));
  return {
    presets: data.modules.map((m) => ({
      id: m.id,
      icon: m.icon ?? "\u{1F9E9}",
      collectsLinks: m.collectsLinks,
      templates: m.templates.map((tpl) => ({ id: tpl.id, name: perLanguage(tpl.name), description: perLanguage(tpl.description) })),
      names: perLanguage(m.name),
      descriptions: perLanguage(m.description),
    })),
    profiles: data.profiles.map((p) => ({ id: p.id, icon: p.icon, names: perLanguage(p.name), descriptions: perLanguage(p.description), modules: p.modules, samples: p.samples })),
  };
}
