import { DetailsView } from "./DetailsView";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";
import { findCatalogueEntry } from "@/core/modules/catalogue";
import { parseRepoUrl } from "@/core/modules/installer";
import { localized } from "@/core/modules/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ id?: string; repo?: string }> }): Promise<Metadata> {
  const { id, repo } = await searchParams;
  return adminTitle(async ({ t, locale, config }) => {
    if (id) { const entry = await findCatalogueEntry(id, { staleOk: true }); return entry ? localized(entry.name, locale, config.defaultLocale) : ""; }
    const parsed = repo ? parseRepoUrl(repo) : null;
    return parsed?.ok ? parsed.repo.url : t("catalogue.details.simple");
  }, { need: "admin" });
}

/** `?id=` : un module du catalogue ; `?repo=` : un dépôt personnel (non vérifié). Depuis le catalogue, la même fiche s'ouvre en fenêtre (voir @modal). */
export default async function CatalogueDetailsPage({ searchParams }: { searchParams: Promise<{ id?: string; repo?: string }> }) {
  const { id, repo } = await searchParams;
  return <DetailsView id={id} repo={repo} />;
}
