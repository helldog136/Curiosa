import type { Metadata } from "next";
import { makeTranslator } from "@/core/i18n/dictionary";
import { getVisitorLocale } from "@/core/i18n/request";
import { pickName } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { localized } from "@/core/modules/types";
import { buildPrivacyPolicy } from "@/core/privacy";
import { getSetting, getSiteConfig } from "@/core/settings";
import { Markdown } from "@/components/site/Markdown";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: makeTranslator(await getVisitorLocale())("privacy.title") };
}

/** Page obligatoire du site : le cœur l'écrit à partir de ce que le site fait réellement ; le propriétaire peut y ajouter, pas y retirer. */
export default async function PrivacyPage() {
  const locale = await getVisitorLocale();
  const config = await getSiteConfig(locale);
  const t = makeTranslator(locale);
  const features = (await getActiveInstances()).flatMap(({ instance, mod }) => {
    const declared = mod.manifest.privacy;
    return declared ? [{ name: pickName(instance, locale, config.defaultLocale), text: localized(declared, locale, config.defaultLocale) }] : [];
  });
  const extra = (await getSetting<string>("privacy.extra", locale)) ?? (await getSetting<string>("privacy.extra", config.defaultLocale)) ?? "";
  const text = buildPrivacyPolicy({ siteName: config.name, contactEmail: config.contactEmail, statsEnabled: config.statsEnabled, newsToggle: config.newsToggle, features, extra, t });
  return (
    <article className="mx-auto max-w-3xl space-y-4 py-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("privacy.title")}</h1>
      <Markdown text={text} />
    </article>
  );
}
