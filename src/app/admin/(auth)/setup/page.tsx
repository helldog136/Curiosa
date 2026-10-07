import { redirect } from "next/navigation";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { KNOWN_LOCALES } from "@/core/i18n/locales";
import { PRESETS } from "@/core/presets";
import { countUsers } from "@/core/services";
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
      presets={PRESETS.map((p) => ({ id: p.id, names: p.names, descriptions: p.descriptions }))}
      needsToken={!!process.env.SETUP_TOKEN}
    />
  );
}
