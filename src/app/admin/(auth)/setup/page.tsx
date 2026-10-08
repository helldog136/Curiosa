import { redirect } from "next/navigation";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { KNOWN_LOCALES } from "@/core/i18n/locales";
import { starterManifests } from "@/core/modules/starter";
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
      presets={starterManifests().filter((m) => m.starter && m.content).map((m) => ({
        id: m.id,
        preselected: !!m.onboarding?.preselected,
        collectsLinks: !!m.onboarding?.collectsLinks,
        names: m.name as Record<string, string>,
        descriptions: (m.description ?? {}) as Record<string, string>,
      }))}
      needsToken={!!process.env.SETUP_TOKEN}
    />
  );
}
