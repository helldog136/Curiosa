import { DetailsView } from "./DetailsView";

export const dynamic = "force-dynamic";

/** `?id=` : un module du catalogue ; `?repo=` : un dépôt personnel (non vérifié). Depuis le catalogue, la même fiche s'ouvre en fenêtre (voir @modal). */
export default async function CatalogueDetailsPage({ searchParams }: { searchParams: Promise<{ id?: string; repo?: string }> }) {
  const { id, repo } = await searchParams;
  return <DetailsView id={id} repo={repo} />;
}
