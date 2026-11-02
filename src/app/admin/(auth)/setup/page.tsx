import { redirect } from "next/navigation";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { KNOWN_LOCALES } from "@/core/i18n/locales";
import { setupModules } from "@/core/modules/starter";
import { countUsers } from "@/core/content/service";
import { getAllSetupStrings } from "./strings";
import { SetupWizard } from "./SetupWizard";

export const dynamic = "force-dynamic";

/** Première connexion : tant qu'aucun compte n'existe, c'est la seule page accessible. */
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/admin/login");
  const { modules, profiles, unreachable } = await setupModules();
  return (
    <SetupWizard
      strings={getAllSetupStrings()}
      uiLocales={UI_LOCALES}
      locales={Object.entries(KNOWN_LOCALES).map(([code, name]) => ({ code, name }))}
      catalogueUnreachable={unreachable}
      presets={modules.map((m) => ({
        id: m.id,
        icon: m.icon ?? "🧩",
        collectsLinks: m.collectsLinks,
        templates: m.templates.map((tpl) => ({
          id: tpl.id,
          name: (typeof tpl.name === "string" ? { en: tpl.name } : tpl.name) as Record<string, string>,
          description: (typeof tpl.description === "string" ? { en: tpl.description } : (tpl.description ?? {})) as Record<string, string>,
        })),
        names: (typeof m.name === "string" ? { en: m.name } : m.name) as Record<string, string>,
        descriptions: ((typeof m.description === "string" ? { en: m.description } : m.description) ?? {}) as Record<string, string>,
      }))}
      profiles={profiles.map((p) => ({ id: p.id, icon: p.icon, names: p.name, descriptions: p.description, modules: p.modules, samples: p.samples }))}
      needsToken={!!process.env.SETUP_TOKEN}
    />
  );
}
