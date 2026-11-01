import { redirect } from "next/navigation";
import { adminCtx } from "@/core/admin";
import { can } from "@/core/auth/access";
import { ExtensionsHeader } from "@/components/admin/ExtensionsHeader";
import { ModulesUpdatesSection, loadModulesUpdates } from "@/components/admin/ModulesUpdatesSection";
import { EXTENSIONS_HREF } from "@/core/modules/extensionsLinks";

export const dynamic = "force-dynamic";

/** Extensions > Mises à jour : les mises à jour des modules (propriétaire seulement). Celles du site lui-même restent sur la page « Mises à jour du site ». */
export default async function ExtensionsUpdatesPage() {
  const { t, locale, user, config, advanced } = await adminCtx("admin");
  if (!can(user, "core:modules.install")) redirect(EXTENSIONS_HREF);
  const data = await loadModulesUpdates(t, locale, config.defaultLocale);
  return (
    <div className="space-y-8">
      <ExtensionsHeader t={t} advanced={advanced} isOwner intro={t("hub.tab.updates.title")} current="updates" />
      <ModulesUpdatesSection t={t} data={data} when={data.report.checkedAt ? new Date(data.report.checkedAt).toLocaleString(locale) : "—"} />
      <p className="text-sm text-muted">{t("hub.coreLink")} <a href="/admin/updates" className="text-accent hover:underline">{t("hub.coreLinkLabel")} ›</a></p>
    </div>
  );
}
