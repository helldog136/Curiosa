import { RouteModal } from "@/components/admin/RouteModal";
import { adminCtx } from "@/core/admin";
import { DetailsView } from "../../details/DetailsView";

export const dynamic = "force-dynamic";

/** La fiche d'un module, ouverte PAR-DESSUS le catalogue (adresse partageable : ouverte seule, elle s'affiche en page entière). */
export default async function CatalogueDetailsModal({ searchParams }: { searchParams: Promise<{ id?: string; repo?: string }> }) {
  const { id, repo } = await searchParams;
  const { t } = await adminCtx("admin");
  return <RouteModal size="medium" testid="catalogue-modal" label={t("catalogue.modalLabel")} closeLabel={t("modal.close")}><DetailsView id={id} repo={repo} embedded /></RouteModal>;
}
