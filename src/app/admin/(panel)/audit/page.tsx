import { adminCtx } from "@/core/admin";
import { MaintenanceHeader, TabIntro } from "@/components/admin/MaintenanceHeader";
import { JournalView } from "@/components/admin/JournalView";
import { AUDIT_HREF } from "@/core/adminLinks";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("maint.tab.audit"));
}

/** Le journal d'audit : tout ce qui se passe sur le site, par les personnes, les extensions, les assistants IA et le système. Une seule liste, filtrable (voir JournalView). */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, locale, config, advanced, user } = await adminCtx({ right: "core:security" });
  const sp = await searchParams;
  return (
    <div className="space-y-6">
      <MaintenanceHeader t={t} level={user.level} advanced={advanced} current="audit" />
      <TabIntro title={t("maint.tab.audit")} intro={t("journal.intro")} />
      <JournalView t={t} locale={locale} defaultLocale={config.defaultLocale} advanced={advanced} sp={sp} path={AUDIT_HREF} />
    </div>
  );
}
