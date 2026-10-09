import { CatalogueModal } from "@/components/admin/CatalogueModal";
import { DetailsView } from "../../details/DetailsView";

export const dynamic = "force-dynamic";

/** La fiche d'un module, ouverte PAR-DESSUS le catalogue (adresse partageable : ouverte seule, elle s'affiche en page entière). */
export default async function CatalogueDetailsModal({ searchParams }: { searchParams: Promise<{ id?: string; repo?: string }> }) {
  const { id, repo } = await searchParams;
  return <CatalogueModal><DetailsView id={id} repo={repo} embedded /></CatalogueModal>;
}
