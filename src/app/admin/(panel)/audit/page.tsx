import { adminCtx } from "@/core/admin";
import { PageHeader } from "@/components/admin/Page";
import { JournalView } from "@/components/admin/JournalView";

/** Le journal d'audit : tout ce qui se passe sur le site, par les personnes, les extensions, les assistants IA et le système. Une seule liste, filtrable (voir JournalView). */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t, locale, config, advanced } = await adminCtx({ right: "core:security" });
  const sp = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title={t("nav.audit")} intro={t("journal.intro")} />
      <JournalView t={t} locale={locale} defaultLocale={config.defaultLocale} advanced={advanced} sp={sp} path="/admin/audit" />
    </div>
  );
}
