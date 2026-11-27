import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { initialSetupLanguage } from "./language";
import { UI_LOCALES, makeTranslator } from "@/core/i18n/dictionary";
import { KNOWN_LOCALES } from "@/core/i18n/locales";
import { countUsers } from "@/core/content/service";
import { getAllSetupStrings } from "./strings";
import { SetupWizard } from "./SetupWizard";
import { LOGIN_HREF } from "@/core/adminLinks";

export const dynamic = "force-dynamic";

/** The tab title is in the language the wizard starts in (the browser's, else English); the wizard keeps it in step with the chosen language. */
export async function generateMetadata(): Promise<Metadata> {
  const lang = initialSetupLanguage((await headers()).get("accept-language"), Object.keys(KNOWN_LOCALES));
  return { title: { absolute: makeTranslator(UI_LOCALES.includes(lang) ? lang : "en")("setup.title") } };
}

/** Première connexion : tant qu'aucun compte n'existe, c'est la seule page accessible. */
export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect(LOGIN_HREF);
  const locales = Object.entries(KNOWN_LOCALES).map(([code, name]) => ({ code, name }));
  return (
    <SetupWizard
      strings={getAllSetupStrings()}
      uiLocales={UI_LOCALES}
      locales={locales}
      initialLang={initialSetupLanguage((await headers()).get("accept-language"), locales.map((l) => l.code))}
      needsToken={!!process.env.SETUP_TOKEN}
    />
  );
}
