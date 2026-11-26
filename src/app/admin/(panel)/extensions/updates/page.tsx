import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { can } from "@/core/auth/access";
import { ExtensionsHeader } from "@/components/admin/ExtensionsHeader";
import { ModulesUpdatesSection, loadModulesUpdates } from "@/components/admin/ModulesUpdatesSection";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";
import { UPDATES_HREF } from "@/core/adminLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => `${t("nav.extensions")} \u00b7 ${t("hub.tab.updates")}`);
}

/** Extensions > Mises à jour : les mises à jour des modules (propriétaire seulement). Celles du site lui-même restent sur la page « Mises à jour du site ». */
export default async function ExtensionsUpdatesPage() {
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  if (!can(user, "core:modules.install")) redirect(EXTENSIONS_HREF);
  const data = await loadModulesUpdates(t, locale, config.defaultLocale);
  return (
    <div className="space-y-8">
      <ExtensionsHeader t={t} advanced={advanced} isOwner current="updates" />
      <ModulesUpdatesSection t={t} data={data} checkedAt={data.report.checkedAt ?? null} locale={locale} />
      <p className="text-sm"><a href={UPDATES_HREF} className="text-accent hover:underline">{t("hub.coreLinkLabel")} ›</a></p>
    </div>
  );
}
