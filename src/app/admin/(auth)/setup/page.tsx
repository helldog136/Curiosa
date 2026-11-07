import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { initialSetupLanguage } from "./language";
import { setupView } from "./view";
import { UI_LOCALES } from "@/core/i18n/dictionary";
import { KNOWN_LOCALES } from "@/core/i18n/locales";
import { setupModules } from "@/core/modules/starter";
import { countUsers } from "@/core/content/service";
import { getAllSetupStrings } from "./strings";
import { SetupWizard } from "./SetupWizard";
import { LOGIN_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

/** Première connexion : tant qu'aucun compte n'existe, c'est la seule page accessible. */
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect(LOGIN_HREF);
  const { modules, profiles, unreachable } = await setupModules();
  const locales = Object.entries(KNOWN_LOCALES).map(([code, name]) => ({ code, name }));
  const view = setupView({ modules, profiles }, locales.map((l) => l.code));
  return (
    <SetupWizard
      strings={getAllSetupStrings()}
      uiLocales={UI_LOCALES}
      locales={locales}
      initialLang={initialSetupLanguage((await headers()).get("accept-language"), locales.map((l) => l.code))}
      catalogueUnreachable={unreachable}
      presets={view.presets}
      profiles={view.profiles}
      needsToken={!!process.env.SETUP_TOKEN}
    />
  );
}
