import { redirect } from "next/navigation";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { KNOWN_LOCALES } from "@/core/i18n/locales";
import { BUILTIN_MODULES } from "@/modules-builtin";
import { countUsers } from "@/core/content/service";
import { getAllSetupStrings } from "./strings";
import { SetupWizard } from "./SetupWizard";

export const dynamic = "force-dynamic";

/** Première connexion : tant qu'aucun compte n'existe, c'est la seule page accessible. */
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/admin/login");
  return (
    <SetupWizard
      strings={getAllSetupStrings()}
      uiLocales={UI_LOCALES}
      locales={Object.entries(KNOWN_LOCALES).map(([code, name]) => ({ code, name }))}
      presets={BUILTIN_MODULES.filter((m) => m.manifest.starter && m.manifest.content).map((m) => ({
        id: m.manifest.id,
        preselected: !!m.manifest.onboarding?.preselected,
        collectsLinks: !!m.manifest.onboarding?.collectsLinks,
        names: m.manifest.name as Record<string, string>,
        descriptions: (m.manifest.description ?? {}) as Record<string, string>,
      }))}
      needsToken={!!process.env.SETUP_TOKEN}
    />
  );
}
