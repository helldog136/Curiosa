import { adminCtx } from "@/core/admin";
import { PageHeader } from "@/components/admin/Page";
import { SettingsSearch } from "@/components/admin/SettingsSearch";
import { settingsSearchLabels } from "@/components/admin/settingsSearchLabels";
import { searchEntriesFor } from "@/core/modules/placeSearchLoad";

export const dynamic = "force-dynamic";

/** (core 0.34.0) Settings search, full page: the answer is drawn by the server first (readable without a script), then the box filters it live. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { user, t, locale, config, advanced } = await adminCtx("member");
  const { q } = await searchParams;
  const entries = await searchEntriesFor(user, t, locale, config.defaultLocale, advanced);
  return (
    <div className="space-y-6">
      <PageHeader title={t("settingsSearch.title")} intro={t("settingsSearch.intro")} />
      <SettingsSearch variant="page" labels={settingsSearchLabels(t)} endpoint="/api/admin/settings-search" initial={entries} initialQuery={typeof q === "string" ? q.slice(0, 100) : ""} advancedMode={advanced} />
    </div>
  );
}
