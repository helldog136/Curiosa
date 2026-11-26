import { adminCtx } from "@/core/admin";
import { PageHeader } from "@/components/admin/Page";
import { SettingsSearch } from "@/components/admin/SettingsSearch";
import { settingsSearchLabels } from "@/components/admin/settingsSearchLabels";
import { hasRole } from "@/core/auth/access";
import { searchContentEntries } from "@/core/content/adminSearch";
import { searchEntriesFor } from "@/core/modules/placeSearchLoad";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("settingsSearch.title"));
}

/** (core 0.34.0) Settings search, full page: the answer is drawn by the server first (readable without a script), then the box filters it live. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { user, t, locale, config, advanced } = await adminCtx("member");
  const { q } = await searchParams;
  const entries = await searchEntriesFor(user, t, locale, config.defaultLocale, advanced);
  const query = typeof q === "string" ? q.slice(0, 100) : "";
  const canContent = hasRole(user, "editor");
  const content = canContent && query ? await searchContentEntries(query, locale, config.defaultLocale) : [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("settingsSearch.title")} intro={t("settingsSearch.intro")} />
      <SettingsSearch variant="page" labels={settingsSearchLabels(t)} endpoint="/api/admin/settings-search" contentEndpoint={canContent ? "/api/admin/content-search" : undefined} initial={entries} initialContent={content} initialQuery={query} advancedMode={advanced} />
    </div>
  );
}
